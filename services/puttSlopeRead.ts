/**
 * 2026-09-13 (Tim) — "with elevation dialed in, sometimes, the putting read has said uphill when its
 * down. A sure like me has the camera close to level but an expectation at level is not real."
 *
 * His diagnosis is right, and it is the second of two defects. ONE OWNER for turning a phone's tilt into
 * a putt slope, so both are fixed in one place and the limits are written down where the maths is.
 *
 * ── DEFECT 1: THE SIGN WAS THROWN AWAY ──────────────────────────────────────────────────────────────
 * The old line was `const deviation = Math.abs(p) - 90`. Taking |pitch| collapses the two hemispheres
 * onto one answer, and the sign is the ONLY thing that distinguishes uphill from downhill. It happens to
 * work while `rotation.beta` stays positive (a normal portrait hold reads ≈+90), and inverts silently the
 * moment it does not — an upside-down hold, or a platform that reports beta with the other sign. "Uphill
 * when it's down", exactly as reported.
 *
 * ── DEFECT 2: THE INSTRUMENT CANNOT RESOLVE WHAT IT CLAIMED ─────────────────────────────────────────
 * The verdict thresholds were ±2%. Work out what 2% IS in the unit actually measured — an angle:
 *
 *     2% slope  → atan(0.02) = 1.15° of camera angle, at ANY putt length
 *     5% slope  → 2.86°
 *    10% slope  → 5.71°
 *
 * A handheld phone varies by ±2-3° from tremor and hold alone. So the old ±2% verdict was decided
 * entirely inside the noise: a 1.2° difference in how he held it flipped "firm pace — it's uphill" to
 * "soft pace — downhill, let it die". That is not a miscalibration, it is a claim the instrument cannot
 * support, which is what "an expectation at level is not real" means.
 *
 * So there is a DEADBAND now, expressed in the measured unit. Inside it the honest answer is that it
 * cannot be called — not a direction chosen by rounding.
 *
 * ── WHY THERE IS NO GPS CROSS-CHECK, THOUGH IT WAS THE FIRST THING WE REACHED FOR ────────────────────
 * Tim: "Gps should be able to provide a hint right?" No — and it is worth recording the numbers so nobody
 * builds it later believing it helps. Against a 20 ft putt's 2% slope, which is 0.12 m of rise:
 *
 *     GPS horizontal              3-5 m       wrong axis; says nothing about rise
 *     GPS altitude                ±5-15 m     vertical error is 1.5-3x horizontal → 40-125x the signal
 *     terrain API (/api/elevation) 11 m grid  both ends of a 6 m putt land in ONE cell → delta is 0
 *
 * Even a whole-green tilt (30 yd, 3 ft of fall = 0.9 m over 27 m) is at or below that data's ~1 m
 * vertical resolution. A reconciliation against a source that cannot see the thing is false comfort, so
 * this module does not pretend to have one.
 */

/** Degrees of camera angle below which uphill and downhill cannot be told apart by a handheld phone. */
export const SLOPE_DEADBAND_DEG = 3;
/** Beyond this the hold is not a putting-read hold at all and tan() is noise. */
export const SLOPE_MAX_DEVIATION_DEG = 30;
/** Real greens do not exceed roughly this grade; anything past it is a bad read, not a steep green. */
export const SLOPE_MAX_PCT = 25;

export type SlopeCall = 'uphill' | 'downhill' | 'too_level_to_call' | 'unreadable_hold' | 'no_reading';

export interface PuttSlopeRead {
  /** Signed grade, + uphill. Null whenever no honest number exists. */
  pct: number | null;
  call: SlopeCall;
  /** Degrees off vertical, signed. Exposed so a surface can show the hold rather than guess at it. */
  deviationDeg: number | null;
}

/**
 * @param pitchDeg DeviceMotion `rotation.beta` in degrees. A portrait hold aimed level reads near ±90;
 *                 tilting the camera UP pushes |pitch| past 90, tilting DOWN pulls it under.
 */
