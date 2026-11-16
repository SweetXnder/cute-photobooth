import { FaceEffectPreset, FilterPreset, NormalizedFaceBox } from '../types/photobooth';

const PATCH_SIZE = 240;

let facePatchSrc: HTMLCanvasElement | null = null;
let facePatchDst: HTMLCanvasElement | null = null;
let cuteLut: Uint32Array | null = null;

function ensurePatchCanvases() {
  if (!facePatchSrc) {
    facePatchSrc = document.createElement('canvas');
    facePatchSrc.width = PATCH_SIZE;
    facePatchSrc.height = PATCH_SIZE;
  }
  if (!facePatchDst) {
    facePatchDst = document.createElement('canvas');
    facePatchDst.width = PATCH_SIZE;
    facePatchDst.height = PATCH_SIZE;
  }
  return { srcCanvas: facePatchSrc, dstCanvas: facePatchDst };
}

/**
 * Precomputes a 240x240 displacement LUT for an IG/Purikura "cute chubby cheeks"
 * + subtle bright-eyes warp.
 */
function getCuteWarpLut(): Uint32Array {
  if (cuteLut) return cuteLut;

  const lut = new Uint32Array(PATCH_SIZE * PATCH_SIZE);
  const half = PATCH_SIZE / 2;

  // Gentle, proportional IG-style chubby cheeks + subtle bright eyes (keeps glasses natural)
  const cheeks = [
    { cx: -0.44, cy: 0.22, r: 0.54, power: 1.26 },
    { cx: 0.44, cy: 0.22, r: 0.54, power: 1.26 },
  ];
  const eyes = [
    { cx: -0.28, cy: -0.14, r: 0.24, power: 1.07 },
    { cx: 0.28, cy: -0.14, r: 0.24, power: 1.07 },
  ];

  for (let y = 0; y < PATCH_SIZE; y++) {
    const ny = (y - half) / half;
    for (let x = 0; x < PATCH_SIZE; x++) {
      const nx = (x - half) / half;

      let ux = nx;
      let uy = ny;

      // Apply chubby cheek puffiness
      for (const c of cheeks) {
        const dx = ux - c.cx;
        const dy = uy - c.cy;
        const dist = Math.hypot(dx, dy);
        if (dist < c.r && dist > 0.0001) {
          const rn = dist / c.r;
          // Smooth falloff so edges blend seamlessly
          const blend = 1 - rn * rn;
          const warpedDist = c.r * Math.pow(rn, c.power);
          const factor = 1 + blend * (warpedDist / dist - 1);
          ux = c.cx + dx * factor;
          uy = c.cy + dy * factor;
        }
      }

      // Apply gentle cute eye enlargement
      for (const e of eyes) {
        const dx = ux - e.cx;
        const dy = uy - e.cy;
        const dist = Math.hypot(dx, dy);
        if (dist < e.r && dist > 0.0001) {
          const rn = dist / e.r;
          const blend = 1 - rn * rn;
          const warpedDist = e.r * Math.pow(rn, e.power);
          const factor = 1 + blend * (warpedDist / dist - 1);
          ux = e.cx + dx * factor;
          uy = e.cy + dy * factor;
        }
      }

      let sx = Math.round(ux * half + half);
      let sy = Math.round(uy * half + half);
      if (sx < 0) sx = 0;
      else if (sx >= PATCH_SIZE) sx = PATCH_SIZE - 1;
      if (sy < 0) sy = 0;
      else if (sy >= PATCH_SIZE) sy = PATCH_SIZE - 1;

      lut[y * PATCH_SIZE + x] = sy * PATCH_SIZE + sx;
    }
  }

  cuteLut = lut;
  return lut;
}

/**
 * Crops the detected face from `source`, applies the chubby-cheek cute warp + rosy blush,
 * and draws it snugly inside the plushie's oval face hole.
 */
