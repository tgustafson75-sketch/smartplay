import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBaseUrl } from './apiBase';

/**
 * Phase D-1 — Course Detail content client.
 *
 * Calls /api/course-content (Anthropic-backed) for About / Caddie Tips / per-hole
 * notes. Persists per-course locally via AsyncStorage; weekly refresh.
 */

// 2026-05-28 — Fix FT: hole_description type. Mirrors the server-side
// type in api/course-content.ts. description_source carries the
// confidence marker the UI surfaces ("from public data" vs
// "field-verified"). Phase 1 always emits 'public_synthesis'; future
// 'pro_contributed' (Tank/Randy at their home courses) and
// 'field_verified' (player corrections) flow through the same field.
export type HoleDescription = {
  hole_number: number;
  description: string;
  description_source: 'public_synthesis' | 'pro_contributed' | 'field_verified';
};

export type CourseContent = {
  about: string;
  caddie_tips: string[];
  hole_notes: { hole_number: number; note: string }[];
  /** 2026-05-28 — Fix FT: per-hole 2-3 sentence previews for players
   *  on courses they've never seen. Length depends on how many of the
   *  input holes the model returned descriptions for — missing entries
   *  are intentional (model declined rather than invent), so callers
   *  must tolerate sparse coverage. */
  hole_descriptions?: HoleDescription[];
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

// 2026-05-28 — Fix FT: bumped v1 → v2 to invalidate the prior cached
// blobs. v1 payloads predate hole_descriptions, so re-using them would
// leave the new feature missing on every previously-visited course
// for up to a week. New key forces a one-time fetch per course on the
// next visit; v1 blobs naturally age out via AsyncStorage and never
// get read again.
const KEY_PREFIX = 'course-content-v2::';
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const memCache: Map<string, CourseContent> = new Map();

function key(courseId: string): string {
  return KEY_PREFIX + courseId;
}

export function getCachedContent(courseId: string): CourseContent | null {
  return memCache.get(courseId) ?? null;
}

/** 2026-05-22 — Fix Q follow-up audit. Wipes both mem + AsyncStorage
 *  caches so the next fetchCourseContent() request lands in the active
 *  caddie's voice. Called from setCaddiePersonality when persona changes
 *  so a cached Kevin-voice course-content blob doesn't keep surfacing
 *  after the user picks Serena. */
export async function clearCourseContentCache(): Promise<void> {
  memCache.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const courseKeys = keys.filter(k => k.startsWith('coursecontent:'));
    if (courseKeys.length > 0) await AsyncStorage.multiRemove(courseKeys);
  } catch (e) {
    console.log('[courseContent] clearCache persisted-wipe failed (non-fatal):', e);
  }
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
/**
 * 2026-06-14 (Tim — course book) — anchor the per-hole static knowledge (notes +
 * descriptions + course tips/about) into the CNS course book so it's persisted,
 * OFFLINE-available, and fed into the brain + offline responder. Best-effort,
 * additive (merge), never throws. Called whenever we obtain content — fresh fetch
 * OR a persisted cache hit — so a course visited once is described even with no signal.
 */
function anchorCourseBook(courseId: string, content: CourseContent, name?: string | null): void {
  try {
    const byHole = new Map<number, { hole: number; note?: string | null; description?: string | null }>();
    for (const n of content.hole_notes ?? []) {
      if (typeof n.hole_number === 'number') byHole.set(n.hole_number, { hole: n.hole_number, note: n.note });
    }
    for (const d of content.hole_descriptions ?? []) {
      if (typeof d.hole_number === 'number') {
        const e = byHole.get(d.hole_number) ?? { hole: d.hole_number };
        e.description = d.description;
        byHole.set(d.hole_number, e);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mem = require('../store/caddieMemoryStore') as typeof import('../store/caddieMemoryStore');
    mem.useCaddieMemoryStore.getState().saveCourseBook({
      course_id: courseId,
      name: name ?? null,
      holes: Array.from(byHole.values()),
      tips: content.caddie_tips ?? [],
      about: content.about ?? null,
      nowMs: Date.now(),
    });
  } catch (e) {
    console.warn('[courseContent] course-book anchor failed (non-fatal):', e);
  }
}

export async function fetchCourseContent(input: CourseContentInput): Promise<CourseContent | null> {
  const courseId = input.courseId;
  if (!courseId) return null;

  const memHit = memCache.get(courseId);
  if (memHit && Date.now() - memHit.fetched_at < REFRESH_AFTER_MS) return memHit;

  const persisted = await readPersisted(courseId);
  if (persisted) {
    memCache.set(courseId, persisted);
    anchorCourseBook(courseId, persisted, input.courseName); // keep the book warm offline
    if (Date.now() - persisted.fetched_at < REFRESH_AFTER_MS) return persisted;
  }

  const apiUrl = getApiBaseUrl();
  try {
    // 2026-05-22 — Fix Q follow-up audit. Threading persona so
    // course About / Caddie Tips / Hole Notes render in the active
    // caddie's voice rather than the voiceGender→Kevin fallback.
    //
    // 2026-05-28 — Fix FU: gate persona/voiceGender reads on
    // settingsStore.hasHydrated. Same race as Fix FS in greeting.tsx:
    // if a user opens Course Detail in the first second of cold boot,
    // settingsStore may still be returning defaults ('kevin', 'male')
    // before AsyncStorage rehydration completes. The fetch body would
    // get kevin → server generates Kevin-voice content → cached for
    // a week. Wait up to 3s for hydration; if it never lands, fall
    // back to defaults rather than block the user forever.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const settingsMod = require('../store/settingsStore');
    const HYDRATION_BUDGET_MS = 3_000;
    const HYDRATION_POLL_MS = 100;
    const deadline = Date.now() + HYDRATION_BUDGET_MS;
    while (
      !(settingsMod.useSettingsStore.getState().hasHydrated as boolean | undefined)
      && Date.now() < deadline
    ) {
      await new Promise(r => setTimeout(r, HYDRATION_POLL_MS));
    }
    const _settings = settingsMod.useSettingsStore.getState();
    // 2026-06-04 — tightened from 20s to 8s. Stalled connections
    // shouldn't hang the UI; caller's catch turns abort into a null
    // fallback and the persisted-cache value (if any) wins.
    const res = await fetch(`${apiUrl}/api/course-content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        voiceGender: _settings.voiceGender ?? 'male',
        persona: _settings.caddiePersonality,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn('[courseContent] fetch failed:', res.status);
      return persisted ?? null;
    }
    const data = (await res.json()) as Omit<CourseContent, 'fetched_at'>;
    const content: CourseContent = { ...data, fetched_at: Date.now() };
    memCache.set(courseId, content);
    await writePersisted(courseId, content);
    anchorCourseBook(courseId, content, input.courseName); // → CNS course book (offline + brain)
    return content;
  } catch (e) {
    console.warn('[courseContent] fetch exception:', e);
    return persisted ?? null;
  }
}

export function _clearCourseContentCache(): void {
  memCache.clear();
}