export function readPuttSlope(pitchDeg: number | null): PuttSlopeRead {
  if (pitchDeg == null || !Number.isFinite(pitchDeg)) {
    return { pct: null, call: 'no_reading', deviationDeg: null };
  }

  /**
   * SIGNED, and no Math.abs anywhere — that is the whole fix. `rotation.beta` is 0 flat screen-up, +90
   * upright portrait facing the player, ±180 flat screen-down, −90 upright but inverted. So for the only
   * hold this read is meant for — upright, camera at the hole — the deviation from vertical is simply
   * beta − 90, and its sign IS the answer: camera tilted up (uphill) pushes beta past 90, tilted down
   * pulls it under.
   *
   * Everything else is REFUSED rather than interpreted. I first wrote a hemisphere-aware version that
   * mapped an upside-down hold onto a slope, and I could not verify that convention without a device —
   * inventing one would be the same class of error as the Math.abs it replaced, just harder to spot. A
   * phone flat on a table (beta 0 → deviation −90) or inverted (beta −90 → −180) falls outside the gate
   * and reads as an unreadable hold, which is true.
   */
  const deviationDeg = pitchDeg - 90;

  if (Math.abs(deviationDeg) > SLOPE_MAX_DEVIATION_DEG) {
    return { pct: null, call: 'unreadable_hold', deviationDeg };
  }

  if (Math.abs(deviationDeg) < SLOPE_DEADBAND_DEG) {
    // The honest answer, and the whole point of this rewrite: at this angle the phone cannot tell.
    return { pct: null, call: 'too_level_to_call', deviationDeg };
  }

  const raw = Math.tan((deviationDeg * Math.PI) / 180) * 100;
  if (!Number.isFinite(raw)) return { pct: null, call: 'no_reading', deviationDeg };
  const pct = Math.round(Math.max(-SLOPE_MAX_PCT, Math.min(SLOPE_MAX_PCT, raw)));
  return { pct, call: pct > 0 ? 'uphill' : 'downhill', deviationDeg };
}

/** What the read means for pace, or null when there is no honest call to make. */
export function paceHintFor(read: PuttSlopeRead): string | null {
  switch (read.call) {
    case 'uphill': return 'firm pace — it’s uphill';
    case 'downhill': return 'soft pace — downhill, let it die';
    default: return null;
  }
}

/** Why there is no number, in the player's language. Null when there IS one. */
export function whyNoSlope(read: PuttSlopeRead): string | null {
  switch (read.call) {
    case 'too_level_to_call':
      return 'Too close to level to call — a phone can’t tell 2% uphill from 2% down at this distance, so I won’t guess.';
    case 'unreadable_hold':
      return 'Hold it upright, facing the hole, and I’ll read the incline.';
    case 'no_reading':
      return 'No tilt reading yet.';
    default:
      return null;
  }
}

/**
 * 2026-09-13 (Tim) — "cant we add a level indicator?… Like a bubble pill like a carpenters level?"
 *
 * Yes, and it is the HONEST half of this screen. Worth being precise about why, because it is the opposite
 * of the slope read above:
 *
 *   · the slope read tries to infer THE GREEN's incline from where the camera is aimed, and cannot — 2%
 *     is 1.15° and a hand wanders 2-3°.
 *   · a level indicator reports THE PHONE's own attitude, which is a direct gravity measurement and is
 *     accurate to a fraction of a degree. Nothing is being inferred.
 *
 * So a bubble is not a weaker version of the slope read; it is the instrument that actually works. Held
 * against a putter shaft, or sighted along the ball-hole line, it gives a real datum a player can trust —
 * and it gives one precisely where the slope call declines, which is the right relationship between them.
 *
 * TWO AXES, because a green has two and the old indicator only had one:
 *   pitch → up/down the line   (uphill / downhill)
 *   roll  → across the line    (cross-slope, the thing that makes a putt break)
 *
 * `liveLevel` used to be derived from the slope PERCENTAGE, which broke the moment the deadband above
 * started returning null near level — the indicator could never say LEVEL exactly when the phone WAS
 * level. Deriving it from the angles instead fixes that and is the more direct reading anyway.
 */

