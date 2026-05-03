/**
 * Phase AR — Conversation state buffer.
 *
 * In-memory rolling buffer of the last few user/Kevin turns. Lets Kevin
 * resolve follow-up queries against prior context within a single
 * listening session OR across rapid-succession sessions:
 *
 *   user: "How far to the green?"
 *   Kevin: "162 to middle."
 *   user: "And the wind?"            ← Kevin needs the prior turn to know "wind for THAT shot"
 *   Kevin: "Into your face, two clubs."
 *
 * Decay rules:
 *   - Buffer auto-clears after 60s of no new turns.
 *   - Buffer also clears on round_state_change (round start / end / hole transition)
 *     so cross-context turns from a prior hole don't leak into a new context.
 *
 * Persistence: NONE. Conversation state is ephemeral by design — it's
 * about "what we're talking about right now", not long-term memory
 * (that's Phase AQ context architecture, persisted server-prompt-side).
 *
 * Read API: `getRecentTurns()` returns up to 3 last turns for injection
 * into the kevin.ts system prompt. Format keeps role labels so the
 * model can resolve "you" vs "I" naturally.
 */

import { useRoundStore } from '../store/roundStore';

export interface ConversationTurn {
  role: 'user' | 'kevin';
  text: string;
  timestamp: number;
}

const MAX_TURNS = 6; // 3 user + 3 Kevin
const DECAY_MS = 60_000;

let buffer: ConversationTurn[] = [];
let lastActivityAt = 0;
let lastRoundActiveSeen: boolean | null = null;
let lastHoleSeen: number | null = null;

/**
 * Append a user utterance to the buffer. Updates lastActivityAt and
 * triggers decay-eviction of stale turns from any prior conversation.
 */
export function recordUserTurn(text: string): void {
  if (!text || !text.trim()) return;
  evictIfStale();
  buffer.push({ role: 'user', text: text.trim(), timestamp: Date.now() });
  if (buffer.length > MAX_TURNS) buffer = buffer.slice(-MAX_TURNS);
  lastActivityAt = Date.now();
}

/** Append Kevin's response to the buffer. */
export function recordKevinTurn(text: string): void {
  if (!text || !text.trim()) return;
  evictIfStale();
  buffer.push({ role: 'kevin', text: text.trim(), timestamp: Date.now() });
  if (buffer.length > MAX_TURNS) buffer = buffer.slice(-MAX_TURNS);
  lastActivityAt = Date.now();
}

/** Return up to 3 last user-Kevin pairs for system prompt injection. */
export function getRecentTurns(): ConversationTurn[] {
  evictIfStale();
  return [...buffer];
}

/** True if the buffer has any active turns (within decay window). */
export function isInActiveConversation(): boolean {
  evictIfStale();
  return buffer.length > 0;
}

/** Force-clear the buffer (e.g. on user-explicit close, or test setup). */
export function clearConversation(reason: string): void {
  if (buffer.length > 0) {
    console.log(`[conversation] cleared (${reason}) had ${buffer.length} turns`);
  }
  buffer = [];
  lastActivityAt = 0;
}

/**
 * Internal: evict the buffer if more than DECAY_MS has elapsed since
 * the last activity OR if round-state has changed since the last call.
 *
 * The round-state check is a soft signal — if isRoundActive flipped
 * (start/end) or currentHole changed since we last saw it, the prior
 * conversation context is unlikely to apply to the new context.
 */
function evictIfStale(): void {
  const now = Date.now();
  if (lastActivityAt > 0 && now - lastActivityAt > DECAY_MS) {
    if (buffer.length > 0) console.log('[conversation] decay - evicting buffer');
    buffer = [];
    lastActivityAt = 0;
  }
  try {
    const round = useRoundStore.getState();
    if (lastRoundActiveSeen != null && lastRoundActiveSeen !== round.isRoundActive) {
      if (buffer.length > 0) console.log('[conversation] round_state_change - evicting');
      buffer = [];
      lastActivityAt = 0;
    }
    if (lastHoleSeen != null && round.isRoundActive && lastHoleSeen !== round.currentHole) {
      if (buffer.length > 0) console.log('[conversation] hole_change - evicting');
      buffer = [];
      lastActivityAt = 0;
    }
    lastRoundActiveSeen = round.isRoundActive;
    lastHoleSeen = round.currentHole;
  } catch {
    // Round store not ready (test env / cold boot); skip the check.
  }
}
