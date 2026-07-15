/**
 * 2026-07-14 (Tim — "cheat the paid geometry DB. I have no money for it. Pull up ANY course →
 * AI auto-assembles satellite + geometry") — AI-VISION HOLE GEOMETRY DERIVATION (client).
 *
 * Flow:
 *   1. From a seed coordinate (the player's live GPS, or the course centroid), build a NORTH-UP
 *      satellite tile (bearing 0 — the endpoint requires north-up).
 *   2. Fetch the tile → base64 → POST to /api/hole-scan (our own vision brain, no Google key).
 *   3. Unproject the returned normalized green/tee PIXELS back into lat/lng using the tile's
 *      known center+zoom+size (services/smartVisionOverlay.unprojectTilePixel — the exact
 *      inverse of the marker projection, so no drift).
 *   4. Assemble a HoleGeometry the rest of the app already understands, flagged `estimated: true`.
 *
 * HONESTY / ZERO-REGRESSION (app-wide tenet):
 *   - Returns null when the model says found_green=false — a wrong green is worse than none.
 *   - The result is ESTIMATED. Callers use it ONLY as a fallback when no curated/API geometry
 *     exists, and badge it as AI-estimated. It never overrides real geometry.
 *   - Requires Mapbox configured; degrades to null otherwise (no crash, no fabricated coords).
 */

import * as Sentry from '@sentry/react-native';
import { getApiBaseUrl } from './apiBase';
import { getCenteredImageryUrl, isMapboxConfigured } from './mapboxImagery';
import { unprojectTilePixel, type LatLng } from './smartVisionOverlay';
import { bearingDegrees } from '../utils/geoDistance';
import { haversineMeters } from '../utils/geoDistance';
import { saveDerivedHoleGeometry, type HoleGeometry } from './courseGeometryService';

/** Zoom for the derivation tile. At z16, a 1024px tile spans ~2 km — wide enough to contain a
 *  full par-5 green even when the seed is the tee, while keeping the green large enough (~30-60px)
 *  for the model to localize. Square so x and y normalize identically. */
const TILE_ZOOM = 16;
const TILE_SIZE = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

export type DerivedHoleGeometry = HoleGeometry & {
  /** Always true — this geometry came from AI vision, not a curated/API source. */
  estimated: true;
  /** Model self-reported confidence for the green localization. */
  confidence: 'high' | 'medium' | 'low';
};

export type HoleScanResponse = {
  found_green: boolean;
  green_center: { x: number; y: number } | null;
  green_front: { x: number; y: number } | null;
  green_back: { x: number; y: number } | null;
  tee: { x: number; y: number } | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
  provider?: string;
};

async function fetchTileAsBase64(url: string): Promise<string | null> {
  // Download the tile to a transient cache file, read it back as base64 (correct binary
  // handling — no Buffer/btoa latin1 assumptions), then delete. Mirrors the local-uri →
  // base64 pattern used elsewhere (glassesVisionInput).
  const FS = await import('expo-file-system/legacy');
  const tmp = `${FS.cacheDirectory ?? ''}holescan_${Math.abs(hashStr(url))}.jpg`;
  try {
    const dl = await FS.downloadAsync(url, tmp);
    if (dl.status !== 200) return null;
    const b64 = await FS.readAsStringAsync(tmp, { encoding: FS.EncodingType.Base64 });
    return b64 || null;
  } catch {
    return null;
  } finally {
    FS.deleteAsync(tmp, { idempotent: true }).catch(() => {});
  }
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Derive a single hole's geometry from satellite imagery around `seed`.
 * Returns null on any failure or when the model can't honestly see a green.
 */
export async function deriveHoleGeometry(input: {
  seed: LatLng;              // player GPS or course centroid to center the satellite tile on
  holeNumber: number;
  par?: number | null;
  yardage?: number | null;
  courseId?: string | null;  // when set, the derived hole is persisted to the derived cache
  signal?: AbortSignal;
}): Promise<DerivedHoleGeometry | null> {
  if (!isMapboxConfigured()) return null;
  const { seed, holeNumber } = input;
  if (!Number.isFinite(seed.lat) || !Number.isFinite(seed.lng)) return null;

  const url = getCenteredImageryUrl({ lat: seed.lat, lng: seed.lng, zoom: TILE_ZOOM, width: TILE_SIZE, height: TILE_SIZE });
  if (!url) return null;

  const ctrl = new AbortController();
  const outerSignal = input.signal;
  const onAbort = () => ctrl.abort();
  if (outerSignal) outerSignal.addEventListener('abort', onAbort);
  const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const b64 = await fetchTileAsBase64(url);
    if (!b64) return null;

    const res = await fetch(`${getApiBaseUrl()}/api/hole-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_b64: b64,
        image_media_type: 'image/jpeg',
        hole_number: holeNumber,
        par: input.par ?? undefined,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as HoleScanResponse;
    if (!data.found_green || !data.green_center) return null;

    // Unproject normalized pixels → lat/lng. Tile is north-up (bearing 0), square TILE_SIZE.
    const toCoord = (p: { x: number; y: number } | null): LatLng | null => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
      const c = unprojectTilePixel(p.x * TILE_SIZE, p.y * TILE_SIZE, seed, TILE_ZOOM, 0, TILE_SIZE, TILE_SIZE);
      return Number.isFinite(c.lat) && Number.isFinite(c.lng) ? c : null;
    };

    const green = toCoord(data.green_center);
    if (!green) return null;
    const green_front = toCoord(data.green_front);
    const green_back = toCoord(data.green_back);
    const tee = toCoord(data.tee);

    // Sanity: reject an "estimated" green implausibly far from the seed (>800m ≈ 875y) — that's a
    // mis-projection or a hallucinated far-field green, not a hole the player is standing on.
    if (haversineMeters(seed, green) > 800) return null;

    const bearing_deg = tee ? bearingDegrees(tee, green) : null;

    const derived: DerivedHoleGeometry = {
      hole_number: holeNumber,
      par: input.par ?? 0,
      yardage: input.yardage ?? 0,
      tee,
      green,
      green_front,
      green_back,
      bearing_deg,
      hazards: [],
      fairway_centerline: [],
      green_outline: [],
      estimated: true,
      estimated_confidence: data.confidence,
      confidence: data.confidence,
    };

    // Anchor into the derived (estimated) CNS geometry cache — offline + brain-readable — when
    // we know the course. Best-effort; a persistence failure never fails the derivation.
    if (input.courseId) {
      await saveDerivedHoleGeometry(input.courseId, derived).catch(() => null);
    }

    return derived;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
    try { Sentry.addBreadcrumb({ category: 'hole_scan', level: 'info', message: `derive hole ${holeNumber}` }); } catch {}
  }
}
