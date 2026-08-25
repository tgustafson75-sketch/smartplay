/**
 * WHAT A HUMAN BODY CAN ACTUALLY DO — the band every biomech metric has to land inside.
 *
 * 2026-08-24 (Tim's range screenshot). The Swing Breakdown card read:
 *
 *     Weight shift  -116%   "your weight is hanging back through impact"
 *     Lead arm       42°    "lead arm bent to 42° at the top — losing width"
 *
 * Neither is a measurement. Weight shift is pelvis displacement as a percentage of STANCE WIDTH, and
 * a person standing on two feet cannot move their pelvis more than a stance width relative to their
 * ankles — -116% is a mis-tracked hip or ankle. leadArmTopDeg is an ELBOW ANGLE where 180° is
 * straight; 42° is an arm folded nearly shut, which no one does at the top of a golf swing.
 *
 * Both were computed, both were out of any physical range, and both were narrated to the player in
 * red as faults with coaching attached. That is worse than showing nothing: it sends someone to the
 * range to fix a problem the camera invented.
 *
 * The app already applies exactly this discipline elsewhere and it works — utils/coordGuard rejects
 * impossible coordinates, clubStatsStore rejects a club distance outside its plausibility band. The
 * pose metrics never got the same treatment. This is that gate, in one place, so a new metric cannot
 * be added without declaring what a real one looks like.
 *
 * REJECT, DO NOT CLAMP. Clamping -116% to -100% would turn a failed read into a confident extreme
 * value and narrate THAT instead — the same mistake wearing a plausible number. An out-of-band read
 * is a failed read and becomes null, which every consumer already renders as "not measured".
 *
 * Bands are deliberately GENEROUS — wide enough that a genuinely extreme amateur swing still reports,
 * narrow enough to catch a keypoint that jumped to another body part. They reject the impossible,
 * not the unusual.
 */

/** [min, max] inclusive. A value outside its band is a failed read, not a measurement. */
export const BIOMECH_BANDS: Record<string, readonly [number, number]> = {
  /** Degrees of pelvis rotation address→top. Beyond ~90 is not a hip turn, it is a tracking error. */
  hipTurnDeg: [0, 90],
  /** Shoulder coil. Tour tops out near 100–110; 130 allows the freakishly supple. */
  shoulderTurnDeg: [0, 130],
  /** Lead-shoulder dip at the top. */
  shoulderTiltDeg: [0, 70],
  /** Pelvis shift as a % of stance width. Standing on two feet bounds this hard. */
  weightShiftPct: [-100, 100],
  /** Same measure at the finish. */
  finishWeightPct: [-100, 100],
  /** Spine-angle change address→impact. Beyond 45° the player has fallen over. */
  spineAngleDeltaDeg: [-45, 45],
  /**
   * Head drift, SIGNED, as a fraction of SHOULDER WIDTH — not of frame height, whatever the field's
   * own doc comment used to say. (My first band here was [0, 0.5], taken from that comment; it would
   * have rejected every head that drifted the other way. Caught by an integration test before it
   * shipped, which is the second time today a stale comment nearly caused the bug it described.)
   * Consumers flag ~0.09 as present, so real values are small; a full shoulder width of head
   * movement is already beyond anything real.
   */
  headDriftPxNorm: [-1, 1],
  /** Hip slide vs rotate. Negative is meaningless; huge is a tracking error. */
  hipSlideRatio: [0, 5],
  /** 0..100 by definition. */
  sequencingScore: [0, 100],
  /**
   * ELBOW ANGLES, where 180° is a straight arm. A golfer's lead arm at the top runs roughly 130–180;
   * a pronounced collapse reaches ~120. Below 90 the arm is folded like a bicep curl — that is the
   * elbow keypoint landing on the wrong joint, which is exactly what produced the 42° on the card.
   */
  leadArmTopDeg: [90, 180],
  leadArmImpactDeg: [90, 180],
  /** Hip lateral translation as a fraction of shoulder width. */
  swayNorm: [0, 1.5],
};

/** True when `value` is a real measurement for `metric`. Unknown metrics pass — the gate never
 *  silently eats a field it has no opinion about. */
export function isPlausible(metric: string, value: number | null | undefined): boolean {
  if (value == null) return true;                 // already "not measured"
  if (!Number.isFinite(value)) return false;
  const band = BIOMECH_BANDS[metric];
  if (!band) return true;
  return value >= band[0] && value <= band[1];
}

/**
 * Null out every metric that falls outside what a body can do, and report which.
 *
 * Runs BEFORE the verdicts are composed, deliberately: a verdict built from a rejected number is the
 * actual harm — the player never sees the raw value, they see "your weight is hanging back" in red.
 */
export function rejectImplausible<T extends Record<string, unknown>>(
  metrics: T,
): { metrics: T; rejected: string[] } {
  const out = { ...metrics };
  const rejected: string[] = [];
  for (const key of Object.keys(BIOMECH_BANDS)) {
    const v = out[key as keyof T];
    if (typeof v === 'number' && !isPlausible(key, v)) {
      (out as Record<string, unknown>)[key] = null;
      rejected.push(`${key}=${Math.round(v * 100) / 100}`);
    }
  }
  return { metrics: out, rejected };
}
