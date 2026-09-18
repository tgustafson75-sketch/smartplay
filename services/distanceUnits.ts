/**
 * EVERY DISTANCE IN THIS APP IS STORED IN YARDS. This file is the only place that turns one into
 * something a human reads, and the only place that knows a metre exists.
 *
 * 2026-09-18 (Tim — "will the course engine build international courses?").
 *
 * The engine already does. There is no country filter anywhere in the locate/search path,
 * `api/course-ai-search` returns city/state/COUNTRY, `courseDisplayName` deliberately appends the
 * country when it is not the USA, and hole geometry is derived from satellite imagery rather than a
 * US course database. A player in Kent or Kanagawa gets the right course and the right green.
 *
 * And then the app tells them it is 145 YARDS to the middle, in a country that has not sold a yard
 * since 1965.
 *
 * `settings.distance_unit: 'yards' | 'meters'` has existed for months, with a setter AND a voice
 * intent ("switch to metres"). It was read by exactly four things: the Settings toggle that writes
 * it, an owner debug screen, one component, and the voice handler. Fifty-two user-facing strings
 * hardcode "yards"/"yds", and the caddie's brain was never told the unit at all — so the one thing
 * the player HEARS was guaranteed to be imperial whatever the toggle said. A setting that changes
 * one screen out of forty is worse than no setting: it tells the player the app can do this, and
 * then does not. [[no-deferred-wiring-placeholders]] [[a-toggle-that-does-nothing-for-the-default-user]]
 *
 * WHICH UNIT LIVES WHERE, so this is never ambiguous again — same contract as services/puttUnits:
 *   - EVERY stored field, every API payload, every calculation is YARDS. `distance_yards` means
 *     yards. Nothing in the data layer knows about this file.
 *   - Conversion happens at the moment of DISPLAY (and at the moment of ENTRY, on the way in).
 *   - A PUTT IS STILL ALWAYS IN FEET, in both systems. That is Tim's explicit 2026-09-13 rule and
 *     it is not mine to reverse: golf talks about putts in feet worldwide. services/puttUnits owns
 *     that and is deliberately untouched here.
 *
 * PURE — no React, no stores, no RN — so the logic suite can reach all of it. The live-settings
 * reader is at the bottom and is the only impure thing in the file.
 */

export type DistanceUnit = 'yards' | 'meters';

/** Exact, by international agreement (1959). Not 0.91. */
export const METERS_PER_YARD = 0.9144;

/** What the player sees after the number. Short, because it sits beside a big numeral. */
export function unitLabel(unit: DistanceUnit): 'yds' | 'm' {
  return unit === 'meters' ? 'm' : 'yds';
}

/** The longer spoken/written form, for prose and for the caddie's own words. */
export function unitWord(unit: DistanceUnit, plural = true): string {
  if (unit === 'meters') return plural ? 'metres' : 'metre';
  return plural ? 'yards' : 'yard';
}

/**
 * Yards → the number to SHOW, rounded to whole units.
 *
 * Returns null for a missing or non-finite input rather than 0, so a caller draws its dash instead
 * of claiming the pin is at your feet. Same contract as shotDistanceDisplay.
 */
export function toDisplayDistance(yards: number | null | undefined, unit: DistanceUnit): number | null {
  if (yards == null || !Number.isFinite(yards)) return null;
  return Math.round(unit === 'meters' ? yards * METERS_PER_YARD : yards);
}

/** What the player TYPED, in their unit → the yards everything else stores. */
export function fromDisplayDistance(entered: number | null | undefined, unit: DistanceUnit): number | null {
  if (entered == null || !Number.isFinite(entered)) return null;
  return unit === 'meters' ? entered / METERS_PER_YARD : entered;
}

/** "145 yds" / "133 m". Null in, dash out — never "0 yds" or "null yds". */
export function formatDistance(
  yards: number | null | undefined,
  unit: DistanceUnit,
  opts?: { dash?: string; space?: boolean },
): string {
  const v = toDisplayDistance(yards, unit);
  if (v == null) return opts?.dash ?? '—';
  return `${v}${opts?.space === false ? '' : ' '}${unitLabel(unit)}`;
}

/**
 * The SINGLE-LETTER suffix the compact readouts use — "145y" / "133m".
 *
 * These sit under a big numeral on the hole preview, the data strip and the rangefinder, where the
 * layout is frozen and a three-character suffix would reflow it. Deliberately a separate function
 * from `unitLabel` rather than a truncation of it: "yds"→"y" works and "m"→"m" is a no-op, and a
 * caller slicing the string itself is how the two spellings drift apart.
 */
export function compactUnitLabel(unit: DistanceUnit): 'y' | 'm' {
  return unit === 'meters' ? 'm' : 'y';
}

/** "145y" / "133m". Null in, dash out. */
export function formatDistanceCompact(
  yards: number | null | undefined,
  unit: DistanceUnit,
  dash = '\u2014',
): string {
  const v = toDisplayDistance(yards, unit);
  return v == null ? dash : `${v}${compactUnitLabel(unit)}`;
}

/**
 * A RANGE, the way the caddie gives one — "138-145 yds", not "138 yds-145 yds".
 *
 * Converting each end separately and rounding both is deliberate: rounding the span instead would
 * let a 7-yard window come out 6 wide in metres, and the width of an honesty band is a claim.
 * [[guards-by-element-not-blanket-suppression]]
 */
export function formatDistanceRange(
  lowYards: number | null | undefined,
  highYards: number | null | undefined,
  unit: DistanceUnit,
): string | null {
  const lo = toDisplayDistance(lowYards, unit);
  const hi = toDisplayDistance(highYards, unit);
  if (lo == null || hi == null) return null;
  return `${lo}-${hi} ${unitLabel(unit)}`;
}

/**
 * HOW FAR AWAY A COURSE IS — the other unit family, and the one that is easy to forget.
 *
 * The Play tab lists nearby courses as "3.2 mi". A player who has set metres has also never driven
 * a mile, and a course list is the FIRST screen an international player meets — before any yardage,
 * before the caddie says anything. Converting the on-course numbers and leaving this one imperial
 * would be the half-fix that makes the setting look broken rather than missing.
 *
 * Takes YARDS like everything else here, because that is what haversineYards gives the callers.
 * One decimal under the threshold, whole numbers above it — the same shape the mile version used,
 * so the list does not start wrapping.
 */
const YARDS_PER_MILE = 1760;
const METERS_PER_KM = 1000;

export function formatTravelDistance(yards: number | null | undefined, unit: DistanceUnit): string | null {
  if (yards == null || !Number.isFinite(yards)) return null;
  if (unit === 'meters') {
    const km = (yards * METERS_PER_YARD) / METERS_PER_KM;
    return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  }
  const miles = yards / YARDS_PER_MILE;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

/**
 * The live setting, for the services and one-off call sites that cannot hold a hook.
 *
 * Defaults to yards on any failure, which is also the store's default — an unreadable setting must
 * never leave a screen with no unit at all.
 */
export function liveDistanceUnit(): DistanceUnit {
  try {
    const { useSettingsStore } = require('../store/settingsStore') as typeof import('../store/settingsStore');
    return useSettingsStore.getState().distance_unit === 'meters' ? 'meters' : 'yards';
  } catch {
    return 'yards';
  }
}
