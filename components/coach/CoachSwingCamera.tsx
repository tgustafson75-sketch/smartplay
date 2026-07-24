/**
 * 2026-07-23 (Tim — "model Coach Caddie's capture after SmartMotion; it must feel like a real coach
 * leading a lesson, near-zero tap"). A focused, reusable in-app swing camera modeled on SmartMotion's
 * capture primitive: an expo-camera CameraView + recordAsync(). It replaces the image-picker MODAL in
 * Coach Caddie so the lesson stays on ONE screen (the coach component never unmounts → lesson state
 * survives) and the caddie can talk between reps.
 *
 * Audio: modeled on SmartMotion — the moment a recording starts we stopSpeaking(), so the caddie's TTS
 * never lands in the clip and never fights the recording audio session. The caller's flow is sequential
 * (coach speaks the instruction → THEN records → THEN speaks feedback), so voice and capture never
 * overlap — the exact camera-owns-mic handoff [[voice-listening-architecture]] the phone needs.
 *
 * This is intentionally NARROW (record a clip → hand back the uri); the caller runs the SAME
 * analyzeSwingFromVideo the coach already uses. Framing / strike-segmentation are SmartMotion's fuller
 * job; here the analysis pipeline locates the swing within the recorded window.
 */
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';

export interface CoachCameraHandle {
  /** Record up to `maxSec`, resolving with the clip uri (or null on permission denial / error).
   *  Auto-stops at maxSec; call stop() to end early. */
  record(maxSec: number): Promise<string | null>;
  /** Stop an in-flight recording early (resolves the pending record() with the partial clip). */
  stop(): void;
}

interface Props {
  facing?: 'back' | 'front';
  style?: StyleProp<ViewStyle>;
}

export const CoachSwingCamera = forwardRef<CoachCameraHandle, Props>(function CoachSwingCamera(
  { facing = 'back', style },
  ref,
) {
  const camRef = useRef<CameraView>(null);
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const inFlightRef = useRef(false);

  useImperativeHandle(ref, (): CoachCameraHandle => ({
    async record(maxSec) {
      if (!camRef.current || inFlightRef.current) return null;
      // Permissions — camera to see the swing, mic because recordAsync captures an audio track.
      if (!camPerm?.granted) { const r = await requestCam(); if (!r.granted) return null; }
      if (!micPerm?.granted) { const r = await requestMic(); if (!r.granted) return null; }
      // Silence the caddie so its TTS doesn't land in the clip / fight the recording audio session
      // (modeled on SmartMotion's start-of-record stopSpeaking()).
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        await (require('../../services/voiceService') as typeof import('../../services/voiceService')).stopSpeaking();
      } catch { /* best-effort — never block the capture */ }
      inFlightRef.current = true;
      try {
        const res = (await camRef.current.recordAsync({ maxDuration: maxSec })) as { uri: string } | undefined;
        return res?.uri ?? null;
      } catch {
        return null;
      } finally {
        inFlightRef.current = false;
      }
    },
    stop() {
      try { camRef.current?.stopRecording(); } catch { /* no-op */ }
    },
  }), [camPerm, micPerm, requestCam, requestMic]);

  // No camera permission yet → render an empty placeholder (record() will request on first use).
  if (!camPerm?.granted) return <View style={style} />;
  return <CameraView ref={camRef} mode="video" facing={facing} style={style} />;
});
