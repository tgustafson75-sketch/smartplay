/**
 * 2026-05-24 — Player calibration profile store.
 *
 * Keyed by player_id (the data-model rule from types/cage.ts:3,
 * cage-store ingest derivation, and the Coach Mode scan-student flow).
 * One profile per player: typed height + per-player pixel scale +
 * limb proportions + address-posture baseline. Survives across
 * sessions via AsyncStorage so a single scan calibrates every
 * future swing for that player.
 *
 * Persisted shape: `Record<player_id, PlayerCalibrationProfile>`.
 * Same pattern as services/courseGreenOverrides + courseTeeOverrides
 * (small key-value persisted maps); could've used Zustand persist
 * here too — chose Zustand for store-shape symmetry with the other
 * cage / family stores and so the UI subscribes via hook.
 *
 * Down-pipeline integration is NEXT — this run is foundation only.
 * swingMetricsService is intentionally untouched until the
 * calibration profile is consumed by it in a follow-up.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { PlayerCalibrationProfile } from '../services/playerCalibration';

interface PlayerCalibrationState {
  /** Map of player_id → profile. */
  profiles: Record<string, PlayerCalibrationProfile>;
  setProfile: (profile: PlayerCalibrationProfile) => void;
  getProfile: (playerId: string) => PlayerCalibrationProfile | null;
  clearProfile: (playerId: string) => void;
  listProfiles: () => PlayerCalibrationProfile[];
}

export const usePlayerCalibrationStore = create<PlayerCalibrationState>()(
  persist(
    (set, get) => ({
      profiles: {},
      setProfile: (profile) => {
        if (!profile.player_id || profile.player_id.length === 0) return;
        set(s => ({ profiles: { ...s.profiles, [profile.player_id]: profile } }));
        console.log('[playerCalibration] stored profile for', profile.player_id,
          '· height', profile.height_cm, 'cm',
          '· scale', profile.scale_cm_per_pixel.toFixed(3), 'cm/px',
          '· spine', profile.posture_baseline.spine_angle_deg + '°');
      },
      getProfile: (playerId) => {
        if (!playerId) return null;
        return get().profiles[playerId] ?? null;
      },
      clearProfile: (playerId) => {
        if (!playerId) return;
        set(s => {
          const next = { ...s.profiles };
          delete next[playerId];
          return { profiles: next };
        });
      },
      listProfiles: () => Object.values(get().profiles).sort((a, b) => b.scanned_at - a.scanned_at),
    }),
    {
      name: 'player-calibration-v1',
      // 2026-05-26 Fix BZ — __BZ_baseline__ version + passthrough migrate so future
      // version bumps don't wipe state. Replace `as never` with the real
      // state type when adding actual migration logic.
      version: 1,
      migrate: (s) => s as never,
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
