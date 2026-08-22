/**
 * 2026-07-07 (Tim — SmartPump third rail): ingest a SmartPump golf-workout export.
 *
 * Flow (modeled on services/metaGlassesIngest.ts + services/roundImport.ts):
 *   1. User picks the SmartPump export (PDF, image, JSON, or CSV/text).
 *   2. JSON  → parsed on-device (offline, no server) if SmartPump emits structured JSON.
 *      PDF/image → base64 → /api/workout-import (AI parse, format-agnostic).
 *   3. Parsed rows → useWorkoutStore.addWorkouts (deduped by date+title).
 *
 * Honest + resilient: never throws to the caller — returns a typed result the UI
 * turns into a toast. A malformed row is dropped, not written as garbage.
 */

import { getApiBaseUrl } from './apiBase';
import { useWorkoutStore, type WorkoutIntensity, type WorkoutRecord } from '../store/workoutStore';

type NewWorkout = Omit<WorkoutRecord, 'id'>;

export type SmartPumpImportResult =
  | { ok: true; imported: number; parsed: number; confidence?: string; warnings?: string[] }
  /**
   * 2026-08-22 — `readCount` / `undatableCount` exist so a failure can say WHICH failure it was.
   * "I couldn't read the file", "I read nothing in it" and "I read 12 sessions and none of them
   * carry a date" are three different problems with three different fixes, and all three used to
   * reach the player as the same sentence.
   */
  | { ok: false; reason: string; readCount?: number; undatableCount?: number };

interface ParsedWorkoutRow {
  date_ms?: number;
  date?: string;
  title?: string;
  duration_min?: number | null;
  focus?: string | null;
  intensity?: WorkoutIntensity | null;
  exercises?: string[];
}

/** Convert a YYYY-MM-DD (or already-epoch) value to midnight-local epoch ms, or null. */
function toDateMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
      const ms = new Date(`${s}T00:00:00`).getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function rowsToRecords(rows: ParsedWorkoutRow[]): NewWorkout[] {
  const out: NewWorkout[] = [];
  for (const r of rows) {
    const date = toDateMs(r.date_ms ?? r.date);
    const title = (r.title ?? '').trim();
    if (date == null || !title) continue;
    out.push({
      date,
      title,
      durationMin: typeof r.duration_min === 'number' && r.duration_min > 0 ? Math.round(r.duration_min) : null,
      focus: r.focus?.trim() || null,
      exercises: Array.isArray(r.exercises) ? r.exercises.map((e) => String(e).trim()).filter(Boolean) : [],
      intensity: r.intensity === 'light' || r.intensity === 'moderate' || r.intensity === 'hard' ? r.intensity : null,
      source: 'smartpump',
    });
  }
  return out;
}

/** Parse a structured JSON export on-device (offline). Accepts an array or { workouts: [] }. */
function parseJsonExport(raw: string): ParsedWorkoutRow[] | null {
  try {
    const j = JSON.parse(raw) as unknown;
    const arr = Array.isArray(j)
      ? j
      : j && typeof j === 'object' && Array.isArray((j as { workouts?: unknown }).workouts)
        ? (j as { workouts: unknown[] }).workouts
        : null;
    if (!arr) return null;
    return arr.map((row) => {
      const o = (row ?? {}) as Record<string, unknown>;
      return {
        date: (o.date ?? o.performed_at ?? o.day ?? o.timestamp) as string | undefined,
        title: (o.title ?? o.name ?? o.workout ?? o.type) as string | undefined,
        duration_min: (typeof o.duration_min === 'number' ? o.duration_min
          : typeof o.minutes === 'number' ? o.minutes
          : typeof o.duration === 'number' ? o.duration
          : null) as number | null,
        focus: (o.focus ?? o.emphasis ?? null) as string | null,
        intensity: (o.intensity ?? null) as WorkoutIntensity | null,
        exercises: Array.isArray(o.exercises) ? (o.exercises as unknown[]).map(String)
          : Array.isArray(o.movements) ? (o.movements as unknown[]).map(String)
          : [],
      };
    });
  } catch {
    return null;
  }
}

/**
 * Import a SmartPump export from a user-picked file. Returns a typed result; never throws.
 */
