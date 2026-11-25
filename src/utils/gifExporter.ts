import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import {
  CapturedPose,
  FilterPreset,
  LayoutMode,
  ThemeConfig,
} from '../types/photobooth';
import { renderPhotoboothComposite } from './canvasRenderer';

export interface AnimatedExportOptions {
  theme: ThemeConfig;
  layout: LayoutMode;
  poses: CapturedPose[];
  filter: FilterPreset;
  customHeader?: string;
  customCaption: string;
  showDatestamp: boolean;
  customDateText: string;
}

/**
 * Renders the 4 burst composite canvases at the given target resolution,
 * preserving each slot's locked faceEffect, boothEffect, and per-burst-frame faceBoxes.
 */
async function renderBurstCanvases(
  options: AnimatedExportOptions,
  targetW: number,
  targetH: number
): Promise<HTMLCanvasElement[]> {
  const {
    theme,
    layout,
    poses,
    filter,
    customHeader,
    customCaption,
    showDatestamp,
    customDateText,
  } = options;

  const fullCanvas = document.createElement('canvas');
  const canvases: HTMLCanvasElement[] = [];

  for (let f = 0; f < 4; f++) {
    const framePoses: CapturedPose[] = poses.map((p) => {
      if (p.burstFrames && p.burstFrames.length > 1) {
        const bf = p.burstFrames[f % p.burstFrames.length];
        return {
          ...p,
          dataUrl: bf.dataUrl,
          faceBoxes: bf.faceBoxes.length > 0 ? bf.faceBoxes : p.faceBoxes,
        };
      }
      return p;
    });

    await renderPhotoboothComposite({
      canvas: fullCanvas,
      theme,
      layout,
      poses: framePoses,
      filter,
      customHeader,
      customCaption,
      showDatestamp,
      customDateText,
    });

    const c = document.createElement('canvas');
    c.width = targetW;
    c.height = targetH;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(fullCanvas, 0, 0, targetW, targetH);
    canvases.push(c);
  }

  return canvases;
}

async function resolveSupportedH264Config(
  width: number,
  height: number,
  fps: number
): Promise<VideoEncoderConfig> {
  const candidates = ['avc1.640033', 'avc1.64002a', 'avc1.4d002a', 'avc1.42001f'];
  for (const codec of candidates) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: 14_000_000,
      framerate: fps,
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return config;
      }
    } catch {
      // Try next profile/level
    }
  }
  return {
    codec: 'avc1.42001f',
    width,
    height,
    bitrate: 10_000_000,
    framerate: fps,
  };
}

/**
 * Exports a high-bitrate, full-color 11.7-second (11 loops) H.264 .mp4 video
 */
export async function exportAnimatedPurikuraMp4(
  options: AnimatedExportOptions
): Promise<Blob> {
  const mp4W = options.layout === '1x4' ? 960 : 1280;
  const mp4H = options.layout === '1x4' ? 2880 : 1312;

  const burstCanvases = await renderBurstCanvases(options, mp4W, mp4H);

  const fps = 30;
  const framesPerStep = 8;
  const totalLoops = 11;
  const totalVideoFrames = totalLoops * 4 * framesPerStep;

  const encoderConfig = await resolveSupportedH264Config(mp4W, mp4H, fps);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: mp4W,
      height: mp4H,
    },
    fastStart: 'in-memory',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => console.error('VideoEncoder error:', err),
  });

  encoder.configure(encoderConfig);

  const frameDurationUs = Math.round(1_000_000 / fps);

  for (let i = 0; i < totalVideoFrames; i++) {
    const stepIdx = Math.floor(i / framesPerStep) % 4;
    const sourceCanvas = burstCanvases[stepIdx];
    const timestampUs = i * frameDurationUs;

    const vFrame = new VideoFrame(sourceCanvas, {
      timestamp: timestampUs,
      duration: frameDurationUs,
    });
    encoder.encode(vFrame, { keyFrame: i % 30 === 0 });
    vFrame.close();
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  return new Blob([target.buffer], { type: 'video/mp4' });
}

export async function exportAnimatedPurikuraGif(
  options: AnimatedExportOptions
): Promise<Blob> {
  const gifW = options.layout === '1x4' ? 480 : 640;
  const gifH = options.layout === '1x4' ? 1440 : 656;

  const burstCanvases = await renderBurstCanvases(options, gifW, gifH);
  const gif = GIFEncoder();

  for (let f = 0; f < 4; f++) {
    const ctx = burstCanvases[f].getContext('2d', { willReadFrequently: true })!;
    const imgData = ctx.getImageData(0, 0, gifW, gifH);
    const palette = quantize(imgData.data, 256);
    const index = applyPalette(imgData.data, palette);
    gif.writeFrame(index, gifW, gifH, { palette, delay: 280 });
  }

  gif.finish();
  const bytes = gif.bytes();
  return new Blob([bytes], { type: 'image/gif' });
}
