/**
 * 2026-05-23 — Unified Vision Context.
 *
 * Single composition surface that fuses:
 *   - GPS / round state         (services/gpsManager + store/roundStore)
 *   - Hole geometry             (services/courseGeometryService.getHoleGeometry)
 *   - Active vision frame       (services/glassesVisionInput.getActiveVisionContext)
 *   - Player profile snapshot   (handicap / dominant_miss for downstream
 *                                personalization)
 *   - Recent shots              (last 3 from roundStore for pattern reads)
 *
 * Why this lives separately from the existing single-purpose helpers:
 *   The caddie brain (api/kevin), smartAnalysisEngine, and the new
 *   SmartVision "see what you see" routine each independently re-
 *   assembled subsets of this context. Duplicated assembly = drift
 *   over time (the brain learns about wind from one source while the
 *   analysis engine learns about it from another, etc). Single
 *   composition function = single source of truth.
 *
 * Public API:
 *   - getUnifiedVisionContext() — async, defensive. Every field is
 *     nullable; consumers branch on what's present. Never throws.
 *   - subscribeUnifiedContext(cb) — fires whenever the active vision
 *     frame changes (and re-emits the full composed context). Useful
 *     for SmartVision live overlay surfaces.
 *
 * Defensive: each subsystem is wrapped in try/catch + null fallback.
 * On a fresh install with no round started, returns a coherent
 * "nothing-active" envelope (everything null, role='free_play').
 *
 * Backward compatible: this file is purely additive. Existing
 * consumers continue to read from their original sources without
 * any change.
 */

import { devLog } from './devLog';

// ─── Types ───────────────────────────────────────────────────────────

export interface UnifiedGPSState {
  /** Active course ID (when a round is loaded). */
  courseId: string | null;
  courseName: string | null;
  /** 1-indexed hole; null when no round is active. */
  holeNumber: number | null;
  /** Par for the active hole. */
  par: number | null;
  /** Live player location from gpsManager. Nullable when GPS isn't
   *  warmed up. */
  player: { lat: number; lng: number } | null;
}

export interface UnifiedHoleGeometry {
  /** Green centroid. */
  green: { lat: number; lng: number } | null;
  /** Front + back of green for layup math. */
  greenFront: { lat: number; lng: number } | null;
  greenBack: { lat: number; lng: number } | null;
  /** Hole hazards (water, bunkers) with their GPS centroids — caller
   *  can derive carry yardages by combining with player GPS. */
  hazards: Array<{ kind: string; lat: number; lng: number }>;
  /** Carry / front-middle-back yardages from current player position.
   *  Pre-computed here so consumers don't each re-derive the same
   *  spherical-distance math. */
  yardagesFromPlayer: { front: number | null; middle: number | null; back: number | null };
}

export interface UnifiedVisionFrame {
  /** file:// or content:// URI to the latest frame. */
  uri: string | null;
  /** Auto-detected mode from glassesVisionInput. */
  mode: 'swing' | 'putting' | 'lie' | 'green_read' | 'unknown';
  modeConfidence: number;
  /** Source — 'glasses' means DAT; 'phone_camera' means user-tapped
   *  capture; 'tightlie' means lie-analysis flow. */
  source: 'glasses' | 'phone_camera' | 'tightlie' | 'smartmotion' | 'unknown';
  /** ms epoch — caller can decide if the frame is stale. */
  capturedAt: number | null;
  /** When a glasses-DAT stream is currently producing frames, true.
   *  Drives "MULTIMODAL ON" badges and the brain's "see what you see"
   *  decision. */
  streaming: boolean;
}

export interface UnifiedPlayerProfile {
  firstName: string | null;
  handicap: number | null;
  dominantMiss: string | null;
}

export interface UnifiedRecentShot {
  hole: number | null;
  shotIndex: number | null;
  club: string | null;
  direction: string | null;
  outcome: string | null;
  distanceYards: number | null;
}

export interface UnifiedVisionContext {
  /** ms epoch the context was composed. */
  timestamp: number;
  /** True when ALL three primary subsystems (GPS, geometry, vision)
   *  contributed something — caller can use as a quick "is this a
   *  rich context?" flag without checking each subfield. */
  rich: boolean;
  /** Coarse summary the brain prompt can quote verbatim — newline-
   *  separated lines, each tagged with its source. Bounded to keep
   *  the prompt budget under control. */
  promptBlock: string | null;
  gps: UnifiedGPSState;
  geometry: UnifiedHoleGeometry;
  vision: UnifiedVisionFrame;
  player: UnifiedPlayerProfile;
  recentShots: UnifiedRecentShot[];
}

