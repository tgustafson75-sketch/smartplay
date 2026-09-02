/**
 * THE conversation history — one rolling thread every mic path reads and writes.
 *
 * 2026-09-01 — renamed off "pipecat". The route that word came from is deleted; this module was
 * never pipecat-specific, it is simply the caddie's memory of the current conversation, and leaving
 * the old name on it kept implying a second path that no longer exists.
 *
 * 2026-07-01 (audit — MIC CONVERGENCE) — there used to be TWO disjoint pipecat
 * histories: useCaddieTabMic.historyRef (caddie-tab mic) and
 * conversationalBrain.pipecatHistory (earbud / badge / watch). They never shared,
 * so the caddie "forgot" the conversation when you switched mics, and NEITHER was
 * ever cleared → context leaked across rounds/sessions forever.
 *
 * This is the ONE rolling history every mic path reads + writes, cleared on round
 * boundaries (roundStore.startRound) so each round is a fresh conversation.
 */

export interface ConversationMessage {
  role: string;
  content: string;
}

/** Keep the last ~6 exchanges (12 messages) — matches the old per-path caps. */
const MAX_MESSAGES = 12;

let history: ConversationMessage[] = [];

export function getConversationHistory(): ConversationMessage[] {
  return history;
}

/** Replace the whole history (e.g. from the server's updated_history), capped. */
export function setConversationHistory(next: ConversationMessage[] | undefined | null): void {
  history = Array.isArray(next) ? next.slice(-MAX_MESSAGES) : [];
}

/** Append one user+assistant exchange when the server didn't return a full history. */
export function appendConversationTurn(userText: string, assistantText: string): void {
  history = [
    ...history,
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText },
  ].slice(-MAX_MESSAGES);
}

/** Wipe the shared history (round boundary / explicit reset). */
export function clearConversationHistory(): void {
  history = [];
}
