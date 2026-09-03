/**
 * 2026-09-03 — WHAT THE ROUND COST YOU PHYSICALLY, in one owner.
 *
 * Phase 413 wired Health Connect into the round record in May and then stopped. Four permissions
 * (Steps, Distance, HeartRate, ActiveCaloriesBurned) were requested, read at round end, written to
 * `roundHistory[].health`, and carried to Supabase inside the `round-store-v1` backup — and NOTHING
 * ever read them back. `hasWatchData` appeared in exactly one file: the writer. The field's own
 * header said "Round summary copy and Kevin's recap context can incorporate them when present",
 * which was true only in the sense that nothing stopped them.
 *
 * That is the worst shape a permission can be in. Google's Health Connect review asks which
 * user-facing feature justifies each data type; "none, we store it" is a rejection, and collecting
 * heart rate for no reader is not something to defend in a privacy policy either.
 *
 * So this module is the reader. It is deliberately the ONLY one: the recap card and Kevin's
 * narration both call it, so the number on screen and the number in his mouth cannot drift into two
 * roundings of the same walk. [[two-owners-is-the-root-cause]]
 *
 * PURE — types-only imports, no react-native/expo, never throws. Safe to call on render and
 * testable in the sim harness, same contract as recapSynth.
 *
 * HONESTY: a round played without a watch has no effort to report, and this returns null rather
 * than a card full of zeroes. `hasWatchData` alone is not enough — it means at least one sample
 * landed, which a denied-mid-round grant can satisfy with nothing but zeroes. Every clause of the
 * headline is omitted when its own metric is absent, so the sentence shrinks instead of inventing.
 * [[illustration-data-points]]
 */

import type { RoundRecord } from '../store/roundStore';

/** Health Connect reports metres; golfers in the app's markets read miles. */
const METRES_PER_MILE = 1609.344;

export interface RoundEffort {
  steps: number;
  distanceMeters: number;
  /** Rounded to one decimal — the underlying pedometer is not precise enough for two. */
  distanceMiles: number;
  heartRateAvg: number | null;
  heartRateMax: number | null;
  activeCalories: number;
  durationMin: number;
  /** Plain-language sentence, safe to render as a caption AND to speak. Never empty. */
  headline: string;
}

/** "4h 10m" / "47m" — spoken and rendered identically. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/**
 * Turn a round's stored health block into something a person can read, or null when there is
 * genuinely nothing to say. Null is the correct answer far more often than not — most rounds are
 * played without a watch, and on iOS this never populates at all.
 */
export function describeRoundEffort(health: RoundRecord['health']): RoundEffort | null {
  if (!health || !health.hasWatchData) return null;

  const steps = Math.max(0, Math.round(health.totalSteps ?? 0));
  const distanceMeters = Math.max(0, health.distanceMeters ?? 0);
  const activeCalories = Math.max(0, Math.round(health.activeCalories ?? 0));
  const durationMin = Math.max(0, Math.round(health.durationMin ?? 0));
  // A heart rate of 0 is not a measurement, it is an absent one wearing a number.
  const heartRateAvg = health.heartRateAvg != null && health.heartRateAvg > 0 ? Math.round(health.heartRateAvg) : null;
  const heartRateMax = health.heartRateMax != null && health.heartRateMax > 0 ? Math.round(health.heartRateMax) : null;

  // hasWatchData says a sample arrived, not that it carried anything. A grant revoked mid-round
  // lands here with every field at zero, and a card reading "0 steps, 0 miles" is worse than no
  // card: it reads as a measurement of a round the player knows they walked.
  const hasAnything = steps > 0 || distanceMeters > 0 || activeCalories > 0 || heartRateAvg != null;
  if (!hasAnything) return null;
  

  const distanceMiles = Math.round((distanceMeters / METRES_PER_MILE) * 10) / 10;

  // Each clause earns its place by having data behind it, and the VERB is chosen per shape rather
  // than glued on — assembling "You " + a list produced "You 13,400 steps over 4h 10m" the moment
  // distance was missing, which is not a sentence a caddie says. [[feels-like-a-real-caddie]]
  const stepsText = steps.toLocaleString('en-US');
  const walked = distanceMiles >= 0.1;
  let headline: string;
  if (walked && steps > 0) headline = `You walked ${distanceMiles} miles and ${stepsText} steps`;
  else if (walked) headline = `You walked ${distanceMiles} miles`;
  else if (steps > 0) headline = `You took ${stepsText} steps`;
  else headline = 'You were out there';
  if (durationMin > 0) {
    // "You were out there 4h 10m" — the bare duration IS the clause there; "over" needs something
    // to sit after.
    headline += headline === 'You were out there' ? ` ${formatDuration(durationMin)}` : ` over ${formatDuration(durationMin)}`;
  }
  if (heartRateAvg != null) headline += `, averaging ${heartRateAvg} bpm`;
  headline += '.';
  if (activeCalories > 0) headline += ` That's about ${activeCalories.toLocaleString('en-US')} active calories.`;

  return {
    steps,
    distanceMeters,
    distanceMiles,
    heartRateAvg,
    heartRateMax,
    activeCalories,
    durationMin,
    headline,
  };
}
