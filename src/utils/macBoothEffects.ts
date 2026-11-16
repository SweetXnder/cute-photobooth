import { BoothEffectId, BoothEffectPreset } from '../types/photobooth';

export const BOOTH_EFFECT_PRESETS: BoothEffectPreset[] = [
  { id: 'none', name: 'Normal' },
  { id: 'bulge', name: 'Bulge' },
  { id: 'pinch', name: 'Pinch' },
  { id: 'twirl', name: 'Twirl' },
  { id: 'mirror', name: 'Mirror' },
  { id: 'thermal', name: 'Thermal' },
  { id: 'xray', name: 'X-Ray' },
  { id: 'pop-art', name: 'Pop Art' },
];

const FX_W = 560;
const FX_H = 420;

// Precomputed coordinate displacement LUTs for spatial effects (FX_W x FX_H)
const spatialLutCache = new Map<BoothEffectId, Uint32Array>();

function getSpatialLut(effect: BoothEffectId): Uint32Array {
  if (spatialLutCache.has(effect)) {
    return spatialLutCache.get(effect)!;
  }

  const lut = new Uint32Array(FX_W * FX_H);
  const cx = FX_W / 2;
  const cy = FX_H / 2;
  const maxR = Math.min(cx, cy) * 0.92;

  for (let y = 0; y < FX_H; y++) {
    for (let x = 0; x < FX_W; x++) {
      let sx = x;
      let sy = y;

      if (effect === 'mirror') {
        sx = x < cx ? x : FX_W - 1 - x;
      } else {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);

        if (r < maxR && r > 0.0001) {
          const rn = r / maxR; // 0..1
          if (effect === 'bulge') {
            // Classic Mac Photo Booth Bulge: magnifies center
            const rSrc = maxR * Math.pow(rn, 1.68);
            const scale = rSrc / r;
            sx = Math.round(cx + dx * scale);
            sy = Math.round(cy + dy * scale);
          } else if (effect === 'pinch') {
            // Classic Mac Photo Booth Pinch: shrinks center into tiny face
            const rSrc = maxR * Math.pow(rn, 0.56);
            const scale = rSrc / r;
            sx = Math.round(cx + dx * scale);
            sy = Math.round(cy + dy * scale);
          } else if (effect === 'twirl') {
            // Classic Mac Photo Booth Twirl: swirls center
            const angle = Math.pow(1 - rn, 2) * 2.35;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            sx = Math.round(cx + dx * cosA - dy * sinA);
            sy = Math.round(cy + dx * sinA + dy * cosA);
          }
        }
      }

      if (sx < 0) sx = 0;
      else if (sx >= FX_W) sx = FX_W - 1;
      if (sy < 0) sy = 0;
      else if (sy >= FX_H) sy = FX_H - 1;

      lut[y * FX_W + x] = sy * FX_W + sx;
    }
  }

  spatialLutCache.set(effect, lut);
  return lut;
}

// Precompute 256-entry packed ABGR color LUT for Thermal & X-Ray
const thermalLut = new Uint32Array(256);
const xrayLut = new Uint32Array(256);

