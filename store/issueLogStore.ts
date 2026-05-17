/**
 * Owner-only issue log.
 *
 * 2026-05-17 — Tim asked: "is it possible with only my login that I
 * can talk to Kevin about issues with the app and then they are
 * stored somewhere so that when we come back to this, we can review
 * that file?... a real time IT assistant in the background would
 * make testing pretty powerful."
 *
 * Implementation: a separate Zustand store keyed by entry id. Persisted
 * to AsyncStorage so entries survive app restarts. Capped at 100
 * entries (FIFO) so a runaway debug session can't bloat storage.
 *
 * Entries are written by the voice intent `log_issue` (handler picks up
 * "Kevin, log this..." / "log an issue..." / "I have feedback..." and
 * captures the rest of the utterance as the note). Settings exposes
 * an "Owner Logs" surface for Tim to review + copy + clear.
 *
 * Gated to the owner email via isOwnerEmail() in the voice intent
 * registration step — non-owner installs don't see the surface and
 * the intent silently no-ops.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export interface IssueLogEntry {
  /** Stable id: `${timestamp}_${random}`. */
  id: string;
  /** ms-since-epoch when the user spoke / typed the entry. */
  timestamp: number;
  /** The actual note text. From voice: the user's full utterance with
   *  the wake phrase stripped. From manual: the typed text verbatim. */
  text: string;
  /** Context snapshot at capture time. Helps later diagnosis without
   *  having to ask the user "where were you when you saw this?". */
  context: {
    route: string | null;
    persona: string | null;
    isRoundActive: boolean;
    courseId: string | null;
    currentHole: number | null;
    appVersion: string;
  };
}

interface IssueLogState {
  entries: IssueLogEntry[];
  addEntry: (text: string, context: IssueLogEntry['context']) => void;
  clearAll: () => void;
  remove: (id: string) => void;
}

const MAX_ENTRIES = 100;

export const useIssueLogStore = create<IssueLogState>()(
  persist(
    (set) => ({
      entries: [],
      addEntry: (text, context) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const entry: IssueLogEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          text: trimmed,
          context,
        };
        set(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
        console.log('[issueLog] new entry:', trimmed.slice(0, 80));
      },
      clearAll: () => set({ entries: [] }),
      remove: (id) => set(s => ({ entries: s.entries.filter(e => e.id !== id) })),
    }),
    {
      name: 'issue-log-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
