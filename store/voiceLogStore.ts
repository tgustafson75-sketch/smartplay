/**
 * 2026-07-04 (Tim — "when all else fails, I need to be able to log statements with the
 * caddie that are stored for the rounds and ingested later if no good signal exists").
 *
 * When the caddie brain can't be reached (dead signal on-course — Tim's Dudley Hills
 * holes 3-4), whatever the player said is CAPTURED here against the round instead of
 * lost. The caddie gives a brief device-TTS confirmation so the player knows it landed.
 * When signal returns the pending notes are surfaced to the live caddie as context and
 * shown in the round recap ("ingested later").
 *
 * Persisted so a note survives an app kill / a long outage / a battery-saver reload.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export interface VoiceLogEntry {
  id: string;
  /** Exactly what the player said (raw transcript). */
  transcript: string;
  /** Hole they were on when captured (null = not in a round). */
  hole: number | null;
  /** Round this belongs to (null = captured outside a round). */
  roundId: string | null;
  capturedAt: number;
  /** 'pending' until the caddie has seen it online; then 'ingested'. */
  status: 'pending' | 'ingested';
}

interface VoiceLogState {
  entries: VoiceLogEntry[];
  /** Capture a statement that couldn't reach the brain. Returns the new entry. */
  addPending: (transcript: string, hole: number | null, roundId: string | null) => VoiceLogEntry;
  /** Mark specific entries ingested (seen by the caddie / folded into the round). */
  markIngested: (ids: string[]) => void;
  /** Pending entries (optionally for a specific round). */
  getPending: (roundId?: string | null) => VoiceLogEntry[];
  /** All entries for a round (pending + ingested), oldest first — for recap. */
  forRound: (roundId: string) => VoiceLogEntry[];
  /**
   * 2026-10-31 (Brain recheck r22, BRAIN-ENG-A) — the instant read just before the last answered brain turn's body was built.
   * A note captured after it has not been sent yet; every note captured at or before it was in that body.
   */
  deliveredAt: number;
  /** Advance the watermark after a brain turn that answered. Only ever moves forward. */
  markDelivered: (at: number) => void;
}

const MAX_ENTRIES = 200;

export const useVoiceLogStore = create<VoiceLogState>()(
  persist(
    (set, get) => ({
      entries: [],
      addPending: (transcript, hole, roundId) => {
        const entry: VoiceLogEntry = {
          id: `vl_${Date.now()}_${Math.floor(Math.random() * 1e6).toString(36)}`,
          transcript: transcript.trim(),
          hole,
          roundId,
          capturedAt: Date.now(),
          status: 'pending',
        };
        set((s) => ({ entries: [...s.entries, entry].slice(-MAX_ENTRIES) }));
        return entry;
      },
      markIngested: (ids) => {
        if (ids.length === 0) return;
        const set2 = new Set(ids);
        set((s) => ({ entries: s.entries.map((e) => (set2.has(e.id) ? { ...e, status: 'ingested' } : e)) }));
      },
      getPending: (roundId) =>
        get().entries.filter((e) => e.status === 'pending' && (roundId === undefined || e.roundId === roundId)),
      forRound: (roundId) =>
        get().entries.filter((e) => e.roundId === roundId).sort((a, b) => a.capturedAt - b.capturedAt),
      deliveredAt: 0,
      markDelivered: (at) => {
        if (Number.isFinite(at) && at > get().deliveredAt) set({ deliveredAt: at });
      },
    }),
    {
      name: 'voice-log-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      version: 1,
      migrate: (p) => p as VoiceLogState,
      partialize: (s) => ({ entries: s.entries, deliveredAt: s.deliveredAt }),
    },
  ),
);
