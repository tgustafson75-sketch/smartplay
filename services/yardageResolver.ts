/**
 * 2026-05-25 — Fix L: single yardage resolver — the spine of the 4-tier
 * GPS fallback ladder.
 *
 * Tonight's Palms round exposed the bug: the UI, Kevin's brain prompt,
 * and voice readback each derived yardage from different sources (GPS
 * fix, courseHoles.distance, user-stated number) that drifted apart.
 * User states "I'm 142" → has nowhere to land. GPS goes soft → UI shows
 * a wrong number with confident styling. There was no honest "I'm
 * giving you N from source X because Y" answer anywhere.
 *
 * This resolver is the single source of truth. Every consumer reads
 * from here and gets back { value, source, confidence, reason } so the
 * UI can label honestly, Kevin's prompt can hedge correctly, and voice
 * readback always knows where the number came from.
 *
 * The tier ladder (highest → lowest priority):
 *   1. user_stated  — Tier 3 voice anchor (roundStore.userStatedYardage)
 *                     when same hole and <5 min old. The player explicitly
 *                     fed the system a number; respect it.
 *   2. gps_live     — Tier 1, live GPS + green coords, when accuracy is
 *                     ≤15m AND fix age <10s. The default in clean conditions.
 *   3. static_card  — Tier 2, bundled courseHoles.distance (tee→green
 *                     scorecard yardage). Used when GPS soft OR mid-warm-up.
 *                     Only valid from the tee — gets stale once player walks.
 *   4. none         — No usable source. UI renders "—", Kevin hedges.
 *
 * NOTE: this resolver returns yardage TO THE MIDDLE OF THE GREEN. Front
 * and back yardages remain on the existing getGreenYardages cascade
 * (those are GPS-only by construction).
 */

import { useRoundStore } from '../store/roundStore';
import { getGreenYardagesSync, getLastFix, classifyAccuracy } from './smartFinderService';

export type YardageSource = 'user_stated' | 'gps_live' | 'static_card' | 'none';
export type YardageConfidence = 'high' | 'med' | 'low';

export interface ResolvedYardage {
  value: number | null;
  source: YardageSource;
  confidence: YardageConfidence;
  /** Human-readable hint Kevin can echo. Always populated. */
  reason: string;
  /** When the underlying input was captured (ms epoch). */
  asOf: number;
  /** True when the resolver fell back from GPS to static. UI can hint. */
  is_fallback: boolean;
}

const STATED_TTL_MS = 5 * 60 * 1000; // 5 min — stale after that

/**
 * Resolve the current yardage to center using the tier ladder. Pure
 * synchronous read — safe to call in render paths. Reads roundStore +
 * smartFinderService cache; no network.
 */
export function resolveYardage(holeNumberArg?: number): ResolvedYardage {
  const round = useRoundStore.getState();
  const hole = holeNumberArg ?? round.currentHole;
  const now = Date.now();

  // Tier 3 — user-stated. Highest precedence when fresh + same hole.
  const stated = round.userStatedYardage;
  if (
    stated &&
    stated.holeAtCapture === hole &&
    now - stated.asOf < STATED_TTL_MS
  ) {
    const sourceLabel =
      stated.source === 'golfshot' ? 'Golfshot' :
      stated.source === 'rangefinder' ? 'rangefinder' :
      stated.source === 'other' ? 'app you stated' :
      'your stated number';
    return {
      value: stated.value,
      source: 'user_stated',
      confidence: 'high', // user-asserted = highest trust
      reason: `Using ${sourceLabel} (${stated.value}y).`,
      asOf: stated.asOf,
      is_fallback: false,
    };
  }

  // Tier 1 — live GPS via the existing yardage cascade.
  const fix = getLastFix();
  const fixAge = fix ? now - fix.timestamp : Infinity;
  const accuracy = fix?.accuracy_m ?? null;
  const quality = classifyAccuracy(accuracy);
  // 2026-06-07 GPS-audit #4: a SmartVision tap writes setMarkedFix
  // with accuracy_m === null. classifyAccuracy(null) returns 'none',
  // which would otherwise route us to static_card with "GPS not
  // ready" copy — directly contradicting the user who JUST told us
  // where they are. Treat a recent null-accuracy fix as a valid
  // user-asserted position with 'med' confidence.
  const isUserMarkedFix = fix != null && accuracy == null && fixAge < 30_000;
  const gpsHealthy =
    fix != null &&
    fixAge < 10_000 &&
    quality.level !== 'weak' &&
    quality.level !== 'none';

  // 2026-07-01 (audit) — accept BOTH 'ok' AND 'estimated'. 'estimated' is the
  // tee-relative GPS estimate (green data not available yet — the Wachusett case).
  // The old code gated on reason==='ok' only, so it DISCARDED the estimate and fell
  // through to the frozen static card — the brain + club-rec never saw the live
  // number counting down as the player walked. We take the estimate (honest lower
  // confidence + flagged as fallback) instead of freezing.
  if (isUserMarkedFix) {
    const y = getGreenYardagesSync(hole);
    if (y && y.middle != null && (y.reason === 'ok' || y.reason === 'estimated')) {
      const estimated = y.reason === 'estimated';
      return {
        value: y.middle,
        source: 'gps_live',
        confidence: estimated ? 'low' : 'med',
        reason: estimated
          ? 'GPS estimate from the tee — mark the green for exact yardage.'
          : 'Using your marked position.',
        asOf: fix.timestamp,
        is_fallback: estimated,
      };
    }
  }

  if (gpsHealthy) {
    const y = getGreenYardagesSync(hole);
    if (y && y.middle != null && (y.reason === 'ok' || y.reason === 'estimated')) {
      const estimated = y.reason === 'estimated';
      return {
        value: y.middle,
        source: 'gps_live',
        confidence: estimated ? 'med' : (quality.level === 'strong' ? 'high' : 'med'),
        reason: estimated
          ? 'GPS estimate from the tee — no green data yet.'
          : (quality.level === 'strong' ? 'GPS clean.' : 'GPS okay.'),
        asOf: fix.timestamp,
        is_fallback: estimated,
      };
    }
  }

  // Tier 2 — static card fallback. Bundled tee→green from courseHoles.
  // Honest about being stale once the player walks away from the tee.
  const hData = round.courseHoles.find(h => h.hole === hole);
  if (hData && hData.distance > 0) {
    const gpsState =
      fix == null ? 'GPS not ready' :
      fixAge >= 10_000 ? 'GPS stale' :
      'GPS soft';
    return {
      value: hData.distance,
      source: 'static_card',
      confidence: 'low',
      reason: `${gpsState} — using static card (${hData.distance}y from the tee).`,
      asOf: now,
      is_fallback: true,
    };
  }

  return {
    value: null,
    source: 'none',
    confidence: 'low',
    reason: 'No yardage available — no green geometry and no static card.',
    asOf: now,
    is_fallback: true,
  };
}

/**
 * Convenience for Kevin's brain context — returns a compact blob the
 * prompt can quote ("Reading 168 from the static card — GPS is soft").
 */
export function buildYardageInsight(): {
  yardage: number | null;
  source: YardageSource;
  confidence: YardageConfidence;
  reason: string;
} {
  const r = resolveYardage();
  return {
    yardage: r.value,
    source: r.source,
    confidence: r.confidence,
    reason: r.reason,
  };
}
