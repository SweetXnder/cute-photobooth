import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoothEffectId,
  BurstFrame,
  CapturedPose,
  FaceEffectId,
  NormalizedFaceBox,
  createEmptyPose,
} from '../types/photobooth';
import { loadImage } from '../utils/imageCache';
import { detectFacesInImage } from '../utils/faceTracker';
import { soundFX } from '../utils/sound';

interface UsePhotoboothSessionParams {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraReady: boolean;
  isMirrored: boolean;
  faceEffect: FaceEffectId;
  boothEffect: BoothEffectId;
  latestLiveFacesRef: React.MutableRefObject<NormalizedFaceBox[]>;
  onRequireUpload: (slotIdx: number) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function usePhotoboothSession({
  videoRef,
  cameraReady,
  isMirrored,
  faceEffect,
  boothEffect,
  latestLiveFacesRef,
  onRequireUpload,
}: UsePhotoboothSessionParams) {
  const [poses, setPoses] = useState<CapturedPose[]>(() =>
    [0, 1, 2, 3].map(() => createEmptyPose())
  );
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  const [countdownSec, setCountdownSec] = useState<number>(3);
  const [countdownDisplay, setCountdownDisplay] = useState<string | null>(null);
  const [isCapturingSequence, setIsCapturingSequence] = useState<boolean>(false);
  const [activeShootingSlot, setActiveShootingSlot] = useState<number | null>(null);
  const [showFlash, setShowFlash] = useState<boolean>(false);

  // Refs avoid stale closures if the user changes effects mid-4-shot session
  const faceEffectRef = useRef<FaceEffectId>(faceEffect);
  const boothEffectRef = useRef<BoothEffectId>(boothEffect);
  const countdownSecRef = useRef<number>(countdownSec);
  const sessionTokenRef = useRef<number>(0);

  faceEffectRef.current = faceEffect;
  boothEffectRef.current = boothEffect;
  countdownSecRef.current = countdownSec;

  useEffect(() => {
    return () => {
      // Cancel any in-flight countdown on unmount
      sessionTokenRef.current += 1;
    };
  }, []);

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
  }, [cameraReady, isMirrored, videoRef]);

  const snapshotCurrentFaces = useCallback((): NormalizedFaceBox[] => {
    return latestLiveFacesRef.current.map((f) => ({ ...f }));
  }, [latestLiveFacesRef]);

  const shootSlotWithCountdown = useCallback(
    async (slotIdx: number, token: number) => {
      if (token !== sessionTokenRef.current) return;
      setActiveShootingSlot(slotIdx);
      const burstFrames: BurstFrame[] = [];
      const seconds = countdownSecRef.current;

      for (let s = seconds; s >= 1; s--) {
        if (token !== sessionTokenRef.current) return;
        setCountdownDisplay(String(s));
        soundFX.playCountdownTick(s);
        await sleep(500);
        if (token !== sessionTokenRef.current) return;

        const midFrame = grabVideoFrameDataUrl();
        if (midFrame) {
          burstFrames.push({
            dataUrl: midFrame,
            faceBoxes: snapshotCurrentFaces(),
          });
        }
        await sleep(500);
      }

      if (token !== sessionTokenRef.current) return;
      setCountdownDisplay(null);
      soundFX.playShutter();
      setShowFlash(true);
      setTimeout(() => setShowFlash(false), 320);

      const finalUrl = grabVideoFrameDataUrl();
      if (finalUrl) {
        const finalFaces = snapshotCurrentFaces();
        const lockedFaceEffect = faceEffectRef.current;
        const lockedBoothEffect = boothEffectRef.current;
        burstFrames.push({ dataUrl: finalUrl, faceBoxes: finalFaces });

        setPoses((prev) => {
          const next = [...prev];
          next[slotIdx] = {
            dataUrl: finalUrl,
            burstFrames,
            faceBoxes: finalFaces,
            faceEffect: lockedFaceEffect,
            boothEffect: lockedBoothEffect,
          };
          return next;
        });
      }

      await sleep(250);
    },
    [grabVideoFrameDataUrl, snapshotCurrentFaces]
  );

  const handleStartSession = useCallback(
    async (onlySlotIndex?: number | null) => {
      if (isCapturingSequence) return;
      if (!cameraReady) {
        onRequireUpload(typeof onlySlotIndex === 'number' ? onlySlotIndex : 0);
        return;
      }

      const token = ++sessionTokenRef.current;
      setIsCapturingSequence(true);

      try {
        if (typeof onlySlotIndex === 'number') {
          await shootSlotWithCountdown(onlySlotIndex, token);
          if (token === sessionTokenRef.current) {
            setSelectedSlotIndex(null);
          }
        } else {
          setPoses([0, 1, 2, 3].map(() => createEmptyPose()));
          for (let i = 0; i < 4; i++) {
            if (token !== sessionTokenRef.current) break;
            await shootSlotWithCountdown(i, token);
            if (i < 3 && token === sessionTokenRef.current) {
              await sleep(350);
            }
          }
        }
      } finally {
        if (token === sessionTokenRef.current) {
          setActiveShootingSlot(null);
          setCountdownDisplay(null);
          setIsCapturingSequence(false);
        }
      }
    },
    [cameraReady, isCapturingSequence, onRequireUpload, shootSlotWithCountdown]
  );

  const handleInstantSnap = useCallback(() => {
    const firstEmpty = poses.findIndex((p) => !p.dataUrl);
    const targetIdx =
      selectedSlotIndex !== null
        ? selectedSlotIndex
        : firstEmpty !== -1
        ? firstEmpty
        : 0;

    if (!cameraReady) {
      onRequireUpload(targetIdx);
      return;
    }

    soundFX.playShutter();
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 260);

    const dataUrl = grabVideoFrameDataUrl();
    if (dataUrl) {
      const capturedFaces = snapshotCurrentFaces();
      const lockedFaceEffect = faceEffectRef.current;
      const lockedBoothEffect = boothEffectRef.current;
      setPoses((prev) => {
        const next = [...prev];
        next[targetIdx] = {
          dataUrl,
          burstFrames: [{ dataUrl, faceBoxes: capturedFaces }],
          faceBoxes: capturedFaces,
          faceEffect: lockedFaceEffect,
          boothEffect: lockedBoothEffect,
        };
        return next;
      });
      setSelectedSlotIndex(null);
    }
  }, [cameraReady, grabVideoFrameDataUrl, onRequireUpload, poses, selectedSlotIndex, snapshotCurrentFaces]);

  const handleUploadedFiles = useCallback(
    (files: FileList, startSlotIdx: number) => {
      const lockedFaceEffect = faceEffectRef.current;
      const lockedBoothEffect = boothEffectRef.current;

      Array.from(files)
        .slice(0, 4)
        .forEach((file, offset) => {
          const reader = new FileReader();
          reader.onload = async () => {
            const result = reader.result as string;
            const targetSlot = (startSlotIdx + offset) % 4;
            setPoses((prev) => {
              const next = [...prev];
              next[targetSlot] = {
                dataUrl: result,
                burstFrames: [{ dataUrl: result, faceBoxes: [] }],
                faceBoxes: [],
                faceEffect: lockedFaceEffect,
                boothEffect: lockedBoothEffect,
              };
              return next;
            });

            try {
              const img = await loadImage(result);
              const detected = await detectFacesInImage(img);
              if (detected.length > 0) {
                setPoses((prev) => {
                  const next = [...prev];
                  if (next[targetSlot]?.dataUrl === result) {
                    next[targetSlot] = {
                      ...next[targetSlot],
                      faceBoxes: detected,
                      burstFrames: [{ dataUrl: result, faceBoxes: detected }],
                    };
                  }
                  return next;
                });
              }
            } catch {
              // Ignore detection failure on uploaded image
            }
          };
          reader.readAsDataURL(file);
        });
    },
    []
  );

  const resetAllPoses = useCallback(() => {
    // Cancel any active countdown cleanly
    sessionTokenRef.current += 1;
    setIsCapturingSequence(false);
    setActiveShootingSlot(null);
    setCountdownDisplay(null);
    setPoses([0, 1, 2, 3].map(() => createEmptyPose()));
    setSelectedSlotIndex(null);
  }, []);

  /**
   * Snapshots any still-live slots with their current live faceEffect, boothEffect, and tracked faces
   * so PNG/MP4/GIF export always matches what the user sees on screen.
   */
  const getExportPoses = useCallback((): CapturedPose[] => {
    const liveFaces = snapshotCurrentFaces();
    const liveFaceFx = faceEffectRef.current;
    const liveBoothFx = boothEffectRef.current;

    return poses.map((p) => {
      if (p.dataUrl) return p;
      const snap = grabVideoFrameDataUrl();
      if (!snap) return p;
      return {
        dataUrl: snap,
        burstFrames: [{ dataUrl: snap, faceBoxes: liveFaces }],
        faceBoxes: liveFaces,
        faceEffect: liveFaceFx,
        boothEffect: liveBoothFx,
      };
    });
  }, [grabVideoFrameDataUrl, poses, snapshotCurrentFaces]);

  return {
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
  };
}
