import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VocabularyProfile } from '../types/vocabulary';

const STORAGE_KEY = 'vocabulary_profile_v1';

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function getCurrentProfile(): Promise<VocabularyProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as VocabularyProfile) : null;
  } catch {
    return null;
  }
}

export async function saveProfile(profile: VocabularyProfile): Promise<void> {
  // Audit 101 / S5 — wrap so quota / OS-denial errors don't propagate
  // unhandled to fire-and-forget callers.
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.warn('[vocabularyProfile] saveProfile failed:', err);
  }
}

export async function clearProfile(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[vocabularyProfile] clearProfile failed:', err);
  }
}

// ─── Merge ────────────────────────────────────────────────────────────────────

export function mergeProfile(
  existing: VocabularyProfile | null,
  incoming: VocabularyProfile,
): VocabularyProfile {
  if (!existing) return incoming;

  const dedupeConcat = (a: string[], b: string[]) =>
    [...new Set([...a, ...b])];

  return {
    ...incoming,
    total_clips_reviewed: existing.total_clips_reviewed + incoming.total_clips_reviewed,
    observed_terminology: {
      strike_terms:     dedupeConcat(existing.observed_terminology.strike_terms,     incoming.observed_terminology.strike_terms),
      contact_terms:    dedupeConcat(existing.observed_terminology.contact_terms,    incoming.observed_terminology.contact_terms),
      diagnostic_terms: dedupeConcat(existing.observed_terminology.diagnostic_terms, incoming.observed_terminology.diagnostic_terms),
      feel_terms:       dedupeConcat(existing.observed_terminology.feel_terms,       incoming.observed_terminology.feel_terms),
    },
  };
}

// ─── Build profile from API response (called after endReviewSession) ──────────

export async function saveGeneratedProfile(
  raw: {
    observed_terminology: VocabularyProfile['observed_terminology'];
    kevin_summary: string;
    total_clips_reviewed: number;
  },
): Promise<VocabularyProfile> {
  const incoming: VocabularyProfile = {
    user_id: 'primary',
    generated_at: Date.now(),
    total_clips_reviewed: raw.total_clips_reviewed,
    observed_terminology: raw.observed_terminology,
    kevin_summary: raw.kevin_summary,
  };

  const existing = await getCurrentProfile();
  const merged = mergeProfile(existing, incoming);
  await saveProfile(merged);
  return merged;
}
