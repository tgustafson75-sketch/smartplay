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
 * THREE QUESTIONS, deliberately kept apart (the first cut of this merged them, and the review showed a
 * soft voice in wind going unheard and its recording discarded):
 * - HEARD (`heardSpeech`): did a person speak at all? Callers use it to decide transcribe-vs-discard,
 *   so it is never stricter than either old path: above -30 (the tab's old bar) OR floor + 14 (the
 *   earbud path's). Erring here costs a transcription, never a question.
 * - ARMED: may a silence end the capture now? As strict as the earbud path always was —
 *   above max(-30, floor + 14) — so a gust or a blip before the player speaks cannot start the clock.
 * - STILL TALKING: below NOISY_FLOOR_DB the old fixed -40 (a quiet or mildly noisy room ends exactly as
 *   the tab always did). Above it — real noise, where ambient itself crosses -40 — the reading must
 *   clear floor + 12 AND come within SPEECH_DROP_DB of the player's own speaking level.
 *
 * The floor: seeded from the first reading (wind already blowing when the mic opens is the floor from
 * the start), falls fast toward anything quieter, and creeps up only on readings within 6 dB of it.
 * It does NOT jump to sustained loudness: by level alone, 14s of continuous talking in a car is
 * indistinguishable from settled wind, and a jump cut that answer off at 5s (traced in review). Being
 * cut off is the hard failure, so wind that arrives AFTER the mic opened in a lull is left to the
 * callers' caps (the earbud path's 8s, the tab's 18s — what the tab always did).
 *
 * The noisy cap: in noise, a listen ends NOISY_CAP_AFTER_SPEECH_MS after the player was first heard,
 * whatever the meter says — a golfer's question is ~3-5s, and this leaves room for a long answer.
 *
 * Pure: readings in, a decision out. Both call sites feed it from their metering callback and ask it
 * from their poll loop.
 */

const NOISE_FLOOR_MIN_DB = -60;
const FLOOR_FALL_ALPHA = 0.15;
const FLOOR_RISE_ALPHA = 0.08;
const FLOOR_RISE_BAND_DB = 6;
/** Absolute bars (unchanged from both call sites). */
export const SPEECH_DETECT_DB = -30;
export const SILENCE_DB = -40;
const SPEECH_MARGIN_DB = 14;
const SILENCE_MARGIN_DB = 12;
/** Ambient above this is real noise: the fixed -40 "still talking" bar no longer separates a voice. */
export const NOISY_FLOOR_DB = -40;
/** In noise, a reading this far under the player's speaking level is not them still talking. */
export const SPEECH_DROP_DB = 15;
/** In noise, the longest a listen runs after the player was first heard. */
export const NOISY_CAP_AFTER_SPEECH_MS = 10_000;

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
  /** A person spoke (transcribe, don't discard). */
  readonly heardSpeech: boolean;
  snapshot(): { floorDb: number | null; speechDb: number | null; noisy: boolean; armed: boolean; samples: number };
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

export function createEndpointer(cfg: EndpointerConfig): Endpointer {
  let samples = 0;
  let floor = -50;
  let heard = false;
  let heardAt = 0;
  let armed = false;
  let armedAt = 0;
  /** First reading over the absolute -30 bar: what both old paths armed on in a quiet place. */
  let loudAt = 0;
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
      if (m < floor) floor += (m - floor) * FLOOR_FALL_ALPHA;
      else if (m <= floor + FLOOR_RISE_BAND_DB) floor += (m - floor) * FLOOR_RISE_ALPHA;

      if (!heard && (m > SPEECH_DETECT_DB || m > floor + SPEECH_MARGIN_DB)) { heard = true; heardAt = nowMs; }
      if (!loudAt && m > SPEECH_DETECT_DB) loudAt = nowMs;
      if (m > Math.max(SPEECH_DETECT_DB, floor + SPEECH_MARGIN_DB)) {
        if (!armed) { armed = true; armedAt = nowMs; }
        voice.push(m);
        if (voice.length > 60) voice.shift();
      }
      let still = SILENCE_DB;
      if (noisy()) {
        still = Math.max(SILENCE_DB, floor + SILENCE_MARGIN_DB);
        const sp = speechDb();
        if (sp != null) still = Math.max(still, sp - SPEECH_DROP_DB);
      }
      if (m > still) lastLoud = nowMs;
    },
    markLoud(nowMs) { lastLoud = nowMs; },
    shouldStop(nowMs, _startedAt) {
      /**
       * Armed — or, in a place that is not noisy NOW, anything ever crossed -30 (exactly what both old
       * paths armed on). The second half catches a player who talked the instant the mic opened, close to
       * it: the floor learned his word gaps (~-30), so nothing cleared floor + 14 while he spoke; once he
       * stops and the room's real quiet comes back, his -30 crossings still count.
       */
      const startAt = armed ? armedAt : loudAt && !noisy() ? loudAt : 0;
      if (startAt) {
        const window = nowMs - startAt >= cfg.speechLongMs ? cfg.longMs : cfg.shortMs;
        if (nowMs - lastLoud >= window) return 'silence';
      }
      if (noisy() && heard && nowMs - heardAt >= NOISY_CAP_AFTER_SPEECH_MS) return 'noisy_cap';
      return null;
    },
    get heardSpeech() { return heard; },
    snapshot() {
      const sp = speechDb();
      return { floorDb: samples > 0 ? Math.round(floor) : null, speechDb: sp == null ? null : Math.round(sp), noisy: noisy(), armed, samples };
    },
  };
}
