/**
 * HAS THE PLAYER STARTED TALKING? — the Auto-Listen (VAD) onset gate, pure.
 *
 * 2026-10-20 (Tim, practice bay: "the sound is too sensitive"; Kevin reacting to bay noise).
 * Two holes, both in how the gate opened:
 * - The ambient floor started at -50 and rose 2% per 100ms reading — about 5s to climb half way to a
 *   loud bay. Until then the bay itself cleared floor + 14 and read as speech. The end-of-speech
 *   detector (services/voice/endpointer) fixed the same thing on 10-17 by seeding from the first
 *   reading; this gate opens the mic and never got it.
 * - Two readings over the bar (200ms) opened it. A strike from the next bay, with its net hit, does
 *   that. A strike is a spike that dies; a voice holds. So onset now needs ONSET_SAMPLES readings in a
 *   row AND the latest still within TRANSIENT_DECAY_DB of the run's peak — the same 15 dB a strike must
 *   fall in strikeDetector.
 */

export const SPEECH_THRESHOLD_DB = -40;
export const SPEECH_MARGIN_DB = 14;
const NOISE_FLOOR_MIN_DB = -60;
const NOISE_FLOOR_FALL_ALPHA = 0.15;
const NOISE_FLOOR_RISE_ALPHA = 0.02;
/** Readings in a row over the bar before speech counts (100ms each). */
export const ONSET_SAMPLES = 3;
/** A run that has fallen this far from its own peak is a strike dying, not a voice. */
export const TRANSIENT_DECAY_DB = 15;

export function createSpeechOnsetGate() {
  let floor: number | null = null;
  let run = 0;
  let runPeak = -160;
  return {
    /** Feed one metering reading; `above` = over the speech bar, `onset` = speech has started. */
    push(db: number): { above: boolean; onset: boolean } {
      // Adaptive ambient floor: seeded from the first reading (a loud room is the floor from the
      // start), then falls fast toward quiet and rises slowly so speech doesn't inflate it. The input
      // is clamped so a dropout can't crash the floor.
      const m = Math.max(db, NOISE_FLOOR_MIN_DB);
      if (floor == null) floor = m;
      else floor += (m - floor) * (m < floor ? NOISE_FLOOR_FALL_ALPHA : NOISE_FLOOR_RISE_ALPHA);
      const above = db > Math.max(SPEECH_THRESHOLD_DB, floor + SPEECH_MARGIN_DB);
      if (above) { run += 1; runPeak = Math.max(runPeak, db); } else { run = 0; runPeak = -160; }
      return { above, onset: run >= ONSET_SAMPLES && db >= runPeak - TRANSIENT_DECAY_DB };
    },
    reset() { floor = null; run = 0; runPeak = -160; },
  };
}
