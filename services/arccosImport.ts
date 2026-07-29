/**
 * 2026-07-29 (Tim — Arccos Air trial) — client for /api/arccos-import.
 *
 * The golfer photographs the Arccos app's "Smart Club Distances" screen; we pull a frame and post
 * it to the vision endpoint, which returns each club's average distance + the UNIT Arccos is
 * showing (carry vs total). We then map those rows onto the player's canonical bag:
 *   - an Arccos CARRY average  → stated carry  (clubStatsStore.setManual — "you set it")
 *   - an Arccos TOTAL average  → the total ladder (clubStatsStore.recordTotal — tee→rest, incl. roll)
 *
 * This SEEDS the bag from the player's own already-clean (outlier-stripped) Arccos numbers, so the
 * Caddie brain has real per-club yardages from day one instead of chart defaults. Everything
 * downstream (carryFor / totalFor / inferClub, the Fit Profile, CNS reconcile) reads it for free.
 *
 * Design notes:
 *   - The pure mapping (arccosRowsToBagUpdates) imports ONLY normalizeClub (type-only clubStats), so
 *     it's node-safe and unit-tested without RN. Store writes live in the screen / applyBagUpdates.
 *   - expo-image-manipulator is lazy-required inside extractArccosFrame so importing this module in a
 *     plain-node jest run (for the pure helpers) never touches an Expo native module.
 *   - Best-effort + honest: network / extraction failures return an empty result, never throw.
 */
import { normalizeClub } from './clubNormalize';
import type { ClubName } from '../store/clubStatsStore';
import { getApiBaseUrl } from './apiBase';

export type ArccosDistanceKind = 'carry' | 'total' | 'unknown';

/** One club distance read off the Arccos screen (raw catalog id from the vision endpoint). */
export type ArccosRow = {
  club_id: string;
  yards: number;
  confidence: 'high' | 'medium' | 'low';
};

export type ArccosImportResult = {
  /** Which unit Arccos was showing for the whole table (defaults to 'total' when it can't tell). */
  distance_kind: ArccosDistanceKind;
  rows: ArccosRow[];
};

/** A resolved, canonical bag entry ready to write into clubStatsStore. */
export type BagUpdate = {
  club: ClubName;
  yards: number;
  /** 'carry' → stated carry (setManual); 'total' → total ladder (recordTotal). */
  unit: 'carry' | 'total';
};

// Sanity window for an on-course full-shot distance (yards). Anything outside is a mis-read, not a
// real club average — drop it rather than corrupt the bag (e.g. a stray "56" loft read as 56 yds is
// still plausible for a wedge, so we keep the floor generous but reject 0 / negative / absurd).
const MIN_YARDS = 20;
const MAX_YARDS = 400;

/**
 * Resolve raw Arccos rows → canonical bag updates. Pure + deterministic:
 *   - normalize each club_id to a ClubName (drops unresolvable + Putter),
 *   - clamp-reject implausible yardages,
 *   - dedupe by club (first legible read wins),
 *   - stamp the unit from the chosen kind ('unknown' is treated as 'total', Arccos's default).
 * `unitOverride` lets the review UI force carry/total if the golfer knows better than the model.
 */
export function arccosRowsToBagUpdates(
  rows: ArccosRow[],
  kind: ArccosDistanceKind,
  unitOverride?: 'carry' | 'total',
): BagUpdate[] {
  const unit: 'carry' | 'total' = unitOverride ?? (kind === 'carry' ? 'carry' : 'total');
  const seen = new Set<ClubName>();
  const out: BagUpdate[] = [];
  for (const r of rows) {
    const club = normalizeClub(r?.club_id);
    if (!club || club === 'Putter') continue;          // unresolvable or putter → no full-shot distance
    if (seen.has(club)) continue;                       // one entry per club
    const yards = Math.round(Number(r?.yards));
    if (!Number.isFinite(yards) || yards < MIN_YARDS || yards > MAX_YARDS) continue;
    seen.add(club);
    out.push({ club, yards, unit });
  }
  return out;
}

/** Parse the /api/arccos-import JSON body into a typed result. Pure; tolerant of junk. */
export function parseArccosApiResponse(data: unknown): ArccosImportResult {
  const d = (data ?? {}) as { distance_kind?: unknown; clubs?: unknown };
  const kind = d.distance_kind;
  const distance_kind: ArccosDistanceKind = kind === 'carry' || kind === 'total' ? kind : 'unknown';
  const rows = (Array.isArray(d.clubs) ? d.clubs : [])
    .map((c): ArccosRow | null => {
      const o = (c ?? {}) as Record<string, unknown>;
      const club_id = String(o.club_id ?? '');
      const yards = Math.round(Number(o.yards));
      if (!club_id || !Number.isFinite(yards) || yards <= 0) return null;
      const conf = o.confidence;
      return { club_id, yards, confidence: conf === 'high' || conf === 'medium' ? conf : 'low' };
    })
    .filter((r): r is ArccosRow => r != null);
  return { distance_kind, rows };
}

/** Pull a single downsized base64 JPEG frame from a screenshot uri. Returns '' on failure. */
export async function extractArccosFrame(imageUri: string): Promise<string> {
  if (!imageUri) return '';
  try {
    // Lazy require so this module stays node-safe for the pure-helper unit tests.
    const ImageManipulator = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const m = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 1080 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    return m.base64 ?? '';
  } catch {
    return '';
  }
}

/**
 * Read Arccos distances from one or more screenshot uris. Never throws — returns an empty result
 * on any extraction / network failure so the screen can show an honest "couldn't read that" state.
 */
export async function importArccosDistances(imageUris: string[], apiUrl?: string): Promise<ArccosImportResult> {
  const base = apiUrl || getApiBaseUrl();
  if (!base) return { distance_kind: 'unknown', rows: [] };
  const frames = (await Promise.all(imageUris.slice(0, 4).map(extractArccosFrame))).filter((b) => b.length > 0);
  if (frames.length === 0) return { distance_kind: 'unknown', rows: [] };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40000);
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/arccos-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: frames.map((b64) => ({ b64, media_type: 'image/jpeg' })) }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { distance_kind: 'unknown', rows: [] };
    return parseArccosApiResponse(await res.json());
  } catch {
    return { distance_kind: 'unknown', rows: [] };
  }
}
