/**
 * Shared pipecat conversation history.
 *
 * 2026-07-01 (audit — MIC CONVERGENCE) — there used to be TWO disjoint pipecat
 * histories: usePipecatVoice.historyRef (caddie-tab mic) and
 * conversationalBrain.pipecatHistory (earbud / badge / watch). They never shared,
 * so the caddie "forgot" the conversation when you switched mics, and NEITHER was
 * ever cleared → context leaked across rounds/sessions forever.
 *
 * This is the ONE rolling history every mic path reads + writes, cleared on round
 * boundaries (roundStore.startRound) so each round is a fresh conversation.
 */

export interface PipecatMessage {
  role: string;
  content: string;
}

/** Keep the last ~6 exchanges (12 messages) — matches the old per-path caps. */
const MAX_MESSAGES = 12;

let history: PipecatMessage[] = [];

export function getPipecatHistory(): PipecatMessage[] {
  return history;
}

/** Replace the whole history (e.g. from the server's updated_history), capped. */
export function setPipecatHistory(next: PipecatMessage[] | undefined | null): void {
  history = Array.isArray(next) ? next.slice(-MAX_MESSAGES) : [];
}

/** Append one user+assistant exchange when the server didn't return a full history. */
export function appendPipecatTurn(userText: string, assistantText: string): void {
  history = [
    ...history,
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText },
  ].slice(-MAX_MESSAGES);
}

/** Wipe the shared history (round boundary / explicit reset). */
export function clearPipecatHistory(): void {
  history = [];
}
