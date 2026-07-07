/**
 * 2026-06-13 (Tim) — Course-capture ingest.
 *
 * SmartFinder already has photo + video capture, so it IS the ingest UI: snap a photo
 * → it becomes this hole's library shot; record while turning → a panorama clip. This
 * copies the captured file into a persistent dir and tags it (course/hole/GPS) in
 * courseCaptureStore, so every round on a new course bootstraps that course's real
 * player's-eye imagery. See memory: roadmap-3d-4d (course-data bootstrap).
 *
 * Best-effort, never throws to the caller (capture/share still works if ingest fails).
 * Needs a course context (active round OR a Play-tab preview/pending course) to tag.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { useCourseCaptureStore, type CaptureKind } from '../store/courseCaptureStore';
import { useRoundStore } from '../store/roundStore';
import { getLastFix } from './smartFinderService';

const DIR = (FileSystem.documentDirectory ?? '') + 'course_captures/';

/**
 * 2026-07-06 (elite audit) — read-time re-anchor for stored capture uris.
 * Captures are persisted as ABSOLUTE paths under course_captures/, and iOS
 * regenerates the app-container UUID on every native build/reinstall — so a
 * stored path from a prior install silently points at the DEAD container even
 * though the file survived (same reshuffle resolveClipUri in videoUpload.ts
 * heals for swing clips; captures live in their own dir so that resolver's
 * candidate list misses them). Synchronous by design (called from render):
 * a file:// uri whose prefix isn't the LIVE documentDirectory is guaranteed
 * stale, so rebuild it from the basename — no FS probe needed.
 */
export function resolveCaptureUri(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith('file://')) return stored;
  try {
    const dir = FileSystem.documentDirectory;
    if (!dir || stored.startsWith(dir)) return stored;
    const base = stored.split('/').pop();
    return base ? `${DIR}${base}` : stored;
  } catch {
    return stored; // FS unavailable — don't regress, hand back the original
  }
}

/** Resolve the course this capture belongs to (active round, else a planned/preview course). */
function resolveCourseId(): string | null {
  const r = useRoundStore.getState();
  return r.activeCourseId ?? r.previewCourseId ?? r.pendingStartCourseId ?? null;
}

export async function ingestCapture(input: {
  sourceUri: string;
  kind: CaptureKind;
  hole: number;
  heading?: number | null;
  panoSessionId?: string | null;
}): Promise<boolean> {
  try {
    const courseId = resolveCourseId();
    if (!courseId || !input.sourceUri) return false; // no course context → can't tag honestly
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => undefined);
    const id = `cap_${Date.now()}_${Math.round(Math.random() * 1e4)}`;
    const ext = input.kind === 'pano' ? 'mp4' : 'jpg';
    const dest = `${DIR}${id}.${ext}`;
    await FileSystem.copyAsync({ from: input.sourceUri, to: dest });
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const fix = getLastFix();
      lat = fix?.location?.lat ?? null;
      lng = fix?.location?.lng ?? null;
    } catch { /* GPS optional */ }
    useCourseCaptureStore.getState().addCapture(courseId, input.hole, {
      id,
      uri: dest,
      lat,
      lng,
      heading: input.heading ?? null,
      kind: input.kind,
      panoSessionId: input.panoSessionId ?? null,
      ts: Date.now(),
    });
    return true;
  } catch (e) {
    console.log('[courseCapture] ingest failed (non-fatal):', e);
    return false;
  }
}
