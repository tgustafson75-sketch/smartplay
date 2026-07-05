/**
 * 2026-07-04 (Tim — offline "log statements ... ingested later if no good signal").
 *
 * Thin service over voiceLogStore: capture a statement the caddie brain couldn't
 * reach, and surface pending notes back to the caddie once signal returns.
 */

import { useVoiceLogStore } from '../store/voiceLogStore';
import { useRoundStore } from '../store/roundStore';

/**
 * Capture a statement that failed to reach the brain (dead signal) against the
 * current round so it isn't lost. Returns true if it captured something.
 */
export function captureOfflineStatement(transcript: string): boolean {
  const clean = (transcript ?? '').trim();
  if (clean.length < 2) return false;
  const round = useRoundStore.getState();
  useVoiceLogStore.getState().addPending(
    clean,
    round.isRoundActive ? round.currentHole : null,
    round.currentRoundId ?? null,
  );
  return true;
}

/**
 * A short context block of the current round's pending offline notes, so when signal
 * returns the live caddie KNOWS what the player said while offline and can fold it into
 * the conversation. PEEKS (does not mark ingested) — the notes stay pending so they
 * survive a failed turn and stay visible until the round ends. Empty when none.
 */
export function peekOfflineNotesBlock(): string {
  const round = useRoundStore.getState();
  const roundId = round.currentRoundId ?? null;
  const pending = useVoiceLogStore.getState().getPending(roundId);
  if (pending.length === 0) return '';
  const lines = pending
    .slice(-8)
    // 2026-07-04 (clean-audit M2) — cap each transcript so 8 long rambles can't
    // blow past the server's memory-block budget and evict the CNS.
    .map((e) => `- ${e.hole != null ? `hole ${e.hole}: ` : ''}"${e.transcript.slice(0, 160)}"`)
    .join('\n');
  return `WHILE OFFLINE the player said these (captured with no signal — acknowledge naturally + use them, don't re-ask):\n${lines}`;
}

/** Mark a round's pending notes ingested (called at round end — they persist for recap). */
export function markRoundNotesIngested(roundId: string | null): void {
  if (!roundId) return;
  const pending = useVoiceLogStore.getState().getPending(roundId);
  if (pending.length > 0) useVoiceLogStore.getState().markIngested(pending.map((e) => e.id));
}

/** Peek pending count without consuming (for a UI badge). */
export function pendingOfflineNoteCount(roundId?: string | null): number {
  return useVoiceLogStore.getState().getPending(roundId).length;
}
