/**
 * Phase 106 — Team Intelligence Store.
 *
 * Holds the team's "currently offered" suggestion plus per-trigger cooldown
 * state. Lives separately from settingsStore because:
 *   - It's high-frequency (per-event evaluation, not per-user-pref).
 *   - It's session-scoped for some fields (suggestionsThisSession),
 *     persistent for others (per-trigger decline counters).
 *   - It composes cleanly: the trigger-detection module reads from
 *     external data (cage history, round insights) and writes only the
 *     suggestion + cooldown state here.
 *
 * Persistence: only the per-trigger decline / cooldown table persists.
 * `pendingSuggestion` and `suggestionsThisSession` reset every cold launch
 * (they're per-app-session by design).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Persona, CaddiePillar } from './settingsStore';

export type SuggestionTrigger =
  | 'drill_plateau'        // drill no improvement N+ sessions
  | 'cage_frustration'     // multiple bad reps + frustration markers
  | 'mental_struggle'      // round struggle accumulation
  | 'tactical_to_mental'   // pattern mismatch (Coach voice when Psychologist is needed)
  | 'user_explicit_stuck'; // "I'm stuck" / "what do you think"

export interface CaddieSuggestion {
  id: string;                  // unique ID for this offer
  fromPersona: Persona;        // active caddie making the suggestion
  toPersona: Persona;          // suggested teammate
  trigger: SuggestionTrigger;  // why the suggestion fired
  reason: string;              // user-facing explanation in fromPersona's voice
  pillar: CaddiePillar;        // pillar this defer applies to
  createdAt: number;
}

interface TriggerCooldown {
  lastDeclinedAt: number;  // ms timestamp of last decline
  declineCount: number;    // running total of declines for this trigger
}

interface TeamIntelligenceState {
  // Session-scoped — reset on cold launch.
  pendingSuggestion: CaddieSuggestion | null;
  suggestionsThisSession: number;
  acceptedHandoffs: string[];  // suggestion IDs accepted (for return-to-original tracking)

  // Persisted — across-session learning.
  cooldowns: Record<SuggestionTrigger, TriggerCooldown>;

  // Actions
  offerSuggestion: (s: CaddieSuggestion) => void;
  acceptPendingSuggestion: () => CaddieSuggestion | null;
  declinePendingSuggestion: () => void;
  clearPending: () => void;
  isThrottled: (trigger: SuggestionTrigger) => boolean;
  resetSessionCounters: () => void;
}

const DEFAULT_COOLDOWNS: Record<SuggestionTrigger, TriggerCooldown> = {
  drill_plateau:       { lastDeclinedAt: 0, declineCount: 0 },
  cage_frustration:    { lastDeclinedAt: 0, declineCount: 0 },
  mental_struggle:     { lastDeclinedAt: 0, declineCount: 0 },
  tactical_to_mental:  { lastDeclinedAt: 0, declineCount: 0 },
  user_explicit_stuck: { lastDeclinedAt: 0, declineCount: 0 },
};

// Tunable thresholds (Phase 106 / Component 5). Conservative defaults;
// real values surface from empirical tuning once the trigger detection
// runs against actual user data.
export const TRIGGER_THRESHOLDS = {
  // Cooldown after a decline: don't re-offer the same trigger for 24h
  // by default. Heavily-declined triggers grow longer cooldowns.
  baseDeclineCooldownMs: 24 * 60 * 60 * 1000,
  // Per-decline backoff multiplier: 1st decline = 1×, 3rd decline = 3×, etc.
  perDeclineBackoffMultiplier: 1,
  // Max suggestions per app session (cold launch resets).
  maxSuggestionsPerSession: 1,
  // After N total declines for a trigger, reduce that trigger's
  // sensitivity (handled by detection layer, not the store).
  reduceAfterTotalDeclines: 5,
} as const;

export const useTeamIntelligenceStore = create<TeamIntelligenceState>()(
  persist(
    (set, get) => ({
      pendingSuggestion: null,
      suggestionsThisSession: 0,
      acceptedHandoffs: [],
      cooldowns: { ...DEFAULT_COOLDOWNS },

      offerSuggestion: (s) => set((state) => {
        // Phase 106 / C7 — per-session frequency cap.
        if (state.suggestionsThisSession >= TRIGGER_THRESHOLDS.maxSuggestionsPerSession) return {};
        // Don't replace an already-pending suggestion.
        if (state.pendingSuggestion) return {};
        return {
          pendingSuggestion: s,
          suggestionsThisSession: state.suggestionsThisSession + 1,
        };
      }),

      acceptPendingSuggestion: () => {
        const s = get().pendingSuggestion;
        if (!s) return null;
        set((state) => ({
          pendingSuggestion: null,
          acceptedHandoffs: [...state.acceptedHandoffs, s.id],
        }));
        return s;
      },

      declinePendingSuggestion: () => set((state) => {
        const s = state.pendingSuggestion;
        if (!s) return {};
        const cur = state.cooldowns[s.trigger] ?? { lastDeclinedAt: 0, declineCount: 0 };
        return {
          pendingSuggestion: null,
          cooldowns: {
            ...state.cooldowns,
            [s.trigger]: {
              lastDeclinedAt: Date.now(),
              declineCount: cur.declineCount + 1,
            },
          },
        };
      }),

      clearPending: () => set({ pendingSuggestion: null }),

      isThrottled: (trigger) => {
        const cur = get().cooldowns[trigger];
        if (!cur || cur.lastDeclinedAt === 0) return false;
        const backoff = TRIGGER_THRESHOLDS.baseDeclineCooldownMs *
          (1 + cur.declineCount * TRIGGER_THRESHOLDS.perDeclineBackoffMultiplier);
        return Date.now() - cur.lastDeclinedAt < backoff;
      },

      resetSessionCounters: () => set({
        suggestionsThisSession: 0,
        acceptedHandoffs: [],
        pendingSuggestion: null,
      }),
    }),
    {
      name: 'team-intelligence-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist cross-session state (cooldowns). Session-scoped
      // fields (pending suggestion, this-session counters) start fresh
      // on every cold launch.
      partialize: (s) => ({ cooldowns: s.cooldowns }),
    },
  ),
);
