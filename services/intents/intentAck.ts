/**
 * 2026-05-22 — Shared intent acknowledgment helper.
 *
 * Hands-free is the primary input surface on Meta Ray-Ban glasses + earbuds.
 * Every voice intent MUST acknowledge before executing — the user CAN'T see
 * the screen, so a silent state change is broken UX. This module centralizes
 * the "Got it, <action>..." pattern so handlers don't each invent their own.
 *
 * Persona-aware: Kevin/Serena/Tank/Harry each have a distinct ack vocabulary
 * (see docs/VOICE-INTENT-REGISTRY.md §11). When no persona is passed, reads
 * caddiePersonality from settingsStore at call time so the active caddie's
 * voice always wins.
 */

import type { IntentResult } from '../../types/voiceIntent';
import { useSettingsStore, type Persona } from '../../store/settingsStore';

const ACK_PHRASES: Record<Persona, string[]> = {
  kevin: ['Got it', 'On it', 'Alright', 'Sure'],
  serena: ['Confirmed', 'Got it', 'Noted', 'Understood'],
  tank: ['Roger', 'Locked in', 'Copy', 'Done'],
  harry: ['Yep', 'On it', 'Got you', 'Cool'],
};

function pickAckPhrase(persona: Persona): string {
  const pool = ACK_PHRASES[persona] ?? ACK_PHRASES.kevin;
  return pool[Math.floor(Math.random() * pool.length)];
}

function getActivePersona(): Persona {
  try {
    return useSettingsStore.getState().caddiePersonality;
  } catch {
    return 'kevin';
  }
}

/**
 * Build a side-effecting ack. Use when the handler is about to mutate state.
 * Pattern: "<ack-phrase> — <action-description>."
 *
 * @example
 *   return intentAck.action('marking your lie as fairway', ['lie:fairway']);
 *   // → "Got it — marking your lie as fairway."
 */
export function actionAck(
  actionDescription: string,
  sideEffects: string[],
  opts?: { persona?: Persona },
): IntentResult {
  const persona = opts?.persona ?? getActivePersona();
  const phrase = pickAckPhrase(persona);
  return {
    success: true,
    voice_response: `${phrase} — ${actionDescription}.`,
    side_effects: sideEffects,
    follow_up_needed: false,
  };
}

/**
 * Build a state-change ack. Use when a toggle / setting flips. Includes the
 * new state in the response so the user knows the action landed.
 *
 * @example
 *   return intentAck.state('Cart mode on', 'tightened up shot detection', ['cart_mode:true']);
 *   // → "Cart mode on — tightened up shot detection."
 */
export function stateAck(
  newState: string,
  consequence: string | null,
  sideEffects: string[],
): IntentResult {
  return {
    success: true,
    voice_response: consequence ? `${newState} — ${consequence}.` : `${newState}.`,
    side_effects: sideEffects,
    follow_up_needed: false,
  };
}

/**
 * Build a status answer. Use when the handler is reading state, not mutating.
 * No "got it" prefix — just the answer. (The user asked a question; the answer
 * IS the acknowledgment.)
 */
export function answerAck(answer: string, sideEffects: string[]): IntentResult {
  return {
    success: true,
    voice_response: answer,
    side_effects: sideEffects,
    follow_up_needed: false,
  };
}

/**
 * Refusal with a reason. Use when the handler CAN'T execute (no GPS, no round
 * active, missing data). Forbidden: silent refusal with empty voice_response.
 */
export function refuseAck(reason: string, sideEffects: string[]): IntentResult {
  return {
    success: false,
    voice_response: reason,
    side_effects: sideEffects,
    follow_up_needed: false,
  };
}

/**
 * Clarifying follow-up. Use when the handler needs one more piece of info.
 * Sets follow_up_needed so the voice loop stays open for the user's response.
 */
export function clarifyAck(question: string): IntentResult {
  return {
    success: false,
    voice_response: question,
    side_effects: ['clarify'],
    follow_up_needed: true,
  };
}

export const intentAck = {
  action: actionAck,
  state: stateAck,
  answer: answerAck,
  refuse: refuseAck,
  clarify: clarifyAck,
};
