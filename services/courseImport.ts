/**
 * 2026-07-01 (Tim — "load a course not in the DB from a scorecard photo"). Client side of the
 * scorecard→course flow: pick a scorecard screenshot, parse it via /api/course-import (par +
 * yardage per hole), and save it as a playable custom course. Mirrors roundImport.ts (reuses its
 * photo picker) but targets COURSE SETUP, not round history.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { getApiBaseUrl } from './apiBase';
import { pickFromLibrary } from './roundImport';
import { useCustomCourseStore, type CustomCourseHole } from '../store/customCourseStore';

export { pickFromLibrary };

export interface CourseImportHole {
  hole: number;
  par: number | null;
  yardage: number | null;
  handicap: number | null;
}
export interface CourseImportResult {
  course_name: string | null;
  tee_name: string | null;
  location: string | null;
  holes: CourseImportHole[];
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}
export type CourseParseResult =
  | { kind: 'ok'; result: CourseImportResult }
  | { kind: 'too_large' }
  | { kind: 'not_a_scorecard' }
  | { kind: 'no_network' }
  | { kind: 'error'; message: string };

/** Resize the screenshot to 1280px + POST to /api/course-import. */
export async function parseCourseScreenshot(uri: string): Promise<CourseParseResult> {
  try {
    const m = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1280 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    const b64 = m.base64;
    if (!b64) return { kind: 'error', message: 'Could not encode screenshot.' };

    const res = await fetch(`${getApiBaseUrl()}/api/course-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: b64, image_media_type: 'image/jpeg' }),
    });
    if (res.status === 413) return { kind: 'too_large' };
    if (!res.ok) {
      const e = await res.json().catch(() => ({} as Record<string, unknown>));
      return { kind: 'error', message: typeof e.error === 'string' ? e.error : `HTTP ${res.status}` };
    }
    const data = (await res.json()) as CourseImportResult;
    if (!Array.isArray(data.holes) || data.holes.length === 0) return { kind: 'not_a_scorecard' };
    return { kind: 'ok', result: data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/network|abort|timeout|fetch/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  }
}

/**
 * Persist a confirmed parse as a custom course. Returns the `custom:<slug>` id.
 * Holes with a null par default to 4 (the user confirms in the UI first); yardage stays null when
 * unreadable and falls back to the scorecard number on-course.
 */
export function saveCourseFromParse(result: CourseImportResult): string {
  const holes: CustomCourseHole[] = result.holes
    .filter((h) => typeof h.hole === 'number')
    .sort((a, b) => a.hole - b.hole)
    .map((h) => ({
      hole: h.hole,
      par: h.par ?? 4,
      distance: h.yardage ?? null,
      handicap: h.handicap ?? null,
    }));
  const course = useCustomCourseStore.getState().addCustomCourse({
    name: result.course_name?.trim() || 'My Course',
    teeName: result.tee_name ?? null,
    location: result.location ?? null,
    holes,
    source: 'scorecard_photo',
  });
  return course.id;
}
