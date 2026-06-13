/**
 * 2026-06-13 — CNS Ball Fitting (the "we are the answer" read).
 *
 * Titleist sells a fitting; the caddie brain already KNOWS your game, so it can
 * answer "which ball fits me?" from signals the CNS holds — no launch monitor,
 * no extra hardware. This is the same composition pattern as cnsShotRead: the
 * brain composes ONE answer-first read; the surface just displays it.
 *
 * PURE, SYNC, OFFLINE-SAFE, never throws — no React, no hooks, no network, no
 * store access (the caller passes the player's signals in). Unit-testable and
 * usable with zero signal.
 *
 * HONESTY BOUNDARY (memory: smartmotion-metrics-honesty, ball-fitting-recommendation):
 * we do NOT measure spin or compression. We match a PROFILE on readable game
 * signals (speed band, handicap, miss, short-game use, stated goal) and name
 * representative balls in that category — explicitly "balls in this category,"
 * NOT an endorsement and NOT a measured fit. A slice caveat says "reduces curve,
 * won't fix the swing." Every result carries the "try a sleeve, not a monitor
 * fit" caveat. See memory: caddie-brain-lens, self-growing-agent-architecture.
 */

export type BallProfile = 'tour' | 'distance' | 'soft-feel' | 'value';

export interface BallFit {
  /** The answer: which category fits. */
  profile: BallProfile;
  /** Answer-first headline. */
  headline: string;
  /** Short measured "why" lines, in priority order — only signals we actually had. */
  why: string[];
  /** Representative real balls in the chosen category (NOT endorsement / measured). */
  examples: string[];
  /** Honest "what you give up" line. */
  tradeoff: string;
  confidence: 'high' | 'medium' | 'low';
  /** Standing honesty caveat — this is a game-data match, not a launch-monitor fit. */
  caveat: string;
}

export interface BallFitInput {
  /** Playing handicap or index (lower = more spin/feel reward). */
  handicap?: number | null;
  /** Learned driver carry (clubStats) or longest drive — the speed-band proxy. */
  driverCarryYards?: number | null;
  experience?: 'starting' | 'improving' | 'returning' | 'competitive' | null;
  missType?: 'slice' | 'hook' | 'thin' | 'fat' | 'pull' | 'push' | 'varies' | null;
  /** How many wedge shots the player actually logs — short-game priority proxy. */
  shortGameWedgeSamples?: number | null;
  /** Free-text stated goal (keyword-scanned). */
  goal?: string | null;
}

const CATALOG: Record<BallProfile, { label: string; examples: string[]; tradeoff: string }> = {
  tour: {
    label: 'tour',
    examples: ['Titleist Pro V1', 'Callaway Chrome Soft X', 'TaylorMade TP5'],
    tradeoff: 'Premium price, and it rewards consistent contact.',
  },
  distance: {
    label: 'distance',
    examples: ['Titleist Velocity', 'Srixon Distance', 'Callaway Warbird'],
    tradeoff: 'Firmer feel and less greenside check than a tour ball.',
  },
  'soft-feel': {
    label: 'soft-feel',
    examples: ['Titleist TruFeel', 'Callaway Supersoft', 'Srixon Soft Feel'],
    tradeoff: 'A touch less distance than a firm distance ball.',
  },
  value: {
    label: 'value',
    examples: ['Kirkland Signature', 'Wilson Duo Soft', 'Vice Drive'],
    tradeoff: 'Not tour-level greenside spin — but real savings while you lose a few.',
  },
};

const CAVEAT =
  'This matches a ball to your game data — not a launch-monitor spin/compression fitting. Try a sleeve before you commit to a dozen.';

const HEADLINES: Record<BallProfile, string> = {
  tour: 'A tour ball fits your game — feel and greenside spin.',
  distance: 'A low-spin distance ball fits your game.',
  'soft-feel': 'A soft, low-compression ball fits your game.',
  value: 'A value ball fits where your game is right now.',
};

/**
 * Compose the ball-fit read. Deterministic scoring across the four profiles;
 * the winning profile's `why` lines are built ONLY from the signals that
 * actually contributed, so we never invent a reason we didn't observe.
 */
