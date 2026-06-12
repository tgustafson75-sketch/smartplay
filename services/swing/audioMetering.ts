import { Audio } from 'expo-av';
import type { MeterSample } from './strikeDetector';
import { setAudioModeSerial } from '../voiceService';

/**
 * Audio metering recorder — wraps expo-av Audio.Recording with
 * `isMeteringEnabled: true` so callers can stream peak-dB samples
 * during a recording. Phase BO.1, ported verbatim from SmartPlay
 * Caddie V3 (services/swing/audioMetering.ts).
 *
 * Used by the Acoustic Test Bench today; Phase BO.2 (deferred) will
 * decide whether to wire it into a live capture flow or run detection
 * post-hoc on uploaded video audio.
 *
 * The audio file produced is incidental — we only care about the
 * metering callbacks. Caller can delete the file after analysis or
 * leave it for the OS to clean up the temp directory.
 *
 * Why a wrapper: keeping the metering subscription, sample buffer, and
 * lifecycle in one place keeps the screen focused on UI rather than
 * expo-av plumbing.
 */

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 22_050,
    numberOfChannels: 1,
    bitRate: 64_000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.LOW,
    sampleRate: 22_050,
    numberOfChannels: 1,
    bitRate: 64_000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 64_000 },
};

const METERING_INTERVAL_MS = 50;

export type MeteringHandle = {
  /** Stop the recording and return the buffered samples (ms-from-start, dB). */
  stop: () => Promise<{ samples: MeterSample[]; uri: string | null; durationMs: number }>;
  /** Cancel without returning data — used on user-initiated abort. */
  cancel: () => Promise<void>;
};

export async function startMeteredRecording(
  onSample?: (sample: MeterSample) => void,
): Promise<MeteringHandle> {
  // 2026-06-07 — REQUIRED on iOS: without recording audio mode,
  // prepareToRecordAsync throws. Smart Motion runs this metering track
  // in parallel with the camera capture (same proven pattern as
  // acousticImpactDetector); the serialized setter avoids the audio-
  // singleton race with the caddie mic / camera. Without this the whole
  // acoustic feature silently no-ops on iOS.
  await setAudioModeSerial({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
  });

  const recording = new Audio.Recording();
  const startedAt = Date.now();
  const samples: MeterSample[] = [];
  // 2026-06-12 — prepare/start are wrapped: if either throws (documented iOS audio-mode
  // race with the camera/caddie mic), a half-constructed Recording left un-unloaded
  // WEDGES the audio session, silently killing metering for the rest of the Smart Motion
  // session. On any failure, unload it and rethrow so the caller's catch can no-op cleanly.
  try {
    // We discard the audio file — only the metering callback matters. LOW quality keeps
    // the temp file small; METERING_INTERVAL_MS controls the tick rate.
    await recording.prepareToRecordAsync(RECORDING_OPTIONS);
    recording.setProgressUpdateInterval(METERING_INTERVAL_MS);

    recording.setOnRecordingStatusUpdate((status) => {
      if (!status.isRecording || status.metering === undefined) return;
      const sample: MeterSample = {
        timeMs: status.durationMillis ?? Date.now() - startedAt,
        dB: status.metering,
      };
      samples.push(sample);
      onSample?.(sample);
    });

    await recording.startAsync();
  } catch (e) {
    try { await recording.stopAndUnloadAsync(); } catch { /* never prepared — nothing to unload */ }
    throw e;
  }

  // 2026-06-07 — idempotent teardown. Smart Motion can race stop() (user
  // taps Stop) against cancel() (screen unmount); a double
  // stopAndUnloadAsync on the same Recording rejects. The `done` latch
  // makes the second call a no-op so dual-source teardown is safe.
  let done = false;
  return {
    async stop() {
      const uri = recording.getURI();
      if (done) return { samples, uri, durationMs: Date.now() - startedAt };
      done = true;
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // expo-av sometimes throws on stop after a brief recording;
        // we still want to return whatever samples we collected.
      }
      return {
        samples,
        uri: recording.getURI() ?? uri,
        durationMs: Date.now() - startedAt,
      };
    },
    async cancel() {
      if (done) return;
      done = true;
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        /* swallow — we don't care about the audio file on cancel */
      }
    },
  };
}
