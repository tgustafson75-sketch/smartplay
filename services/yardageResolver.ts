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
 *   2. gps_live     — Tier 1, live GPS + green coords, whenever accuracy is
 *                     ≤15m and gpsManager still holds the fix. The default in
 *                     clean conditions. Staleness is gpsManager's call, not
 *                     ours — see the note on `gpsHealthy` below.
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
import { getGreenYardagesSync, getLastFix, classifyAccuracy, holeData } from './smartFinderService';

export type YardageSource = 'user_stated' | 'gps_live' | 'static_card' | 'none';
export type YardageConfidence = 'high' | 'med' | 'low';

export interface ResolvedYardage {
  value: number | null;
  /**
   * 2026-09-10 (Tim: "a yard is a universal truth for every tool — why do we have multiple
   * interpretations and feeds and loops") — THE TRIPLET LIVES HERE NOW.
   *
   * Thirteen surfaces were reading a yardage from three different functions: this resolver,
   * getGreenYardagesSync, and holeLengthYards. Only this one applies the tier ladder, so the caddie
   * could be clubbing off a number the watch and the cockpit had never heard of — and a stated
   * correction moved some of them and not others.
   *
   * getGreenYardagesSync is now the ENGINE, not an answer: it is called from inside this file and
   * nowhere else. front/back ride along so a surface that needs F/M/B has no reason to go around.
   */
  front: number | null;
  back: number | null;
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
  return traceResolved(hole, resolveYardageInner(hole, round));
}

