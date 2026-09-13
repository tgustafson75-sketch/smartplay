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
  tempo_result?: { ratio?: number | null } | null;
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
