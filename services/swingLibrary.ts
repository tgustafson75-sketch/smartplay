/**
 * Phase R — Swing library query helpers.
 *
 * Unified read-only view across cage sessions (Phase J/K) and uploaded
 * videos (Phase R). Lives separately from cageStore so the store stays
 * pure state; consumer surfaces (app/swinglab/library.tsx, voice handlers)
 * call these helpers without coupling to the store internals.
 */

import { useCageStore, type CageSession, type SwingSource } from '../store/cageStore';

export type LibraryFilter = 'all' | 'uploads' | 'cage';

export interface LibraryEntry {
  session: CageSession;
  source: SwingSource;
  date_ms: number;
  primary_issue_name: string | null;
  swing_count: number;
  display_label: string;
  /** 2026-05-16 — Local file:// URI of the persisted fault frame from
   *  Phase K analysis. Used by the library list as a per-row thumbnail
   *  so the user can scan their swings visually instead of by date.
   *  Null when analysis hasn't completed yet or no specific frame stood
   *  out. Prefers PrimaryIssue.visual_reference_path; falls back to the
   *  first shot's perShotAnalysis.visual_reference_path. */
  thumbnail_uri: string | null;
}

/**
 * 2026-05-22 — Analyzer routing. Putting needs a different vision model
 * than full-body swing.
 *
 * 2026-05-23 update — Added perspective awareness. Previously ANY
 * meta_glasses upload was forced to putting, which miscategorized
 * "wearing glasses while watching someone else swing" videos (full-body
 * subject, needs Phase K). Now the upload.perspective field — auto-
 * inferred from familyStore.active_member_id at ingest, overridable
 * via the upload-screen picker — wins over source_device.
 *
 * Decision order:
 *   1. perspective === 'watching_someone' → 'swing' (Phase K full-body
 *      pose analyzer), even if source_device is meta_glasses
 *   2. perspective === 'pov_self' AND tag is 'putt'|'chip' → 'putting'
 *      (POV downward putt video — grip / putter / green visible)
 *   3. perspective === 'pov_self' (no tag) → 'swing' (rare niche: self-
 *      recorded full-body via glasses; default safest path)
 *   4. perspective null/missing (legacy uploads) → original routing:
 *      'putt'/'chip' tag → putting; meta_glasses → putting; else swing
 *
 * Consumers: cage-review / SwingLab upload flow checks this BEFORE
 * kicking off pose analysis, and routes glasses POV clips through
 * puttingAnalysisService.analyzePutt() instead.
 */
export type AnalyzerKind = 'putting' | 'swing';

export function getAnalyzerKind(session: CageSession): AnalyzerKind {
  const tag = session.upload?.tag;
  const perspective = session.upload?.perspective;

  // Explicit perspective wins over source_device.
  if (perspective === 'watching_someone') return 'swing';
  if (perspective === 'pov_self') {
    if (tag === 'putt' || tag === 'chip') return 'putting';
    return 'swing';
  }

  // Legacy / null-perspective fallback: original source_device routing.
  if (tag === 'putt' || tag === 'chip') return 'putting';
  if (session.upload?.source_device === 'meta_glasses') return 'putting';
  return 'swing';
}

/** True when the session should be rendered with the PuttingLab card
 *  shape (not the full-body swing biomechanics card). */
export function isPuttingSession(session: CageSession): boolean {
  return getAnalyzerKind(session) === 'putting';
}

function describe(session: CageSession): string {
  if (session.source === 'uploaded_video' && session.upload?.notes) {
    return session.upload.notes.slice(0, 60);
  }
  if (session.source === 'uploaded_video') return 'Uploaded swing';
  return `${session.club} cage session`;
}

/** Read all sessions, newest first, optionally filtered. */
export function getLibrary(filter: LibraryFilter = 'all'): LibraryEntry[] {
  const sessions = useCageStore.getState().sessionHistory;
  return sessions
    .filter(s => {
      if (filter === 'all') return true;
      if (filter === 'uploads') return s.source === 'uploaded_video';
      return s.source !== 'uploaded_video'; // 'cage' includes legacy entries with no source
    })
    .map<LibraryEntry>(session => {
      const primaryThumb = session.primary_issue?.visual_reference_path ?? null;
      const perShotThumb = session.shots.find(s => s.perShotAnalysis?.visual_reference_path)
        ?.perShotAnalysis?.visual_reference_path ?? null;
      return {
        session,
        source: session.source ?? 'live_cage',
        date_ms: session.date,
        primary_issue_name: session.primary_issue?.name ?? null,
        swing_count: session.shots.length,
        display_label: describe(session),
        thumbnail_uri: primaryThumb ?? perShotThumb ?? null,
      };
    })
    .sort((a, b) => b.date_ms - a.date_ms);
}

/** Find a session by id. Returns null if not found. */
export function getSession(sessionId: string): CageSession | null {
  return useCageStore.getState().sessionHistory.find(s => s.id === sessionId) ?? null;
}

/**
 * Find the most recent session whose date matches a relative phrase.
 * Used by voice queries like "look at last Tuesday's swing".
 */
export function findSessionByRelativeDate(phrase: string, now: Date = new Date()): CageSession | null {
  const t = phrase.toLowerCase();
  const sessions = useCageStore.getState().sessionHistory;
  if (sessions.length === 0) return null;

  // "today" / "this morning" / "earlier"
  if (t.includes('today') || t.includes('earlier') || t.includes('this morning')) {
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    return latestSince(sessions, startOfDay.getTime());
  }
  // "yesterday"
  if (t.includes('yesterday')) {
    const yest = new Date(now); yest.setDate(yest.getDate() - 1); yest.setHours(0, 0, 0, 0);
    const yestEnd = new Date(yest); yestEnd.setHours(23, 59, 59, 999);
    return latestBetween(sessions, yest.getTime(), yestEnd.getTime());
  }
  // "last week" / "last seven days"
  if (t.includes('last week') || t.includes('past week') || t.includes('seven days')) {
    const since = new Date(now); since.setDate(since.getDate() - 7);
    return latestSince(sessions, since.getTime());
  }
  // "last [weekday]"
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < weekdays.length; i++) {
    if (t.includes(weekdays[i])) {
      // Find the most recent past occurrence of this weekday
      const target = new Date(now);
      const diff = (target.getDay() - i + 7) % 7 || 7;
      target.setDate(target.getDate() - diff);
      target.setHours(0, 0, 0, 0);
      const end = new Date(target); end.setHours(23, 59, 59, 999);
      return latestBetween(sessions, target.getTime(), end.getTime());
    }
  }
  // Fallback: most recent overall
  return sessions[sessions.length - 1] ?? null;
}

function latestSince(sessions: CageSession[], sinceMs: number): CageSession | null {
  const matches = sessions.filter(s => s.date >= sinceMs);
  return matches.length ? matches[matches.length - 1] : null;
}

function latestBetween(sessions: CageSession[], startMs: number, endMs: number): CageSession | null {
  const matches = sessions.filter(s => s.date >= startMs && s.date <= endMs);
  return matches.length ? matches[matches.length - 1] : null;
}

/** Format a session for a brief voice summary. */
export function formatSessionSummary(session: CageSession): string {
  const dateStr = new Date(session.date).toLocaleDateString();
  const sourceStr = session.source === 'uploaded_video' ? 'uploaded swing' : `${session.club} session`;
  if (session.primary_issue) {
    return `${dateStr} ${sourceStr}. Primary issue: ${session.primary_issue.name}.`;
  }
  return `${dateStr} ${sourceStr}. No primary issue identified.`;
}