// ─── Public API ──────────────────────────────────────────────────────

export async function getUnifiedVisionContext(): Promise<UnifiedVisionContext> {
  const ts = Date.now();
  const empty: UnifiedVisionContext = {
    timestamp: ts,
    rich: false,
    promptBlock: null,
    gps: { courseId: null, courseName: null, holeNumber: null, par: null, player: null },
    geometry: {
      green: null, greenFront: null, greenBack: null,
      hazards: [],
      yardagesFromPlayer: { front: null, middle: null, back: null },
    },
    vision: {
      uri: null, mode: 'unknown', modeConfidence: 0,
      source: 'unknown', capturedAt: null, streaming: false,
    },
    player: { firstName: null, handicap: null, dominantMiss: null },
    recentShots: [],
  };

  // ── GPS / round state ──
  let gps = empty.gps;
  try {
    const round = (await import('../store/roundStore')).useRoundStore.getState();
    const profileMod = await import('../store/playerProfileStore');
    const profileState = profileMod.usePlayerProfileStore.getState();
    gps = {
      courseId: round.activeCourseId ?? null,
      courseName: round.activeCourse ?? null,
      holeNumber: round.isRoundActive ? round.currentHole : null,
      par: round.getCurrentPar?.() ?? null,
      // Player location resolved below from gpsManager — kept null
      // here for now and set after we have it.
      player: null,
    };
    empty.player = {
      firstName: profileState.firstName ?? null,
      handicap: profileState.handicap ?? null,
      dominantMiss: profileState.dominantMiss ?? null,
    };
  } catch (e) {
    devLog('[unifiedVision] roundStore/profile read failed (non-fatal): ' + String(e));
  }

  try {
    const loc = await (await import('./shotLocationService')).getCurrentLocation();
    if (loc) gps = { ...gps, player: loc };
  } catch { /* non-fatal */ }

  // ── Hole geometry ──
  let geometry = empty.geometry;
  if (gps.courseId && gps.holeNumber) {
    try {
      const geoMod = await import('./courseGeometryService');
      const g = geoMod.getHoleGeometry(gps.courseId, gps.holeNumber);
      if (g) {
        geometry = {
          green: g.green ?? null,
          greenFront: g.green_front ?? null,
          greenBack: g.green_back ?? null,
          hazards: Array.isArray(g.hazards)
            ? (g.hazards as Array<Record<string, unknown>>)
                .map((h) => {
                  const loc = (h as { location?: { lat: number; lng: number } }).location;
                  const lat = typeof (h as { lat?: number }).lat === 'number' ? (h as { lat: number }).lat : loc?.lat;
                  const lng = typeof (h as { lng?: number }).lng === 'number' ? (h as { lng: number }).lng : loc?.lng;
                  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
                  return {
                    kind: typeof h.kind === 'string' ? h.kind : (typeof h.label === 'string' ? h.label : 'unknown'),
                    lat,
                    lng,
                  };
                })
                .filter((x): x is { kind: string; lat: number; lng: number } => x !== null)
            : [],
          yardagesFromPlayer: {
            front: yardsBetween(gps.player, g.green_front),
            middle: yardsBetween(gps.player, g.green),
            back: yardsBetween(gps.player, g.green_back),
          },
        };
      }
    } catch (e) {
      devLog('[unifiedVision] geometry read failed (non-fatal): ' + String(e));
    }
  }

  // ── Active vision frame ──
  let vision = empty.vision;
  try {
    const visMod = await import('./glassesVisionInput');
    const ctx = await visMod.getActiveVisionContext();
    if (ctx) {
      vision = {
        uri: ctx.frame.uri ?? null,
        mode: ctx.detected_mode,
        modeConfidence: ctx.mode_confidence,
        source: (ctx.frame.source as UnifiedVisionFrame['source']) ?? 'unknown',
        capturedAt: ctx.frame.captured_at ?? null,
        streaming: false,
      };
    }
    // DAT streaming status — additive when the bridge is loaded.
    try {
      const bridgeMod = await import('./metaWearablesBridge');
      const status = bridgeMod.getGlassesStatusSync();
      vision = { ...vision, streaming: status.streaming };
    } catch { /* non-fatal */ }
  } catch (e) {
    devLog('[unifiedVision] vision read failed (non-fatal): ' + String(e));
  }

  // ── Recent shots ──
  let recentShots = empty.recentShots;
  try {
    const round = (await import('../store/roundStore')).useRoundStore.getState();
    const shots = (round as unknown as { recentShots?: Array<Record<string, unknown>> }).recentShots ?? [];
    recentShots = shots.slice(-3).map((s) => ({
      hole: typeof s.hole === 'number' ? s.hole : null,
      shotIndex: typeof s.shotIndex === 'number' ? s.shotIndex : null,
      club: typeof s.club === 'string' ? s.club : null,
      direction: typeof s.direction === 'string' ? s.direction : null,
      outcome: typeof s.outcome === 'string' ? s.outcome : null,
      distanceYards: typeof s.distance_yards === 'number' ? s.distance_yards : null,
    }));
  } catch { /* non-fatal */ }

  // ── Compose ──
  const rich = !!(gps.holeNumber && geometry.green && vision.uri);
  const promptBlock = composePromptBlock({ gps, geometry, vision, recentShots, player: empty.player });

  return {
    timestamp: ts,
    rich,
    promptBlock,
    gps,
    geometry,
    vision,
    player: empty.player,
    recentShots,
  };
}

