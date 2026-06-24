/**
 * 2026-06-24 (Tim — Ball Fitting v1, honest) — "we are the answer."
 *
 * Titleist sells a fitting; the caddie brain already KNOWS your game, so it can
 * answer "which ball fits me?" from signals the CNS actually holds — no launch
 * monitor, no extra hardware. Lives in the CNS and follows the same PURE / SYNC /
 * OFFLINE-SAFE / never-throws composition style as composeShotRead (cnsShotRead.ts):
 * no React, no hooks, no network, no store access — the caller passes the player's
 * signals in. That keeps it unit-testable and usable with zero signal.
 *
 * HONESTY BOUNDARY (the whole feature depends on it — memory:
 * ball-fitting-recommendation, illustration-data-points, smartmotion-metrics-honesty):
 *   - confidence is ALWAYS 'directional' in v1. We do NOT measure spin or
 *     compression, so this is a match on READABLE game data (speed tier from
 *     driver carry, handicap tier, short-game/feel emphasis), NOT a fitting.
 *   - where we lack a signal we OMIT it (characteristic '—'), we never fabricate.
 *   - exampleCategories are GENERIC category names ("tour urethane", "low-spin
 *     distance", "soft 2-piece"), never a branded ball asserted as fact. A brand
 *     may appear only clearly framed as "e.g.".
 *   - if there isn't enough data (no handicap AND no driver distance) we return a
 *     low-info result that asks the player to log a few drives / set their handicap
 *     first — we do not invent player data.
 *
 * NOTE: this is distinct from services/cnsBallFitting.ts (composeBallFit), which
 * powers the branded caddie-tab Ball Fit screen. This v1 is the stricter,
 * generic-category read surfaced in the SwingLab Fit Profile.
 */

export type BallProfileKind = 'distance' | 'tour' | 'soft_feel' | 'straight_distance';

export interface BallFitResult {
  profile: BallProfileKind;
  /** Human label for the profile, e.g. "Tour (urethane)". */
  profileLabel: string;
  /** Answer-first one-liner. */
  headline: string;
  /** Short "why" lines — ONLY from signals we actually observed. */
  reasons: string[];
  /** Ball characteristics — '—' where we have no honest read. */
  characteristics: {
    spin: 'low' | 'mid' | 'high' | '—';
    feel: 'firm' | 'mid' | 'soft' | '—';
    cover: string;
  };
  /** v1 is ALWAYS directional — a game-data match, not a spin/compression fit. */
  confidence: 'directional';
  /** Generic category names (NOT branded balls asserted as fact). */
  exampleCategories: string[];
  /** True when we didn't have enough to recommend a profile — surface the prompt. */
  lowInfo: boolean;
  /** The "directional · from your readable game data" honesty line for the UI. */
  honestyLine: string;
}

export interface BallFitInput {
  /** Handicap index or playing handicap (lower = more spin/feel reward). null = unknown. */
  handicap?: number | null;
  /** Learned/measured driver CARRY in yards — the swing-speed-tier proxy. null = unknown. */
  driverCarryYards?: number | null;
  /** Free-text stated goal (keyword-scanned for a feel vs distance emphasis). */
  goal?: string | null;
  /** Dominant miss flavor (a curving miss nudges toward lower-spin off the driver). */
  missType?: 'slice' | 'hook' | 'thin' | 'fat' | 'pull' | 'push' | 'varies' | null;
  /** Tracked wedge shots (PW+GW+SW+LW samples) — a short-game / greenside-feel proxy. */
  wedgeSamples?: number | null;
}

/**
 * Swing-speed TIER from DRIVER CARRY yards. Carry (not total) is what we measure
 * in clubStats, so the bands are tuned to realistic carry — they sit a touch below
 * the equivalent total-distance bands a launch monitor would quote.
 *   slow     : < 210y carry  (gentler swing — a softer, low-compression ball loads easier)
 *   moderate : 210–250y      (the broad amateur middle)
 *   fast     : 250–275y      (enough speed to use a firmer / tour cover)
 *   tour     : 275y+         (compresses a tour ball fully)
 */