/** Degrees either axis may be off before the bubble stops reading as centred. A spirit level is tight. */
export const LEVEL_TOLERANCE_DEG = 1;

export interface LevelRead {
  /** Signed degrees off vertical along the aim. + = camera tilted up. Null when there is no reading. */
  pitchOffDeg: number | null;
  /** Signed degrees of side tilt. + = rolled right. */
  rollOffDeg: number | null;
  /** True only when BOTH axes are inside tolerance — a carpenter's level does not round up. */
  isLevel: boolean;
  /** True when the hold is nowhere near a readable position, so the bubble should not pretend. */
  unreadable: boolean;
}

export function readLevel(pitchDeg: number | null, rollDeg: number | null): LevelRead {
  if (pitchDeg == null || !Number.isFinite(pitchDeg) || rollDeg == null || !Number.isFinite(rollDeg)) {
    return { pitchOffDeg: null, rollOffDeg: null, isLevel: false, unreadable: true };
  }
  const pitchOffDeg = pitchDeg - 90;
  const rollOffDeg = rollDeg;
  // Outside a plausible upright hold the bubble would be pinned to one end and read as a measurement.
  const unreadable = Math.abs(pitchOffDeg) > SLOPE_MAX_DEVIATION_DEG;
  return {
    pitchOffDeg,
    rollOffDeg,
    isLevel: !unreadable
      && Math.abs(pitchOffDeg) <= LEVEL_TOLERANCE_DEG
      && Math.abs(rollOffDeg) <= LEVEL_TOLERANCE_DEG,
    unreadable,
  };
}

/**
 * Where the bubble sits, as a fraction of the vial from centre on each axis (−1…1). Clamped, so a wild
 * hold parks it at the end rather than off the dial.
 * @param spanDeg how many degrees from centre to the end of the vial — the sensitivity of the level.
 */
export function bubbleOffset(level: LevelRead, spanDeg = 10): { x: number; y: number } {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  if (level.pitchOffDeg == null || level.rollOffDeg == null) return { x: 0, y: 0 };
  return {
    x: clamp(level.rollOffDeg / spanDeg),
    // Screen y grows downward; tilting the camera UP should float the bubble UP.
    y: clamp(-level.pitchOffDeg / spanDeg),
  };
}