export async function ingestSmartPumpExport(): Promise<SmartPumpImportResult> {
  let uri = '';
  let name = '';
  let mimeType = '';
  try {
    const DocumentPicker = await import('expo-document-picker');
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/json', 'text/csv', 'text/plain', 'image/*', '*/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return { ok: false, reason: 'canceled' };
    uri = picked.assets[0].uri;
    name = picked.assets[0].name ?? '';
    mimeType = picked.assets[0].mimeType ?? '';
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'picker_failed' };
  }

  const lower = (name || uri).toLowerCase();
  const isJson = /json$/.test(lower) || /json/i.test(mimeType);
  const isText = /\.(csv|txt)$/.test(lower) || /(csv|plain)/i.test(mimeType);
  const isPdf = /\.pdf$/.test(lower) || /pdf/i.test(mimeType);

  try {
    const FS = await import('expo-file-system/legacy');

    // ── On-device path: a structured JSON export needs no server. ──
    if (isJson) {
      const raw = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.UTF8 });
      const rows = parseJsonExport(raw);
      if (!rows || rows.length === 0) return { ok: false, reason: 'no_workouts_in_json' };
      const imported = useWorkoutStore.getState().addWorkouts(rowsToRecords(rows));
      return { ok: true, imported, parsed: rows.length };
    }

    // ── Server AI-parse path: PDF / image / unstructured text. ──
    let fileB64: string;
    let media = mimeType || (isPdf ? 'application/pdf' : isText ? 'text/plain' : 'application/octet-stream');
    if (isText) {
      // Send text inline (base64 of the text) — the model reads it as a document.
      const raw = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.UTF8 });
      // Try a structured on-device parse first (a CSV/JSON-ish text export).
      const rows = parseJsonExport(raw);
      if (rows && rows.length > 0) {
        const imported = useWorkoutStore.getState().addWorkouts(rowsToRecords(rows));
        return { ok: true, imported, parsed: rows.length };
      }
      fileB64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
      media = 'text/plain';
    } else {
      fileB64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
    }

    // 2026-07-15 (audit) — client-side size guard. Vercel's gateway rejects bodies >~4.5MB before
    // the function runs, so a multi-page SmartPump PDF would fail opaquely. Fail friendly first.
    if (fileB64.length > 5_000_000) return { ok: false, reason: 'too_large' };

    // 2026-07-15 (audit) — this was the only import path with no timeout: a hung connection left
    // the spinner spinning forever. Bound it and map the abort to a connectivity reason.
    const res = await fetch(`${getApiBaseUrl().replace(/\/+$/, '')}/api/workout-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_b64: fileB64, file_media_type: media }),
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => ({}))) as { workouts?: ParsedWorkoutRow[]; error?: string; confidence?: string; warnings?: string[]; read_count?: number; undatable_count?: number };
    if (!res.ok) return { ok: false, reason: json.error ?? `http_${res.status}` };
    const rows = json.workouts ?? [];
    if (rows.length === 0) {
      // Tim, 08-22: SmartPump's export carried no timestamps at all. The file was perfectly
      // readable — the sessions were all there — and telling him "couldn't find any dated workouts"
      // named the symptom while hiding the cause and the fix.
      const readCount = typeof json.read_count === 'number' ? json.read_count : 0;
      const undatableCount = typeof json.undatable_count === 'number' ? json.undatable_count : 0;
      return {
        ok: false,
        reason: readCount > 0 || undatableCount > 0 ? 'workouts_without_dates' : 'no_workouts_found',
        readCount,
        undatableCount,
      };
    }
    const imported = useWorkoutStore.getState().addWorkouts(rowsToRecords(rows));
    return { ok: true, imported, parsed: rows.length, confidence: json.confidence, warnings: json.warnings };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'read_failed';
    // Map network/timeout aborts to an honest connectivity reason (not a "bad file" message).
    if (/network|abort|timeout|fetch/i.test(msg)) return { ok: false, reason: 'no_network' };
    return { ok: false, reason: msg };
  }
}

/**
 * 2026-08-22 (Tim — "I have the report I exported from the app, but I can't find the import").
 *
 * The import lived in ONE place, Settings, while everything it produces shows up on the dashboard —
 * so the natural move, looking for it on the card that is about training your swing, found nothing.
 * This is the whole import interaction including what the player is told, so a second entry point
 * costs one call and cannot drift into a second, differently-worded version of the same flow.
 */
export async function importSmartPumpWithFeedback(source: string): Promise<SmartPumpImportResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const toast = () => (require('../store/toastStore') as typeof import('../store/toastStore')).useToastStore.getState();
  try {
    toast().show('Reading your workout export…');
    const result = await ingestSmartPumpExport();
    if (!result.ok) {
      if (result.reason === 'canceled') return result;
      const seen = Math.max(result.readCount ?? 0, result.undatableCount ?? 0);
      const msg = result.reason === 'workouts_without_dates'
        ? `Found ${seen} session${seen === 1 ? '' : 's'} in that export, but no dates on them — so there's nothing to line them up against. Add dates to the export and re-import.`
        : result.reason === 'no_workouts_found' || result.reason === 'no_workouts_in_json'
        ? 'Couldn’t find any workouts in that file.'
        : result.reason === 'no_network'
          ? 'Couldn’t reach the server — check your connection and try again.'
          : result.reason === 'too_large'
            ? 'That file is too large — try a single-page export or a JSON/CSV.'
            : result.reason.startsWith('http_') || /pdf/i.test(result.reason)
              ? 'Couldn’t read that export. Try an image or a JSON/CSV export.'
              : 'That file couldn’t be read as a SmartPump export.';
      toast().show(msg);
      return result;
    }
    if (result.imported === 0) {
      toast().show(`Already up to date — no new workouts in that export (${result.parsed} read).`);
      return result;
    }
    toast().show(`Imported ${result.imported} workout${result.imported === 1 ? '' : 's'}. See TRAINING on your dashboard progress graph.`);
    return result;
  } catch (e) {
    console.log(`[smartPumpIngest] import failed (${source}):`, e);
    toast().show('That workout export couldn’t be read.');
    return { ok: false, reason: 'unreadable' } as SmartPumpImportResult;
  }
}
