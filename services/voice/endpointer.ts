/**
 * WHEN HAS THE PLAYER FINISHED TALKING? — the one end-of-speech detector for both mic owners.
 *
 * 2026-10-17 (Tim at the range, in wind, showing the app to someone): "caddie had a hard time stop
 * listening when I was done". His log: an earbud/text-box listen ran 8.1s with speech "heard" and came
 * back empty, and a Caddie-tab tap came back empty too.
 *
 * Two endpointers, both wrong in wind:
 * - hooks/useVoiceCaddie (Caddie tab) ended on a FIXED -40 dBFS: any ambient above -40 (wind, a cart,
 *   a range) never reads as silence, so it ran to its 18s cap.
 * - services/voiceService (earbud, text-box mic) lifted its thresholds over an ambient floor, but the
 *   floor started at -50 and rose at 2% per 100ms sample — about 5s to climb half way to the wind. In
 *   that time the wind itself was "still talking", so it ran to its 8s cap.
 * Either way the clip was mostly wind, and Whisper heard nothing in it.
 *
 * What changes (quiet rooms keep the absolute floors exactly as before: -30 to count as speech, -40 to
 * count as still talking):
 * - The floor is seeded from the first reading and rises only on readings within 6 dB of it, so the
 *   player's voice (even a quiet one) cannot inflate it, and it can rise faster (8% a reading).
 * - In noise (floor above NOISY_FLOOR_DB), "still talking" is also judged against the player's own
 *   voice: a reading must come within SPEECH_DROP_DB of their speaking level. Wind that the absolute and
 *   ambient thresholds cannot tell from a voice falls under that.
 * - In noise, a listen ends at NOISY_CAP_MS whatever the meter says. A golfer's question is ~3-5s.
 *
 * Pure: readings in, a decision out. Both call sites feed it from their metering callback and ask it
 * from their poll loop.
 */

const NOISE_FLOOR_MIN_DB = -60;
const FLOOR_FALL_ALPHA = 0.15;
const FLOOR_RISE_ALPHA = 0.08;
const FLOOR_RISE_BAND_DB = 6;
/** Absolute bars (unchanged from both call sites): never more sensitive than these. */
export const SPEECH_DETECT_DB = -30;
export const SILENCE_DB = -40;
const SPEECH_MARGIN_DB = 14;
const SILENCE_MARGIN_DB = 12;
/** Ambient above this is a noisy place (a quiet phone mic sits around -55). */
export const NOISY_FLOOR_DB = -46;
/** In noise, a reading this far under the player's speaking level is not them still talking. */
export const SPEECH_DROP_DB = 12;
/** In noise, the longest a listen runs. */
export const NOISY_CAP_MS = 8_000;

export type EndReason = 'silence' | 'noisy_cap';

export interface EndpointerConfig {
  /** Quiet gap that ends a one-word command. */
  shortMs: number;
  /** Quiet gap that ends a sentence (rides out a word-search pause). */
  longMs: number;
  /** Speaking longer than this makes it a sentence. */
  speechLongMs: number;
}

export interface Endpointer {
  /** Feed one metering reading (dBFS) taken at `nowMs`. */
  push(meteringDb: number, nowMs: number): void;
  /** Restart the quiet clock (after the mic warm-up gap). */
  markLoud(nowMs: number): void;
  /** Should the capture end now? `startedAt` is when the mic opened. */
  shouldStop(nowMs: number, startedAt: number): EndReason | null;
  readonly heardSpeech: boolean;
  readonly speechStartAt: number;
  snapshot(): { floorDb: number | null; speechDb: number | null; noisy: boolean; samples: number };
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

export function createEndpointer(cfg: EndpointerConfig): Endpointer {
  let samples = 0;
  let floor = -50;
  let heard = false;
  let speechStart = 0;
  let lastLoud = 0;
  const voice: number[] = [];
  const noisy = () => samples > 0 && floor > NOISY_FLOOR_DB;
  const speechDb = () => (voice.length >= 3 ? pct(voice, 0.8) : null);

  return {
    push(meteringDb, nowMs) {
      if (typeof meteringDb !== 'number' || !Number.isFinite(meteringDb) || meteringDb <= -100) return;
      const m = Math.max(meteringDb, NOISE_FLOOR_MIN_DB);
      if (samples === 0) floor = m;
      samples += 1;
      const effSpeech = Math.max(SPEECH_DETECT_DB, floor + SPEECH_MARGIN_DB);
      const effSilence = Math.max(SILENCE_DB, floor + SILENCE_MARGIN_DB);
      // The floor learns from ambient only: it falls toward anything quieter, and rises only on readings
      // close to it (within FLOOR_RISE_BAND_DB) — a voice, even a quiet one, never pulls it up.
      if (m < floor) floor += (m - floor) * FLOOR_FALL_ALPHA;
      else if (m <= floor + FLOOR_RISE_BAND_DB) floor += (m - floor) * FLOOR_RISE_ALPHA;
      if (m > effSpeech) {
        if (!heard) speechStart = nowMs;
        heard = true;
        voice.push(m);
        if (voice.length > 60) voice.shift();
      }
      let still = effSilence;
      const sp = speechDb();
      if (noisy() && sp != null) still = Math.max(still, sp - SPEECH_DROP_DB);
      if (m > still) lastLoud = nowMs;
    },
    markLoud(nowMs) { lastLoud = nowMs; },
    shouldStop(nowMs, startedAt) {
      if (heard) {
        const window = nowMs - speechStart >= cfg.speechLongMs ? cfg.longMs : cfg.shortMs;
        if (nowMs - lastLoud >= window) return 'silence';
      }
      if (noisy() && nowMs - startedAt >= NOISY_CAP_MS) return 'noisy_cap';
      return null;
    },
    get heardSpeech() { return heard; },
    get speechStartAt() { return speechStart; },
    snapshot() {
      const sp = speechDb();
      return { floorDb: samples > 0 ? Math.round(floor) : null, speechDb: sp == null ? null : Math.round(sp), noisy: noisy(), samples };
    },
  };
}
