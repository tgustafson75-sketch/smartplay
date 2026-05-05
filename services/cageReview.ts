import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReviewSession } from '../types/cageReview';
import type { CageShot } from '../store/cageStore';

const STORAGE_KEY = 'cage_review_sessions_v1';

// ─── Persistence ──────────────────────────────────────────────────────────────

async function loadSessions(): Promise<ReviewSession[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReviewSession[]) : [];
  } catch {
    return [];
  }
}

async function saveSessions(sessions: ReviewSession[]): Promise<void> {
  // Audit 101 / S5 — wrap AsyncStorage write so quota / OS-denial errors
  // surface in the log instead of propagating unhandled to fire-and-forget
  // callers (startReviewSession / updateReviewSession / endReviewSession).
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.warn('[cageReview] saveSessions failed:', err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function startReviewSession(
  cage_session_id: string,
  mode: ReviewSession['mode'],
): Promise<ReviewSession> {
  const session: ReviewSession = {
    id: Date.now().toString() + '_review',
    cage_session_id,
    mode,
    started_at: Date.now(),
    completed_at: null,
    current_shot_index: 0,
    shots_reviewed: [],
    vocabulary_observations: [],
  };
  const all = await loadSessions();
  await saveSessions([...all, session]);
  return session;
}

export async function getReviewSession(id: string): Promise<ReviewSession | null> {
  const all = await loadSessions();
  return all.find(s => s.id === id) ?? null;
}

export async function updateReviewSession(updated: ReviewSession): Promise<void> {
  const all = await loadSessions();
  await saveSessions(all.map(s => (s.id === updated.id ? updated : s)));
}

export async function endReviewSession(id: string): Promise<ReviewSession> {
  const all = await loadSessions();
  const session = all.find(s => s.id === id);
  if (!session) throw new Error('Review session not found: ' + id);
  const completed: ReviewSession = { ...session, completed_at: Date.now() };
  await saveSessions(all.map(s => (s.id === id ? completed : s)));
  return completed;
}

export async function listReviewSessions(): Promise<ReviewSession[]> {
  return loadSessions();
}

// ─── Mode-aware shot selection ────────────────────────────────────────────────

export function getShotsForReview(
  mode: ReviewSession['mode'],
  shots: CageShot[],
): CageShot[] {
  if (shots.length === 0) return [];

  switch (mode) {
    case 'quick':
      return shots;

    case 'coach': {
      const selected = new Set<number>();
      selected.add(0);
      selected.add(shots.length - 1);
      for (let i = 4; i < shots.length - 1; i += 5) selected.add(i);
      shots.forEach((s, i) => {
        if (s.clipUri || (!s.feel && !s.contact)) selected.add(i);
      });
      return shots.filter((_, i) => selected.has(i));
    }

    case 'skim':
      return shots.filter(s => !s.review_labels);
  }
}

export function nextUnreviewedShot(
  review: ReviewSession,
  eligibleShots: CageShot[],
): CageShot | null {
  return eligibleShots.find(s => !review.shots_reviewed.includes(s.id)) ?? null;
}
