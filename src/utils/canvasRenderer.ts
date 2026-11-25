import {
  BoothEffectId,
  CapturedPose,
  FaceEffectId,
  FilterPreset,
  LayoutMode,
  NormalizedFaceBox,
  ThemeConfig,
} from '../types/photobooth';
import { FACE_EFFECT_MAP } from '../data/faceEffects';
import { drawCuteFaceInsideHole } from './cuteFaceWarp';
import { detectFacesInImage } from './faceTracker';
import { getCachedImage, loadImage } from './imageCache';
import { renderWithMacBoothEffect } from './macBoothEffects';

export { getCachedImage, loadImage };

const MAX_PROCESSED_POSE_CACHE = 24;
const processedPoseCache = new Map<string, HTMLCanvasElement>();

function getProcessedPoseCanvas(
  dataUrl: string,
  img: HTMLImageElement,
  boothEffect: BoothEffectId
): HTMLCanvasElement {
  const key = `${dataUrl.slice(-48)}_${img.width}x${img.height}_${boothEffect}`;
  const existing = processedPoseCache.get(key);
  if (existing) {
    processedPoseCache.delete(key);
    processedPoseCache.set(key, existing);
    return existing;
  }
  const c = document.createElement('canvas');
  renderWithMacBoothEffect(img, img.width, img.height, false, boothEffect, c);
  while (processedPoseCache.size >= MAX_PROCESSED_POSE_CACHE) {
    const firstKey = processedPoseCache.keys().next().value;
    if (firstKey) processedPoseCache.delete(firstKey);
    else break;
  }
  processedPoseCache.set(key, c);
  return c;
}