/**
 * 2026-09-13 (Tim) — "if we reconcile with what we see and know this truly completes this picture."
 *
 * THE GROUNDED READ — the instrument that can actually resolve a putt's slope.
 *
 * Everything above this line reads the phone while it is held UP and aimed down the line, and the
 * honest conclusion there was a deadband: 2% of grade is 1.15° of camera angle and a handheld phone
 * wanders 2-3°, so the verdict was decided inside the noise. That is a property of the METHOD, not of
 * the sensor — no amount of routing or prompting fixes an instrument pointed at the wrong thing.
 *
 * Lay the phone ON the green and the method changes underneath the same sensor:
 *
 *              aimed (upright)                     grounded (flat)
 *   measures   where the camera points             the surface the phone rests on
 *   infers     green slope from aim angle          nothing — the attitude IS the gradient
 *   noise      ±2-3° (hand tremor, hold)           ±0.5° (grass texture under a flat object)
 *   resolves   ~5% at best                         ~1%, so the 2% that decides pace is readable
 *
 * This is why a carpenter's level is placed ON the board rather than sighted along it, and it is the
 * reconciliation Tim asked for: the bubble is not a weaker slope read, it is the one that works.
 *
 * ── IT IS STILL AN ESTIMATE, AND THE HONESTY RULES STILL APPLY (Tim, same conversation) ─────────────
 *
 * A better instrument is not a survey. What this reads is THE PATCH OF GREEN UNDER THE PHONE — four
 * inches of it — and a green undulates across a twenty-foot putt. The number is honest about the spot
 * it was taken on and says nothing about the rest of the line, so:
 *
 *   · it is never upgraded to a green map, a break in inches, or a cup count
 *   · the uncertainty is stated ONCE, as a confidence level, not smeared across every clause
 *
 * That last point is Tim's: "We can relax to show what is useful but show confidence level." A number
 * buried under three hedges is a number the player cannot act on, and hedging every sentence is its own
 * dishonesty — it hides WHICH readings are actually good. So the grade is reported plainly and carries a
 * confidence derived from things that were measured, never from tone:
 *
 *   margin  how far the reading sits above the 0.5° grass floor — 0.6° is nearly flat, 3° is not
 *   hold    whether the phone was steady while it read, or still being set down
 *   spots   how much of the LINE was sampled; one patch is one patch, two ends that agree is a line
 *
 * The gain over the aimed read is resolution at a point. Coverage of the line comes only from sampling
 * it, which is exactly what `spots` counts and why two agreeing ends earn a better grade than one.
 *
 * ── SIGN CONVENTIONS, AND WHICH OF THEM IS ACTUALLY DERIVED ─────────────────────────────────────────
 *
 * ALONG (uphill/downhill) — DERIVED, and consistent with the upright read above. `rotation.beta` runs
 * 0 flat-screen-up → +90 upright, and the rotation that carries it there is the one that RAISES THE TOP
 * EDGE. So with the phone flat and its top edge pointed at the hole, beta > 0 means the hole end sits
 * higher: uphill. That is the same premise `deviationDeg = beta - 90` rests on, applied at the other
 * end of the same sweep, so the two reads cannot disagree about which way is up.
 *
 * ACROSS (break) — CARRIED, not derived. The app has shipped `gamma > 0 → breaks right` since the putt
 * overlay was written, and I cannot confirm the platform's gamma polarity without a device. Inventing a
 * convention here would be precisely the Math.abs error again, so this carries the existing one rather
 * than quietly choosing a new one, and the bubble renders from THE SAME numbers — on a green the player
 * can see, the vial and the sentence agree with each other and the eye settles it. If a device shows
 * them inverted, flip it HERE, once.
 */

/** Beyond this on either axis the phone is not lying on a green and nothing should be reported. */
export const GROUND_MAX_TILT_DEG = 20;
/**
 * Grass texture under a flat phone, not sensor error. Below this the surface reads level — and note it
 * is well under the 1.15° that 2% of grade subtends, which is the whole reason this method exists.
 */
export const GROUND_DEADBAND_DEG = 0.5;

export type GroundCall = 'read' | 'not_flat' | 'no_reading';

export interface GroundSlopeRead {
  /** Signed grade along the phone's long axis, + uphill toward the top edge. Null when not readable. */
  alongPct: number | null;
  /** Signed cross-grade, + falls to the right. Null when not readable. */
  acrossPct: number | null;
  alongDeg: number | null;
  acrossDeg: number | null;
  call: GroundCall;
  /** True when both axes are inside the deadband — a genuinely flat piece of green. */
  isFlat: boolean;
}

const NO_GROUND_READ: GroundSlopeRead = {
  alongPct: null, acrossPct: null, alongDeg: null, acrossDeg: null, call: 'no_reading', isFlat: false,
};

/**
 * 2026-09-13 (Tim) — "like say you lay it flat cross wise level and take a pic?"
 *
 * THE AXES SWAP, and that is why this is a parameter rather than an assumption. Laid crosswise, the
 * axis that read uphill/downhill now reads the cross-slope and vice versa — so a crosswise reading
 * interpreted as a lengthwise one does not degrade, it INVERTS the break call. Exactly the class of
 * silent wrongness the Math.abs bug was.
 *
 * Both mappings below are derived from ONE carried convention, so a device test flips one thing:
 *
 *   raiseTop   = beta      (DERIVED: beta runs 0 flat → +90 upright by raising the top edge)
 *   raiseRight = -gamma    (CARRIED: the app has shipped `gamma > 0 → falls right`, i.e. right edge down)
 *
 * TOP_TO_HOLE — top edge points at the hole:
 *   along  = raiseTop            = beta      (hole end raised ⇒ uphill)
 *   across = -raiseRight         = gamma     (right edge lower ⇒ falls right)
 *
 * CROSSWISE — long axis square to the line, hole off the phone's RIGHT edge:
 *   along  = raiseRight          = -gamma    (hole end raised ⇒ uphill)
 *   across = raiseTop            = beta      (facing the hole, your right hand points at the phone's
 *                                             BOTTOM edge, so a raised TOP edge means it falls right)
 */
