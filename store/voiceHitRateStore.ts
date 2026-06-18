import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 2026-06-16 (Tim — self-growing agent metric) — the health metric of a LOCAL-FIRST
 * caddie: how often a spoken ask is answered ON-DEVICE (instant, offline, 0-token) vs
 * ESCALATED to the cloud (classifier and/or brain). Per [[self-growing-agent-architecture]]
 * this ratio should trend UP round over round as the brain (CNS memory) grows.
 *
 * Recorded at the decision points in services/listeningSession.ts:
 *   - 'local'  → precheck hit (instant command/tool) OR local-primary (tryLocalReply)
 *   - 'cloud'  → the cloud classifier and/or /api/kevin brain was needed
 *
 * Persisted so the trend accumulates across sessions. Bounded (just counters + a small
 * recent-detail ring), so no storage growth concern. Pure observation — it never gates
 * or alters the voice path.
 */

const MAX_RECENT = 30;

export interface VoiceHitEntry {
  kind: 'local' | 'cloud';
  detail: string; // e.g. 'local_primary:yardage_middle', 'precheck:open_tool', 'cloud:brain'
  at: number;
}

interface VoiceHitRateState {
  local: number;
  cloud: number;
  recent: VoiceHitEntry[];
  recordLocal: (detail: string, now: number) => void;
  recordCloud: (detail: string, now: number) => void;
  reset: () => void;
  localPct: () => number; // 0-100; 0 when no data
}

export const useVoiceHitRateStore = create<VoiceHitRateState>()(
  persist(
    (set, get) => ({
      local: 0,
      cloud: 0,
      recent: [],

      recordLocal: (detail, now) =>
        set(s => ({
          local: s.local + 1,
          recent: [{ kind: 'local' as const, detail, at: now }, ...s.recent].slice(0, MAX_RECENT),
        })),

      recordCloud: (detail, now) =>
        set(s => ({
          cloud: s.cloud + 1,
          recent: [{ kind: 'cloud' as const, detail, at: now }, ...s.recent].slice(0, MAX_RECENT),
        })),

      reset: () => set({ local: 0, cloud: 0, recent: [] }),

      localPct: () => {
        const { local, cloud } = get();
        const total = local + cloud;
        return total === 0 ? 0 : Math.round((local / total) * 100);
      },
    }),
    {
      name: 'voice-hit-rate-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // 2026-06-16 — passthrough migrate (audit pattern): protects the counters on a
      // future shape bump instead of silently wiping them.
      migrate: (s) => s as never,
      partialize: (s) => ({ local: s.local, cloud: s.cloud, recent: s.recent }),
    },
  ),
);