export interface SlotRect {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function getCanvasDimensions(layout: LayoutMode): { width: number; height: number } {
  if (layout === '1x4') {
    return { width: 1200, height: 3600 };
  }
  return { width: 1600, height: 1640 };
}

export function getPhotoSlotRects(layout: LayoutMode, width: number, height: number): SlotRect[] {
  if (layout === '1x4') {
    const slotW = Math.round(width * 0.78);
    const slotH = Math.round(slotW * (3 / 4));
    const startX = Math.round((width - slotW) / 2);
    const startY = Math.round(height * 0.075);
    const gapY = Math.round(height * 0.014);
    return [0, 1, 2, 3].map((i) => ({
      index: i,
      x: startX,
      y: startY + i * (slotH + gapY),
      w: slotW,
      h: slotH,
    }));
  } else {
    const gap = Math.round(width * 0.03);
    const sideMargin = Math.round(width * 0.072);
    const slotW = Math.round((width - sideMargin * 2 - gap) / 2);
    const slotH = Math.round(slotW * (3 / 4));
    const startY = Math.round(height * 0.132);
    return [0, 1, 2, 3].map((i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      return {
        index: i,
        x: sideMargin + col * (slotW + gap),
        y: startY + row * (slotH + gap),
        w: slotW,
        h: slotH,
      };
    });
  }
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function renderMinimalBackground(
  ctx: CanvasRenderingContext2D,
  theme: ThemeConfig,
  width: number,
  height: number,
  slots: SlotRect[],
  customHeader?: string
) {
  ctx.save();

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, theme.bgPrimary);
  grad.addColorStop(1, theme.bgSecondary);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  if (theme.pattern === 'subtle-grid') {
    ctx.strokeStyle = 'rgba(140, 130, 150, 0.09)';
    ctx.lineWidth = 2;
    const step = 48;
    for (let x = 0; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  } else if (theme.pattern === 'split-pastel') {
    ctx.fillStyle = theme.bgPrimary;
    ctx.fillRect(0, 0, width / 2, height);
    ctx.fillStyle = theme.bgSecondary;
    ctx.fillRect(width / 2, 0, width / 2, height);

    ctx.strokeStyle = 'rgba(80, 60, 95, 0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width / 2, 36);
    ctx.lineTo(width / 2, height - 36);
    ctx.stroke();
  } else if (theme.pattern === 'soft-check') {
    ctx.fillStyle = 'rgba(215, 110, 140, 0.05)';
    const checkSize = 80;
    for (let y = 0; y < height; y += checkSize) {
      for (let x = 0; x < width; x += checkSize) {
        if ((Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0) {
          ctx.fillRect(x, y, checkSize, checkSize);
        }
      }
    }
  } else if (theme.pattern === 'fine-border') {
    ctx.strokeStyle = theme.accentColor;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 4;
    drawRoundedRectPath(ctx, 32, 32, width - 64, height - 64, 24);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (theme.id === 'bighero6-care') {
    const headerY = slots[0].y * 0.42;
    const span = 56;
    ctx.strokeStyle = '#2B2D38';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(width / 2 - span, headerY);
    ctx.lineTo(width / 2 + span, headerY);
    ctx.stroke();
    ctx.fillStyle = '#2B2D38';
    ctx.beginPath();
    ctx.arc(width / 2 - span, headerY, 12, 0, Math.PI * 2);
    ctx.arc(width / 2 + span, headerY, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  const headerText = customHeader !== undefined ? customHeader : theme.headerTitle;
  if (headerText.trim()) {
    ctx.font = '700 28px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = theme.subTextColor;
    ctx.textAlign = 'center';
    ctx.letterSpacing = '6px';
    ctx.fillText(headerText, width / 2, slots[0].y - 44);
  }

  ctx.restore();
}

function drawSourceCover(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  srcW: number,
  srcH: number,
  slot: SlotRect,
  filter: FilterPreset,
  mirror: boolean
) {
  const srcAspect = srcW / srcH;
  const slotAspect = slot.w / slot.h;
  let sx = 0,
    sy = 0,
    sw = srcW,
    sh = srcH;
  if (srcAspect > slotAspect) {
    sw = srcH * slotAspect;
    sx = (srcW - sw) / 2;
  } else {
    sh = srcW / slotAspect;
    sy = (srcH - sh) / 2;
  }

  ctx.save();
  ctx.filter = filter.cssFilter;
  if (mirror) {
    ctx.translate(slot.x + slot.w, slot.y);
    ctx.scale(-1, 1);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, slot.w, slot.h);
  } else {
    ctx.drawImage(source, sx, sy, sw, sh, slot.x, slot.y, slot.w, slot.h);
  }
  ctx.restore();

  if (filter.tintColor) {
    ctx.fillStyle = filter.tintColor;
    ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
  }

  if (filter.vignette) {
    const radGrad = ctx.createRadialGradient(
      slot.x + slot.w / 2,
      slot.y + slot.h / 2,
      slot.w * 0.3,
      slot.x + slot.w / 2,
      slot.y + slot.h / 2,
      slot.w * 0.72
    );
    radGrad.addColorStop(0, 'rgba(0,0,0,0)');
    radGrad.addColorStop(1, 'rgba(35, 25, 15, 0.24)');
    ctx.fillStyle = radGrad;
    ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
  }
}

const LIVE_PREVIEW_FALLBACK_FACE: NormalizedFaceBox = {
  cx: 0.5,
  cy: 0.45,
  w: 0.26,
  h: 0.34,
  angle: 0,
};

function drawFaceEffectOverlays(
  ctx: CanvasRenderingContext2D,
  slot: SlotRect,
  faces: NormalizedFaceBox[] | undefined,
  faceEffect: FaceEffectId,
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  srcW: number,
  srcH: number,
  mirror: boolean,
  filter: FilterPreset,
  allowCenterFallback: boolean
) {
  if (faceEffect === 'none') return;
  const preset = FACE_EFFECT_MAP[faceEffect];
  if (!preset) return;
  const img = getCachedImage(preset.src);
  if (!img) return;

  const targets =
    faces && faces.length > 0
      ? faces
      : allowCenterFallback
      ? [LIVE_PREVIEW_FALLBACK_FACE]
      : [];

  for (const face of targets) {
    const faceCenterX = slot.x + face.cx * slot.w;
    const faceCenterY = slot.y + face.cy * slot.h;
    const targetHoleW = face.w * slot.w * 1.20;
    const drawW = targetHoleW / preset.holeW;
    const drawH = drawW * (img.height / img.width);

    drawCuteFaceInsideHole(
      ctx,
      source,
      srcW,
      srcH,
      mirror,
      slot,
      face,
      preset,
      filter,
      drawW,
      drawH
    );

    ctx.save();
    ctx.translate(faceCenterX, faceCenterY);
    ctx.rotate(face.angle);
    ctx.drawImage(
      img,
      -preset.holeCx * drawW,
      -preset.holeCy * drawH,
      drawW,
      drawH
    );
    ctx.restore();
  }
}

function drawSlotSync(
  ctx: CanvasRenderingContext2D,
  slot: SlotRect,
  pose: CapturedPose | undefined,
  theme: ThemeConfig,
  filter: FilterPreset,
  liveBoothEffect: BoothEffectId,
  liveFaceEffect: FaceEffectId,
  liveFaceBoxes: NormalizedFaceBox[],
  isSelected: boolean,
  liveVideoSource?: HTMLVideoElement | HTMLCanvasElement | null,
  liveVideoMirroredAlready?: boolean,
  isMirrored?: boolean,
  isLiveTarget?: boolean,
  countdownDisplay?: string | null,
  showFlash?: boolean
) {
  ctx.save();

  const pad = 10;
  ctx.save();
  ctx.shadowColor = 'rgba(20, 20, 30, 0.07)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 5;
  drawRoundedRectPath(ctx, slot.x - pad, slot.y - pad, slot.w + pad * 2, slot.h + pad * 2, 16);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  if (isSelected) {
    drawRoundedRectPath(
      ctx,
      slot.x - pad - 4,
      slot.y - pad - 4,
      slot.w + (pad + 4) * 2,
      slot.h + (pad + 4) * 2,
      20
    );
    ctx.lineWidth = 6;
    ctx.strokeStyle = theme.accentColor;
    ctx.stroke();
  }

  drawRoundedRectPath(ctx, slot.x, slot.y, slot.w, slot.h, 10);
  ctx.clip();

  const hasCaptured = Boolean(pose && pose.dataUrl);
  const shouldShowLive = (!hasCaptured || isLiveTarget) && Boolean(liveVideoSource);

  if (shouldShowLive && liveVideoSource) {
    const srcW =
      liveVideoSource instanceof HTMLVideoElement
        ? liveVideoSource.videoWidth
        : liveVideoSource.width;
    const srcH =
      liveVideoSource instanceof HTMLVideoElement
        ? liveVideoSource.videoHeight
        : liveVideoSource.height;
    const effectiveMirror = liveVideoMirroredAlready ? false : Boolean(isMirrored);

    drawSourceCover(ctx, liveVideoSource, srcW, srcH, slot, filter, effectiveMirror);

    // Live slots use the active studio faceEffect & live tracked faces
    drawFaceEffectOverlays(
      ctx,
      slot,
      liveFaceBoxes,
      liveFaceEffect,
      liveVideoSource,
      srcW,
      srcH,
      effectiveMirror,
      filter,
      true
    );

    if (showFlash && isLiveTarget) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
    }

    if (countdownDisplay && isLiveTarget) {
      ctx.fillStyle = 'rgba(20, 18, 25, 0.18)';
      ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
      ctx.font = '700 160px "Fredoka", sans-serif';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 24;
      ctx.fillText(countdownDisplay, slot.x + slot.w / 2, slot.y + slot.h / 2);
      ctx.shadowBlur = 0;
    }
  } else if (hasCaptured && pose?.dataUrl) {
    const img = getCachedImage(pose.dataUrl);
    if (img) {
      // Captured slots are immutable snapshots: each slot uses its own locked boothEffect & faceEffect
      const slotBoothFx = pose.boothEffect ?? 'none';
      const slotFaceFx = pose.faceEffect ?? 'none';

      if (slotBoothFx !== 'none') {
        const fxCanvas = getProcessedPoseCanvas(pose.dataUrl, img, slotBoothFx);
        drawSourceCover(ctx, fxCanvas, fxCanvas.width, fxCanvas.height, slot, filter, false);
        drawFaceEffectOverlays(
          ctx,
          slot,
          pose.faceBoxes,
          slotFaceFx,
          fxCanvas,
          fxCanvas.width,
          fxCanvas.height,
          false,
          filter,
          false
        );
      } else {
        drawSourceCover(ctx, img, img.width, img.height, slot, filter, false);
        drawFaceEffectOverlays(
          ctx,
          slot,
          pose.faceBoxes,
          slotFaceFx,
          img,
          img.width,
          img.height,
          false,
          filter,
          false
        );
      }
    } else {
      drawEmptyMinimalPlaceholder(ctx, slot, theme);
    }
  } else {
    drawEmptyMinimalPlaceholder(ctx, slot, theme);
  }

  // Silence unused param lint when liveBoothEffect is handled upstream
  void liveBoothEffect;
  ctx.restore();
}

function drawEmptyMinimalPlaceholder(
  ctx: CanvasRenderingContext2D,
  slot: SlotRect,
  theme: ThemeConfig
) {
  ctx.fillStyle = '#F7F6F4';
  ctx.fillRect(slot.x, slot.y, slot.w, slot.h);

  ctx.fillStyle = theme.subTextColor;
  ctx.globalAlpha = 0.4;
  ctx.font = '600 42px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`0${slot.index + 1}`, slot.x + slot.w / 2, slot.y + slot.h / 2);
  ctx.globalAlpha = 1;
}

export interface RenderLiveFrameOptions {
  canvas: HTMLCanvasElement;
  theme: ThemeConfig;
  layout: LayoutMode;
  poses: CapturedPose[];
  filter: FilterPreset;
  boothEffect?: BoothEffectId;
  faceEffect?: FaceEffectId;
  liveFaceBoxes?: NormalizedFaceBox[];
  customHeader?: string;
  customCaption: string;
  showDatestamp: boolean;
  customDateText: string;
  selectedSlotIndex?: number | null;
  activeShootingSlot?: number | null;
  liveVideo?: HTMLVideoElement | null;
  isMirrored?: boolean;
  countdownDisplay?: string | null;
  showFlash?: boolean;
  /** 0.5 for 60fps live preview (4x fewer pixels), 1.0 for high-DPI PNG export */
  renderScale?: number;
}

/**
 * Synchronous 60fps frame renderer for live camera-in-frame display
 */
export function renderLiveFrameSync(options: RenderLiveFrameOptions) {
  const {
    canvas,
    theme,
    layout,
    poses,
    filter,
    boothEffect = 'none',
    faceEffect = 'none',
    liveFaceBoxes = [],
    customHeader,
    customCaption,
    showDatestamp,
    customDateText,
    selectedSlotIndex = null,
    activeShootingSlot = null,
    liveVideo = null,
    isMirrored = true,
    countdownDisplay = null,
    showFlash = false,
    renderScale = 1,
  } = options;

  const { width, height } = getCanvasDimensions(layout);
  const targetW = Math.round(width * renderScale);
  const targetH = Math.round(height * renderScale);

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const slots = getPhotoSlotRects(layout, width, height);

  // 1. Background & Header
  renderMinimalBackground(ctx, theme, width, height, slots, customHeader);

  // Prepare live video source once per tick
  const videoReady =
    liveVideo && liveVideo.readyState >= 2 && liveVideo.videoWidth > 0 && liveVideo.videoHeight > 0;
  let liveSource: HTMLVideoElement | HTMLCanvasElement | null = null;
  let liveSourceMirroredAlready = false;

  if (videoReady && liveVideo) {
    if (boothEffect !== 'none') {
      liveSource = renderWithMacBoothEffect(
        liveVideo,
        liveVideo.videoWidth,
        liveVideo.videoHeight,
        isMirrored,
        boothEffect
      );
      liveSourceMirroredAlready = true;
    } else {
      liveSource = liveVideo;
      liveSourceMirroredAlready = false;
    }
  }

  // 2. Photo Slots
  for (let i = 0; i < 4; i++) {
    const isLiveTarget =
      activeShootingSlot !== null
        ? activeShootingSlot === i
        : selectedSlotIndex === i || !poses[i]?.dataUrl;

    drawSlotSync(
      ctx,
      slots[i],
      poses[i],
      theme,
      filter,
      boothEffect,
      faceEffect,
      liveFaceBoxes,
      selectedSlotIndex === i,
      liveSource,
      liveSourceMirroredAlready,
      isMirrored,
      isLiveTarget,
      activeShootingSlot === i ? countdownDisplay : null,
      activeShootingSlot === i ? showFlash : false
    );
  }

  // 3. Real Character Art Overlays
  for (const item of theme.placements) {
    const img = getCachedImage(item.src);
    if (!img) continue;
    const cx = (layout === '1x4' ? item.x1x4 : item.x2x2) * width;
    const cy = (layout === '1x4' ? item.y1x4 : item.y2x2) * height;
    const targetW = (layout === '1x4' ? item.w1x4 : item.w2x2) * width;
    const rot = ((layout === '1x4' ? item.rot1x4 : item.rot2x2) * Math.PI) / 180;
    const targetH = targetW * (img.height / img.width);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
    ctx.restore();
  }

  // 4. Footer Text & Datestamp
  const footerCenterY = layout === '1x4' ? height * 0.946 : height * 0.892;
  ctx.save();
  const tagline = customCaption.trim() || theme.defaultTagline;
  ctx.font = `700 ${layout === '1x4' ? 36 : 34}px "Fredoka", "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = theme.textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tagline, width / 2, showDatestamp ? footerCenterY - 22 : footerCenterY);

  if (showDatestamp) {
    ctx.font = `500 ${layout === '1x4' ? 22 : 21}px "JetBrains Mono", monospace`;
    ctx.fillStyle = theme.subTextColor;
    ctx.fillText(customDateText.trim() || theme.defaultDatestamp, width / 2, footerCenterY + 24);
  }
  ctx.restore();

  ctx.restore();
}

/**
 * Async full-resolution compositor for PNG/MP4/GIF export.
 * Preloads all assets AND runs a safety-net static face detection pass on any
 * captured slot that has a faceEffect enabled but empty faceBoxes.
 */
export async function renderPhotoboothComposite(options: {
  canvas: HTMLCanvasElement;
  theme: ThemeConfig;
  layout: LayoutMode;
  poses: CapturedPose[];
  filter: FilterPreset;
  customHeader?: string;
  customCaption: string;
  showDatestamp: boolean;
  customDateText: string;
  selectedSlotIndex?: number | null;
}) {
  const { theme, poses } = options;

  // Collect all unique per-slot face effect images to preload
  const effectSrcs = new Set<string>();
  for (const p of poses) {
    if (p.faceEffect && p.faceEffect !== 'none') {
      const src = FACE_EFFECT_MAP[p.faceEffect]?.src;
      if (src) effectSrcs.add(src);
    }
  }

  await Promise.all([
    ...theme.placements.map((p) => loadImage(p.src).catch(() => {})),
    ...Array.from(effectSrcs).map((src) => loadImage(src).catch(() => {})),
    ...poses
      .filter((p) => Boolean(p.dataUrl))
      .map((p) => loadImage(p.dataUrl!).catch(() => {})),
  ]);

  // Safety net: if any captured pose has a faceEffect enabled but missed faceBoxes at capture time,
  // run static IMAGE-mode MediaPipe detection so the downloaded PNG never falls back to a stationary center!
  const hydratedPoses = await Promise.all(
    poses.map(async (p) => {
      if (p.dataUrl && p.faceEffect !== 'none' && (!p.faceBoxes || p.faceBoxes.length === 0)) {
        const img = getCachedImage(p.dataUrl);
        if (img) {
          const detected = await detectFacesInImage(img);
          if (detected.length > 0) {
            return { ...p, faceBoxes: detected };
          }
        }
      }
      return p;
    })
  );

  renderLiveFrameSync({
    ...options,
    poses: hydratedPoses,
    renderScale: 1,
  });
}
