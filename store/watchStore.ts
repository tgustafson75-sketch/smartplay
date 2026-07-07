import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { HealthSnapshot } from '../services/healthData';

// ─── TYPES ────────────────────────────────

export interface SwingMetrics {
  backswingMs: number;
  downswingMs: number;
  tempoRatio: number;
  peakWristSpeed: number;
  wristAcceleration: number;
  impactAcceleration: number;
  transitionDetected: boolean;
  earlyTransition: boolean;
  tempoGood: boolean;
  clubHeadSpeedEst: number;
  timestamp: number;
  club: string;
}

export interface WatchSession {
  swings: SwingMetrics[];
  averageTempo: number;
  averageClubSpeed: number;
  earlyTransitionRate: number;
  dominantTempoFault: 'too fast' | 'too slow' | 'inconsistent' | 'good' | null;
}

// ─── STATE ────────────────────────────────

interface WatchState {
  isConnected: boolean;
  deviceName: string | null;
  lastHeartbeat: number | null;
  lastHealthSyncAt: number | null;
  lastHealthSnapshot: HealthSnapshot | null;
  lastSwing: SwingMetrics | null;
  isSwingDetected: boolean;
  sessionSwings: SwingMetrics[];

  setConnected: (connected: boolean, deviceName?: string) => void;
  setHealthSnapshot: (snapshot: HealthSnapshot | null) => void;
  recordSwing: (metrics: Omit<SwingMetrics, 'timestamp'>) => void;
  clearSession: () => void;
  getSessionSummary: () => WatchSession | null;
  setSwingDetected: (detected: boolean) => void;
}

// ─── STORE ────────────────────────────────

export const useWatchStore = create<WatchState>()(
  persist(
    (set, get) => ({
      isConnected: false,
      deviceName: null,
      lastHeartbeat: null,
      lastHealthSyncAt: null,
      lastHealthSnapshot: null,
      lastSwing: null,
      isSwingDetected: false,
      sessionSwings: [],

      setConnected: (connected, deviceName) =>
        set({
          isConnected: connected,
          deviceName: deviceName ?? null,
          lastHeartbeat: connected ? Date.now() : null,
        }),

      setHealthSnapshot: (snapshot) =>
        set({
          lastHealthSnapshot: snapshot,
          lastHealthSyncAt: snapshot?.hasData ? Date.now() : null,
        }),

      recordSwing: (metrics) => {
        const swing: SwingMetrics = { ...metrics, timestamp: Date.now() };
        set(s => ({
          lastSwing: swing,
          isSwingDetected: true,
          sessionSwings: [...s.sessionSwings, swing],
        }));
        setTimeout(() => set({ isSwingDetected: false }), 3000);
      },

      clearSession: () => set({ sessionSwings: [], lastSwing: null }),

      setSwingDetected: (detected) => set({ isSwingDetected: detected }),

      getSessionSummary: () => {
        const swings = get().sessionSwings;
        if (swings.length === 0) return null;

        const avgTempo = swings.reduce((a, s) => a + s.tempoRatio, 0) / swings.length;
        const avgSpeed = swings.reduce((a, s) => a + s.clubHeadSpeedEst, 0) / swings.length;
        const earlyCount = swings.filter(s => s.earlyTransition).length;
        const earlyRate = earlyCount / swings.length;

        const tooFastCount = swings.filter(s => s.tempoRatio < 2.5).length;
        const tooSlowCount = swings.filter(s => s.tempoRatio > 3.5).length;
        const goodCount = swings.filter(s => s.tempoGood).length;

        let dominantFault: WatchSession['dominantTempoFault'] = null;
        if (goodCount / swings.length > 0.7) {
          dominantFault = 'good';
        } else if (tooFastCount > tooSlowCount) {
          dominantFault = 'too fast';
        } else if (tooSlowCount > tooFastCount) {
          dominantFault = 'too slow';
        } else {
          dominantFault = 'inconsistent';
        }

        return {
          swings,
          averageTempo: avgTempo,
          averageClubSpeed: avgSpeed,
          earlyTransitionRate: earlyRate,
          dominantTempoFault: dominantFault,
        };
      },
    }),
    {
      name: 'watch-store-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      // Audit follow-up — explicit version + migrate added defensively.
      version: 1,
      migrate: (persisted) => persisted as WatchState,
      // 2026-07-07 (audit) — do NOT persist isConnected: it's ephemeral BLE/hardware
      // state and there was no boot-time reset, so a stale `true` rehydrated as a
      // phantom "Watch On" badge on every cold start when nothing was connected. Only
      // deviceName is durable; isConnected starts false and flips on the live event.
      partialize: (s) => ({
        deviceName: s.deviceName,
      }),
    },
  ),
);