export function drawCuteFaceInsideHole(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  srcW: number,
  srcH: number,
  mirror: boolean,
  slot: { x: number; y: number; w: number; h: number },
  face: NormalizedFaceBox,
  preset: FaceEffectPreset,
  filter: FilterPreset,
  drawW: number,
  drawH: number
) {
  if (srcW === 0 || srcH === 0) return;

  const { srcCanvas, dstCanvas } = ensurePatchCanvases();
  const sCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  const dCtx = dstCanvas.getContext('2d', { willReadFrequently: true })!;

  // Compute the 4:3 cover crop in `source` pixel coordinates
  const slotAspect = slot.w / slot.h;
  const srcAspect = srcW / srcH;
  let cropX = 0,
    cropY = 0,
    cropW = srcW,
    cropH = srcH;
  if (srcAspect > slotAspect) {
    cropW = srcH * slotAspect;
    cropX = (srcW - cropW) / 2;
  } else {
    cropH = srcW / slotAspect;
    cropY = (srcH - cropH) / 2;
  }

  // Face center in the 4:3 slot [0..1] -> convert back to un-mirrored normalized [0..1] in crop
  const unmirroredCx = mirror ? 1 - face.cx : face.cx;
  const sampleCenterX = cropX + unmirroredCx * cropW;
  const sampleCenterY = cropY + face.cy * cropH;

  // Sample from cheekbone-to-cheekbone width so the face fills 100% of the oval hole with zero side gaps
  const sampleSpan = face.w * cropW * 0.98;

  sCtx.save();
  sCtx.clearRect(0, 0, PATCH_SIZE, PATCH_SIZE);
  sCtx.translate(PATCH_SIZE / 2, PATCH_SIZE / 2);
  if (mirror) {
    sCtx.scale(-1, 1);
  }
  // Un-rotate by -face.angle so the face patch is upright for the cheek/eye LUT
  sCtx.rotate(mirror ? face.angle : -face.angle);
  const scale = PATCH_SIZE / sampleSpan;
  sCtx.scale(scale, scale);
  sCtx.drawImage(source, -sampleCenterX, -sampleCenterY);
  sCtx.restore();

  // Apply chubby cheeks + subtle cute eyes warp LUT
  const srcData = sCtx.getImageData(0, 0, PATCH_SIZE, PATCH_SIZE);
  const dstData = dCtx.createImageData(PATCH_SIZE, PATCH_SIZE);
  const src32 = new Uint32Array(srcData.data.buffer);
  const dst32 = new Uint32Array(dstData.data.buffer);
  const lut = getCuteWarpLut();
  for (let i = 0; i < lut.length; i++) {
    dst32[i] = src32[lut[i]];
  }
  dCtx.putImageData(dstData, 0, 0);

  // Add soft kawaii rosy blush on both cheeks
  const blushPositions = [
    { x: PATCH_SIZE * 0.27, y: PATCH_SIZE * 0.59 },
    { x: PATCH_SIZE * 0.73, y: PATCH_SIZE * 0.59 },
  ];
  for (const b of blushPositions) {
    const r = PATCH_SIZE * 0.14;
    const grad = dCtx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
    grad.addColorStop(0, 'rgba(255, 118, 142, 0.34)');
    grad.addColorStop(0.6, 'rgba(255, 138, 160, 0.16)');
    grad.addColorStop(1, 'rgba(255, 150, 170, 0)');
    dCtx.fillStyle = grad;
    dCtx.beginPath();
    dCtx.arc(b.x, b.y, r, 0, Math.PI * 2);
    dCtx.fill();
  }

  // Draw the warped cute face clipped inside the plushie's oval opening (zero gap around rim)
  const faceCenterX = slot.x + face.cx * slot.w;
  const faceCenterY = slot.y + face.cy * slot.h;
  const rx = (preset.holeW * drawW) * 0.53;
  const ry = (preset.holeH * drawH) * 0.53;
  const patchDrawSize = rx * 2.08;

  ctx.save();
  ctx.translate(faceCenterX, faceCenterY);
  ctx.rotate(face.angle);

  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();

  ctx.save();
  ctx.filter = filter.cssFilter;
  ctx.drawImage(
    dstCanvas,
    -patchDrawSize / 2,
    -patchDrawSize / 2,
    patchDrawSize,
    patchDrawSize
  );
  ctx.restore();

  if (filter.tintColor) {
    ctx.fillStyle = filter.tintColor;
    ctx.fillRect(-rx, -ry, rx * 2, ry * 2);
  }

  // Subtle inner rim shadow so the face looks nestled inside the fluffy plushie hood
  const rimGrad = ctx.createRadialGradient(0, 0, Math.min(rx, ry) * 0.68, 0, 0, Math.max(rx, ry) * 1.05);
  rimGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  rimGrad.addColorStop(1, 'rgba(40, 22, 22, 0.24)');
  ctx.fillStyle = rimGrad;
  ctx.fillRect(-rx, -ry, rx * 2, ry * 2);

  ctx.restore();
}
