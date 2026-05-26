/**
 * 2026-05-24 — GPS health store (Flow B + the optional owner debug card).
 *
 * Carries the state the confidence-gated proactive ask needs to do its
 * job AND the rolling record Tim reviews from the owner debug surface:
 *   - lastAccuracy_m / lastAccuracyAt: most-recent GPS quality reading
 *   - lastAsk: when + where + at-what-accuracy the orchestrator last
 *     fired the "what hole?" question, and whether the user answered
 *   - askedHolesThisRound: per-hole cooldown set so Kevin doesn't
 *     re-ask the same hole if accuracy stays soft
 *   - cooldownUntil: per-time cooldown so a long run of poor signal
 *     doesn't produce repeated asks even across hole changes
 *
 * Persisted so backgrounding the app doesn't reset cooldowns mid-round.
 * `askedHolesThisRound` is reset by the orchestrator on round-active
 * transitions (start / end), so a fresh round gets fresh asks.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export interface GpsAskRecord {
  /** ms epoch when the proactive ask was spoken. */
  at: number;
  /** Hole the player was on when the ask fired. Null when no active round. */
  hole: number | null;
  /** Accuracy_m at the moment of the ask. Null when OS didn't report. */
  accuracy_m: number | null;
  /** Reason the ask was triggered — today always 'poor_signal'. */
  reason: 'poor_signal';
}

interface GpsHealthState {
  /** Last GPS accuracy reading from the poor-signal subscriber. */
  lastAccuracy_m: number | null;
  lastAccuracyAt: number | null;
  /** The most-recent proactive ask. Null when none has fired this
   *  install (or after clear). Surfaced on the owner debug card. */
  lastAsk: GpsAskRecord | null;
  /** Hole numbers asked-about during the CURRENT round. Used as the
   *  per-hole cooldown — don't re-ask the same hole if accuracy stays
   *  soft, the player already knows. Cleared on round start / end. */
  askedHolesThisRound: number[];
  /** Cross-hole cooldown ms-epoch. Don't ask before this time even if
   *  the hole has changed. Default ~5 minutes; absorbs the
   *  "drove across the parking lot under trees" case where accuracy
   *  flaps. */
  cooldownUntil: number;

  recordAccuracy: (accuracy_m: number | null) => void;
  recordAsk: (record: GpsAskRecord, perTimeCooldownMs: number) => void;
  markHoleAsked: (hole: number) => void;
  clearRoundCooldowns: () => void;
  isHoleCooldownActive: (hole: number | null) => boolean;
  isTimeCooldownActive: () => boolean;
}

export const useGpsHealthStore = create<GpsHealthState>()(
  persist(
    (set, get) => ({
      lastAccuracy_m: null,
      lastAccuracyAt: null,
      lastAsk: null,
      askedHolesThisRound: [],
      cooldownUntil: 0,

      recordAccuracy: (accuracy_m) => {
        set({ lastAccuracy_m: accuracy_m, lastAccuracyAt: Date.now() });
      },
      recordAsk: (record, perTimeCooldownMs) => {
        set(s => ({
          lastAsk: record,
          cooldownUntil: Date.now() + perTimeCooldownMs,
          // Add the asked hole to the per-round set if non-null.
          askedHolesThisRound:
            record.hole != null && !s.askedHolesThisRound.includes(record.hole)
              ? [...s.askedHolesThisRound, record.hole]
              : s.askedHolesThisRound,
        }));
        console.log('[gpsHealth] recorded ask',
          'hole=', record.hole,
          'accuracy_m=', record.accuracy_m,
          'cooldownUntil=', new Date(Date.now() + perTimeCooldownMs).toISOString());
      },
      markHoleAsked: (hole) => {
        set(s => s.askedHolesThisRound.includes(hole)
          ? s
          : { askedHolesThisRound: [...s.askedHolesThisRound, hole] });
      },
      clearRoundCooldowns: () => {
        set({ askedHolesThisRound: [], cooldownUntil: 0 });
        console.log('[gpsHealth] cleared round cooldowns');
      },
      isHoleCooldownActive: (hole) => {
        if (hole == null) return false;
        return get().askedHolesThisRound.includes(hole);
      },
      isTimeCooldownActive: () => Date.now() < get().cooldownUntil,
    }),
    {
      name: 'gps-health-v1',
      // 2026-05-26 Fix BZ — __BZ_baseline__ version + passthrough migrate so future
      // version bumps don't wipe state. Replace `as never` with the real
      // state type when adding actual migration logic.
      version: 1,
      migrate: (s) => s as never,
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
