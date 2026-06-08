/**
 * 2026-05-24 — Practice→Play bridge store.
 *
 * Persisted snapshot of the user's recent practice / cage-session
 * tendencies, consumed by the Golf Father Tank rules (services/intents/
 * askGolfFatherHandler.ts) to make "driver or 3-wood" / "flag or center"
 * style answers context-aware. Fed by mediaHandlers' swing-analysis
 * subscriber on every analyzed CageShot.
 *
 * Field origins:
 *   - swingCount, lastSessionDate: incremented per analyzed swing
 *   - overTheTopCount / fatShotCount: derived from BOTH the spec's
 *     metric fields (club_path, low_point — for future launch-monitor
 *     wiring) AND the real perShotAnalysis fields available today
 *     (detected_issue keywords + severity filter)
 *   - avgCarryDriver / avgCarry3Wood: only populates when carry_distance
 *     is present on the analysis (acoustic ball speed → carry estimate
 *     pipeline; not all swings have it). Mean is recomputed incrementally.
 *   - typicalMiss: 'right' / 'left' / 'straight' — best-effort from
 *     face_to_path numeric OR observation text keywords (brittle, but
 *     better than always 'straight')
 *
 * The store interface matches the spec verbatim; the body is adapted
 * to read fields that actually exist today on Phase K analyses, so
 * the counters accumulate real data instead of staying at 0. When the
 * pose-to-metric pipeline lands and emits club_path / low_point /
 * face_to_path / carry_distance, those branches will activate
 * automatically without an interface change.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

interface PracticeStats {
  lastSessionDate: number;
  swingCount: number;
  avgCarryDriver: number;
  avgCarry3Wood: number;
  typicalMiss: 'left' | 'right' | 'straight';
  overTheTopCount: number;
  fatShotCount: number;
  updateFromSwing: (analysis: unknown) => void;
  reset: () => void;
}

export const usePracticeStore = create<PracticeStats>()(
  persist(
    (set) => ({
      lastSessionDate: 0,
      swingCount: 0,
      avgCarryDriver: 0,
      avgCarry3Wood: 0,
      typicalMiss: 'straight',
      overTheTopCount: 0,
      fatShotCount: 0,
      updateFromSwing: (analysisInput) => set((state) => {
        const a = (analysisInput ?? {}) as Record<string, unknown>;

        // Spec metric fields (launch-monitor; not produced by Phase K yet).
        const clubPath = Number(a.club_path ?? a.clubPath ?? 0);
        const lowPoint = Number(a.low_point ?? a.lowPoint ?? 0);
        const carry = Number(a.carry_distance ?? a.carryDistance ?? 0);
        const faceToPath = Number(a.face_to_path ?? a.faceToPath ?? 0);
        const club = String(a.club ?? '').toLowerCase();

        // Real Phase K fields available today.
        const detectedIssue = String(a.detected_issue ?? '').toLowerCase();
        const severity = String(a.severity ?? '').toLowerCase();
        const observation = String(a.observation ?? '').toLowerCase();
        const isSignificantIssue = severity === 'moderate' || severity === 'significant';

        // OR'd detection: numeric metric (future) OR vision diagnosis (today).
        const isOverTheTop =
          clubPath > 3 ||
          (isSignificantIssue && (
            detectedIssue.includes('over_the_top') ||
            detectedIssue.includes('over-the-top') ||
            detectedIssue.includes('casting') ||
            detectedIssue.includes('outside_in')
          ));
        const isFat =
          lowPoint > 2 ||
          (isSignificantIssue && (
            detectedIssue.includes('fat') ||
            detectedIssue.includes('chunk') ||
            detectedIssue.includes('heavy_contact')
          ));

        // Miss direction — numeric face-to-path first, then observation
        // keywords. Falls back to existing typicalMiss to avoid flipping
        // on a single ambiguous swing.
        let nextTypicalMiss: 'left' | 'right' | 'straight' = state.typicalMiss;
        if (faceToPath > 3) nextTypicalMiss = 'right';
        else if (faceToPath < -3) nextTypicalMiss = 'left';
        else if (observation.includes('miss right') || observation.includes('block right') || observation.includes('push right')) nextTypicalMiss = 'right';
        else if (observation.includes('miss left') || observation.includes('pull left') || observation.includes('hook left')) nextTypicalMiss = 'left';

        const isDriver = club === 'driver' || club === 'd';
        const newSwingCount = state.swingCount + 1;

        return {
          lastSessionDate: Date.now(),
          swingCount: newSwingCount,
          avgCarryDriver: isDriver && carry > 0
            ? ((state.avgCarryDriver * state.swingCount + carry) / newSwingCount)
            : state.avgCarryDriver,
          avgCarry3Wood: !isDriver && carry > 0
            ? ((state.avgCarry3Wood * state.swingCount + carry) / newSwingCount)
            : state.avgCarry3Wood,
          overTheTopCount: isOverTheTop ? state.overTheTopCount + 1 : state.overTheTopCount,
          fatShotCount: isFat ? state.fatShotCount + 1 : state.fatShotCount,
          typicalMiss: nextTypicalMiss,
        };
      }),
      reset: () => set({
        lastSessionDate: 0,
        swingCount: 0,
        avgCarryDriver: 0,
        avgCarry3Wood: 0,
        typicalMiss: 'straight',
        overTheTopCount: 0,
        fatShotCount: 0,
      }),
    }),
    {
      name: 'practice-store',
      // 2026-05-26 Fix BZ — __BZ_baseline__ version + passthrough migrate so future
      // version bumps don't wipe state. Replace `as never` with the real
      // state type when adding actual migration logic.
      version: 1,
      migrate: (s) => s as never,
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
