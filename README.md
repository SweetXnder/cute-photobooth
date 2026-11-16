# Cute Photobooth

A minimalist, Purikura / Life4Cuts-inspired web photobooth built with React, TypeScript, HTML5 Canvas, and MediaPipe Face Detection. Your live webcam streams directly inside the themed frame at 60fps, complete with TikTok-style plushie face effects, Mac Photo Booth distortions, tone filters, and high-resolution PNG, MP4, and GIF exports.

---

## Features

- **Live Camera-in-Frame Studio:** Your webcam streams directly inside the center photobooth strip (`1×4` vertical strip or `2×2` grid) at 60fps, with a **Clean View** toggle for distraction-free screen recording.
- **8 Character Frame Themes:**
  - **SpongeBob:** *Best Friends Yellow*, *Goofy Goober Coral*
  - **Big Hero 6:** *Healthcare Companion*, *Lucky Cat Café & Mochi*
  - **Sanrio:** *My Melody & Kuromi*, *Sanrio Friends Club*
  - **Mofusand:** *Same-Nyan Ocean*, *Ichigo-Nyan Strawberry*
- **12 TikTok-Style Fruit Plushie Face Effects:** Real-time multi-face tracking (`Cherry`, `Strawberry`, `Peach`, `Grape`, `Avocado`, `Watermelon`, `Dragonfruit`, `Durian`, `Pear`, `Kiwi`, `Pineapple`, `Banana`) with automatic face-in-hole fitting, chubby-cheek warp, rosy blush, and head-tilt tracking.
- **Mac Photo Booth FX:** Real-time `Bulge`, `Pinch`, `Twirl`, `Mirror`, `Thermal`, `X-Ray`, and `Pop Art` pixel shaders.
- **Studio Tone Filters & Custom Text:** `Natural`, `Soft Peach`, `Studio Bright`, `Crisp Pop`, `Warm Film`, and `Monochrome`, plus editable top header, bottom caption, and datestamp.
- **Multi-Pose Capture & Retakes:** Customizable `3s / 5s / 10s` countdown burst capture, instant snap, photo upload, and click-any-slot to retake individual poses.
- **High-DPI Exports:**
  - **PNG:** Lossless `1200×3600` (`1×4`) or `1600×1640` (`2×2`) composite
  - **MP4:** 11.7-second full-color H.264 video (`WebCodecs` + `mp4-muxer`)
  - **GIF:** Animated burst loop (`gifenc`)

---

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3 (optional, only needed if re-running `scripts/build_assets.py`)

### Run Locally
```bash
npm install
npm run dev
```
Open **http://localhost:5173/** in Chrome, Edge, or Safari and allow camera access.

### Production Build
```bash
npm run build
npm run preview
```

---

## Project Structure

```text
purikura-photobooth/
├── public/
│   ├── assets/
│   │   ├── effects/          # 12 transparent fruit plushie cutouts
│   │   └── themes/           # Character PNGs for SpongeBob, Big Hero 6, Sanrio, Mofusand
│   └── mediapipe/            # Local WASM & BlazeFace TFLite model for offline-safe tracking
├── scripts/
│   └── build_assets.py       # Official character & sticker extraction pipeline
├── src/
│   ├── data/
│   │   ├── faceEffects.ts    # Face-hole geometry metadata for all 12 fruit effects
│   │   └── themes.ts         # Frame palettes, patterns, and character placements
│   ├── types/
│   │   └── photobooth.ts     # Core TypeScript types
│   ├── utils/
│   │   ├── canvasRenderer.ts # 60fps live frame & high-DPI export compositor
│   │   ├── cuteFaceWarp.ts   # Chubby-cheek LUT warp, rosy blush & oval hole fitting
│   │   ├── faceTracker.ts    # MediaPipe BlazeFace multi-face & roll-angle tracker
│   │   ├── gifExporter.ts    # Burst-frame MP4 (WebCodecs) and GIF exporters
│   │   ├── macBoothEffects.ts# Precomputed LUT shaders (Bulge, Pinch, Twirl, Thermal, etc.)
│   │   └── sound.ts          # Web Audio API countdown & shutter sound synthesizer
│   ├── App.tsx               # Studio UI, capture state machine, and animation loop
│   └── App.css               # Minimalist glassmorphic studio layout
├── ARCHITECTURE.md           # Detailed system architecture & rendering pipeline
└── package.json
```
