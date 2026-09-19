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

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  type VideoFile,
} from 'react-native-vision-camera';
import { PREFERRED_CAPTURE_FPS } from '../../services/capture/captureFlags';
import { useCaptureEngineStore } from '../../store/captureEngineStore';
import { createRecordingGate, type RecordingGate } from '../../services/capture/recordingGate';

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
  /**
   * 2026-09-12 — fired when this engine cannot run on this device.
   *
   * `if (!device) return null` below renders NOTHING. The parent has already committed to the vision
   * branch by then (its lazy require succeeded, so the native module is linked), which left the
   * player looking at a blank frame with no capture at all — a worse outcome than the 30fps engine
   * it replaced. The parent needs to hear about it so it can fall back.
   */
  onUnavailable?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** expo-camera returns a file:// uri; vision-camera returns a bare path. Normalize
 *  so the downstream analysis pipeline sees the same shape from either engine. */
function toUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

export const SwingVisionCamera = forwardRef<SwingCameraHandle, Props>(function SwingVisionCamera(
  { facing = 'back', isActive = true, onCameraReady, onUnavailable, style },
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
  /**
   * 2026-08-26 — publish what we ACTUALLY got. useCameraFormat degrades to the device's best, so
   * asking for 120 and receiving 30 produced a capture indistinguishable from a high-speed one
   * downstream — and SmartTrace would draw a departure direction it could not have seen. See
   * captureEngineStore.capturedFps and MIN_TRACE_FPS.
   */
  useEffect(() => {
    useCaptureEngineStore.getState().setCapturedFps(fps ?? null);
    return () => { useCaptureEngineStore.getState().setCapturedFps(null); };
  }, [fps]);

  const camRef = useRef<Camera>(null);
  // Holds the resolver for the in-flight recordAsync promise; resolved when
  // vision-camera reports the finished file (or undefined on error/stop-with-no-file).
  const finishRef = useRef<((v: { uri: string } | undefined) => void) | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 2026-09-19 (production, iPhone 17 Pro, four events from one player) —
   *
   *   capture/no-recording-in-progress: There was no active video recording in progress!
   *   Did you call stopRecording() twice?   mechanism: onunhandledrejection
   *
   * THE COMMENT BELOW SAID "double-stop is guarded" AND NOTHING GUARDED IT. Two things were wrong,
   * and the second is why it reached Sentry instead of being swallowed:
   *
   *  1. No recording STATE was tracked, so every stop call — the caller's, this component's own
   *     backstop timer, the Stop button, the voice command — went straight to the native module
   *     whether or not anything was recording. The caller sets its own timeout at the same duration
   *     as the backstop here, and `onRecordingFinished` only clears the backstop AFTER a native
   *     round trip, so the two stops land in the same tick and the second one has nothing to stop.
   *
   *  2. `try { cam.stopRecording() } catch {}` CANNOT CATCH IT. vision-camera declares
   *     `stopRecording(): Promise<void>` and rejects through `tryParseNativeCameraError` — which is
   *     exactly the frame in the reported stack. A synchronous catch around a promise-returning
   *     call sees nothing, so the rejection escaped as an unhandled one.
   *
   * Both halves live in services/capture/recordingGate, which is pure and therefore testable — this
   * component needs a native module to mount, and that is a large part of why the missing guard went
   * unnoticed. Native state can still disagree with ours (a recording can end on its own between our
   * flag and the call), so the gate keeps the `.catch` as a second layer rather than as the only one.
   * [[no-half-fixes-enforce-every-surface]]
   */
  const gateRef = useRef<RecordingGate | null>(null);
  if (gateRef.current == null) {
    gateRef.current = createRecordingGate(() => camRef.current?.stopRecording());
  }

  /** The ONLY path to the native stop. Idempotent, and it can never reject into nowhere. */
  const stopNative = useCallback(() => {
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    gateRef.current?.stop();
  }, []);

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
              gateRef.current?.markStopped();
              if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
              const r = finishRef.current; finishRef.current = null;
              r?.({ uri: toUri(video.path) });
            },
            onRecordingError: () => {
              gateRef.current?.markStopped();
              if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
              const r = finishRef.current; finishRef.current = null;
              r?.(undefined);
            },
          });
          // Only AFTER startRecording returns without throwing: a failed start never recorded, and
          // marking it as recording would send a stop at a camera with nothing in progress.
          gateRef.current?.markStarted();
        } catch {
          gateRef.current?.markStopped();
          finishRef.current = null;
          resolve(undefined);
          return;
        }
        // Backstop auto-stop. The caller sets its own timeout at the same duration, so these two
        // genuinely race — which is what produced the field report. Both go through stopNative now,
        // and the second finds the gate already closed and does nothing. Keeps parity with
        // CameraView.recordAsync({ maxDuration }).
        if (opts?.maxDuration && opts.maxDuration > 0) {
          maxTimerRef.current = setTimeout(stopNative, opts.maxDuration * 1000);
        }
      });
    },
    stopRecording() {
      stopNative();
    },
  }), [stopNative]);

  // No camera (permission denied / unavailable) → render nothing; recordAsync
  // resolves undefined, matching the "no capture" path the caller already handles.
  /**
   * No camera device for this facing — the module is linked but cannot serve this device. Tell the
   * parent so it falls back to expo-camera rather than showing an empty frame. Reported from an
   * effect, never during render: calling a parent's setState inside render is a React warning and,
   * worse, can loop.
   */
  useEffect(() => {
    if (!device) onUnavailable?.();
  }, [device, onUnavailable]);

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
      /**
       * 2026-08-24 (Tim: "check the selfie mode analysis") — NEVER MIRROR THE RECORDING.
       *
       * react-native-vision-camera's `isMirrored` defaults to TRUE for the front camera, and this
       * component never set it. So on this engine a SELFIE face-on recording would have come back
       * mirrored, and a mirrored clip flips EVERY direction read: handedness, in-to-out vs
       * out-to-in, ball start direction, aim, which way a miss went. The numbers would all look
       * plausible and all be backwards.
       *
       * The expo-camera path has always set `mirror={false}` with a comment saying exactly why —
       * "a mirrored selfie preview would feel natural but flip every direction read, so we
       * deliberately don't". That guarantee simply never crossed to the second capture engine. Two
       * paths, one guarantee, which is the shape this whole week has been about.
       *
       * Latent rather than live today (DEFAULT_USE_VISION_CAMERA is false, so this engine is behind
       * an owner toggle) — which is precisely why it would have shipped unnoticed the day the engine
       * was promoted.
       */
      isMirrored={false}
      onInitialized={onCameraReady}
    />
  );
});
