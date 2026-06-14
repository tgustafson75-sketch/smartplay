import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/**
 * 2026-06-13 — Conversation log (Tim: "we ingest what the caddie says and
 * everything that goes back and forth to learn").
 *
 * The self-growing agent learns from the whole DIALOGUE, not just structured
 * events. This is the capture layer: every caddie line (speak) and every
 * transcribed user line (captureUtterance) lands here as a turn, bounded + lightly
 * persisted. It is the LEARNING INPUT (a later distill pass summarizes it into the
 * CNS via caddieMemoryStore.recordReflection) AND it directly unblocks
 * "save those stretches as my routine" — lastCaddieText() is the thing to point at
 * (there was previously no conversation history to capture from).
 *
 * Pure store, never throws; logging is best-effort and must never block voice.
 */

export interface ConversationTurn {
  role: 'caddie' | 'user';
  text: string;
  at: number;
}

const MAX_TURNS = 60; // bounded recent-dialogue window — growth is capped

interface ConversationLogState {
  turns: ConversationTurn[];
  logCaddie: (text: string, at: number) => void;
  logUser: (text: string, at: number) => void;
  /** The most recent N turns (default 12) for distill / recall context. */
  recentTurns: (n?: number) => ConversationTurn[];
  /** The last contiguous run of caddie turns, JOINED — so a reply that was
   *  spoken in sentence chunks (speakChunked) rejoins into the full text.
   *  This is what "save those stretches" points at. */
  lastCaddieText: () => string | null;
  clear: () => void;
}

export const useConversationLog = create<ConversationLogState>()(
  persist(
    (set, get) => ({
      turns: [],
      logCaddie: (text, at) => {
        const t = (text ?? '').trim();
        if (!t) return;
        set((s) => ({ turns: [...s.turns, { role: 'caddie' as const, text: t, at }].slice(-MAX_TURNS) }));
      },
      logUser: (text, at) => {
        const t = (text ?? '').trim();
        if (!t) return;
        set((s) => ({ turns: [...s.turns, { role: 'user' as const, text: t, at }].slice(-MAX_TURNS) }));
      },
      recentTurns: (n = 12) => get().turns.slice(-n),
      lastCaddieText: () => {
        const turns = get().turns;
        const run: string[] = [];
        for (let i = turns.length - 1; i >= 0; i--) {
          if (turns[i].role === 'caddie') run.unshift(turns[i].text);
          else if (run.length > 0) break; // hit a user turn after collecting caddie run
        }
        return run.length > 0 ? run.join(' ') : null;
      },
      clear: () => set({ turns: [] }),
    }),
    {
      name: 'conversation-log',
      storage: createJSONStorage(() => getPersistStorage()),
      // 2026-06-14 (audit — store hygiene) — explicit version + passthrough migrate
      // so a future shape bump upgrades cleanly instead of wiping persisted state.
      version: 1,
      migrate: (s) => s as never,
    },
  ),
);
