import { FaceDetector, FilesetResolver, Detection } from '@mediapipe/tasks-vision';
import { NormalizedFaceBox } from '../types/photobooth';

let videoDetector: FaceDetector | null = null;
let imageDetector: FaceDetector | null = null;
let initPromise: Promise<void> | null = null;

let lastVideoDetectMs = 0;
let lastVideoTime = -1;
let smoothedFaces: NormalizedFaceBox[] = [];

export async function ensureFaceTrackerReady(): Promise<void> {
  if (videoDetector && imageDetector) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    const modelAssetPath = '/mediapipe/blaze_face_short_range.tflite';

    videoDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.42,
    });

    imageDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath,
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.40,
    });
  })();

  try {
    await initPromise;
  } catch (err) {
    initPromise = null;
    console.warn('FaceDetector initialization failed:', err);
  }
}

function mapDetectionsToSlotCoords(
  detections: Detection[],
  srcW: number,
  srcH: number,
  isMirrored: boolean
): NormalizedFaceBox[] {
  if (!detections || detections.length === 0 || srcW === 0 || srcH === 0) {
    return [];
  }

  const slotAspect = 4 / 3;
  const srcAspect = srcW / srcH;
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

  const mapped: NormalizedFaceBox[] = [];
  for (const det of detections) {
    const box = det.boundingBox;
    if (!box) continue;

    const rawCx = box.originX + box.width / 2;
    const rawCy = box.originY + box.height / 2;

    let cx = (rawCx - sx) / sw;
    // BlazeFace box spans eyebrows-to-chin; shift up slightly so eyebrows & forehead sit cleanly inside the hole
    const cy = (rawCy - sy) / sh - (box.height / sh) * 0.08;
    const w = box.width / sw;
    const h = box.height / sh;

    if (isMirrored) {
      cx = 1 - cx;
    }

    // Ignore faces completely outside the 4:3 crop
    if (cx < -0.15 || cx > 1.15 || cy < -0.15 || cy > 1.15) continue;

    let angle = 0;
    if (det.keypoints && det.keypoints.length >= 2) {
      const k0 = det.keypoints[0];
      const k1 = det.keypoints[1];
      let x0 = (k0.x * srcW - sx) / sw;
      const y0 = (k0.y * srcH - sy) / sh;
      let x1 = (k1.x * srcW - sx) / sw;
      const y1 = (k1.y * srcH - sy) / sh;
      if (isMirrored) {
        x0 = 1 - x0;
        x1 = 1 - x1;
      }
      let dx = (x1 - x0) * 4;
      let dy = (y1 - y0) * 3;
      if (dx < 0) {
        dx = -dx;
        dy = -dy;
      }
      if (Math.hypot(dx, dy) > 0.01) {
        angle = Math.atan2(dy, dx);
        // Clamp extreme angles
        angle = Math.max(-0.55, Math.min(0.55, angle));
      }
    }

    mapped.push({ cx, cy, w, h, angle });
  }

  // Sort left-to-right for stable matching
  mapped.sort((a, b) => a.cx - b.cx);
  return mapped;
}

function smoothFaceList(
  prev: NormalizedFaceBox[],
  next: NormalizedFaceBox[]
): NormalizedFaceBox[] {
  if (next.length === 0) return [];
  if (prev.length !== next.length) return next;

  const alpha = 0.42; // Responsive yet jitter-free
  return next.map((n, i) => {
    const p = prev[i];
    if (Math.abs(p.cx - n.cx) > 0.25) return n;
    return {
      cx: p.cx + (n.cx - p.cx) * alpha,
      cy: p.cy + (n.cy - p.cy) * alpha,
      w: p.w + (n.w - p.w) * alpha,
      h: p.h + (n.h - p.h) * alpha,
      angle: p.angle + (n.angle - p.angle) * alpha,
    };
  });
}

/**
 * Runs throttled (~30fps) face detection on the live webcam video and returns
 * smoothed face bounding boxes in normalized 4:3 slot coordinates.
 */
export function detectFacesInVideoFrame(
  video: HTMLVideoElement,
  isMirrored: boolean
): NormalizedFaceBox[] {
  if (!videoDetector || video.readyState < 2 || video.videoWidth === 0) {
    return smoothedFaces;
  }

  const now = performance.now();
  if (now - lastVideoDetectMs < 28 && video.currentTime === lastVideoTime) {
    return smoothedFaces;
  }

  lastVideoDetectMs = now;
  lastVideoTime = video.currentTime;

  try {
    const result = videoDetector.detectForVideo(video, now);
    const rawFaces = mapDetectionsToSlotCoords(
      result.detections,
      video.videoWidth,
      video.videoHeight,
      isMirrored
    );
    smoothedFaces = smoothFaceList(smoothedFaces, rawFaces);
  } catch {
    // Keep last smoothed faces on transient frame error
  }

  return smoothedFaces;
}

/**
 * Runs one-shot face detection on a static/uploaded image.
 */
export async function detectFacesInImage(
  img: HTMLImageElement
): Promise<NormalizedFaceBox[]> {
  await ensureFaceTrackerReady();
  if (!imageDetector || img.width === 0 || img.height === 0) {
    return [];
  }
  try {
    const result = imageDetector.detect(img);
    return mapDetectionsToSlotCoords(result.detections, img.width, img.height, false);
  } catch {
    return [];
  }
}