export type GroundOrientation = 'top_to_hole' | 'crosswise';

/**
 * Read the surface the phone is resting on.
 * @param pitchDeg    `rotation.beta` in degrees — near 0 when the phone lies flat, screen up.
 * @param rollDeg     `rotation.gamma` in degrees — near 0 when it is not tilted side to side.
 * @param orientation how the phone is lying relative to the ball→hole line. See the note above: this is
 *                    not a display preference, it decides which axis is which.
 */
export function readGroundSlope(
  pitchDeg: number | null,
  rollDeg: number | null,
  orientation: GroundOrientation = 'top_to_hole',
): GroundSlopeRead {
  if (pitchDeg == null || !Number.isFinite(pitchDeg) || rollDeg == null || !Number.isFinite(rollDeg)) {
    return NO_GROUND_READ;
  }
  // Screen-down (beta near ±180) and upright (near ±90) are both excluded by this one test, so the
  // hemisphere ambiguity that broke the aimed read cannot arise here. The gate is on the RAW axes and
  // so is orientation-independent — flat is flat however the phone is turned.
  if (Math.abs(pitchDeg) > GROUND_MAX_TILT_DEG || Math.abs(rollDeg) > GROUND_MAX_TILT_DEG) {
    return { ...NO_GROUND_READ, alongDeg: pitchDeg, acrossDeg: rollDeg, call: 'not_flat' };
  }

  const alongRawDeg = orientation === 'crosswise' ? -rollDeg : pitchDeg;
  const acrossRawDeg = orientation === 'crosswise' ? pitchDeg : rollDeg;

  const grade = (deg: number) => {
    if (Math.abs(deg) < GROUND_DEADBAND_DEG) return 0;
    const raw = Math.tan((deg * Math.PI) / 180) * 100;
    if (!Number.isFinite(raw)) return 0;
    // One decimal: at this noise floor tenths are real, and rounding a 1.4% green to 1% would throw
    // away exactly the resolution this method was adopted to gain.
    return Math.round(Math.max(-SLOPE_MAX_PCT, Math.min(SLOPE_MAX_PCT, raw)) * 10) / 10;
  };

  const alongPct = grade(alongRawDeg);
  const acrossPct = grade(acrossRawDeg);
  return {
    alongPct,
    acrossPct,
    alongDeg: alongRawDeg,
    acrossDeg: acrossRawDeg,
    call: 'read',
    isFlat: alongPct === 0 && acrossPct === 0,
  };
}

export type ReadConfidence = 'low' | 'moderate' | 'good';

export interface GroundReadQuality {
  /** How many separate spots along the line were sampled. One patch is not a line. */
  spots?: number;
  /**
   * False when the sampled spots DISAGREE by more than the noise floor. Two ends that disagree do not
   * average into a better number — they mean the line changes along its length, which is a real finding
   * and must not be smoothed into false precision.
   */
  agree?: boolean;
  /**
   * Degrees of wobble observed while the reading was taken. Null when nothing watched the hold — which
   * is NOT the same as steady, so it is treated as unknown rather than good.
   */
  wobbleDeg?: number | null;
}

/** Wobble at or under this while grounded counts as a steady hold — the phone was down, not moving. */
export const GROUND_STEADY_DEG = 0.4;

/**
 * How much to trust one grounded reading. Every input is something that was measured; nothing here is a
 * judgement about how the sentence should sound.
 */
