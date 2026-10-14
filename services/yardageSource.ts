/**
 * 2026-09-12 (Tim) — ONE OWNER FOR "IS THIS YARDAGE LIVE, OR IS IT THE CARD?"
 *
 * "We should have logic already that has the active indicator, because in the rounds and yardage
 *  with GPS we have static if it is not working or active. All of that should be in the same general
 *  category, right — that it all same catches, because the connectivity is the same."
 *
 * Exactly right, and he caught this one shot before it shipped. The rule DID already exist — three
 * states, correct, argued over twice — but it lived INLINE in a JSX prop in app/(tabs)/caddie.tsx:
 *
 *     yardageSource={displayYardage == null ? null
 *       : liveYardage != null ? 'live'
 *       : geometryBuilding[activeCourseId] ? 'building'
 *       : 'static'}
 *
 * A rule that lives inside one component's props cannot be reused, so the L1 hole preview — which
 * needs the identical judgement about the identical GPS — was about to get its own copy. That is the
 * two-owners defect this project keeps paying for, and the copy would have drifted the first time
 * one of them was tuned. [[two-owners-is-the-root-cause]]
 *
 * WHY THREE STATES AND NOT TWO. 2026-08-12: a course still being mapped must say so, rather than
 * showing a bare STATIC that reads as "this is as good as it gets". The distinction is between a
 * permanent condition and a temporary one, and a player deserves to know which they are looking at.
 */

/** 2026-10-13 — + 'estimate' (the tee estimate: moves as you walk, not measured to a green) and 'last'
 *  (a degraded fix — where you were). Both used to read LIVE in green. */
export type YardageSource = 'live' | 'estimate' | 'last' | 'building' | 'static';

/**
 * Resolve where a displayed yardage actually came from.
 *
 * `null` means there is NO yardage on screen, so there is nothing to label — distinct from 'static',
 * which means a real number is showing and it came from the scorecard rather than from GPS.
 */
export function resolveYardageSource(args: {
  /** The number actually being shown, or null when nothing is. */
  displayYardage: number | null;
  /** Non-null only when GPS resolved a real distance for this position. */
  liveYardage: number | null;
  /** Whether geometry for this course is mid-build right now. */
  isBuilding: boolean;
  /** The resolver's GPS tier, when it was not live: the tee estimate, or a degraded fix. */
  gpsNotLive?: 'estimate' | 'last' | null;
}): YardageSource | null {
  if (args.displayYardage == null) return null;
  if (args.liveYardage != null) return 'live';
  if (args.gpsNotLive) return args.gpsNotLive;
  return args.isBuilding ? 'building' : 'static';
}

/** Short label for a pill. Kept under ~9 characters — these sit on a data strip and on a hole photo. */
export function yardageSourceLabel(s: YardageSource | null): string | null {
  switch (s) {
    case 'live': return 'LIVE';
    case 'estimate': return 'EST.';
    case 'last': return 'LAST FIX';
    case 'building': return 'MAPPING…';
    case 'static': return 'STATIC';
    default: return null;
  }
}

/** True only when GPS is genuinely driving the number. Drives colour, so it must not lie. */
export function isLiveYardage(s: YardageSource | null): boolean {
  return s === 'live';
}
