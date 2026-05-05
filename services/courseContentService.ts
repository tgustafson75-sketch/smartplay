import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Phase D-1 — Course Detail content client.
 *
 * Calls /api/course-content (Anthropic-backed) for About / Caddie Tips / per-hole
 * notes. Persists per-course locally via AsyncStorage; weekly refresh.
 */

export type CourseContent = {
  about: string;
  caddie_tips: string[];
  hole_notes: { hole_number: number; note: string }[];
  fetched_at: number;
};

export type CourseContentInput = {
  courseId: string;
  courseName: string;
  location?: string;
  par: number;
  yardage: number;
  rating?: number | null;
  slope?: number | null;
  holes: { hole_number: number; par: number; yardage: number }[];
};

const KEY_PREFIX = 'course-content-v1::';
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const memCache: Map<string, CourseContent> = new Map();

function key(courseId: string): string {
  return KEY_PREFIX + courseId;
}

export function getCachedContent(courseId: string): CourseContent | null {
  return memCache.get(courseId) ?? null;
}

async function readPersisted(courseId: string): Promise<CourseContent | null> {
  try {
    const raw = await AsyncStorage.getItem(key(courseId));
    return raw ? (JSON.parse(raw) as CourseContent) : null;
  } catch {
    return null;
  }
}

async function writePersisted(courseId: string, content: CourseContent): Promise<void> {
  try {
    await AsyncStorage.setItem(key(courseId), JSON.stringify(content));
  } catch (e) {
    console.warn('[courseContent] cache write failed:', e);
  }
}

/**
 * Fetch course content. Returns mem-cached value when fresh; falls back to
 * AsyncStorage; falls back to a network call. On network failure returns the
 * stale persisted copy when available, else null.
 */
export async function fetchCourseContent(input: CourseContentInput): Promise<CourseContent | null> {
  const courseId = input.courseId;
  if (!courseId) return null;

  const memHit = memCache.get(courseId);
  if (memHit && Date.now() - memHit.fetched_at < REFRESH_AFTER_MS) return memHit;

  const persisted = await readPersisted(courseId);
  if (persisted) {
    memCache.set(courseId, persisted);
    if (Date.now() - persisted.fetched_at < REFRESH_AFTER_MS) return persisted;
  }

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  try {
    const res = await fetch(`${apiUrl}/api/course-content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, voiceGender: require('../store/settingsStore').useSettingsStore.getState().voiceGender ?? 'male' }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn('[courseContent] fetch failed:', res.status);
      return persisted ?? null;
    }
    const data = (await res.json()) as Omit<CourseContent, 'fetched_at'>;
    const content: CourseContent = { ...data, fetched_at: Date.now() };
    memCache.set(courseId, content);
    await writePersisted(courseId, content);
    return content;
  } catch (e) {
    console.warn('[courseContent] fetch exception:', e);
    return persisted ?? null;
  }
}

export function _clearCourseContentCache(): void {
  memCache.clear();
}
