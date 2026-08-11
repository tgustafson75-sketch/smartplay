/**
 * 2026-07-01 (Tim — "load a course not in the DB from a scorecard photo"). Client side of the
 * scorecard→course flow: pick a scorecard screenshot, parse it via /api/course-import (par +
 * yardage per hole), and save it as a playable custom course. Mirrors roundImport.ts (reuses its
 * photo picker) but targets COURSE SETUP, not round history.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { getApiBaseUrl } from './apiBase';
import { pickFromLibrary, pickManyFromLibrary } from './roundImport';
import { useCustomCourseStore, type CustomCourseHole } from '../store/customCourseStore';

export { pickFromLibrary, pickManyFromLibrary };

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

/**
 * 2026-08-10 (Tim — "when I went to ingest the scorecard, it only allows for one picture, and it
 * hits an error. So the pictures I took of the scorecard I wasn't able to take advantage of").
 *
 * Merge several parses of the SAME card into one course. A scorecard is physically too wide to
 * photograph legibly in one frame — his Connecticut National card runs 1-9 + OUT, then 10-18 + IN —
 * so people shoot the front nine and the back nine separately. The importer took a single URI, so
 * the second photo had nowhere to go and the result was half a course.
 *
 * Merge rules, chosen so a blurry second shot can never damage a good first one:
 *   - holes are keyed by hole number, so front-nine and back-nine photos slot together;
 *   - a field is only filled when it's currently missing — first good value wins, later photos
 *     cannot overwrite data already read cleanly;
 *   - course/tee/location take the first non-empty value;
 *   - confidence is the LOWEST across parses (an 18-hole course assembled from one clear and one
 *     marginal photo is only as trustworthy as the marginal one);
 *   - warnings accumulate, deduped, so nothing is silently dropped.
 */
export function mergeCourseImports(parts: CourseImportResult[]): CourseImportResult {
  const byHole = new Map<number, CourseImportHole>();
  const warnings: string[] = [];
  let course_name: string | null = null;
  let tee_name: string | null = null;
  let location: string | null = null;
  let worst: 'high' | 'medium' | 'low' = 'high';
  const rank = { low: 0, medium: 1, high: 2 } as const;

  for (const p of parts) {
    if (!p) continue;
    if (!course_name && p.course_name?.trim()) course_name = p.course_name.trim();
    if (!tee_name && p.tee_name?.trim()) tee_name = p.tee_name.trim();
    if (!location && p.location?.trim()) location = p.location.trim();
    if (rank[p.confidence] < rank[worst]) worst = p.confidence;
    for (const w of p.warnings ?? []) if (!warnings.includes(w)) warnings.push(w);

    for (const h of p.holes ?? []) {
      const n = Math.trunc(Number(h.hole));
      if (!Number.isFinite(n) || n < 1 || n > 18) continue;
      const existing = byHole.get(n);
      if (!existing) {
        byHole.set(n, { hole: n, par: h.par ?? null, yardage: h.yardage ?? null, handicap: h.handicap ?? null });
      } else {
        // Fill gaps only — never overwrite a value we already read.
        if (existing.par == null && h.par != null) existing.par = h.par;
        if (existing.yardage == null && h.yardage != null) existing.yardage = h.yardage;
        if (existing.handicap == null && h.handicap != null) existing.handicap = h.handicap;
      }
    }
  }

  const holes = [...byHole.values()].sort((a, b) => a.hole - b.hole);
  return { course_name, tee_name, location, holes, confidence: worst, warnings };
}

/**
 * Parse SEVERAL photos of one scorecard and merge them. Individual photo failures are tolerated:
 * two good photos and one blurry one still produce a course, with the failure surfaced as a
 * warning rather than losing the whole import. Only when EVERY photo fails do we return the error.
 */
export async function parseCourseScreenshots(uris: string[]): Promise<CourseParseResult> {
  if (uris.length === 0) return { kind: 'error', message: 'No photos selected.' };
  if (uris.length === 1) return parseCourseScreenshot(uris[0]);

  const results = await Promise.all(uris.map(u => parseCourseScreenshot(u)));
  const ok = results.filter((r): r is { kind: 'ok'; result: CourseImportResult } => r.kind === 'ok');
  if (ok.length === 0) {
    // Every photo failed — report the first real reason so the user gets actionable copy.
    return results[0];
  }
  const merged = mergeCourseImports(ok.map(r => r.result));
  const failed = results.length - ok.length;
  if (failed > 0) {
    merged.warnings.push(`${failed} of ${results.length} photos couldn't be read — check those holes.`);
  }
  return { kind: 'ok', result: merged };
}

/** Resize the screenshot to 1280px + POST to /api/course-import. */
export async function parseCourseScreenshot(uri: string): Promise<CourseParseResult> {
  try {
    const m = await ImageManipulator.manipulateAsync(
      uri,
      // 2026-08-10 — 1280 was too small for a WIDE scorecard: an 18-column card resized to 1280
      // leaves the yardage digits a few pixels tall and the parse fails as "not a scorecard".
      // 2000 keeps the columns legible; the route accepts it well inside its size cap.
      [{ resize: { width: 2000 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    const b64 = m.base64;
    if (!b64) return { kind: 'error', message: 'Could not encode screenshot.' };

    const res = await fetch(`${getApiBaseUrl()}/api/course-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: b64, image_media_type: 'image/jpeg' }),
      // 2026-07-06 (audit) — bound the wait (~1.5× the route's 45s maxDuration)
      // so a dead connection surfaces as no_network instead of hanging forever.
      signal: AbortSignal.timeout(68_000),
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
