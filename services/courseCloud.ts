/**
 * 2026-07-23 — Course Cloud client (crowd-sourced hole geometry).
 *
 * When this device AI-derives a hole's geometry (services/holeGeometryDerivation), we share it —
 * with the player's consent — to api/course-geometry-share, so the next player of that course reads
 * it back from api/course-geometry with zero AI cost. Privacy: coords only, no PII; the server hashes
 * our opaque contributor id again behind a salt.
 *
 * Consent: gated by the ONE community-data toggle (settingsStore.shareCommunityData, default ON for
 * beta). Off → we never upload. Best-effort + fire-and-forget: a failure never affects the round.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBaseUrl } from './apiBase';
import { useSettingsStore } from '../store/settingsStore';
import type { HoleGeometry } from './courseGeometryService';

// Must match api/course-geometry-share.ts APP_KEY (public app key, same class as the messaging key).
const SHARE_APP_KEY = 'spc_share_k1_2f8d61b4c07a49e3a1d5e9f60b3c7a29';
const CONTRIB_ID_KEY = 'course-cloud-contributor-id-v1';
const SHARE_TIMEOUT_MS = 8000;

// Confidence label → numeric so the server can rank contributions.
const CONF_NUM: Record<string, number> = { high: 0.85, medium: 0.6, low: 0.4 };

// Send each (course,hole) at most once per app session — the server upsert is idempotent, this
// just avoids redundant network churn while scrubbing/re-opening a course.
const sentThisSession = new Set<string>();

let contributorIdCache: string | null = null;

/** Stable, opaque per-install id. Not security-sensitive — a de-dupe/counting key only. */
async function getContributorId(): Promise<string> {
  if (contributorIdCache) return contributorIdCache;
  try {
    const existing = await AsyncStorage.getItem(CONTRIB_ID_KEY);
    if (existing) { contributorIdCache = existing; return existing; }
    const id = `cc_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    await AsyncStorage.setItem(CONTRIB_ID_KEY, id);
    contributorIdCache = id;
    return id;
  } catch {
    return 'cc_anon';
  }
}

export function isCommunitySharingEnabled(): boolean {
  try { return useSettingsStore.getState().shareCommunityData !== false; } catch { return false; }
}

type ShareHole = {
  hole: number;
  par?: number | null;
  yardage?: number | null;
  tee_lat?: number | null; tee_lng?: number | null;
  green_lat?: number | null; green_lng?: number | null;
  green_front_lat?: number | null; green_front_lng?: number | null;
  green_back_lat?: number | null; green_back_lng?: number | null;
  source?: string;
  confidence?: number;
};

/** Map a client HoleGeometry (derived or curated) into the share payload shape. */
function toShareHole(h: HoleGeometry): ShareHole {
  const estimated = h.estimated === true;
  const conf = estimated ? (CONF_NUM[h.estimated_confidence ?? 'low'] ?? 0.4) : 0.9;
  return {
    hole: h.hole_number,
    par: h.par ?? null,
    yardage: h.yardage ?? null,
    tee_lat: h.tee?.lat ?? null, tee_lng: h.tee?.lng ?? null,
    green_lat: h.green?.lat ?? null, green_lng: h.green?.lng ?? null,
    green_front_lat: h.green_front?.lat ?? null, green_front_lng: h.green_front?.lng ?? null,
    green_back_lat: h.green_back?.lat ?? null, green_back_lng: h.green_back?.lng ?? null,
    source: estimated ? 'ai_vision' : 'bundled',
    confidence: conf,
  };
}

/**
 * Share one or more derived holes for a course. Consent-gated, deduped per session,
 * fire-and-forget. `courseId` must be the upstream/course id the READ path keys on.
 */
export async function shareCourseGeometry(courseId: string, holes: HoleGeometry[]): Promise<void> {
  if (!isCommunitySharingEnabled()) return;
  if (!courseId || !Array.isArray(holes) || holes.length === 0) return;

  // Only holes with usable coords, not already sent this session.
  const fresh = holes.filter(h => {
    const hasCoords = (h.tee && Number.isFinite(h.tee.lat)) || (h.green && Number.isFinite(h.green.lat));
    if (!hasCoords) return false;
    const key = `${courseId}:${h.hole_number}`;
    if (sentThisSession.has(key)) return false;
    return true;
  });
  if (fresh.length === 0) return;

  const base = getApiBaseUrl();
  if (!base) return;
  const contributor = await getContributorId();

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SHARE_TIMEOUT_MS);
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/course-geometry-share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-key': SHARE_APP_KEY },
      body: JSON.stringify({ course_id: courseId, contributor, holes: fresh.map(toShareHole) }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      for (const h of fresh) sentThisSession.add(`${courseId}:${h.hole_number}`);
      console.log('[courseCloud] shared', fresh.length, 'holes for', courseId);
    } else {
      console.log('[courseCloud] share rejected', res.status, 'for', courseId);
    }
  } catch (e) {
    // Silent — sharing is best-effort; the round never depends on it.
    console.log('[courseCloud] share failed (non-fatal):', e instanceof Error ? e.message : String(e));
  }
}