function resolveYardageInner(
  hole: number,
  round: ReturnType<typeof useRoundStore.getState>,
): ResolvedYardage {
  const now = Date.now();

  // Tier 3 — user-stated. Highest precedence when fresh + same hole.
  const stated = round.userStatedYardage;
  if (
    stated &&
    /**
     * 2026-08-28 — the setter is now the one owner of "is this a plausible yardage", but this READER
     * cannot assume it. `userStatedYardage` is PERSISTED, so a value written before that guard
     * existed can be rehydrated into a fresh session and would be returned here at `confidence:
     * 'high'`, beating live GPS, with the caddie clubbing from it. A guard at the door does nothing
     * about what is already inside the room.
     *
     * Cheap, and it degrades correctly: an implausible stored value falls through to the live-GPS
     * tier below rather than being clamped into something we would then state as fact.
     */
    Number.isFinite(stated.value) && stated.value > 0 && stated.value <= 700 &&
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
      // The player gave us ONE number. Inventing a front and back around it would be fabrication.
      front: null,
      back: null,
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
  // 2026-07-30 (Tim — voice sim round: "the yardage updated for a second, then went back to the whole
  // hole yardage"). ROOT CAUSE: a simulated fix's timestamp is FROZEN at the shot moment (the real GPS
  // watcher is torn down during a sim round, so nothing re-emits it). ~10s later this age gate crossed
  // 10_000ms → the live tier was skipped → it fell back to the static scorecard distance = the full
  // hole. A simulated fix legitimately never ticks, so treating it as "stale" is the defect. Bypass the
  // age gate when the simulator owns the fix — mirrors gpsManager.getGpsHealth()'s own simulated
  // short-circuit — so the narrated countdown holds.
  /**
   * 2026-09-10 (Tim, Hemet, mid-round: "the right number goes in and out") — THE FLAP.
   *
   * This gate used to read `(isSimulatedActive() || fixAge < 10_000)`. gpsManager's walking mode
   * polls at EXACTLY 10_000ms (POLL_CONFIG.walking.intervalMs). So the gate and the cadence feeding
   * it were tied: a fix landed, stayed "healthy" for 9.9s, and at the very instant the next one was
   * due it aged out — dropping to the static card, which is the FROZEN tee→green scorecard number,
   * not a slightly older live reading. The next fix flipped it back. Every ten seconds, all round.
   * The caddie tab re-runs this memo on a 4s tick and on every fix, so both states got rendered.
   *
   * gpsManager already OWNS "is this fix usable" and sized it deliberately — its own comment reads
   * "30s covers walking-mode (10s) + 3 missed ticks of headroom" — then degrades at 60s while KEEPING
   * the position, and only hard-clears at 5 minutes. That two-stage design is Tim's own 2026-06-29
   * over-strict-gate fix. This resolver invented a SECOND, tighter staleness rule one layer up and
   * re-created the exact failure that fix removed. [[two-owners-is-the-root-cause]]
   *
   * So the age arithmetic is deleted rather than retuned. If getLastFix() hands us a fix at all, the
   * owner has already decided it is usable; when GPS genuinely dies the owner clears it and we fall
   * to the static card through the normal path. Deleting the gate also deletes the reason the
   * `isSimulatedActive()` special-case existed — it was only ever there to bypass this gate for
   * simulated fixes, whose timestamps never tick (2026-07-30).
   */
  const gpsHealthy =
    fix != null &&
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
        front: y.front ?? null,
        back: y.back ?? null,
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
        front: y.front ?? null,
        back: y.back ?? null,
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
  // 2026-07-10 (Tim) — plausibility ceiling. A single hole is ~30–700y; a course TOTAL is
  // 5,000–7,500y. Every GPS path already clamps (smartfinder >600, refreshGps 10–600); this
  // static-card tier only checked `> 0`, so a mis-populated per-hole `distance` carrying a
  // course-total-sized number would render straight into the per-hole "top" cards. This is the
  // mechanism behind the recurring "header showed the whole-course yardage" bug — gate it here
  // so a course-total-magnitude value is rejected (falls through to `none`) instead of shown.
  const hData = holeData(hole);
  if (hData && hData.distance > 30 && hData.distance <= 700) {
    const gpsState =
      fix == null ? 'GPS not ready' :
      fixAge >= 10_000 ? 'GPS stale' :
      'GPS soft';
    return {
      value: hData.distance,
      // Card front/back are placeholders equal to `distance` on every API course (courseToHoles
      // writes them that way), so they are only passed through when they say something different.
      front: hData.front > 0 && hData.front !== hData.distance ? hData.front : null,
      back: hData.back > 0 && hData.back !== hData.distance ? hData.back : null,
      source: 'static_card',
      confidence: 'low',
      reason: `${gpsState} — using static card (${hData.distance}y from the tee).`,
      asOf: now,
      is_fallback: true,
    };
  }

  return {
    value: null,
    front: null,
    back: null,
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
/**
 * 2026-09-10 — every resolved yardage, with the tier that produced it, during a field-test round.
 *
 * `resolveYardage` is called from thirteen surfaces on a 3-4s cadence, so this is deliberately the
 * ONE place it is recorded rather than at each caller — a caller that forgot would leave a hole in
 * the report shaped exactly like "this surface never asked". Off, it is one boolean read.
 */
function traceResolved(hole: number, r: ResolvedYardage): ResolvedYardage {
  try {
    const rt = require('./roundTrace') as typeof import('./roundTrace');
    rt.traceDeep('gps', 'yardage_tier', {
      hole,
      value: r.value,
      source: r.source,
      confidence: r.confidence,
      fallback: r.is_fallback,
    });
  } catch { /* never affects the number */ }
  return r;
}

export function buildYardageInsight(): {
  yardage: number | null;
  source: YardageSource;
  confidence: YardageConfidence;
  reason: string;
  /**
   * 2026-09-10 (Tim, Hemet) — `source` ALONE CANNOT TELL THE CADDIE WHETHER THIS WAS MEASURED.
   *
   * `gps_live` covers two completely different claims: a real distance from the player to a KNOWN
   * green, and `estimatedFromTee` — the hole's card length minus the straight-line distance walked
   * from the tee, on a hole with no green coordinate at all. api/kevin rendered `gps_live` as
   * "Measured live off GPS — you can state it flatly", and its only hedge fires on confidence
   * 'low' while an estimate carries 'med'. So for eighteen holes at Hemet the caddie was
   * explicitly instructed to state an estimate flatly.
   *
   * The `reason` string has always said so in plain words ("GPS estimate from the tee — no green
   * data yet") and the renderer never read it. Sending the FLAG as well means the distinction is
   * machine-readable rather than something the model has to notice in prose.
   * [[arithmetic-belongs-in-code-not-the-model]] [[illustration-data-points]]
   */
  is_fallback: boolean;
} {
  const r = resolveYardage();
  return {
    yardage: r.value,
    source: r.source,
    confidence: r.confidence,
    reason: r.reason,
    is_fallback: r.is_fallback,
  };
}

/**
 * 2026-09-10 — the ONE adapter from the resolved yardage to the F/M/B card shape.
 *
 * Cockpit and the caddie tab had each grown their own version of this mapping, which is how the
 * number and the "SCORECARD ~Xy" label under it came to disagree about which tier produced them.
 * `reason` is derived from the resolver's own source, so a surface cannot label a tier it is not on.
 */
export type FmbReason = 'ok' | 'no_geometry' | 'no_fix' | 'no_hole' | 'estimated';

export function resolvedToFmb(r: ResolvedYardage | null): {
  front: number | null; middle: number | null; back: number | null; reason: FmbReason;
} | null {
  if (!r) return null;
  if (r.front == null && r.value == null && r.back == null) return null;
  const reason: FmbReason =
    r.source === 'static_card' ? 'no_geometry'
    : r.source === 'none' ? 'no_hole'
    : r.is_fallback ? 'estimated'
    : 'ok';
  return { front: r.front, middle: r.value, back: r.back, reason };
}
