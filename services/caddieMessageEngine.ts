/**
 * caddieMessageEngine — Contextual caddie advice generator.
 *
 * Builds a short (max 2-sentence) message from live round context:
 *   strategy → mode → pattern → mentalState
 *
 * All output is passed through formatVoiceMessage() (voiceProfile) to ensure
 * the caddie always sounds calm, confident, and brief.
 *
 * Usage:
 *   import { generateCaddieMessage } from '../services/caddieMessageEngine';
 *   const msg = generateCaddieMessage({ strategy, mode, mentalState, currentPattern, distance, hole });
 */

import { formatVoiceMessage } from './voiceProfile';

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface CaddieMessageContext {
  strategy:       'aggressive' | 'balanced' | 'conservative';
  mode:           'safe' | 'neutral' | 'attack';
  mentalState:    'confident' | 'neutral' | 'frustrated' | 'nervous';
  currentPattern: 'miss_right' | 'miss_left' | 'neutral' | string | null;
  distance?:      number | null;
  hole?:          number | null;
}

// ---------------------------------------------------------------------------
// Phrase banks
// ---------------------------------------------------------------------------

// 1. Strategy opening — first sentence
const STRATEGY_OPENERS: Record<CaddieMessageContext['strategy'], string[]> = {
  aggressive:   [
    'Be aggressive here.',
    'Attack the flag.',
    'Go at the pin.',
  ],
  balanced:     [
    'Play center.',
    'Play to the fat part of the green.',
    'Middle of the green is your target.',
  ],
  conservative: [
    'Play it safe.',
    'Take the safe route.',
    'Smart play — aim for the center.',
  ],
};

// Mode overrides the strategy opener when they diverge
const MODE_OVERRIDES: Partial<Record<CaddieMessageContext['mode'], string>> = {
  safe:   'Play it safe.',
  attack: 'Be aggressive here.',
};

// 2. Pattern clause — middle
const PATTERN_CLAUSES: Record<string, string> = {
  miss_right: 'Avoid the right miss.',
  miss_left:  'Avoid the left pull.',
  neutral:    '',
};

// 3. Mental close — last sentence
const MENTAL_CLOSES: Record<CaddieMessageContext['mentalState'], string> = {
  confident:  'Trust your swing.',
  neutral:    'Stay smooth.',
  frustrated: 'Breathe and reset.',
  nervous:    'One shot at a time.',
};

// ---------------------------------------------------------------------------
// Distance hint (optional extra clause)
// ---------------------------------------------------------------------------

function distanceHint(distance: number): string {
  if (distance <= 50)  return 'Short game — land it soft.';
  if (distance <= 100) return 'Inside 100 — commit to the number.';
  if (distance <= 150) return 'Mid-iron distance — play to the center.';
  if (distance <= 200) return 'Long approach — take one more club.';
  return '';
}

// ---------------------------------------------------------------------------
// pick() — round-robin through a phrase pool per key to avoid repetition
// ---------------------------------------------------------------------------

const _cursors: Record<string, number> = {};

function pick(key: string, pool: string[]): string {
  const i = (_cursors[key] ?? 0) % pool.length;
  _cursors[key] = i + 1;
  return pool[i];
}

// ---------------------------------------------------------------------------
// generateCaddieMessage()
// ---------------------------------------------------------------------------

/**
 * Returns a short, intelligent caddie message (max 2 sentences).
 *
 * Build order:
 *   1. Strategy/mode opener
 *   2. Pattern warning (if non-neutral)
 *   3. Mental state close
 *
 * If distance is provided and no pattern exists, a distance hint replaces
 * the pattern clause.
 */
export function generateCaddieMessage(ctx: CaddieMessageContext): string {
  const { strategy, mode, mentalState, currentPattern, distance } = ctx;

  // ── 1. Opener ─────────────────────────────────────────────────────────
  const opener =
    MODE_OVERRIDES[mode] ??
    pick(`opener_${strategy}`, STRATEGY_OPENERS[strategy] ?? STRATEGY_OPENERS.balanced);

  // ── 2. Middle clause (pattern or distance) ────────────────────────────
  const patternKey  = currentPattern ?? 'neutral';
  const patternText = PATTERN_CLAUSES[patternKey] ?? '';
  const middleText  =
    patternText ||
    (distance != null && distance > 0 ? distanceHint(distance) : '');

  // ── 3. Close ──────────────────────────────────────────────────────────
  const close = MENTAL_CLOSES[mentalState] ?? MENTAL_CLOSES.neutral;

  // ── Assemble (max 2 sentences: opener + close, with middle folded in) ─
  const parts = [opener, middleText, close].filter(Boolean);

  // Keep it tight: if we have 3 parts, drop the opener's period and join
  // middle into sentence 1, then close is sentence 2.
  let raw: string;
  if (parts.length === 3) {
    const [p1, p2, p3] = parts;
    raw = `${p1} ${p2} ${p3}`;
  } else {
    raw = parts.join(' ');
  }

  return formatVoiceMessage(raw);
}