export type SpeedTier = 'slow' | 'moderate' | 'fast' | 'tour';
export function speedTierFromCarry(carry: number | null | undefined): SpeedTier | null {
  if (typeof carry !== 'number' || !Number.isFinite(carry) || carry <= 0) return null;
  if (carry < 210) return 'slow';
  if (carry < 250) return 'moderate';
  if (carry < 275) return 'fast';
  return 'tour';
}

/** Handicap TIER. lower = can use (and reward) more spin/feel. */
export type HcpTier = 'low' | 'mid' | 'high';
function hcpTier(h: number | null | undefined): HcpTier | null {
  if (typeof h !== 'number' || !Number.isFinite(h)) return null;
  if (h <= 10) return 'low';   // single-digit-ish — uses greenside spin + control
  if (h <= 18) return 'mid';   // the improving middle
  return 'high';               // forgiveness + distance beats chasing spin
}

const CATALOG: Record<BallProfileKind, {
  label: string;
  characteristics: BallFitResult['characteristics'];
  exampleCategories: string[];
}> = {
  tour: {
    label: 'Tour (urethane)',
    // Tour balls are urethane-covered: more greenside spin + a soft feel, designed
    // to be compressed by faster swings.
    characteristics: { spin: 'high', feel: 'soft', cover: 'urethane' },
    exampleCategories: ['tour urethane', 'soft urethane', 'premium 3-/4-piece'],
  },
  soft_feel: {
    // Low-compression, soft-feel balls (often ionomer). We can read FEEL honestly;
    // we do NOT measure spin, so spin stays '—'.
    label: 'Soft feel',
    characteristics: { spin: '—', feel: 'soft', cover: 'ionomer / soft cover' },
    exampleCategories: ['soft 2-piece', 'low-compression soft', 'soft ionomer'],
  },
  distance: {
    label: 'Distance',
    // Firmer, lower-spin-off-the-driver distance balls.
    characteristics: { spin: 'low', feel: 'firm', cover: 'ionomer / surlyn' },
    exampleCategories: ['low-spin distance', 'firm 2-piece distance', 'fast ionomer'],
  },
  straight_distance: {
    // Forgiveness-first: low driver spin to curve less + 2-piece distance. Honest:
    // a lower-spin ball reduces a curve, it does not fix the swing.
    label: 'Straight distance',
    characteristics: { spin: 'low', feel: 'mid', cover: 'durable ionomer' },
    exampleCategories: ['low-spin distance', 'straight-flight 2-piece', 'durable distance'],
  },
};

const HEADLINES: Record<BallProfileKind, string> = {
  tour: 'A tour urethane ball fits your game — greenside spin and soft feel.',
  soft_feel: 'A soft, low-compression ball fits your game.',
  distance: 'A low-spin distance ball fits your game.',
  straight_distance: 'A forgiving low-spin distance ball fits where your game is now.',
};

const HONESTY_LINE = 'directional · from your readable game data (speed tier, handicap, short game) — not a spin/compression fitting';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Compose the honest, directional ball fit. Rules-based, deterministic. Reasons
 * are built ONLY from the signals that actually contributed.
 */
