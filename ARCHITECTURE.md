# Architecture Design — Cute Photobooth

## 1. High-Level Data Flow

```text
+-------------------+      60fps rAF       +-----------------------+
|  Hidden <video>   | -------------------> |  renderLiveFrameSync  |
|  (WebRTC Stream)  |                      |  (canvasRenderer.ts)  |
+-------------------+                      +-----------------------+
         |                                    ^        ^        ^
         | ~30fps throttled                   |        |        |
         v                                    |        |        |
+-------------------+    NormalizedFaceBox[]  |        |        |
|   faceTracker.ts  | ------------------------+        |        |
| (MediaPipe WASM)  |                                  |        |
+-------------------+                                  |        |
                                                       |        |
+-------------------+    Warped 240x240 Face Patch     |        |
|  cuteFaceWarp.ts  | ---------------------------------+        |
+-------------------+                                           |
                                                                |
+-------------------+    560x420 Shader Output                  |
| macBoothEffects.ts| ------------------------------------------+
+-------------------+
```

---

## 2. Core Subsystems

### A. Single-Canvas Live Studio (`src/utils/canvasRenderer.ts`)
Instead of rendering a separate camera preview and a separate strip preview, the application runs a single `requestAnimationFrame` loop that composites directly into the center `<canvas>`:
1. **Background & Header Layer:** Renders theme gradients, subtle grid/check/split patterns, and customizable header text.
2. **Slot Layer (`1×4` or `2×2`):** Each of the 4 slots independently displays either the live camera feed (for empty or selected retake slots) or the captured pose image.
3. **Character Overlay Layer:** Composites preloaded transparent character PNGs at layout-specific normalized coordinates (`1x4` vs `2x2`).
4. **Footer Layer:** Renders the customizable tagline and datestamp.

### B. Multi-Face Tracking & Face-in-Hole Fitting (`src/utils/faceTracker.ts` & `src/utils/cuteFaceWarp.ts`)
- **Local MediaPipe BlazeFace:** Loads WASM and `blaze_face_short_range.tflite` from `public/mediapipe/` so tracking runs locally in the browser with zero external network dependency.
- **Coordinate Mapping:** Converts raw `<video>` pixel bounding boxes and eye keypoints into the `4:3` cover-cropped, optionally mirrored slot coordinate space (`NormalizedFaceBox`), computing head roll angle from eye positions and smoothing across frames with an exponential moving average.
- **Chubby-Cheek LUT Warp:** Precomputes a `240×240` `Uint32Array` displacement lookup table for subtle cheek puffiness and bright-eye scaling. Each detected face is sampled, warped, blushed with radial gradients, clipped to the plushie's oval opening, and layered beneath the transparent fruit cutout.

### C. Mac Photo Booth Pixel Shaders (`src/utils/macBoothEffects.ts`)
- **Spatial Warps (`Bulge`, `Pinch`, `Twirl`, `Mirror`):** Precomputed `560×420` `Uint32Array` coordinate LUTs allow O(1) per-pixel remapping at 60fps.
- **Color Shaders (`Thermal`, `X-Ray`, `Pop Art`):** Uses precomputed 256-entry packed `ABGR` `Uint32Array` luminance lookup tables for fast single-pass pixel shading.

### D. High-DPI Export Pipeline (`src/utils/gifExporter.ts`, `src/App.tsx`)
- **PNG:** Offscreen `renderPhotoboothComposite()` renders at `1200×3600` (`1×4`) or `1600×1640` (`2×2`) after awaiting all asset preloads.
- **MP4:** Captures intermediate burst frames during countdowns, composites 4 high-res canvases, and encodes an 11.7-second `30fps` H.264 stream using the browser's hardware `VideoEncoder` (`WebCodecs`) muxed via `mp4-muxer`.
- **GIF:** Quantizes the 4 burst composite frames to 256-color palettes with `gifenc` for instant client-side GIF downloads.
