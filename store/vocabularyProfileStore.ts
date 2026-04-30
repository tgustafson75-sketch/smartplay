import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface VocabularyEntry {
  phrase: string;            // raw user phrase, lowercased and trimmed
  count: number;             // how many times said
  meaning_signature: string; // compact stringified version of the parsed result it mapped to
  last_used: number;         // ms timestamp
  was_corrected?: boolean;   // user later corrected this; weighting decreases
}

interface VocabularyState {
  entries: Record<string, VocabularyEntry>;
  totalShotsParsed: number;

  recordPhrase: (phrase: string, signature: string) => void;
  recordCorrection: (phrase: string) => void;
  getTopPhrases: (limit?: number) => string[];
  reset: () => void;
}

export const useVocabularyProfileStore = create<VocabularyState>()(
  persist(
    (set, get) => ({
      entries: {},
      totalShotsParsed: 0,

      recordPhrase: (phrase, signature) => {
        const key = phrase.toLowerCase().trim();
        if (!key) return;
        const now = Date.now();
        set(s => {
          const existing = s.entries[key];
          const next: VocabularyEntry = existing
            ? { ...existing, count: existing.count + 1, last_used: now, meaning_signature: signature }
            : { phrase: key, count: 1, meaning_signature: signature, last_used: now };
          return {
            entries: { ...s.entries, [key]: next },
            totalShotsParsed: s.totalShotsParsed + 1,
          };
        });
      },

      recordCorrection: (phrase) => {
        const key = phrase.toLowerCase().trim();
        if (!key) return;
        set(s => {
          const existing = s.entries[key];
          if (!existing) return s;
          return {
            ...s,
            entries: {
              ...s.entries,
              [key]: { ...existing, was_corrected: true, count: Math.max(0, existing.count - 1) },
            },
          };
        });
      },

      getTopPhrases: (limit = 20) => {
        const all = Object.values(get().entries);
        return all
          .filter(e => !e.was_corrected || e.count >= 3)
          .sort((a, b) => b.count - a.count || b.last_used - a.last_used)
          .slice(0, limit)
          .map(e => e.phrase);
      },

      reset: () => set({ entries: {}, totalShotsParsed: 0 }),
    }),
    {
      name: 'vocabulary-profile-v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