export function recommendBall(input: BallFitInput): BallFitResult {
  const carry = num(input.driverCarryYards);
  const hcp = num(input.handicap);
  const wedge = num(input.wedgeSamples);
  const goal = (input.goal ?? '').toLowerCase();

  const speed = speedTierFromCarry(carry);
  const tier = hcpTier(hcp);

  // ── Not enough to say anything honest → low-info prompt (don't invent data). ──
  if (speed == null && tier == null) {
    return {
      profile: 'soft_feel', // a broadly-safe placeholder; UI shows the prompt, not a claim
      profileLabel: 'Not enough yet',
      headline: 'Set your handicap and log a few drives, and I’ll fit your ball.',
      reasons: [
        'Add your handicap in your profile.',
        'Track or set your driver carry so I can read your speed tier.',
      ],
      characteristics: { spin: '—', feel: '—', cover: '—' },
      confidence: 'directional',
      exampleCategories: [],
      lowInfo: true,
      honestyLine: HONESTY_LINE,
    };
  }

  // ── Feel / short-game emphasis from readable signals (goal keywords + wedge use). ──
  const goalWantsFeel = /(feel|control|spin|check|greens?|short game|scoring|touch)/.test(goal);
  const goalWantsDistance = /(distance|farther|further|longer|bomb|more yards|power)/.test(goal);
  const goalWantsStraight = /(straight|accuracy|accurate|consistent|consistency|fairway|in play)/.test(goal);
  const wedgeHeavy = wedge != null && wedge >= 6; // logs a lot of wedge work → greenside priority
  const feelEmphasis = goalWantsFeel || wedgeHeavy;
  const curvingMiss = input.missType === 'slice' || input.missType === 'hook';

  const reasons: string[] = [];

  // ── Core mapping (rules, honest). Speed tier × handicap tier, then feel nudges. ──
  let profile: BallProfileKind;

  // Effective handicap tier when missing: lean on speed alone but don't claim a hcp reason.
  const t: HcpTier = tier ?? (speed === 'tour' || speed === 'fast' ? 'mid' : 'high');

  if (speed === 'tour' || (speed === 'fast' && t === 'low')) {
    // Faster speed + lower handicap → tour: enough speed to compress a urethane
    // cover and the skill to use greenside spin.
    profile = 'tour';
  } else if (t === 'high' || speed === 'slow') {
    // Higher handicap and/or slower speed → forgiveness + distance, lower spin off
    // the driver (a 2-piece). A curving miss reinforces this (lower spin = less curve).
    profile = (curvingMiss || goalWantsStraight) ? 'straight_distance' : 'distance';
    // Slow speed specifically loads a soft, low-compression ball better — if the
    // player isn't asking for straightness/distance, soft feel is the kinder fit.
    if (speed === 'slow' && !curvingMiss && !goalWantsStraight && !goalWantsDistance) profile = 'soft_feel';
  } else {
    // Moderate speed, improving (mid/low handicap): distance or soft-feel by feel
    // emphasis; a feel/short-game priority pushes toward tour.
    if (feelEmphasis && t === 'low') profile = 'tour';
    else if (feelEmphasis) profile = 'soft_feel';
    else if (goalWantsDistance) profile = 'distance';
    else if (goalWantsStraight || curvingMiss) profile = 'straight_distance';
    else profile = 'soft_feel'; // safe, broadly-good default in the middle
  }

  // A clearly stated feel/short-game priority nudges a non-tour pick toward more
  // feel (soft_feel), unless we're already at tour.
  if (feelEmphasis && profile === 'distance') profile = 'soft_feel';

  // ── Reasons — ONLY from signals we observed. ──
  if (speed != null && carry != null) {
    const c = Math.round(carry);
    if (speed === 'slow') reasons.push(`your ~${c} yd driver carry is a gentler speed tier — a softer, low-compression ball loads easier`);
    else if (speed === 'moderate') reasons.push(`your ~${c} yd driver carry sits in the moderate speed tier`);
    else if (speed === 'fast') reasons.push(`your ~${c} yd driver carry is a faster speed tier — enough to use a firmer / urethane cover`);
    else reasons.push(`your ~${c} yd driver carry is a tour-level speed tier — you can compress a tour ball`);
  }
  if (tier != null && hcp != null) {
    const hLabel = hcp <= 0 ? 'scratch' : `${Math.round(hcp)}`;
    if (tier === 'low') reasons.push(`at a ${hLabel} handicap you can use greenside spin and control`);
    else if (tier === 'mid') reasons.push(`a ${hLabel} handicap rewards feel and forgiveness over raw spin`);
    else reasons.push(`at a ${hLabel} handicap, forgiveness and distance beat chasing spin`);
  }
  if (wedgeHeavy) reasons.push('you log a lot of wedge work — greenside feel matters for your game');
  if (goalWantsFeel && !wedgeHeavy) reasons.push('your goal leans on feel and short-game control');
  if (goalWantsDistance) reasons.push('your goal leans on distance');
  if (curvingMiss) reasons.push(`you fight a ${input.missType} — a lower-spin ball curves a little less (it reduces it, it won’t fix the swing)`);

  if (reasons.length === 0) {
    reasons.push('a balanced, soft ball is the safe starting point until your game tells us more');
  }

  const cat = CATALOG[profile];
  return {
    profile,
    profileLabel: cat.label,
    headline: HEADLINES[profile],
    reasons: reasons.slice(0, 4),
    characteristics: cat.characteristics,
    confidence: 'directional',
    exampleCategories: cat.exampleCategories,
    lowInfo: false,
    honestyLine: HONESTY_LINE,
  };
}
