import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  Download,
  Eye,
  EyeOff,
  Film,
  FlipHorizontal,
  RotateCcw,
  SwitchCamera,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import './App.css';
import { FILTER_PRESETS, THEME_LIST, THEMES } from './data/themes';
import { FACE_EFFECT_PRESETS } from './data/faceEffects';
import {
  BoothEffectId,
  CapturedPose,
  FaceEffectId,
  FilterId,
  LayoutMode,
  NormalizedFaceBox,
  ThemeId,
} from './types/photobooth';
import {
  getCanvasDimensions,
  getPhotoSlotRects,
  loadImage,
  renderLiveFrameSync,
  renderPhotoboothComposite,
} from './utils/canvasRenderer';
import {
  detectFacesInImage,
  detectFacesInVideoFrame,
  ensureFaceTrackerReady,
} from './utils/faceTracker';
import { BOOTH_EFFECT_PRESETS } from './utils/macBoothEffects';
import {
  exportAnimatedPurikuraGif,
  exportAnimatedPurikuraMp4,
} from './utils/gifExporter';
import { soundFX } from './utils/sound';

export function App() {
  const [themeId, setThemeId] = useState<ThemeId>('mofusand-berry');
  const activeTheme = THEMES[themeId];
  const [layout, setLayout] = useState<LayoutMode>('1x4');

  // Camera, Face Effect, Mac Photo Booth Effect & Color Filter State
  const [faceEffect, setFaceEffect] = useState<FaceEffectId>('none');
  const [boothEffect, setBoothEffect] = useState<BoothEffectId>('none');
  const [filterId, setFilterId] = useState<FilterId>('soft-peach');
  const activeFilter =
    FILTER_PRESETS.find((f) => f.id === filterId) || FILTER_PRESETS[0];
  const [isMirrored, setIsMirrored] = useState<boolean>(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [cameraReady, setCameraReady] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<'frames' | 'face' | 'booth' | 'filter' | 'more'>('frames');

  // Capture & Timer State
  const [countdownSec, setCountdownSec] = useState<number>(3);
  const [countdownDisplay, setCountdownDisplay] = useState<string | null>(null);
  const [isCapturingSequence, setIsCapturingSequence] = useState<boolean>(false);
  const [activeShootingSlot, setActiveShootingSlot] = useState<number | null>(null);
  const [showFlash, setShowFlash] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [cleanView, setCleanView] = useState<boolean>(false);

  // 4 Pose Slots (empty slots automatically stream live camera inside the frame!)
  const [poses, setPoses] = useState<CapturedPose[]>(() =>
    [0, 1, 2, 3].map(() => ({ dataUrl: null, burstUrls: [] }))
  );
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);

  // Header, Footer Text & Datestamp
  const [customHeader, setCustomHeader] = useState<string>(
    THEMES['mofusand-berry'].headerTitle
  );
  const [customCaption, setCustomCaption] = useState<string>(
    THEMES['mofusand-berry'].defaultTagline
  );
  const [showDatestamp, setShowDatestamp] = useState<boolean>(true);
  const [customDateText, setCustomDateText] = useState<string>(
    THEMES['mofusand-berry'].defaultDatestamp
  );

  const [isExportingGif, setIsExportingGif] = useState<boolean>(false);
  const [isExportingMp4, setIsExportingMp4] = useState<boolean>(false);

  // Hidden video element feeding the center frame canvas
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetSlotRef = useRef<number>(0);

  // Preload all theme character images & face effect PNGs so switching is instant
  useEffect(() => {
    THEME_LIST.forEach((t) => {
      t.placements.forEach((p) => {
        loadImage(p.src).catch(() => {});
      });
    });
    FACE_EFFECT_PRESETS.forEach((fx) => {
      loadImage(fx.src).catch(() => {});
    });
  }, []);

  // Initialize MediaPipe FaceDetector when a face effect is turned on
  useEffect(() => {
    if (faceEffect !== 'none') {
      ensureFaceTrackerReady();
    }
  }, [faceEffect]);

  const handleSelectTheme = (newId: ThemeId) => {
    soundFX.playPop(680);
    setThemeId(newId);
    const nextTheme = THEMES[newId];
    setCustomHeader(nextTheme.headerTitle);
    setCustomCaption(nextTheme.defaultTagline);
    setCustomDateText(nextTheme.defaultDatestamp);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundFX.enabled = next;
  };

  // Start hidden webcam stream
  const startCamera = useCallback(async (mode: 'user' | 'environment' = facingMode) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraReady(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 960 },
          facingMode: { ideal: mode },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
    } catch {
      setCameraReady(false);
    }
  }, [facingMode]);

  const handleFlipCamera = () => {
    soundFX.playPop(620);
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    setIsMirrored(nextMode === 'user');
  };

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [startCamera, facingMode]);

  const latestLiveFacesRef = useRef<NormalizedFaceBox[]>([]);

  // 60fps requestAnimationFrame loop rendering live camera directly inside the center frame
  useEffect(() => {
    let animId = 0;
    const renderTick = () => {
      const canvas = frameCanvasRef.current;
      const liveVideo = cameraReady ? videoRef.current : null;
      const liveFaces =
        faceEffect !== 'none' && liveVideo
          ? detectFacesInVideoFrame(liveVideo, isMirrored)
          : [];
      latestLiveFacesRef.current = liveFaces;

      if (canvas) {
        renderLiveFrameSync({
          canvas,
          theme: activeTheme,
          layout,
          poses,
          filter: activeFilter,
          boothEffect,
          faceEffect,
          liveFaceBoxes: liveFaces,
          customHeader,
          customCaption,
          showDatestamp,
          customDateText,
          selectedSlotIndex,
          activeShootingSlot,
          liveVideo,
          isMirrored,
          countdownDisplay,
          showFlash,
        });
      }
      animId = requestAnimationFrame(renderTick);
    };
    animId = requestAnimationFrame(renderTick);
    return () => cancelAnimationFrame(animId);
  }, [
    activeTheme,
    layout,
    poses,
    activeFilter,
    boothEffect,
    faceEffect,
    customHeader,
    customCaption,
    showDatestamp,
    customDateText,
    selectedSlotIndex,
    activeShootingSlot,
    cameraReady,
    isMirrored,
    countdownDisplay,
    showFlash,
  ]);

  const grabVideoFrameDataUrl = useCallback((): string | null => {
    const video = videoRef.current;
    if (!cameraReady || !video || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }
    const c = document.createElement('canvas');
    c.width = 960;
    c.height = 720;
    const ctx = c.getContext('2d')!;

    const vW = video.videoWidth;
    const vH = video.videoHeight;
    const targetAspect = 4 / 3;
    const vAspect = vW / vH;
    let sx = 0,
      sy = 0,
      sw = vW,
      sh = vH;
    if (vAspect > targetAspect) {
      sw = vH * targetAspect;
      sx = (vW - sw) / 2;
    } else {
      sh = vW / targetAspect;
      sy = (vH - sh) / 2;
    }

    ctx.save();
    if (isMirrored) {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    ctx.restore();
    const url = c.toDataURL('image/jpeg', 0.94);
    loadImage(url).catch(() => {});
    return url;
  }, [cameraReady, isMirrored]);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const shootSlotWithCountdown = async (slotIdx: number) => {
    setActiveShootingSlot(slotIdx);
    const burstUrls: string[] = [];

    for (let s = countdownSec; s >= 1; s--) {
      setCountdownDisplay(String(s));
      soundFX.playCountdownTick(s);
      await sleep(500);
      const midFrame = grabVideoFrameDataUrl();
      if (midFrame) burstUrls.push(midFrame);
      await sleep(500);
    }

    setCountdownDisplay(null);
    soundFX.playShutter();
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 320);

    const finalUrl = grabVideoFrameDataUrl();
    if (finalUrl) {
      burstUrls.push(finalUrl);
      const capturedFaces = [...latestLiveFacesRef.current];
      setPoses((prev) => {
        const next = [...prev];
        next[slotIdx] = { dataUrl: finalUrl, burstUrls, faceBoxes: capturedFaces };
        return next;
      });
    }

    await sleep(250);
  };

  const handleStartSession = async (onlySlotIndex?: number | null) => {
    if (isCapturingSequence) return;
    if (!cameraReady) {
      triggerSlotUpload(typeof onlySlotIndex === 'number' ? onlySlotIndex : 0);
      return;
    }
    setIsCapturingSequence(true);

    if (typeof onlySlotIndex === 'number') {
      await shootSlotWithCountdown(onlySlotIndex);
      setSelectedSlotIndex(null);
    } else {
      setPoses([0, 1, 2, 3].map(() => ({ dataUrl: null, burstUrls: [] })));
      for (let i = 0; i < 4; i++) {
        await shootSlotWithCountdown(i);
        if (i < 3) await sleep(350);
      }
    }

    setActiveShootingSlot(null);
    setIsCapturingSequence(false);
  };

  const handleInstantSnap = () => {
    const firstEmpty = poses.findIndex((p) => !p.dataUrl);
    const targetIdx =
      selectedSlotIndex !== null
        ? selectedSlotIndex
        : firstEmpty !== -1
        ? firstEmpty
        : 0;

    if (!cameraReady) {
      triggerSlotUpload(targetIdx);
      return;
    }

    soundFX.playShutter();
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 260);

    const dataUrl = grabVideoFrameDataUrl();
    if (dataUrl) {
      const capturedFaces = [...latestLiveFacesRef.current];
      setPoses((prev) => {
        const next = [...prev];
        next[targetIdx] = { dataUrl, burstUrls: [dataUrl], faceBoxes: capturedFaces };
        return next;
      });
      setSelectedSlotIndex(null);
    }
  };

  const triggerSlotUpload = (slotIdx: number) => {
    uploadTargetSlotRef.current = slotIdx;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).slice(0, 4).forEach((file, offset) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const result = reader.result as string;
        const targetSlot = (uploadTargetSlotRef.current + offset) % 4;
        setPoses((prev) => {
          const next = [...prev];
          next[targetSlot] = { dataUrl: result, burstUrls: [result] };
          return next;
        });
        try {
          const img = await loadImage(result);
          const detected = await detectFacesInImage(img);
          if (detected.length > 0) {
            setPoses((prev) => {
              const next = [...prev];
              if (next[targetSlot]?.dataUrl === result) {
                next[targetSlot] = { ...next[targetSlot], faceBoxes: detected };
              }
              return next;
            });
          }
        } catch {
          // Ignore detection error on uploaded image
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  // Clicking any slot on the center frame selects it to retake or live-preview
  const handleFrameClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = frameCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;

    const { width, height } = getCanvasDimensions(layout);
    const slots = getPhotoSlotRects(layout, width, height);
    const px = nx * width;
    const py = ny * height;
    const hitSlot = slots.find(
      (s) => px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h
    );
    if (hitSlot) {
      soundFX.playPop(640);
      setSelectedSlotIndex(
        selectedSlotIndex === hitSlot.index ? null : hitSlot.index
      );
    } else {
      setSelectedSlotIndex(null);
    }
  };

  // Snapshot any still-live slots if the user clicks Save PNG while posing live!
  const getExportPoses = useCallback((): CapturedPose[] => {
    return poses.map((p) => {
      if (p.dataUrl) return p;
      const snap = grabVideoFrameDataUrl();
      return {
        dataUrl: snap,
        burstUrls: snap ? [snap] : [],
        faceBoxes: [...latestLiveFacesRef.current],
      };
    });
  }, [poses, grabVideoFrameDataUrl]);

  const handleDownloadPng = async () => {
    const exportPoses = getExportPoses();
    const offscreen = document.createElement('canvas');
    await renderPhotoboothComposite({
      canvas: offscreen,
      theme: activeTheme,
      layout,
      poses: exportPoses,
      filter: activeFilter,
      boothEffect,
      faceEffect,
      customHeader,
      customCaption,
      showDatestamp,
      customDateText,
      selectedSlotIndex: null,
    });
    const dataUrl = offscreen.toDataURL('image/png');
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.download = `photobooth-${themeId}-${timestamp}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadGif = async () => {
    if (isExportingGif) return;
    setIsExportingGif(true);
    try {
      const exportPoses = getExportPoses();
      const blob = await exportAnimatedPurikuraGif({
        theme: activeTheme,
        layout,
        poses: exportPoses,
        filter: activeFilter,
        boothEffect,
        faceEffect,
        customHeader,
        customCaption,
        showDatestamp,
        customDateText,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = `photobooth-${themeId}-${timestamp}.gif`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setIsExportingGif(false);
    }
  };

  const handleDownloadMp4 = async () => {
    if (isExportingMp4) return;
    if (typeof VideoEncoder === 'undefined') {
      // Fallback gracefully to GIF on mobile browsers without WebCodecs
      await handleDownloadGif();
      return;
    }
    setIsExportingMp4(true);
    try {
      const exportPoses = getExportPoses();
      const blob = await exportAnimatedPurikuraMp4({
        theme: activeTheme,
        layout,
        poses: exportPoses,
        filter: activeFilter,
        boothEffect,
        faceEffect,
        customHeader,
        customCaption,
        showDatestamp,
        customDateText,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = `photobooth-${themeId}-${timestamp}.mp4`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setIsExportingMp4(false);
    }
  };

  return (
    <div
      className={`studio-stage ${cleanView ? 'clean-view' : ''}`}
      style={{ backgroundColor: activeTheme.bgPrimary + '55' }}
    >
      {/* Hidden video element that streams into the frame canvas */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* LEFT DOCK (Desktop): Minimal Theme List (Bold Name Only) & Layout */}
      {!cleanView && (
        <aside className="side-dock desktop-only">
          <div>
            <div className="dock-label">Layout</div>
            <div className="segmented-control">
              <button
                type="button"
                className={`seg-btn ${layout === '1x4' ? 'active' : ''}`}
                onClick={() => setLayout('1x4')}
              >
                1×4 Strip
              </button>
              <button
                type="button"
                className={`seg-btn ${layout === '2x2' ? 'active' : ''}`}
                onClick={() => setLayout('2x2')}
              >
                2×2 Grid
              </button>
            </div>
          </div>

          <div>
            <div className="dock-label">Frames</div>
            <div className="theme-list">
              {THEME_LIST.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`theme-item ${themeId === t.id ? 'active' : ''}`}
                  onClick={() => handleSelectTheme(t.id)}
                >
                  <div
                    className="theme-thumb"
                    style={{ background: t.bgPrimary }}
                  >
                    <img src={t.previewThumb} alt={t.title} />
                  </div>
                  <span className="theme-bold-name">{t.title}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}

      {/* CENTER HERO: The Photobooth Frame with Live Camera Inside */}
      <main className="frame-center-stage">
        <canvas
          ref={frameCanvasRef}
          className={`hero-frame-canvas ${layout === '2x2' ? 'grid-layout' : ''}`}
          onClick={handleFrameClick}
        />

        {!cleanView && selectedSlotIndex !== null && (
          <div className="slot-hint-pill">
            Slot 0{selectedSlotIndex + 1} live — tap Snap / Retake or tap outside to lock
          </div>
        )}

        {!cameraReady && (
          <button
            type="button"
            className="mobile-camera-retry"
            onClick={() => startCamera(facingMode)}
          >
            Tap to Enable Camera
          </button>
        )}
      </main>

      {/* RIGHT DOCK (Desktop): Minimal Shoot, Mac Booth FX, Filters, Footer & Save */}
      {!cleanView && (
        <aside className="side-dock desktop-only">
          <div>
            <div className="dock-label">Capture</div>
            <button
              type="button"
              className="btn-shoot"
              disabled={isCapturingSequence}
              onClick={() => handleStartSession(selectedSlotIndex)}
            >
              <Camera size={16} />
              <span>
                {isCapturingSequence
                  ? 'Shooting...'
                  : selectedSlotIndex !== null
                  ? `Retake Slot 0${selectedSlotIndex + 1} (${countdownSec}s)`
                  : `Start 4-Shot (${countdownSec}s)`}
              </span>
            </button>

            <div className="btn-secondary-row" style={{ marginTop: '6px' }}>
              <button
                type="button"
                className="btn-minimal"
                disabled={isCapturingSequence}
                onClick={handleInstantSnap}
              >
                <span>Instant Snap</span>
              </button>

              <button
                type="button"
                className="btn-minimal"
                disabled={isCapturingSequence}
                onClick={() =>
                  triggerSlotUpload(selectedSlotIndex !== null ? selectedSlotIndex : 0)
                }
              >
                <Upload size={13} />
                <span>Upload</span>
              </button>
            </div>

            <div className="btn-secondary-row" style={{ marginTop: '6px' }}>
              <button
                type="button"
                className="btn-minimal"
                onClick={() => setIsMirrored(!isMirrored)}
              >
                <FlipHorizontal size={13} />
                <span>{isMirrored ? 'Mirrored' : 'Normal'}</span>
              </button>

              <button
                type="button"
                className="btn-minimal"
                onClick={() => {
                  setPoses([0, 1, 2, 3].map(() => ({ dataUrl: null, burstUrls: [] })));
                  setSelectedSlotIndex(null);
                }}
              >
                <RotateCcw size={13} />
                <span>Reset Live</span>
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '8px',
                gap: '6px',
              }}
            >
              <div className="segmented-control" style={{ flex: 1, gridTemplateColumns: '1fr 1fr 1fr' }}>
                {[3, 5, 10].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    className={`seg-btn ${countdownSec === sec ? 'active' : ''}`}
                    onClick={() => setCountdownSec(sec)}
                  >
                    {sec}s
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="btn-minimal"
                style={{ padding: '7px 10px' }}
                onClick={toggleSound}
                title="Toggle Shutter Sound"
              >
                {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </button>
            </div>
          </div>

          <div>
            <div className="dock-label">Face Effects</div>
            <div className="face-fx-grid">
              <button
                type="button"
                className={`face-fx-btn ${faceEffect === 'none' ? 'active' : ''}`}
                onClick={() => {
                  soundFX.playPop(580);
                  setFaceEffect('none');
                }}
              >
                <span style={{ fontSize: '0.78rem', lineHeight: '28px' }}>None</span>
              </button>
              {FACE_EFFECT_PRESETS.map((fx) => (
                <button
                  key={fx.id}
                  type="button"
                  className={`face-fx-btn ${faceEffect === fx.id ? 'active' : ''}`}
                  onClick={() => {
                    soundFX.playPop(680);
                    setFaceEffect(fx.id);
                  }}
                  title={fx.name}
                >
                  <img src={fx.src} alt={fx.name} />
                  <span>{fx.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="dock-label">Mac Photo Booth FX</div>
            <div className="filter-grid">
              {BOOTH_EFFECT_PRESETS.map((fx) => (
                <button
                  key={fx.id}
                  type="button"
                  className={`filter-pill ${boothEffect === fx.id ? 'active' : ''}`}
                  onClick={() => {
                    soundFX.playPop(620);
                    setBoothEffect(fx.id);
                  }}
                >
                  {fx.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="dock-label">Tone Filter</div>
            <div className="filter-grid">
              {FILTER_PRESETS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`filter-pill ${filterId === f.id ? 'active' : ''}`}
                  onClick={() => setFilterId(f.id)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="dock-label">Header & Footer Text</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <input
                type="text"
                className="minimal-input"
                value={customHeader}
                onChange={(e) => setCustomHeader(e.target.value)}
                placeholder="Top header caption..."
                maxLength={36}
              />
              <input
                type="text"
                className="minimal-input"
                value={customCaption}
                onChange={(e) => setCustomCaption(e.target.value)}
                placeholder="Bottom footer caption..."
                maxLength={40}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  type="checkbox"
                  checked={showDatestamp}
                  onChange={(e) => setShowDatestamp(e.target.checked)}
                  style={{ accentColor: 'var(--accent-primary)' }}
                />
                <input
                  type="text"
                  className="minimal-input"
                  value={customDateText}
                  onChange={(e) => setCustomDateText(e.target.value)}
                  disabled={!showDatestamp}
                  placeholder="Date..."
                  maxLength={28}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 'auto' }}>
            <button
              type="button"
              className="btn-shoot"
              onClick={handleDownloadPng}
            >
              <Download size={15} />
              <span>Save PNG</span>
            </button>

            <div className="btn-secondary-row">
              <button
                type="button"
                className="btn-minimal"
                disabled={isExportingMp4}
                onClick={handleDownloadMp4}
              >
                <Film size={14} />
                <span>{isExportingMp4 ? 'Saving...' : 'Save MP4'}</span>
              </button>

              <button
                type="button"
                className="btn-minimal"
                disabled={isExportingGif}
                onClick={handleDownloadGif}
              >
                <Film size={14} />
                <span>{isExportingGif ? 'Saving...' : 'Save GIF'}</span>
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Mobile Floating Top Actions (Flip Front/Back Camera + Clean View) */}
      <div className="mobile-top-actions mobile-only">
        <button
          type="button"
          className="mobile-icon-pill"
          onClick={handleFlipCamera}
          title="Switch Front / Back Camera"
          aria-label="Switch Camera"
        >
          <SwitchCamera size={17} />
        </button>
        <button
          type="button"
          className="mobile-icon-pill"
          onClick={() => setCleanView(!cleanView)}
          title={cleanView ? 'Show Controls' : 'Clean View'}
          aria-label={cleanView ? 'Show Controls' : 'Clean View'}
        >
          {cleanView ? <Eye size={17} /> : <EyeOff size={17} />}
        </button>
      </div>

      {/* Mobile Bottom Control Sheet */}
      {!cleanView && (
        <section className="mobile-sheet mobile-only">
          {/* Quick Capture Row */}
          <div className="mobile-quick-bar">
            <button
              type="button"
              className="mobile-quick-btn"
              disabled={isCapturingSequence}
              onClick={handleInstantSnap}
            >
              Snap
            </button>

            <button
              type="button"
              className="btn-shoot"
              disabled={isCapturingSequence}
              onClick={() => handleStartSession(selectedSlotIndex)}
            >
              <Camera size={16} />
              <span>
                {isCapturingSequence
                  ? 'Shooting...'
                  : selectedSlotIndex !== null
                  ? `Retake 0${selectedSlotIndex + 1} (${countdownSec}s)`
                  : `Shoot 4-Shot (${countdownSec}s)`}
              </span>
            </button>

            <button
              type="button"
              className="mobile-quick-btn"
              onClick={handleDownloadPng}
              title="Save PNG"
              aria-label="Save PNG"
            >
              <Download size={16} />
            </button>

            <button
              type="button"
              className="mobile-quick-btn"
              onClick={() => {
                setPoses([0, 1, 2, 3].map(() => ({ dataUrl: null, burstUrls: [] })));
                setSelectedSlotIndex(null);
              }}
              title="Reset Live"
              aria-label="Reset Live"
            >
              <RotateCcw size={15} />
            </button>
          </div>

          {/* Mobile 5-Tab Bar */}
          <div className="mobile-tabs">
            {(
              [
                ['frames', 'Frames'],
                ['face', 'Face FX'],
                ['booth', 'Booth FX'],
                ['filter', 'Filters'],
                ['more', 'More'],
              ] as const
            ).map(([tabKey, label]) => (
              <button
                key={tabKey}
                type="button"
                className={`mobile-tab-btn ${mobileTab === tabKey ? 'active' : ''}`}
                onClick={() => {
                  soundFX.playPop(600);
                  setMobileTab(tabKey);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Mobile Tab Content Tray */}
          <div className="mobile-tray">
            {mobileTab === 'frames' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="segmented-control">
                  <button
                    type="button"
                    className={`seg-btn ${layout === '1x4' ? 'active' : ''}`}
                    onClick={() => setLayout('1x4')}
                  >
                    1×4 Strip
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${layout === '2x2' ? 'active' : ''}`}
                    onClick={() => setLayout('2x2')}
                  >
                    2×2 Grid
                  </button>
                </div>
                <div className="mobile-hscroll">
                  {THEME_LIST.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`mobile-theme-card ${themeId === t.id ? 'active' : ''}`}
                      onClick={() => handleSelectTheme(t.id)}
                    >
                      <div className="theme-thumb" style={{ background: t.bgPrimary }}>
                        <img src={t.previewThumb} alt={t.title} />
                      </div>
                      <span className="theme-bold-name">{t.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mobileTab === 'face' && (
              <div className="mobile-hscroll">
                <button
                  type="button"
                  className={`face-fx-btn mobile-face-card ${faceEffect === 'none' ? 'active' : ''}`}
                  onClick={() => {
                    soundFX.playPop(580);
                    setFaceEffect('none');
                  }}
                >
                  <span style={{ fontSize: '0.78rem', lineHeight: '34px' }}>None</span>
                </button>
                {FACE_EFFECT_PRESETS.map((fx) => (
                  <button
                    key={fx.id}
                    type="button"
                    className={`face-fx-btn mobile-face-card ${faceEffect === fx.id ? 'active' : ''}`}
                    onClick={() => {
                      soundFX.playPop(680);
                      setFaceEffect(fx.id);
                    }}
                  >
                    <img src={fx.src} alt={fx.name} />
                    <span>{fx.name}</span>
                  </button>
                ))}
              </div>
            )}

            {mobileTab === 'booth' && (
              <div className="mobile-pill-grid-4">
                {BOOTH_EFFECT_PRESETS.map((fx) => (
                  <button
                    key={fx.id}
                    type="button"
                    className={`filter-pill ${boothEffect === fx.id ? 'active' : ''}`}
                    onClick={() => {
                      soundFX.playPop(620);
                      setBoothEffect(fx.id);
                    }}
                  >
                    {fx.name}
                  </button>
                ))}
              </div>
            )}

            {mobileTab === 'filter' && (
              <div className="mobile-pill-grid-3">
                {FILTER_PRESETS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`filter-pill ${filterId === f.id ? 'active' : ''}`}
                    onClick={() => setFilterId(f.id)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}

            {mobileTab === 'more' && (
              <div className="mobile-more-stack">
                <div className="mobile-more-row">
                  <div className="segmented-control" style={{ flex: 1, gridTemplateColumns: '1fr 1fr 1fr' }}>
                    {[3, 5, 10].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        className={`seg-btn ${countdownSec === sec ? 'active' : ''}`}
                        onClick={() => setCountdownSec(sec)}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn-minimal"
                    onClick={() => setIsMirrored(!isMirrored)}
                  >
                    <FlipHorizontal size={13} />
                    <span>{isMirrored ? 'Mirror' : 'Normal'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-minimal"
                    style={{ padding: '8px 10px' }}
                    onClick={toggleSound}
                  >
                    {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  </button>
                </div>

                <div className="mobile-more-row">
                  <input
                    type="text"
                    className="minimal-input"
                    value={customHeader}
                    onChange={(e) => setCustomHeader(e.target.value)}
                    placeholder="Top header..."
                    maxLength={36}
                  />
                  <input
                    type="text"
                    className="minimal-input"
                    value={customCaption}
                    onChange={(e) => setCustomCaption(e.target.value)}
                    placeholder="Bottom caption..."
                    maxLength={40}
                  />
                </div>

                <div className="mobile-more-row">
                  <input
                    type="checkbox"
                    checked={showDatestamp}
                    onChange={(e) => setShowDatestamp(e.target.checked)}
                    style={{ accentColor: 'var(--accent-primary)' }}
                  />
                  <input
                    type="text"
                    className="minimal-input"
                    value={customDateText}
                    onChange={(e) => setCustomDateText(e.target.value)}
                    disabled={!showDatestamp}
                    placeholder="Date..."
                    maxLength={28}
                  />
                  <button
                    type="button"
                    className="btn-minimal"
                    disabled={isCapturingSequence}
                    onClick={() =>
                      triggerSlotUpload(selectedSlotIndex !== null ? selectedSlotIndex : 0)
                    }
                  >
                    <Upload size={13} />
                    <span>Upload</span>
                  </button>
                </div>

                <div className="mobile-more-row">
                  <button
                    type="button"
                    className="btn-minimal"
                    style={{ flex: 1 }}
                    disabled={isExportingMp4}
                    onClick={handleDownloadMp4}
                  >
                    <Film size={14} />
                    <span>{isExportingMp4 ? 'Saving...' : 'Save MP4'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-minimal"
                    style={{ flex: 1 }}
                    disabled={isExportingGif}
                    onClick={handleDownloadGif}
                  >
                    <Film size={14} />
                    <span>{isExportingGif ? 'Saving...' : 'Save GIF'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Corner Toggle (Desktop) to Hide/Show Side Docks for IG/TikTok Aesthetic Screen Captures */}
      <button
        type="button"
        className="clean-view-toggle"
        onClick={() => setCleanView(!cleanView)}
      >
        {cleanView ? <Eye size={14} /> : <EyeOff size={14} />}
        <span>{cleanView ? 'Show Controls' : 'Clean View'}</span>
      </button>
    </div>
  );
}

export default App;