export function groundReadConfidence(g: GroundSlopeRead, q: GroundReadQuality = {}): ReadConfidence {
  if (g.call !== 'read' || g.alongDeg == null || g.acrossDeg == null) return 'low';

  const spots = q.spots ?? 1;
  const steady = q.wobbleDeg != null && q.wobbleDeg <= GROUND_STEADY_DEG;
  // The larger axis is what the reading is really resolving; a big along-slope is not made uncertain by
  // a flat cross-slope sitting next to it.
  const margin = Math.max(Math.abs(g.alongDeg), Math.abs(g.acrossDeg));

  // Inside twice the grass floor the surface is barely distinguishable from flat, and no amount of
  // steadiness or sampling changes that — it is the floor of the instrument, not of the technique.
  if (margin < GROUND_DEADBAND_DEG * 2) return 'low';
  if (!steady) return 'low';
  // A line sampled at both ends, in agreement, is the only thing here that speaks for the whole putt.
  // Spots that disagree are worth MORE than one spot as information and LESS as a single number, so
  // they land back at moderate rather than good.
  return spots >= 2 && q.agree !== false ? 'good' : 'moderate';
}

/** Spread across sampled spots, in percentage points, above which they are not describing one slope. */
export const GROUND_AGREE_PCT = 1.5;

export interface GroundSpotSummary {
  /** The reading to act on: the mean of the spots, which is the best single answer for the line. */
  mean: GroundSlopeRead;
  spots: number;
  /** False when the spots disagree — the slope changes between where they were taken. */
  agree: boolean;
  /** The larger of the two axes' spreads, in percentage points. */
  spreadPct: number;
}

/**
 * Fold several grounded spot readings into one answer for the line, without hiding what they disagree
 * about. Returns null when there is nothing usable to fold.
 */
export function summarizeGroundSpots(reads: readonly GroundSlopeRead[]): GroundSpotSummary | null {
  const usable = reads.filter((r) => r.call === 'read' && r.alongPct != null && r.acrossPct != null);
  if (usable.length === 0) return null;

  const along = usable.map((r) => r.alongPct as number);
  const across = usable.map((r) => r.acrossPct as number);
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  const spread = (xs: number[]) => Math.round((Math.max(...xs) - Math.min(...xs)) * 10) / 10;

  const alongPct = avg(along);
  const acrossPct = avg(across);
  const spreadPct = Math.max(spread(along), spread(across));

  return {
    mean: {
      alongPct,
      acrossPct,
      // Degrees are kept for the confidence margin test, which works in the measured unit.
      alongDeg: (Math.atan(alongPct / 100) * 180) / Math.PI,
      acrossDeg: (Math.atan(acrossPct / 100) * 180) / Math.PI,
      call: 'read',
      isFlat: alongPct === 0 && acrossPct === 0,
    },
    spots: usable.length,
    agree: usable.length < 2 || spreadPct <= GROUND_AGREE_PCT,
    spreadPct,
  };
}

/** What the confidence rests on, in one short clause — so the chip can be tapped and explain itself. */
export function groundConfidenceNote(c: ReadConfidence, q: GroundReadQuality = {}): string {
  const spots = q.spots ?? 1;
  switch (c) {
    case 'good':
      return `read at ${spots} spots along the line`;
    case 'moderate':
      return q.agree === false
        ? `${spots} spots disagree — the slope changes along the line`
        : 'one spot on the line — walk it and read the far end too';
    default:
      return 'close to flat or the phone moved — set it down and hold still';
  }
}

/**
 * The grounded read in the player's language, or null when there is no read to describe.
 *
 * Plain on purpose. The uncertainty rides on the confidence level rather than on qualifiers inside the
 * sentence, because a grade the player cannot act on is not honesty, it is just noise with a hedge.
 */
