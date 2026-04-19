/**
 * engine/responseFormatter.ts
 *
 * Elite Caddie Voice layer for Focus Mode engines.
 *
 * Wraps the existing features/voice/ResponseFormatter with:
 *   - formatCaddieResponse() — assembles distance + club + insight into one phrase
 *   - applyTone()            — prepends/appends momentum cue from round state
 *   - applyPersonality()     — re-exported from personalityEngine for convenience
 *
 * Rules enforced here:
 *   • Max 2 sentences per response
 *   • No filler words ("based on data", "I would suggest", etc.)
 *   • Tone adapts to round momentum; stays neutral when nothing notable
 */

import { formatDistance, formatClub } from '../features/voice/ResponseFormatter';
import type { RoundState } from './roundEngine';
import type { PersonalityProfile } from './personalityEngine';
export { applyPersonality } from './personalityEngine';

// ─── Core formatter ───────────────────────────────────────────────────────────

interface CaddieResponseParts {
  distance?: number | null;
  club?:     string | null;
  /** Short directional / hazard insight — max one clause */
  insight?:  string | null;
}

/**
 * Assembles up to 3 parts into a single caddie phrase.
 * All parts are optional — returns a non-empty string always.
 */
export const formatCaddieResponse = ({
  distance,
  club,
  insight,
}: CaddieResponseParts): string => {
  const parts: string[] = [];

  if (distance != null && distance > 0) {
    parts.push(formatDistance(distance, 'short'));   // "152."
  }

  if (club) {
    parts.push(formatClub(club, 'neutral', 'calm')); // "I like the 7 iron."
  }

  if (insight?.trim()) {
    // Insight is already a short clause — keep as-is
    parts.push(insight.trim());
  }

  if (parts.length === 0) {
    return "Pick a target and commit.";
  }

  // Join without double-spaces; trim trailing punctuation duplicates
  return parts.join(' ').replace(/\.\s*\./g, '.').trim();
};

// ─── Tone engine ──────────────────────────────────────────────────────────────

/**
 * Prepends or appends a momentum cue when the round state warrants it.
 * Silent when momentum is neutral — never adds noise.
 */
export const applyTone = (message: string, roundState?: RoundState | null): string => {
  if (!roundState) return message;

  if (roundState.momentum === 'negative') {
    return `Let's reset. ${message}`;
  }

  if (roundState.momentum === 'positive') {
    // Only append if message doesn't already end with encouragement
    const lower = message.toLowerCase();
    if (!lower.includes('well') && !lower.includes('commit')) {
      return `${message} You're swinging it well.`;
    }
  }

  if (roundState.pressure && roundState.momentum === 'neutral') {
    return `${message} Commit to the target.`;
  }

  return message;
};

// ─── Knowledge response trim ──────────────────────────────────────────────────

/**
 * Trim an AI knowledge answer to ≤2 sentences and strip robotic filler phrases.
 * Pass the optional golf bridge to append naturally when present.
 */
export const formatKnowledgeAnswer = (
  answer:      string,
  golfBridge?: string | null,
): string => {
  const FILLER = [
    /based on (the )?data/gi,
    /according to my (training|knowledge)/gi,
    /as an ai[,.]?/gi,
    /i would suggest that/gi,
    /it('s| is) worth noting that/gi,
    /in summary[,.]?/gi,
  ];

  let cleaned = answer.trim();
  for (const pattern of FILLER) {
    cleaned = cleaned.replace(pattern, '').replace(/\s{2,}/g, ' ').trim();
  }

  // Cap at 2 sentences
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) ?? [cleaned];
  const capped    = sentences.slice(0, 2).join(' ').trim();

  return golfBridge ? `${capped} ${golfBridge}` : capped;
};
