/**
 * 2026-09-12 — ONE OWNER OF "WHICH MEASURED SWINGS ARE HIS".
 *
 * This assembly lived inside `app/(tabs)/dashboard.tsx`, which is why the caddie could not see a
 * single biomech number: reaching the swing library from anywhere else meant rebuilding thirty
 * lines of per-shot-vs-session fallback, self-filtering and tempo carry-over — and the moment two
 * copies exist they drift, which is the defect this repo keeps finding. Extracted so the dashboard
 * graph and the caddie's context read the same swings.
 *
 * The rules it carries, unchanged from the dashboard:
 *
 *   PER-SHOT FIRST. A session is one date but many swings; grading a week off the session-level
 *   summary alone would let one read speak for twenty balls. A shot the pose pass could not read
 *   contributes nothing rather than a zero.
 *
 *   TEMPO RIDES ALONG. It is a SESSION read (it needs marked phases), so it attaches to each of
 *   that session's swings rather than being dropped for lack of a per-shot equivalent — it is the
 *   metric players ask about most.
 *
 *   SELF ONLY. In Family/Coach mode a student's swings land in this same history, and drawing
 *   their hip turn as the owner's regression would be worse than showing nothing at all.
 */

import { resolvePlayerName } from '../../store/swingSessionStore';
import type { TrendSwing } from './swingMetricTrend';

/** The shape this reads off a swing-library session. Local so the module stays store-agnostic. */
export interface ReadableBiomech {
  hipTurnDeg?: number | null;
  shoulderTurnDeg?: number | null;
  shoulderTiltDeg?: number | null;
  weightShiftPct?: number | null;
  spineAngleDeltaDeg?: number | null;
  headDriftPxNorm?: number | null;
  hipSlideRatio?: number | null;
  sequencingScore?: number | null;
}

export interface SwingLibrarySession {
  date: number;
  player_id?: string | null;
  club?: string | null;
  tempo_result?: { ratio?: number | null; ratingLabel?: string | null } | null;
  biomechanics?: ReadableBiomech | null;
  shots?: { club?: string | null; biomechanics?: ReadableBiomech | null }[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const metricsFrom = (
  b: ReadableBiomech | null | undefined,
  tempoRatio: number | null,
): TrendSwing['metrics'] => ({
  hipTurnDeg: num(b?.hipTurnDeg),
  shoulderTurnDeg: num(b?.shoulderTurnDeg),
  shoulderTiltDeg: num(b?.shoulderTiltDeg),
  weightShiftPct: num(b?.weightShiftPct),
  spineAngleDeltaDeg: num(b?.spineAngleDeltaDeg),
  headDriftPxNorm: num(b?.headDriftPxNorm),
  hipSlideRatio: num(b?.hipSlideRatio),
  sequencingScore: num(b?.sequencingScore),
  tempoRatio,
});

/** Every readable swing of the OWNER's, newest last, ready for computeSwingMetricTrend. */
export function collectSelfTrendSwings(
  sessions: readonly SwingLibrarySession[] | null | undefined,
): TrendSwing[] {
  const swings: TrendSwing[] = [];
  for (const sess of sessions ?? []) {
    if (resolvePlayerName(sess.player_id, '__self__') !== '__self__') continue;
    const tempoRatio = num(sess.tempo_result?.ratio);

    const perShot = (sess.shots ?? []).filter((sh) => sh.biomechanics);
    if (perShot.length > 0) {
      for (const sh of perShot) {
        swings.push({
          date: sess.date,
          club: sh.club ?? sess.club ?? null,
          metrics: metricsFrom(sh.biomechanics, tempoRatio),
        });
      }
      continue;
    }

    if (!sess.biomechanics && tempoRatio == null) continue;
    swings.push({
      date: sess.date,
      club: sess.club ?? null,
      metrics: metricsFrom(sess.biomechanics, tempoRatio),
    });
  }
  return swings;
}

/**
 * 2026-09-14 (Tim — "triple check tempo analysis. I have a feeling it is still giving generic
 * reads.") — THE LATEST TEMPO READING, not a trend.
 *
 * `collectSelfTrendSwings` feeds a TREND, and a trend needs four weeks. Tempo is different in kind
 * from the biomech metrics beside it: it comes from three marked phases of ONE swing, so a single
 * session is already a real reading rather than a sample of one in a series. The caddie had no
 * access to it below the trend floor — verified by running the payload builder with two sessions at
 * a measured 2.1:1 and finding no tempo number in it at all.
 *
 * It lives HERE rather than in caddieRequestBody because the SELF filter lives here. Writing
 * `resolvePlayerName(id, '__self__')` a second time in the payload builder is how a student's tempo
 * would eventually be quoted back to Tim as his own — and my first attempt at exactly that compared
 * against the wrong sentinel and silently returned nothing.
 * [[two-owners-is-the-root-cause]]
 */
export interface LatestTempoRead {
  /** The most recent marked ratio. */
  ratio: number;
  /** Its rating label ("Rushed", "On Tempo"), when the read carried one. */
  ratingLabel: string | null;
  /** When it was marked. */
  dateMs: number | null;
  /** Mean of the last few reads — his own baseline, distinct from the tour reference. */
  recentAvg: number;
  /** How many reads that average is over. */
  recentCount: number;
}

/** How many past reads make a personal baseline. Few enough to be current, enough to not be one swing. */
const TEMPO_BASELINE_READS = 5;

export function latestSelfTempoRead(
  sessions: readonly SwingLibrarySession[] | null | undefined,
): LatestTempoRead | null {
  const mine = (sessions ?? [])
    .filter((sess) => resolvePlayerName(sess.player_id, '__self__') === '__self__')
    .filter((sess) => num(sess.tempo_result?.ratio) != null)
    .sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
  if (mine.length === 0) return null;

  const last = mine[mine.length - 1];
  const recent = mine.slice(-TEMPO_BASELINE_READS).map((x) => num(x.tempo_result?.ratio) as number);
  return {
    ratio: num(last.tempo_result?.ratio) as number,
    ratingLabel: last.tempo_result?.ratingLabel ?? null,
    dateMs: typeof last.date === 'number' ? last.date : null,
    recentAvg: recent.reduce((n, v) => n + v, 0) / recent.length,
    recentCount: recent.length,
  };
}