function packABGR(r: number, g: number, b: number): number {
  return (
    (255 << 24) |
    ((b & 0xff) << 16) |
    ((g & 0xff) << 8) |
    (r & 0xff)
  ) >>> 0;
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

(function initColorLuts() {
  // Thermal gradient stops matching Apple Photo Booth Thermal Camera
  const stops = [
    { pos: 0, r: 10, g: 12, b: 75 },     // Deep navy
    { pos: 55, r: 28, g: 65, b: 175 },   // Royal blue
    { pos: 110, r: 168, g: 24, b: 130 }, // Vivid magenta
    { pos: 165, r: 238, g: 72, b: 24 },  // Fiery orange-red
    { pos: 220, r: 252, g: 218, b: 36 }, // Bright yellow
    { pos: 255, r: 255, g: 255, b: 255 } // Hot white
  ];

  for (let i = 0; i < 256; i++) {
    let s0 = stops[0];
    let s1 = stops[stops.length - 1];
    for (let j = 0; j < stops.length - 1; j++) {
      if (i >= stops[j].pos && i <= stops[j + 1].pos) {
        s0 = stops[j];
        s1 = stops[j + 1];
        break;
      }
    }
    const t = s1.pos === s0.pos ? 0 : (i - s0.pos) / (s1.pos - s0.pos);
    thermalLut[i] = packABGR(
      lerp(s0.r, s1.r, t),
      lerp(s0.g, s1.g, t),
      lerp(s0.b, s1.b, t)
    );

    // X-Ray LUT: inverted luminance with glowing cyan-blue tint
    const inv = 255 - i;
    const contrast = Math.min(255, Math.max(0, Math.round((inv - 115) * 1.32 + 125)));
    const xr = Math.round(contrast * 0.62);
    const xg = Math.round(contrast * 0.93);
    const xb = Math.min(255, Math.round(contrast * 1.18 + 12));
    xrayLut[i] = packABGR(xr, xg, xb);
  }
})();

// Pop Art 4-quadrant Warhol palettes: [shadowRGB, midRGB, highRGB]
const POP_QUADS = [
  // Top-left: Hot pink / yellow / cyan
  [
    packABGR(42, 18, 92),
    packABGR(236, 56, 132),
    packABGR(255, 232, 75),
  ],
  // Top-right: Deep blue / cyan / lime
  [
    packABGR(16, 42, 118),
    packABGR(28, 178, 238),
    packABGR(235, 252, 110),
  ],
  // Bottom-left: Purple / emerald / soft yellow
  [
    packABGR(72, 20, 88),
    packABGR(48, 195, 132),
    packABGR(255, 240, 175),
  ],
  // Bottom-right: Crimson / vivid orange / warm cream
  [
    packABGR(115, 18, 42),
    packABGR(246, 108, 36),
    packABGR(255, 236, 170),
  ],
];

// Reusable work canvases so we don't allocate every frame
let srcWorkCanvas: HTMLCanvasElement | null = null;
let dstWorkCanvas: HTMLCanvasElement | null = null;

function ensureWorkCanvases() {
  if (!srcWorkCanvas) {
    srcWorkCanvas = document.createElement('canvas');
    srcWorkCanvas.width = FX_W;
    srcWorkCanvas.height = FX_H;
  }
  if (!dstWorkCanvas) {
    dstWorkCanvas = document.createElement('canvas');
    dstWorkCanvas.width = FX_W;
    dstWorkCanvas.height = FX_H;
  }
  return { srcCanvas: srcWorkCanvas, dstCanvas: dstWorkCanvas };
}

/**
 * Renders source (video or image) cropped to 4:3 with mirror + MacBook Photo Booth effect
 * into an offscreen canvas and returns it.
 */
export function renderWithMacBoothEffect(
  source: HTMLVideoElement | HTMLImageElement,
  srcW: number,
  srcH: number,
  mirror: boolean,
  effect: BoothEffectId,
  targetCanvas?: HTMLCanvasElement
): HTMLCanvasElement {
  const { srcCanvas, dstCanvas } = ensureWorkCanvases();
  const outCanvas = targetCanvas || dstCanvas;
  if (outCanvas.width !== FX_W || outCanvas.height !== FX_H) {
    outCanvas.width = FX_W;
    outCanvas.height = FX_H;
  }

  const targetAspect = FX_W / FX_H;
  const srcAspect = srcW / srcH;
  let sx = 0,
    sy = 0,
    sw = srcW,
    sh = srcH;
  if (srcAspect > targetAspect) {
    sw = srcH * targetAspect;
    sx = (srcW - sw) / 2;
  } else {
    sh = srcW / targetAspect;
    sy = (srcH - sh) / 2;
  }

  const sCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  sCtx.save();
  sCtx.clearRect(0, 0, FX_W, FX_H);
  if (mirror) {
    sCtx.translate(FX_W, 0);
    sCtx.scale(-1, 1);
  }
  sCtx.drawImage(source, sx, sy, sw, sh, 0, 0, FX_W, FX_H);
  sCtx.restore();

  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true })!;
  if (effect === 'none') {
    outCtx.clearRect(0, 0, FX_W, FX_H);
    outCtx.drawImage(srcCanvas, 0, 0);
    return outCanvas;
  }

  const srcData = sCtx.getImageData(0, 0, FX_W, FX_H);
  const dstData = outCtx.createImageData(FX_W, FX_H);
  const src32 = new Uint32Array(srcData.data.buffer);
  const dst32 = new Uint32Array(dstData.data.buffer);
  const src8 = srcData.data;

  if (effect === 'bulge' || effect === 'pinch' || effect === 'twirl' || effect === 'mirror') {
    const lut = getSpatialLut(effect);
    const len = lut.length;
    for (let i = 0; i < len; i++) {
      dst32[i] = src32[lut[i]];
    }
  } else if (effect === 'thermal' || effect === 'xray') {
    const colorMap = effect === 'thermal' ? thermalLut : xrayLut;
    const len = src32.length;
    for (let i = 0; i < len; i++) {
      const idx4 = i << 2;
      const lum = (77 * src8[idx4] + 150 * src8[idx4 + 1] + 29 * src8[idx4 + 2]) >> 8;
      dst32[i] = colorMap[lum];
    }
  } else if (effect === 'pop-art') {
    const halfW = FX_W >> 1;
    const halfH = FX_H >> 1;
    for (let y = 0; y < FX_H; y++) {
      const qy = y < halfH ? 0 : 1;
      const sy2 = (y % halfH) * 2;
      for (let x = 0; x < FX_W; x++) {
        const qx = x < halfW ? 0 : 1;
        const sx2 = (x % halfW) * 2;
        const quadIdx = qy * 2 + qx;
        const palette = POP_QUADS[quadIdx];

        const srcIdx4 = (sy2 * FX_W + sx2) << 2;
        const lum = (77 * src8[srcIdx4] + 150 * src8[srcIdx4 + 1] + 29 * src8[srcIdx4 + 2]) >> 8;

        let color: number;
        if (lum < 92) {
          color = palette[0];
        } else if (lum < 172) {
          color = palette[1];
        } else {
          color = palette[2];
        }
        dst32[y * FX_W + x] = color;
      }
    }
  }

  outCtx.putImageData(dstData, 0, 0);
  return outCanvas;
}
