import { Audio } from 'expo-av';
import type { MeterSample } from './strikeDetector';

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
  const recording = new Audio.Recording();
  // We discard the audio file — only the metering callback matters.
  // Using LOW quality keeps the temp file small. METERING_INTERVAL_MS
  // controls how often we receive metering ticks.
  await recording.prepareToRecordAsync(RECORDING_OPTIONS);
  recording.setProgressUpdateInterval(METERING_INTERVAL_MS);

  const startedAt = Date.now();
  const samples: MeterSample[] = [];

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

  return {
    async stop() {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // expo-av sometimes throws on stop after a brief recording;
        // we still want to return whatever samples we collected.
      }
      const uri = recording.getURI();
      return {
        samples,
        uri,
        durationMs: Date.now() - startedAt,
      };
    },
    async cancel() {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        /* swallow — we don't care about the audio file on cancel */
      }
    },
  };
}