export function composeBallFit(input: BallFitInput): BallFit {
  const score: Record<BallProfile, number> = { tour: 0, distance: 0, 'soft-feel': 0, value: 0 };
  const why: Partial<Record<BallProfile, string[]>> = { tour: [], distance: [], 'soft-feel': [], value: [] };
  let signals = 0;

  const carry = num(input.driverCarryYards);
  const hcp = num(input.handicap);
  const wedge = num(input.shortGameWedgeSamples);

  // 1) Speed band from driver carry.
  if (carry != null) {
    signals++;
    if (carry >= 250) {
      score.tour += 2; why.tour!.push(`your driver carries ~${Math.round(carry)} — enough speed to compress a tour ball`);
    } else if (carry >= 215) {
      score.tour += 1; score['soft-feel'] += 1;
    } else {
      // Slower speed compresses a soft, low-compression ball better than a firm tour ball.
      score['soft-feel'] += 2; why['soft-feel']!.push(`your driver carries ~${Math.round(carry)} — a low-compression ball loads easier at your speed`);
      score.distance += 1;
    }
  }

  // 2) Handicap → how much spin/feel the player can use.
  if (hcp != null) {
    signals++;
    if (hcp <= 8) {
      score.tour += 2; why.tour!.push(`at a ${fmtHcp(hcp)} handicap you can use the spin and control`);
    } else if (hcp <= 18) {
      score['soft-feel'] += 2; why['soft-feel']!.push(`a mid handicap rewards feel and forgiveness over raw spin`);
      score.distance += 1;
    } else {
      score.value += 2; why.value!.push(`at a higher handicap, saving strokes (and dollars) beats chasing spin`);
      score.distance += 1;
    }
  }

  // 3) Miss — a slice/hook curves on sidespin; a lower-spin ball curves LESS (honest: reduces, not fixes).
  if (input.missType === 'slice' || input.missType === 'hook') {
    signals++;
    score.distance += 2;
    why.distance!.push(`you fight a ${input.missType} — a lower-spin ball curves a little less (it reduces it, it won't fix the swing)`);
  }

  // 4) Short-game usage → greenside spin priority.
  if (wedge != null && wedge >= 6) {
    signals++;
    score.tour += 2;
    why.tour!.push(`you work the wedges a lot — urethane gives you greenside check`);
  }

  // 5) Stated goal keywords.
  const g = (input.goal ?? '').toLowerCase();
  if (g) {
    if (/(distance|farther|further|longer|bomb|more yards)/.test(g)) { score.distance += 2; signals++; why.distance!.push('your goal leans on distance'); }
    if (/(feel|control|spin|check|greens?|short game|scoring)/.test(g)) { score.tour += 2; signals++; why.tour!.push('your goal leans on feel and control'); }
    if (/(straight|accuracy|consistent|consistency|fairway)/.test(g)) { score.distance += 1; score['soft-feel'] += 1; signals++; }
    if (/(cheap|budget|save money|lose balls|losing balls|value)/.test(g)) { score.value += 2; signals++; why.value!.push('you asked to keep it affordable'); }
  }

  // 6) Experience bookends.
  if (input.experience === 'competitive') { score.tour += 1; signals++; }
  else if (input.experience === 'starting') { score.value += 1; score.distance += 1; signals++; }

  // Pick the winner. Deterministic tiebreak: soft-feel > distance > value > tour
  // (the safe, broadly-good default wins ties when signal is thin).
  const order: BallProfile[] = ['soft-feel', 'distance', 'value', 'tour'];
  let best: BallProfile = 'soft-feel';
  for (const p of order) if (score[p] > score[best]) best = p;

  const cat = CATALOG[best];
  const reasons = (why[best] ?? []).slice(0, 3);
  // If we somehow have no reason for the winner (thin signal → default), say so honestly.
  if (reasons.length === 0) reasons.push('a balanced, soft ball is the safe default until your game tells us more');

  const confidence: BallFit['confidence'] = signals >= 3 ? 'high' : signals >= 1 ? 'medium' : 'low';

  return {
    profile: best,
    headline: HEADLINES[best],
    why: reasons,
    examples: cat.examples,
    tradeoff: cat.tradeoff,
    confidence,
    caveat: CAVEAT,
  };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function fmtHcp(h: number): string {
  return h <= 0 ? 'scratch' : `${Math.round(h)}`;
}
