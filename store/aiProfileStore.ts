// Persisted Zustand store for the AI-learned player profile.
// Updated only after a round ends — never read or written during live gameplay.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RoundSummary } from '../services/localLearning';

export type MissBias = 'right' | 'left' | 'straight' | null;
export type AiConfidence = 'low' | 'medium' | 'high' | null;

export interface AiPlayerProfile {
  missBias: MissBias;
  confidence: AiConfidence;
  /** Per-club micro-tips from AI: { 'Driver': 'Aim left of target', ... } */
  clubAdjustments: Record<string, string>;
  /** One-sentence coach note from last analysis */
  coachNote: string;
  /** ISO timestamp of last successful AI analysis */
  lastUpdated: string | null;
  /** How many rounds have fed into this profile */
  roundCount: number;
  /** Total completed rounds — drives experience tier */
  roundsPlayed: number;
  /** Compact per-round summaries for decay-weighted historical bias (max 5) */
  roundHistory: RoundSummary[];
}

interface AiProfileState extends AiPlayerProfile {
  applyInsight: (insight: Omit<AiPlayerProfile, 'lastUpdated' | 'roundCount' | 'roundsPlayed' | 'roundHistory'>) => void;
  /** Call once when a round ends. Persists summary + increments roundsPlayed. */
  addRoundHistory: (summary: RoundSummary) => void;
  reset: () => void;
}

const DEFAULT: AiPlayerProfile = {
  missBias: null,
  confidence: null,
  clubAdjustments: {},
  coachNote: '',
  lastUpdated: null,
  roundCount: 0,
  roundsPlayed: 0,
  roundHistory: [],
};

export const useAiProfileStore = create<AiProfileState>()(
  persist(
    (set) => ({
      ...DEFAULT,

      applyInsight: (insight) =>
        set((state) => ({
          missBias:        insight.missBias,
          confidence:      insight.confidence,
          // Merge club adjustments — new data wins per club
          clubAdjustments: { ...state.clubAdjustments, ...insight.clubAdjustments },
          coachNote:       insight.coachNote,
          lastUpdated:     new Date().toISOString(),
          roundCount:      state.roundCount + 1,
        })),

      addRoundHistory: (summary) =>
        set((state) => {
          // Keep last 5 rounds; oldest dropped
          const updated = [...state.roundHistory, summary].slice(-5);
          return {
            roundHistory:  updated,
            roundsPlayed:  state.roundsPlayed + 1,
          };
        }),

      reset: () => set(DEFAULT),
    }),
    {
      name: 'smartplay-ai-profile',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

/**
 * Returns a subtle hint string based on the AI profile to blend into caddie advice.
 * Empty string if confidence is too low or no data yet.
 */
export function buildAiHint(profile: AiPlayerProfile, club: string): string {
  if (!profile.missBias || !profile.confidence) return '';
  // Only surface 'medium' or 'high' confidence insights
  if (profile.confidence === 'low') return '';

  const parts: string[] = [];

  if (profile.missBias === 'right') {
    parts.push('Favor left');
  } else if (profile.missBias === 'left') {
    parts.push('Favor right');
  }

  // Per-club adjustment if available
  const clubTip = profile.clubAdjustments[club];
  if (clubTip) parts.push(clubTip);

  return parts.join('. ');
}
