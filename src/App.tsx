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
  detectFacesInVideoFrame,
  ensureFaceTrackerReady,
} from './utils/faceTracker';
import { BOOTH_EFFECT_PRESETS } from './utils/macBoothEffects';
import {
  exportAnimatedPurikuraGif,
  exportAnimatedPurikuraMp4,
} from './utils/gifExporter';
import { soundFX } from './utils/sound';
import { useCameraStream } from './hooks/useCameraStream';
import { usePhotoboothSession } from './hooks/usePhotoboothSession';

export function App() {
  const [themeId, setThemeId] = useState<ThemeId>('mofusand-berry');
  const activeTheme = THEMES[themeId];
  const [layout, setLayout] = useState<LayoutMode>('1x4');

  // Studio Active Effect & Filter State (applies to live slots; locked per-slot on capture)
  const [faceEffect, setFaceEffect] = useState<FaceEffectId>('none');
  const [boothEffect, setBoothEffect] = useState<BoothEffectId>('none');
  const [filterId, setFilterId] = useState<FilterId>('soft-peach');
  const activeFilter =
    FILTER_PRESETS.find((f) => f.id === filterId) || FILTER_PRESETS[0];

  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [cleanView, setCleanView] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<'frames' | 'face' | 'booth' | 'filter' | 'more'>('frames');

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

  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetSlotRef = useRef<number>(0);
  const latestLiveFacesRef = useRef<NormalizedFaceBox[]>([]);

  const triggerSlotUpload = useCallback((slotIdx: number) => {
    uploadTargetSlotRef.current = slotIdx;
    fileInputRef.current?.click();
  }, []);

  // Decoupled Camera Lifecycle Hook
  const {
    videoRef,
    facingMode,
    isMirrored,
    setIsMirrored,
    cameraReady,
    cameraError,
    videoDevices,
    selectedDeviceId,
    setSelectedDeviceId,
    startCamera,
    handleFlipCamera,
  } = useCameraStream();

  // Decoupled Capture / Session State Machine Hook
  const {
    poses,
    selectedSlotIndex,
    setSelectedSlotIndex,
    countdownSec,
    setCountdownSec,
    countdownDisplay,
    isCapturingSequence,
    activeShootingSlot,
    showFlash,
    handleStartSession,
    handleInstantSnap,
    handleUploadedFiles,
    resetAllPoses,
    getExportPoses,
  } = usePhotoboothSession({
    videoRef,
    cameraReady,
    isMirrored,
    faceEffect,
    boothEffect,
    latestLiveFacesRef,
    onRequireUpload: triggerSlotUpload,
  });

  // Preload static theme character images & face effect cutouts once on mount
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

  // Initialize MediaPipe FaceDetector lazily when a face effect is enabled
  useEffect(() => {
    if (faceEffect !== 'none') {
      ensureFaceTrackerReady();
    }
  }, [faceEffect]);

  // Ref-backed render state so the single 60fps rAF loop NEVER tears down/restarts on React re-renders
  const renderStateRef = useRef({
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
  });

  renderStateRef.current = {
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
  };

  useEffect(() => {
    let animId = 0;
    const renderTick = () => {
      const s = renderStateRef.current;
      const canvas = frameCanvasRef.current;
      const liveVideo = s.cameraReady ? videoRef.current : null;
      const liveFaces =
        s.faceEffect !== 'none' && liveVideo
          ? detectFacesInVideoFrame(liveVideo, s.isMirrored)
          : [];
      latestLiveFacesRef.current = liveFaces;

      if (canvas) {
        renderLiveFrameSync({
          canvas,
          theme: s.activeTheme,
          layout: s.layout,
          poses: s.poses,
          filter: s.activeFilter,
          boothEffect: s.boothEffect,
          faceEffect: s.faceEffect,
          liveFaceBoxes: liveFaces,
          customHeader: s.customHeader,
          customCaption: s.customCaption,
          showDatestamp: s.showDatestamp,
          customDateText: s.customDateText,
          selectedSlotIndex: s.selectedSlotIndex,
          activeShootingSlot: s.activeShootingSlot,
          liveVideo,
          isMirrored: s.isMirrored,
          countdownDisplay: s.countdownDisplay,
          showFlash: s.showFlash,
          renderScale: 0.5,
        });
      }
      animId = requestAnimationFrame(renderTick);
    };
    animId = requestAnimationFrame(renderTick);
    return () => cancelAnimationFrame(animId);
  }, [videoRef]);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    handleUploadedFiles(files, uploadTargetSlotRef.current);
    e.target.value = '';
  };

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

  const handleDownloadPng = async () => {
    const exportPoses = getExportPoses();
    const offscreen = document.createElement('canvas');
    await renderPhotoboothComposite({
      canvas: offscreen,
      theme: activeTheme,
      layout,
      poses: exportPoses,
      filter: activeFilter,
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
      {/* Hidden video element (non-zero size & opacity so Edge/Chromium never throttles playback) */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: 320,
          height: 240,
          opacity: 0.001,
          pointerEvents: 'none',
          zIndex: -1,
        }}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* LEFT DOCK (Desktop): Minimal Theme List & Layout */}
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
            onClick={() => startCamera(facingMode, selectedDeviceId)}
          >
            {cameraError || 'Tap to Enable Camera'}
          </button>
        )}
      </main>

      {/* RIGHT DOCK (Desktop): Capture, Face FX, Booth FX, Filters, Text & Export */}
      {!cleanView && (
        <aside className="side-dock desktop-only">
          <div>
            <div className="dock-label">Capture</div>
            {videoDevices.length > 1 && (
              <select
                className="minimal-input"
                style={{ marginBottom: '6px', cursor: 'pointer' }}
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                aria-label="Select Camera"
              >
                {videoDevices.map((dev, idx) => (
                  <option key={dev.deviceId} value={dev.deviceId}>
                    {dev.label || `Camera ${idx + 1}`}
                  </option>
                ))}
              </select>
            )}
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
                onClick={resetAllPoses}
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

      {/* Mobile Floating Top Actions */}
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
              onClick={resetAllPoses}
              title="Reset Live"
              aria-label="Reset Live"
            >
              <RotateCcw size={15} />
            </button>
          </div>

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

      {/* Corner Toggle (Desktop) */}
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
