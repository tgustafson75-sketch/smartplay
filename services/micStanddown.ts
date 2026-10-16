/**
 * DID THE METER SHOW REAL SILENCE? — the tap mic's no-speech stand-down decision.
 *
 * 2026-10-15 (review). hooks/useVoiceCaddie stands the mic down after NO_SPEECH_STANDDOWN_MS when its
 * fixed -30 dBFS speech threshold was never crossed, and it DISCARDED the recording: no transcribe,
 * no log. The 08-19 comment in that file documents the device where that is wrong — Android, outdoors,
 * arm's length, wind: the meter sits under -30 while the player talks normally. The tap-to-stop branch
 * was fixed for exactly that ("the meter is not the judge"); the stand-down was the same veto left
 * standing, and on that device the turn silently vanished.
 *
 * The opposite bug is real too: the stand-down exists so a mic nobody answered closes quietly instead
 * of shipping seven seconds of silence to Whisper and saying "Didn't catch that".
 *
 * So the meter keeps its say only when it is EVIDENCE of silence: readings arrived, and none of them
 * rose meaningfully above the ambient floor (the same adaptive floor + 14 dB speech margin
 * voiceService.captureUtteranceDetailed uses). Anything else — a quiet voice under -30 but well over
 * the floor, or no metering at all — is transcribed, and the caller keeps an empty result quiet.
 */

const NOISE_FLOOR_INIT_DB = -50; // only reported before the first reading
const NOISE_FLOOR_MIN_DB = -60;
const NOISE_FLOOR_FALL_ALPHA = 0.15;
const NOISE_FLOOR_RISE_ALPHA = 0.02;
/** Matches voiceService SPEECH_MARGIN_DB: what clears ambient by this much counts as a voice. */
export const STANDDOWN_SPEECH_MARGIN_DB = 14;

export interface MeterTracker {
  /** Feed every metering reading (dBFS). */
  update(meteringDb: number): void;
  /** True only when readings arrived and none stood out from the ambient floor. */
  isRealSilence(): boolean;
  snapshot(): { samples: number; floorDb: number; peakOverFloorDb: number | null };
}

export function createMeterTracker(): MeterTracker {
  let samples = 0;
  let floorDb = NOISE_FLOOR_INIT_DB;
  let peakOverFloorDb = Number.NEGATIVE_INFINITY;
  return {
    update(meteringDb: number) {
      if (typeof meteringDb !== 'number' || !Number.isFinite(meteringDb)) return;
      // -160 is the "no signal" sentinel (cold-mic warm-up on some Android OEMs), not ambient.
      if (meteringDb <= -100) return;
      const m = Math.max(meteringDb, NOISE_FLOOR_MIN_DB);
      // Seed the floor from the first reading: a fixed -50 seed would make the first readings in a
      // loud place (wind, a cart) look like a voice. Speech between words drops fast, and the floor
      // falls fast, so a talker who starts immediately still stands out on the next word.
      if (samples === 0) floorDb = m;
      samples += 1;
      // Measured against the floor BEFORE this reading moves it, so a burst is not averaged away.
      peakOverFloorDb = Math.max(peakOverFloorDb, m - floorDb);
      const alpha = m < floorDb ? NOISE_FLOOR_FALL_ALPHA : NOISE_FLOOR_RISE_ALPHA;
      floorDb += (m - floorDb) * alpha;
    },
    isRealSilence() {
      return samples > 0 && peakOverFloorDb < STANDDOWN_SPEECH_MARGIN_DB;
    },
    snapshot() {
      return {
        samples,
        floorDb: Math.round(floorDb),
        peakOverFloorDb: Number.isFinite(peakOverFloorDb) ? Math.round(peakOverFloorDb) : null,
      };
    },
  };
}
