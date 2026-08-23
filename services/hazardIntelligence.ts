/**
 * HAZARD INTELLIGENCE — a SENSE, not a screen feature.
 *
 * 2026-08-21 (Tim) — "we need to use calculation in computer vision to find those hazards", and
 * "SmartFinder and SmartVision are all supposed to be unified as part of the central nervous
 * system… well, duh."
 *
 * He is right, and the chain was already 90% built:
 *   api/hole-scan (COMPUTER VISION) returns hazards with kind 'bunker'|'water' and polygons
 *     → HoleGeometry.hazards
 *       → this computation: real distances (front/centre/back), which SIDE, the carry needed to
 *         CLEAR it, and how far past it runs out
 *         → …and it stopped here, inside app/smartfinder.tsx, visible only on the rangefinder screen.
 *
 * So the caddie could say "158 yards" while the app already knew, from satellite vision, that the
 * bunker starts at 141 and needs 152 to carry. The intelligence existed and the brain could not
 * reach it — the exact unconnected-halves shape, and the reason his answer had to be a number.
 *
 * Moved here UNCHANGED so both consumers share one computation: SmartFinder renders it, and
 * pipecatContext feeds it to the caddie. A second copy for the brain would have been the next thing
 * to drift ([[caddie-brain-lens]] — route every change through the CNS).
 *
 * Pure and dependency-light on purpose: it takes a position, the hole geometry and a landing
 * distance, and returns facts. No React, no stores, no network — so it can run inside a context
 * build on every turn without costing anything.
 */
import { bearingDegrees, haversineYards } from '../utils/geoDistance';
import type { HoleGeometry } from './courseGeometryService';

export type HazardIntelligence = {
  label: string;
  kind: 'water' | 'bunker' | 'hazard';
  side: 'left' | 'right' | 'center';
  front: number;
  center: number;
  back: number;
  carryToClear: number;
  runoutDistance: number;
  source: 'polygon' | 'point';
};

export function computeHazardIntelligence(
  player: { lat: number; lng: number } | null,
  geometry: HoleGeometry | null,
  landingTotal: number | null,
  shotBearingDeg: number | null,
): HazardIntelligence | null {
  if (!player || !geometry) return null;

  type Candidate = {
    label: string;
    kind: 'water' | 'bunker' | 'hazard';
    sideHint: 'left' | 'right' | 'center' | null;
    centroid: { lat: number; lng: number } | null;
    distances: number[];
    source: 'polygon' | 'point';
  };
  const candidates: Candidate[] = [];

  for (const h of geometry.hazards ?? []) {
    if (!h.location) continue;
    const lower = h.label.toLowerCase();
    const kind: 'water' | 'bunker' | 'hazard' =
      lower.includes('water') || lower.includes('pond') || lower.includes('lake') ? 'water'
      : lower.includes('bunker') || lower.includes('sand') ? 'bunker'
      : 'hazard';
    candidates.push({
      label: h.label,
      kind,
      sideHint: null,
      centroid: h.location,
      distances: [Math.round(haversineYards(player, h.location))],
      source: 'point',
    });
  }

  const polygonFeatures = [...(geometry.bunkers ?? []), ...(geometry.water_hazards ?? [])];
  for (const f of polygonFeatures) {
    const dists: number[] = [];
    if (f.polygon && f.polygon.length > 0) {
      for (const p of f.polygon) dists.push(Math.round(haversineYards(player, p)));
    }
    if (dists.length === 0 && f.centroid) {
      dists.push(Math.round(haversineYards(player, f.centroid)));
    }
    if (dists.length === 0) continue;
    candidates.push({
      label: f.name ?? (f.side === 'greenside' ? 'Greenside hazard' : 'Hazard'),
      kind: geometry.water_hazards?.includes(f) ? 'water' : 'bunker',
      sideHint: f.side === 'left' || f.side === 'right' ? f.side : null,
      centroid: f.centroid ?? null,
      distances: dists,
      source: f.polygon && f.polygon.length > 0 ? 'polygon' : 'point',
    });
  }

  if (candidates.length === 0) return null;

  const scored = candidates.map((c) => {
    const sorted = [...c.distances].sort((a, b) => a - b);
    const front = sorted[0];
    const back = sorted[sorted.length - 1];
    const center = Math.round((front + back) / 2);
    const sideFromBearing = (() => {
      /**
       * 2026-08-22 — `!shotBearingDeg` is a FALSY check on a number, so a shot playing due north
       * (bearing 0) took this branch and lost side detection entirely: the hazard fell back to
       * 'center' and the caddie could not say "bunker right" on any hole that plays due north.
       * Zero is a heading, not a missing value. Same shape as the NaN-SVG white screen.
       */
      if (shotBearingDeg == null || !Number.isFinite(shotBearingDeg) || !c.centroid) return null;
      const hazardBearing = bearingDegrees(player, c.centroid);
      let rel = ((hazardBearing - shotBearingDeg) % 360 + 360) % 360;
      if (rel > 180) rel -= 360;
      if (Math.abs(rel) <= 12) return 'center' as const;
      return rel < 0 ? 'left' as const : 'right' as const;
    })();
    const side = c.sideHint ?? sideFromBearing ?? 'center';
    return { c, front, back, center, side };
  }).sort((a, b) => a.center - b.center);

  const best = scored[0];
  const carryToClear = best.back + 1;
  const runoutDistance = landingTotal != null ? Math.max(0, landingTotal - carryToClear) : 0;

  return {
    label: best.c.label,
    kind: best.c.kind,
    side: best.side,
    front: best.front,
    center: best.center,
    back: best.back,
    carryToClear,
    runoutDistance,
    source: best.c.source,
  };
}
