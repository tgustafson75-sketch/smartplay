/**
 * SMARTMOTION PRACTICE CREDIT — every swing of a set counts, read or not, however the player leaves.
 *
 * 2026-10-27 (capture-half audit C5). Three ways a real swing went uncounted:
 *   1. The stamp into the active practice session was keyed by CLIP, so a 5-swing set stamped once.
 *   2. It waited for the cloud read (`analysis != null`), so a swing recorded with no signal was never
 *      stamped at all — the offline read lands later, on another screen, and nothing stamps it then.
 *   3. Points were credited only on Save / New Set; Back left the set in the library with no credit.
 *
 * The rule, pure: each swing of the set is stamped once (keyed by session + swing), a swing the read
 * demoted as a practice swing is never stamped or credited, the swing on screen carries what was
 * measured on it, and the rest carry only what is known (the club) — never an invented tempo or line.
 */
import type { RangeSwingSample } from './openRangeStats';
import { isPracticeSwing, type PracticeMark } from '../swing/practiceSwings';

type ShotLike = { practice?: PracticeMark | null } | null | undefined;

export const swingStampKey = (sessionId: string, index: number): string => `${sessionId}#${index}`;

export interface StampInput {
  sessionId: string;
  /** Swings in the set (segments). A single-swing capture is 1. */
  swingCount: number;
  /** The saved session's shots, in set order (practice demotion lives here once the read lands). */
  shots: readonly ShotLike[];
  stamped: ReadonlySet<string>;
  club: string | null;
  /** Stamp only this swing (the one on screen); omitted = every swing still unstamped. */
  only?: number;
  /** What was measured on the swing on screen. */
  measured?: { index: number; sample: RangeSwingSample } | null;
  /**
   * 2026-10-27 (seam review of SB3b × SB3e) — false while the set's READ is still running. The review shows
   * swing 1 as soon as ITS read lands, but the practice classifier runs only after every swing is read, so a
   * swing-1 stamp then was credited before the read could demote it. The swing on screen waits for the read to
   * settle (offline it settles at once, failed — still stamped). Absent = settled.
   */
  readSettled?: boolean;
}

export function samplesToStamp(input: StampInput): { key: string; index: number; sample: RangeSwingSample }[] {
  if (input.only != null && input.readSettled === false) return [];
  const n = Math.max(1, input.swingCount, input.shots.length);
  const indexes = input.only != null ? [input.only] : Array.from({ length: n }, (_, i) => i);
  const out: { key: string; index: number; sample: RangeSwingSample }[] = [];
  for (const i of indexes) {
    if (i < 0 || i >= n) continue;
    const key = swingStampKey(input.sessionId, i);
    if (input.stamped.has(key)) continue;
    if (isPracticeSwing(input.shots[i])) continue;
    const sample: RangeSwingSample = input.measured && input.measured.index === i
      ? input.measured.sample
      : { club: input.club, tier: 'none', tempoRatio: null, divergenceDeg: null };
    out.push({ key, index: i, sample });
  }
  return out;
}

/** Swings the set earns credit for: every swing but the ones the read demoted, at least one. */
export function creditedSwingCount(input: { swingCount: number; drillShotCount?: number | null; shots: readonly ShotLike[] }): number {
  const demoted = input.shots.filter(isPracticeSwing).length;
  return Math.max(1, (input.swingCount || input.drillShotCount || 1) - demoted);
}

/** Leaving the screen credits a set that was saved and not credited yet (Save / New Set already did it otherwise). */
export function shouldCreditOnLeave(input: { sessionId: string | null; alreadyCredited: boolean }): boolean {
  return !!input.sessionId && !input.alreadyCredited;
}
