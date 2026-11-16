import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import {
  BoothEffectId,
  CapturedPose,
  FaceEffectId,
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
  boothEffect?: BoothEffectId;
  faceEffect?: FaceEffectId;
  customHeader?: string;
  customCaption: string;
  showDatestamp: boolean;
  customDateText: string;
}

/**
 * Renders the 4 burst composite canvases at the given target resolution
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
    boothEffect = 'none',
    faceEffect = 'none',
    customHeader,
    customCaption,
    showDatestamp,
    customDateText,
  } = options;

  const fullCanvas = document.createElement('canvas');
  const canvases: HTMLCanvasElement[] = [];

  for (let f = 0; f < 4; f++) {
    const framePoses: CapturedPose[] = poses.map((p) => {
      if (p.burstUrls && p.burstUrls.length > 1) {
        const bUrl = p.burstUrls[f % p.burstUrls.length];
        return { dataUrl: bUrl, burstUrls: p.burstUrls };
      }
      return p;
    });

    await renderPhotoboothComposite({
      canvas: fullCanvas,
      theme,
      layout,
      poses: framePoses,
      filter,
      boothEffect,
      faceEffect,
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

/**
 * Exports a high-bitrate, full-color 11.2-second (10 loops) H.264 .mp4 video
 */
export async function exportAnimatedPurikuraMp4(
  options: AnimatedExportOptions
): Promise<Blob> {
  // Dimensions divisible by 16 for hardware H.264 VideoEncoder compatibility
  const mp4W = options.layout === '1x4' ? 960 : 1280;
  const mp4H = options.layout === '1x4' ? 2880 : 1312;

  const burstCanvases = await renderBurstCanvases(options, mp4W, mp4H);

  const fps = 30;
  const framesPerStep = 8; // 8 / 30s = 0.266s per burst pose
  const totalLoops = 11; // 11 * 4 * 8 / 30 = 11.73 seconds (> 10s)
  const totalVideoFrames = totalLoops * 4 * framesPerStep;

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

  encoder.configure({
    codec: 'avc1.640033', // High Profile Level 5.1 (supports up to 4K)
    width: mp4W,
    height: mp4H,
    bitrate: 16_000_000,
    framerate: fps,
  });

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