// ─── Subscription API ───────────────────────────────────────────────

type UnifiedListener = (ctx: UnifiedVisionContext) => void;
const unifiedListeners = new Set<UnifiedListener>();

export function subscribeUnifiedContext(cb: UnifiedListener): () => void {
  unifiedListeners.add(cb);
  // Fire immediately with current state. Async — caller doesn't have
  // to await.
  void getUnifiedVisionContext().then((ctx) => {
    try { cb(ctx); } catch { /* swallow */ }
  });
  // Wire glassesVisionInput frame subscription so we re-emit when a
  // new frame lands. Cleanup unsubscribes BOTH.
  let visionUnsub: (() => void) | null = null;
  void (async () => {
    try {
      const visMod = await import('./glassesVisionInput');
      visionUnsub = visMod.subscribeVisionFrames(async () => {
        const ctx = await getUnifiedVisionContext();
        unifiedListeners.forEach((listener) => {
          try { listener(ctx); } catch { /* swallow */ }
        });
      });
    } catch { /* non-fatal */ }
  })();
  return () => {
    unifiedListeners.delete(cb);
    visionUnsub?.();
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function yardsBetween(a: { lat: number; lng: number } | null, b: { lat: number; lng: number } | null): number | null {
  if (!a || !b) return null;
  // Haversine, returns yards. R_earth in yards = 6,371,000m * 1.09361yd/m.
  const R = 6_966_311; // yards (approx)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function composePromptBlock(parts: {
  gps: UnifiedGPSState;
  geometry: UnifiedHoleGeometry;
  vision: UnifiedVisionFrame;
  recentShots: UnifiedRecentShot[];
  player: UnifiedPlayerProfile;
}): string | null {
  const lines: string[] = [];
  const { gps, geometry, vision, recentShots, player } = parts;
  if (gps.courseName || gps.holeNumber) {
    lines.push(
      `[GPS] ${gps.courseName ?? 'course?'} hole ${gps.holeNumber ?? '?'}${gps.par ? `, par ${gps.par}` : ''}`,
    );
  }
  const ydg = geometry.yardagesFromPlayer;
  if (ydg.front != null || ydg.middle != null || ydg.back != null) {
    lines.push(
      `[GEOMETRY] front ${ydg.front ?? '?'}y / middle ${ydg.middle ?? '?'}y / back ${ydg.back ?? '?'}y`,
    );
  }
  if (geometry.hazards.length > 0) {
    lines.push(`[HAZARDS] ${geometry.hazards.length} on this hole`);
  }
  if (vision.uri) {
    lines.push(
      `[VISION] ${vision.source} frame, detected mode=${vision.mode} (${vision.modeConfidence}%)${vision.streaming ? ' [LIVE]' : ''}`,
    );
  }
  if (recentShots.length > 0) {
    const last = recentShots[recentShots.length - 1];
    if (last) {
      lines.push(
        `[LAST SHOT] hole ${last.hole ?? '?'}: ${last.club ?? '?'}${last.direction ? ` ${last.direction}` : ''}${last.outcome ? ` (${last.outcome})` : ''}`,
      );
    }
  }
  if (player.dominantMiss) {
    lines.push(`[PLAYER] dominant miss: ${player.dominantMiss}`);
  }
  if (lines.length === 0) return null;
  return '[UNIFIED VISION CONTEXT]\n' + lines.join('\n') + '\n[/UNIFIED VISION CONTEXT]';
}
