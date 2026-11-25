import { useCallback, useEffect, useRef, useState } from 'react';
import { resetFaceTrackerState } from '../utils/faceTracker';
import { soundFX } from '../utils/sound';

export function useCameraStream() {
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isMirrored, setIsMirrored] = useState<boolean>(true);
  const [cameraReady, setCameraReady] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef<number>(0);

  const stopActiveStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(
    async (
      mode: 'user' | 'environment' = facingMode,
      deviceId: string = selectedDeviceId
    ) => {
      const reqId = ++requestIdRef.current;
      stopActiveStream();
      resetFaceTrackerState();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraReady(false);
        setCameraError('Camera unavailable — open this page over HTTPS in Edge, Chrome, or Safari.');
        return;
      }

      const attempts: MediaStreamConstraints[] = deviceId
        ? [
            { video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false },
            { video: { deviceId: { exact: deviceId } }, audio: false },
            { video: true, audio: false },
          ]
        : [
            { video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: { ideal: mode } }, audio: false },
            { video: { facingMode: mode }, audio: false },
            { video: true, audio: false },
          ];

      let stream: MediaStream | null = null;
      let lastErr: unknown = null;

      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastErr = err;
          const errName = (err as DOMException)?.name;
          if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
            break;
          }
        }
      }

      // Guard against stale async resolution (e.g., rapid camera flip or unmount)
      if (reqId !== requestIdRef.current) {
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
        return;
      }

      if (!stream) {
        setCameraReady(false);
        const errName = (lastErr as DOMException)?.name || '';
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          setCameraError('Camera blocked — click the lock/camera icon in the address bar and allow Camera, then tap Retry.');
        } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
          setCameraError('Camera is busy in another app — close it or switch cameras, then tap Retry.');
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          setCameraError('No camera detected on this device.');
        } else {
          setCameraError('Could not start camera — tap to retry or upload photos.');
        }
        return;
      }

      streamRef.current = stream;
      setCameraError(null);

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (reqId === requestIdRef.current) {
          setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
        }
      } catch {
        // Ignore enumerateDevices failure
      }

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        if (video.readyState < 1) {
          await new Promise<void>((resolve) => {
            const onMeta = () => {
              video.removeEventListener('loadedmetadata', onMeta);
              resolve();
            };
            video.addEventListener('loadedmetadata', onMeta, { once: true });
            setTimeout(resolve, 1500);
          });
        }
        if (reqId !== requestIdRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        await video.play().catch(() => {});
      }

      if (reqId === requestIdRef.current) {
        setCameraReady(true);
      }
    },
    [facingMode, selectedDeviceId, stopActiveStream]
  );

  const handleFlipCamera = useCallback(() => {
    soundFX.playPop(620);
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setSelectedDeviceId('');
    setFacingMode(nextMode);
    setIsMirrored(nextMode === 'user');
  }, [facingMode]);

  useEffect(() => {
    startCamera(facingMode, selectedDeviceId);
    return () => {
      requestIdRef.current += 1;
      stopActiveStream();
    };
  }, [startCamera, facingMode, selectedDeviceId, stopActiveStream]);

  return {
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
  };
}
