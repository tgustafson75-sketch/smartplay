/**
 * caddieEngine.ts — True Caddie Intelligence Engine
 *
 * Pure rule-based engine. No React, no imports, no network calls.
 * Accepts a snapshot of game state and returns a full caddie decision object.
 * Fast (<1 ms), deterministic, unit-testable.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type LieType = 'fairway' | 'rough' | 'bunker' | 'tee';

export type MentalState =
  | 'confident'
  | 'neutral'
  | 'nervous'
  | 'rushed'
  | 'frustrated'
  | 'aggressive'
  | 'pressure';

export interface CaddieInput {
  /** GPS / hole yardages */
  front:   number | null;
  middle:  number | null;
  back:    number | null;
  /** Player-selected pin position (defaults to 'middle') */
  pinPosition?: 'front' | 'middle' | 'back';
  /** Current lie */
  lie?: LieType;
  /** Player's mental state */
  mentalState?: MentalState;
  /** Shot history for the current round */
  shots?: Array<{ result: 'left' | 'right' | 'straight' | string }>;
  /** Club distances map: club name → carry yards */
  clubDistances?: Record<string, number>;
  /** Wind speed in mph (positive = headwind) */
  wind?: number;
}

export interface CaddieDecision {
  /** Resolved numeric target yardage (after lie / mental adjustment) */
  targetYards: number | null;
  /** Raw yardage before adjustments */
  rawYards: number | null;
  /** Lie penalty added to yardage (0 for fairway) */
  lieAdjustment: number;
  /** Extra yards taken (one club deeper) when nervous */
  mentalAdjustment: string | null;
  /** Recommended club name */
  recommendedClub: string | null;
  /** Where to aim */
  aimAdjustment: 'center' | 'slight left' | 'slight right';
  /** Human-readable aim label */
  aimLabel: string;
  /** Shot tip */
  shotSuggestion: string;
  /** Short confidence message for voice / card */
  confidenceMessage: string;
  /** Full pre-built voice phrase */
  voicePhrase: string;
  /** Miss pattern summary ('right' | 'left' | 'neutral') */
  missPattern: 'right' | 'left' | 'neutral';
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default club carry distances when no learned data available */
const DEFAULT_DISTANCES: [string, number][] = [
  ['Driver',   230],
  ['3 Wood',   215],
  ['5 Wood',   200],
  ['4 Iron',   190],
  ['5 Iron',   180],
  ['6 Iron',   170],
  ['7 Iron',   160],
  ['8 Iron',   148],
  ['9 Iron',   137],
  ['PW',       125],
  ['GW',       110],
  ['SW',        90],
  ['LW',        70],
  ['Putter',    20],
];

const LIE_PENALTY: Record<LieType, number> = {
  tee:     0,
  fairway: 0,
  rough:   8,   // +5–10 yds → use 8 as midpoint
  bunker:  12,  // +10–15 yds → use 12 as midpoint
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Count left / right misses from shots array */
function getMissPattern(
  shots: Array<{ result: string }>,
): 'right' | 'left' | 'neutral' {
  const recent = shots.slice(-10);
  let left = 0;
  let right = 0;
  for (const s of recent) {
    if (s.result === 'left')  left++;
    if (s.result === 'right') right++;
  }
  const threshold = Math.max(2, Math.ceil(recent.length * 0.35));
  if (right > left && right >= threshold) return 'right';
  if (left > right && left  >= threshold) return 'left';
  return 'neutral';
}

/** Find closest club to a given yardage */
function findClub(
  yards: number,
  clubDistances?: Record<string, number>,
): string | null {
  const entries: [string, number][] = clubDistances
    ? Object.entries(clubDistances)
    : DEFAULT_DISTANCES;

  // Exclude Putter for shots 30+ yds
  const candidates = yards >= 30
    ? entries.filter(([c]) => c !== 'Putter')
    : entries;

  if (candidates.length === 0) return null;

  let best = candidates[0][0];
  let bestDiff = Math.abs(candidates[0][1] - yards);
  for (const [name, yds] of candidates) {
    const diff = Math.abs(yds - yards);
    if (diff < bestDiff) { bestDiff = diff; best = name; }
  }
  return best;
}

/** Return the next-heavier club (one club more) */
function upgradeClub(
  club: string,
  clubDistances?: Record<string, number>,
): string {
  const order = clubDistances
    ? Object.keys(clubDistances)
    : DEFAULT_DISTANCES.map(([c]) => c);
  const idx = order.indexOf(club);
  // Clubs are ordered longest→shortest; index 0 = Driver, so "one more club" = idx - 1
  if (idx > 0) return order[idx - 1];
  return club;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * getCaddieRecommendation — main entry point.
 *
 * Stateless pure function: same inputs always produce same output.
 */
export function getCaddieRecommendation(input: CaddieInput): CaddieDecision {
  const {
    front,
    middle,
    back,
    pinPosition = 'middle',
    lie = 'fairway',
    mentalState = 'neutral',
    shots = [],
    clubDistances,
    wind = 0,
  } = input;

  // ── 1. Raw target yardage based on pin position ──────────────────────────
  let rawYards: number | null = null;
  if (pinPosition === 'front' && front != null)  rawYards = front;
  else if (pinPosition === 'back' && back != null) rawYards = back;
  else rawYards = middle ?? front ?? back ?? null;

  // ── 2. Lie adjustment ────────────────────────────────────────────────────
  const lieAdjustment = LIE_PENALTY[lie] ?? 0;
  const adjustedYards = rawYards != null ? rawYards + lieAdjustment : null;

  // ── 3. Wind adjustment (simple: headwind adds, tailwind subtracts) ───────
  const windAdjustedYards = adjustedYards != null
    ? adjustedYards + Math.round(wind * 0.4)
    : null;

  const targetYards = windAdjustedYards;

  // ── 4. Club selection ────────────────────────────────────────────────────
  let recommendedClub: string | null = targetYards != null
    ? findClub(targetYards, clubDistances)
    : null;

  // ── 5. Mental adjustment (nervous → take one extra club) ─────────────────
  let mentalAdjustment: string | null = null;
  if (mentalState === 'nervous' && recommendedClub) {
    const upgraded = upgradeClub(recommendedClub, clubDistances);
    if (upgraded !== recommendedClub) {
      mentalAdjustment = `Playing ${upgraded} — one extra club for a smooth, relaxed swing.`;
      recommendedClub = upgraded;
    }
  }

  // ── 6. Miss pattern + aim adjustment ─────────────────────────────────────
  const missPattern = getMissPattern(shots);

  let aimAdjustment: 'center' | 'slight left' | 'slight right' = 'center';
  let aimLabel = 'Aim Center';
  let shotSuggestion = 'Smooth swing — trust your line.';

  if (missPattern === 'right') {
    aimAdjustment = 'slight left';
    aimLabel      = 'Aim Slight Left';
    shotSuggestion = 'You tend to miss right — start it left of the flag.';
  } else if (missPattern === 'left') {
    aimAdjustment = 'slight right';
    aimLabel      = 'Aim Slight Right';
    shotSuggestion = 'You tend to miss left — favor the right side.';
  }

  // ── 7. Lie-specific shot tip overrides ──────────────────────────────────
  if (lie === 'rough') {
    shotSuggestion = `Rough lie — take more club and make a steeper swing. ${shotSuggestion}`;
  } else if (lie === 'bunker') {
    shotSuggestion = `Bunker shot — open the face, aim to clear the lip, commit through.`;
  }

  // ── 8. Confidence message ────────────────────────────────────────────────
  const shotCount = shots.length;
  let confidenceMessage = 'Pick a target and commit.';

  if (mentalState === 'nervous' || mentalState === 'pressure') {
    confidenceMessage = 'Breathe. One smooth swing — you\'ve got this.';
  } else if (mentalState === 'confident' || mentalState === 'aggressive') {
    confidenceMessage = 'You\'re dialed in — be aggressive.';
  } else if (shotCount < 5) {
    confidenceMessage = 'Still calibrating — trust your tempo.';
  } else if (missPattern !== 'neutral') {
    confidenceMessage = `Pattern locked in. ${aimLabel} and commit.`;
  }

  // ── 9. Voice phrase ───────────────────────────────────────────────────────
  const distPart   = targetYards != null ? `${targetYards} yards.` : '';
  const clubPart   = recommendedClub ? `${recommendedClub}.` : 'Grab a club.';
  const aimPart    = aimLabel + '.';
  const notePart   = mentalAdjustment ?? confidenceMessage;
  const voicePhrase = [distPart, clubPart, aimPart, notePart].filter(Boolean).join(' ');

  return {
    targetYards,
    rawYards,
    lieAdjustment,
    mentalAdjustment,
    recommendedClub,
    aimAdjustment,
    aimLabel,
    shotSuggestion,
    confidenceMessage,
    voicePhrase,
    missPattern,
  };
}

// ─── Player Model Helpers ─────────────────────────────────────────────────────
// Lightweight adaptive model that tracks shot tendencies. Designed to work
// alongside the full getCaddieRecommendation() engine without replacing it.

export interface AdaptivePlayerModel {
  totalShots: number;
  misses: { left: number; right: number; straight: number };
}

/** Create a fresh empty player model */
export function createPlayerModel(): AdaptivePlayerModel {
  return { totalShots: 0, misses: { left: 0, right: 0, straight: 0 } };
}

/** Record a shot result into the model */
export function recordShot(
  model: AdaptivePlayerModel,
  shot: { result: 'left' | 'right' | 'straight' | 'center' },
): AdaptivePlayerModel {
  const result = shot.result === 'center' ? 'straight' : shot.result;
  return {
    totalShots: model.totalShots + 1,
    misses: {
      ...model.misses,
      [result]: (model.misses[result as keyof typeof model.misses] ?? 0) + 1,
    },
  };
}

/** Derive dominant tendency from a player model */
export function getTendencies(
  model: AdaptivePlayerModel,
): { dominantMiss: 'left' | 'right' | 'straight' | null; confidence: number } {
  const { left, right, straight } = model.misses;
  const total = model.totalShots;
  if (total < 3) return { dominantMiss: null, confidence: 0 };
  const max = Math.max(left, right, straight);
  const confidence = Math.round((max / total) * 100);
  if (max === straight) return { dominantMiss: 'straight', confidence };
  if (max === left) return { dominantMiss: 'left', confidence };
  return { dominantMiss: 'right', confidence };
}

/** Apply a personality modifier to an advice string */
export function applyPersonality(
  text: string,
  personality: 'safe' | 'aggressive' | 'pro',
): string {
  if (personality === 'aggressive') {
    return text.replace(/\b(smoothly?|easy|just|try to)\b/gi, '').replace(/\s{2,}/g, ' ').trim()
      + ' Commit.';
  }
  if (personality === 'pro') {
    return text + ' Execute the process.';
  }
  return text; // safe — no change
}

/** Generate advice text from context and player model */
export function generateAdvice(
  context: { distance?: number | null; club?: string | null },
  model: AdaptivePlayerModel,
  personality: 'safe' | 'aggressive' | 'pro' = 'safe',
): string {
  const tend = getTendencies(model);
  const distPart = context.distance ? `${context.distance} yards. ` : '';
  const clubPart = context.club ? `${context.club}. ` : '';
  let aimPart = 'Center target.';
  if (tend.dominantMiss === 'right' && tend.confidence >= 50) aimPart = 'Aim left — right miss tendency.';
  if (tend.dominantMiss === 'left' && tend.confidence >= 50) aimPart = 'Aim right — left miss tendency.';
  const base = `${distPart}${clubPart}${aimPart}`;
  return applyPersonality(base, personality);
}