export function describeGroundSlope(g: GroundSlopeRead): string | null {
  if (g.call !== 'read' || g.alongPct == null || g.acrossPct == null) return null;
  if (g.isFlat) return 'Reads flat.';
  const parts: string[] = [];
  if (g.alongPct !== 0) {
    parts.push(`${Math.abs(g.alongPct)}% ${g.alongPct > 0 ? 'uphill' : 'downhill'}`);
  }
  if (g.acrossPct !== 0) {
    parts.push(`${Math.abs(g.acrossPct)}% falling ${g.acrossPct > 0 ? 'right' : 'left'}`);
  }
  return `${parts.join(', ')}.`;
}

/** Why there is no grounded reading, in the player's language. Null when there IS one. */
export function whyNoGroundSlope(g: GroundSlopeRead): string | null {
  switch (g.call) {
    case 'not_flat':
      return 'Lay the phone flat on the green and let it settle.';
    case 'no_reading':
      return 'No tilt reading yet.';
    default:
      return null;
  }
}

/**
 * 2026-09-13 (Tim) — "For a put when it super tough, could there be a second level placing phone on the
 * ground and it sees the terrain lie to the pin clearly?"
 *
 * THE GRAZING VIEW — the pose, and how the app knows it is in it.
 *
 * At standing height a 2% slope over 20 ft is about five inches of rise across the whole line, seen
 * from above and foreshortened to nearly nothing. From an inch off the deck that same five inches
 * stands up against the backdrop. It is why a player crouches behind the ball, and it is the single
 * cheapest way to give a vision model something it can actually read.
 *
 * IT IS A DIFFERENT POSE FROM THE INCLINOMETER, which is the thing to be clear about. Flat on the green
 * screen-up, `readGroundSlope` gets the surface gradient and the rear camera is looking at grass. To
 * see down the line the phone has to STAND on its bottom edge. One phone, two poses, and they cannot be
 * done at once.
 *
 * The prize is not only the angle. A phone resting on the green has NO HAND TREMOR — and hand tremor
 * (±2-3°) is the entire reason the aimed read had to be given a deadband. So this pose is also the
 * steadiest attitude reading the app can get.
 *
 * WHY STEADINESS IS PART OF THE TEST: "upright" alone is just the normal aiming hold. Upright AND
 * steady to a fraction of a degree is a phone that is resting on something. The app cannot measure its
 * height off the ground, so it verifies the thing it CAN measure and asks for the rest.
 */

/** How far from horizontal the camera may point and still be looking down the line. */
export const GRAZING_PITCH_TOLERANCE_DEG = 20;

export type GrazingPoseCall = 'ready' | 'not_upright' | 'not_steady' | 'no_reading';

export interface GrazingPose {
  call: GrazingPoseCall;
  /** True only when the phone is upright AND resting still enough to be sitting on the green. */
  ready: boolean;
}

/**
 * @param pitchDeg  rotation.beta in degrees — 90 is upright with the camera horizontal.
 * @param wobbleDeg observed movement over the last sampling window; null means nothing watched it,
 *                  which is NOT the same as steady and is treated as not-ready.
 */
export function readGrazingPose(pitchDeg: number | null, wobbleDeg: number | null): GrazingPose {
  if (pitchDeg == null || !Number.isFinite(pitchDeg)) return { call: 'no_reading', ready: false };
  // Upright, camera looking out along the green rather than down at it or up at the sky.
  if (Math.abs(pitchDeg - 90) > GRAZING_PITCH_TOLERANCE_DEG) return { call: 'not_upright', ready: false };
  if (wobbleDeg == null || wobbleDeg > GROUND_STEADY_DEG) return { call: 'not_steady', ready: false };
  return { call: 'ready', ready: true };
}

/** What to do to get into the pose, in the player's language. Null when already there. */
export function whyNoGrazingPose(pose: GrazingPose): string | null {
  switch (pose.call) {
    case 'not_upright':
      return 'Stand the phone on its bottom edge on the green, camera looking at the hole.';
    case 'not_steady':
      return 'Let go and let it settle — resting on the green is what makes this read good.';
    case 'no_reading':
      return 'No tilt reading yet.';
    default:
      return null;
  }
}
