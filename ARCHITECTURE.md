# Architecture Design — Cute Photobooth (v2 Clean Architecture)

## 1. Layered System Diagram

```text
+-------------------------------------------------------------------+
|                     Presentation Layer (App.tsx)                  |
|  Desktop Side Docks  |  Hero <canvas>  |  Mobile Bottom Sheet     |
|  Ref-backed stable 60fps rAF loop (renderScale = 0.5 live)        |
+-------------------------------------------------------------------+
           |                                      |
           v                                      v
+--------------------------+          +-----------------------------+
|  useCameraStream Hook    |          |  usePhotoboothSession Hook  |
|  - Cascading constraints |          |  - Cancellable 4-shot FSM   |
|  - Request-ID race guard |          |  - Per-slot immutable pose  |
|  - Device switcher       |          |    (faceEffect, boothEffect,|
|  - FaceTracker reset     |          |     burstFrames+faceBoxes)  |
+--------------------------+          +-----------------------------+
           |                                      |
           +------------------+-------------------+
                              v
+-------------------------------------------------------------------+
|                 Rendering & Media Pipeline (utils/)               |
|  - canvasRenderer.ts : Dual-scale compositor (0.5x live / 1x PNG) |
|  - imageCache.ts     : Static pinned + bounded 48-entry LRU cache |
|  - faceTracker.ts    : MediaPipe BlazeFace + 8-frame miss hold    |
|  - cuteFaceWarp.ts   : 240x240 LUT chubby-cheek warp + blush      |
|  - macBoothEffects.ts: 560x420 spatial & color LUT shaders        |
|  - gifExporter.ts    : Per-burst faceBox MP4 (probed H.264) & GIF |
+-------------------------------------------------------------------+
```

---

## 2. Key Architectural Guarantees

1. **Immutable Per-Slot Snapshots:** Every `CapturedPose` locks its own `faceEffect`, `boothEffect`, `faceBoxes`, and `burstFrames` (`{ dataUrl, faceBoxes }[]`) at capture time. Changing effects for Slot 2 never retroactively mutates Slot 1.
2. **Zero-Drop Export Hydration:** `faceTracker.ts` holds tracked faces across brief blinks/flashes (`MAX_CONSECUTIVE_MISSES = 8`), and `renderPhotoboothComposite` runs a safety-net static `detectFacesInImage` pass if any captured slot with a `faceEffect` has empty `faceBoxes`, eliminating stationary center-fallback bugs in exported PNGs, MP4s, and GIFs.
3. **Bounded Memory:** `imageCache.ts` separates permanent static theme/effect assets from a bounded 48-entry LRU cache for transient `data:` URLs, and `processedPoseCache` is LRU-capped at 24 entries.
4. **Race-Free Async Lifecycles:** `useCameraStream` guards hardware `getUserMedia` calls with a monotonic `requestIdRef` (stopping stale streams immediately), and `usePhotoboothSession` guards countdown sequences with a cancellable `sessionTokenRef`.
5. **4× Lighter Live Preview:** Live `rAF` renders at `renderScale = 0.5` (`600×1800` / `800×820`) via a single stable ref-backed loop that never tears down on React state updates, while PNG export renders at full `1.0` (`1200×3600` / `1600×1640`).
