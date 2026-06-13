/**
 * 2026-06-13 — Vision-camera swing capture (SmartTrace migration, Stage 0).
 *
 * A drop-in replacement for the expo-camera <CameraView> in the swing path,
 * recording with react-native-vision-camera at a HIGH frame rate so SmartTrace
 * has a dense launch window to read ball departure from. It deliberately mimics
 * CameraView's imperative ref API — recordAsync()/stopRecording() — so Stage 1's
 * swap in smartmotion is mechanical (the same cameraRef calls work unchanged).
 *
 * Records VIDEO-ONLY (audio={false}) on purpose: the acoustic impact anchor comes
 * from acousticImpactDetector's own parallel expo-av Audio.Recording, so keeping
 * this camera off the mic guarantees that recording never loses access. See
 * services/capture/captureFlags.ts and memory practice-engine-smartmotion.
 *
 * Native module — only renders meaningfully in a build that linked vision-camera
 * (the app.json config plugin). Gated behind USE_VISION_CAMERA; the expo-camera
 * path stays the default until this is proven on-device.
 */

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  type VideoFile,
} from 'react-native-vision-camera';
import { PREFERRED_CAPTURE_FPS } from '../../services/capture/captureFlags';

/** Mirrors the slice of expo-camera's CameraView ref API the swing path uses, so
 *  this component is a structural drop-in for it. */
export interface SwingCameraHandle {
  recordAsync(opts?: { maxDuration?: number }): Promise<{ uri: string } | undefined>;
  stopRecording(): void;
}

interface Props {
  facing?: 'front' | 'back';
  /** vision-camera streams only while active; mirror CameraView mount/unmount. */
  isActive?: boolean;
  onCameraReady?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** expo-camera returns a file:// uri; vision-camera returns a bare path. Normalize
 *  so the downstream analysis pipeline sees the same shape from either engine. */
function toUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

export const SwingVisionCamera = forwardRef<SwingCameraHandle, Props>(function SwingVisionCamera(
  { facing = 'back', isActive = true, onCameraReady, style },
  ref,
) {
  const device = useCameraDevice(facing);
  // Prioritize frame rate (SmartTrace's launch window) over resolution, then take
  // the highest resolution available at that rate. vision-camera resolves to the
  // closest format the device actually supports — degrades gracefully on phones
  // that top out below PREFERRED_CAPTURE_FPS.
  const format = useCameraFormat(device, [
    { fps: PREFERRED_CAPTURE_FPS },
    { videoResolution: 'max' },
  ]);
  const fps = format ? Math.min(PREFERRED_CAPTURE_FPS, format.maxFps) : undefined;

  const camRef = useRef<Camera>(null);
  // Holds the resolver for the in-flight recordAsync promise; resolved when
  // vision-camera reports the finished file (or undefined on error/stop-with-no-file).
  const finishRef = useRef<((v: { uri: string } | undefined) => void) | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, (): SwingCameraHandle => ({
    recordAsync(opts) {
      return new Promise<{ uri: string } | undefined>((resolve) => {
        const cam = camRef.current;
        if (!cam) { resolve(undefined); return; }
        finishRef.current = resolve;
        try {
          cam.startRecording({
            fileType: 'mp4',
            onRecordingFinished: (video: VideoFile) => {
              if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
              const r = finishRef.current; finishRef.current = null;
              r?.({ uri: toUri(video.path) });
            },
            onRecordingError: () => {
              if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
              const r = finishRef.current; finishRef.current = null;
              r?.(undefined);
            },
          });
        } catch {
          finishRef.current = null;
          resolve(undefined);
          return;
        }
        // Backstop auto-stop (the caller also sets its own timeout; double-stop is
        // guarded). Keeps parity with CameraView.recordAsync({ maxDuration }).
        if (opts?.maxDuration && opts.maxDuration > 0) {
          maxTimerRef.current = setTimeout(() => {
            try { camRef.current?.stopRecording(); } catch { /* no-op */ }
          }, opts.maxDuration * 1000);
        }
      });
    },
    stopRecording() {
      try { camRef.current?.stopRecording(); } catch { /* no-op */ }
    },
  }), []);

  // No camera (permission denied / unavailable) → render nothing; recordAsync
  // resolves undefined, matching the "no capture" path the caller already handles.
  if (!device) return null;

  return (
    <Camera
      ref={camRef}
      style={style ?? StyleSheet.absoluteFill}
      device={device}
      format={format}
      fps={fps}
      isActive={isActive}
      video={true}
      audio={false}
      photo={false}
      onInitialized={onCameraReady}
    />
  );
});
