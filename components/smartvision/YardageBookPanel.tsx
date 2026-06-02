/**
 * 2026-05-17 — Bluegolf-style yardage book.
 *
 * Lists each landmark on the hole (bunkers, water hazards, green) with
 * F (front) / B (back) yardages from the origin (default: tee).
 * Closest-point and farthest-point on each polygon are computed via
 * haversine. Bunkers tagged 'left' / 'right' / 'greenside' (server
 * classification) get prefixed labels for clarity at a glance.
 *
 * Mirrors the panel in Bluegolf's hole view:
 *   Left Bunker       F: 210   B: 225
 *   Greenside Bunker  F: 388   B: 401
 *   Pond              F: 165   B: 195
 *   Green (Center)    488      (F: 476 / B: 499)
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import type { HoleGeometry, LandmarkFeature } from '../../services/courseGeometryService';
// 2026-06-01 — Fix GL: dropped the inline haversine + EARTH_RADIUS_YARDS
// constant in favor of the canonical utils/geoDistance helper +
// utils/coordGuard validation. The inline copy was the last surviving
// duplicate of the math (Fix GA consolidated smartvision / hole-view /
// smartFinder), and it had NO WGS84 guard — a 246yd artifact could
// surface here on a bad polygon vertex. Now everyone runs through the
// same code path.
import { haversineYards as canonicalHaversineYards } from '../../utils/geoDistance';
import { isValidGolfCoord, type LatLng } from '../../utils/coordGuard';

function haversineYards(a: LatLng, b: LatLng): number {
  if (!isValidGolfCoord(a.lat, a.lng) || !isValidGolfCoord(b.lat, b.lng)) {
    return NaN;
  }
  return canonicalHaversineYards(a, b);
}

/** Front (nearest) and back (farthest) yardage to a polygon from origin. */
function frontBackYards(origin: LatLng, polygon: LatLng[]): { front: number; back: number } | null {
  if (polygon.length === 0) return null;
  // 2026-06-01 — Fix GL: skip the polygon entirely if origin is bad —
  // every per-vertex haversine would just NaN out.
  if (!isValidGolfCoord(origin.lat, origin.lng)) return null;
  let front = Infinity;
  let back = 0;
  for (const p of polygon) {
    const d = haversineYards(origin, p);
    if (!Number.isFinite(d)) continue;
    if (d < front) front = d;
    if (d > back) back = d;
  }
  if (!Number.isFinite(front)) return null;
  return { front: Math.round(front), back: Math.round(back) };
}

function bunkerLabel(b: LandmarkFeature): string {
  if (b.name) return b.name;
  switch (b.side) {
    case 'greenside': return 'Greenside Bunker';
    case 'left': return 'Left Bunker';
    case 'right': return 'Right Bunker';
    case 'fairway': return 'Fairway Bunker';
    default: return 'Bunker';
  }
}

function waterLabel(w: LandmarkFeature): string {
  if (w.name) return w.name;
  switch (w.side) {
    case 'greenside': return 'Greenside Water';
    case 'left': return 'Left Water';
    case 'right': return 'Right Water';
    case 'fairway': return 'Cross Water';
    default: return 'Water';
  }
}

interface Row {
  key: string;
  label: string;
  front: number;
  back: number;
  color: string;
}

export interface YardageBookPanelProps {
  geometry: HoleGeometry | null;
  origin: LatLng | null;
  /** When true (default), only show landmarks that are still IN PLAY
   *  ahead of the origin (front >= 50 yds). Stops the panel from
   *  cluttering with hazards already behind the player. */
  filterInPlay?: boolean;
}

export default function YardageBookPanel({
  geometry,
  origin,
  filterInPlay = true,
}: YardageBookPanelProps) {
  const rows: Row[] = useMemo(() => {
    if (!geometry || !origin) return [];
    const out: Row[] = [];

    for (const b of geometry.bunkers ?? []) {
      const fb = frontBackYards(origin, b.polygon);
      if (!fb) continue;
      out.push({
        key: 'bk-' + (b.name ?? b.side ?? 'x') + '-' + Math.round(fb.front),
        label: bunkerLabel(b),
        front: fb.front,
        back: fb.back,
        color: '#fbbf24',
      });
    }

    for (const w of geometry.water_hazards ?? []) {
      const fb = frontBackYards(origin, w.polygon);
      if (!fb) continue;
      out.push({
        key: 'wh-' + (w.name ?? w.side ?? 'x') + '-' + Math.round(fb.front),
        label: waterLabel(w),
        front: fb.front,
        back: fb.back,
        color: '#38bdf8',
      });
    }

    // Green row — explicit, always shown so the panel always has at
    // least one entry. Front/middle/back come from the polygon when
    // available, else from green_front / green / green_back points.
    if (geometry.green_polygon && geometry.green_polygon.length > 0) {
      const fb = frontBackYards(origin, geometry.green_polygon);
      if (fb) {
        out.push({
          key: 'green',
          label: 'Green',
          front: fb.front,
          back: fb.back,
          color: '#7ed3a3',
        });
      }
    } else if (geometry.green_front || geometry.green || geometry.green_back) {
      const f = geometry.green_front ? Math.round(haversineYards(origin, geometry.green_front)) : null;
      const b = geometry.green_back ? Math.round(haversineYards(origin, geometry.green_back)) : null;
      const m = geometry.green ? Math.round(haversineYards(origin, geometry.green)) : null;
      out.push({
        key: 'green',
        label: 'Green',
        front: f ?? m ?? 0,
        back: b ?? m ?? 0,
        color: '#7ed3a3',
      });
    }

    const filtered = filterInPlay ? out.filter(r => r.back >= 50) : out;
    filtered.sort((a, b) => a.front - b.front);
    return filtered;
  }, [geometry, origin, filterInPlay]);

  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No landmarks for this hole.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>YARDAGE BOOK</Text>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {rows.map(r => (
          <View key={r.key} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: r.color }]} />
            <Text style={styles.label} numberOfLines={1}>{r.label}</Text>
            <Text style={styles.fb}>F: {r.front}  B: {r.back}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  scroll: {
    maxHeight: 220,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  label: {
    flex: 1,
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '600',
  },
  fb: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  empty: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 11,
    fontStyle: 'italic',
  },
});
