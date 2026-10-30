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
  /**
   * When it was said (ms). 2026-10-28 (Brain review r2) — the payload builder merges this thread with
   * services/conversationState (which holds the router's command replies) and must put the two in the
   * order they happened; without a time, every command turn landed after every brain turn.
   */
  at?: number;
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

/** Append one user+assistant exchange: the question when it was asked, the answer when it came. */
export function appendConversationTurn(userText: string, assistantText: string, askedAt: number = Date.now(), answeredAt: number = Date.now()): void {
  history = [
    ...history,
    { role: 'user', content: userText, at: askedAt },
    { role: 'assistant', content: assistantText, at: answeredAt },
  ].slice(-MAX_MESSAGES);
}

/**
 * Remove ONE exchange askCaddie appended — the most recent user/assistant pair matching both texts —
 * leaving everything around it. 2026-09-28: proactive lines used to REPLACE the whole history to drop
 * their directive, which also wiped any real exchange the player had while the line was generating.
 */
export function removeConversationExchange(userText: string, assistantText: string): void {
  for (let i = history.length - 2; i >= 0; i--) {
    const u = history[i];
    const a = history[i + 1];
    if (u.role === 'user' && u.content === userText && a.role === 'assistant' && a.content === assistantText) {
      history = [...history.slice(0, i), ...history.slice(i + 2)];
      return;
    }
  }
}

/**
 * 2026-10-29 (Brain recheck r13) — counts every clear. A caller that asked BEFORE a clear and is answered
 * AFTER it compares the count and files nothing: that answer belongs to a thread that has ended.
 */
let clears = 0;
export function getConversationClearCount(): number {
  return clears;
}

/** Wipe the shared history (round boundary / explicit reset). */
export function clearConversationHistory(): void {
  history = [];
  clears++;
}
