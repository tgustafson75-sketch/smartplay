import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/**
 * 2026-06-13 — Self-growing-agent telemetry (Tim's standing rule:
 * [[self-growing-agent-architecture]]).
 *
 * The Caddie should answer more and more LOCALLY over time (deterministic logic +
 * learned CNS memory) and ping the cloud AI less. This counter is the health
 * metric of that growth: every voice query is tagged local-answered vs
 * cloud-escalated, PERSISTED so it accumulates round over round. The local
 * hit-rate should trend UP as the brain grows — you can literally watch the agent
 * get cheaper, faster, and more offline-capable.
 *
 * Pure counters; never throws; zero cost. Wired at the router's local-vs-cloud
 * fork (voiceCommandRouter): precheck match → local; fell through to the cloud
 * classifier → cloud.
 */

interface AgentBrainStatsState {
  /** Queries the local brain answered with NO cloud call (0 tokens). */
  localAnswered: number;
  /** Queries that had to escalate to the cloud AI (token + network cost). */
  cloudEscalated: number;
  /** Epoch ms the counters were last reset (for "since" framing). */
  since: number;
  noteLocal: () => void;
  noteCloud: () => void;
  /** A query first counted as cloud (precheck missed) but then ANSWERED locally by
   *  the memory-backed fallback (tryLocalReply) — move it cloud→local so the metric
   *  reflects memory growth, not just the static regex precheck. */
  reclassifyCloudToLocal: () => void;
  /** Fraction 0..1 of queries answered locally. 0 when no data yet. */
  localHitRate: () => number;
  reset: (now: number) => void;
}

export const useAgentBrainStats = create<AgentBrainStatsState>()(
  persist(
    (set, get) => ({
      localAnswered: 0,
      cloudEscalated: 0,
      since: 0,
      noteLocal: () => set((s) => ({ localAnswered: s.localAnswered + 1 })),
      noteCloud: () => set((s) => ({ cloudEscalated: s.cloudEscalated + 1 })),
      reclassifyCloudToLocal: () => set((s) => ({
        cloudEscalated: Math.max(0, s.cloudEscalated - 1),
        localAnswered: s.localAnswered + 1,
      })),
      localHitRate: () => {
        const { localAnswered, cloudEscalated } = get();
        const total = localAnswered + cloudEscalated;
        return total > 0 ? localAnswered / total : 0;
      },
      reset: (now) => set({ localAnswered: 0, cloudEscalated: 0, since: now }),
    }),
    {
      name: 'agent-brain-stats',
      storage: createJSONStorage(() => getPersistStorage()),
      // 2026-06-14 (audit — store hygiene) — explicit version + passthrough migrate
      // so a future shape bump has a safe upgrade path instead of silently wiping
      // persisted state (zustand discards state whose version is behind with no migrate).
      version: 1,
      migrate: (s) => s as never,
    },
  ),
);
