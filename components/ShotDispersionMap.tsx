/**
 * ShotDispersionMap
 *
 * Dot-plot visualisation of shot direction spread over a session.
 *
 * Layout
 * ──────
 *  • A green "fairway" corridor runs vertically down the centre.
 *  • Each shot lands at a random-seeded x position scaled to the
 *    dispersion width for that direction, and a y position that
 *    reflects distance (closer shots appear lower, farther shots
 *    appear higher) when yardsBefore is available.
 *  • Left  = red   Right = blue   Straight = green
 *  • A dashed centre line represents the target line.
 *  • Stats bar at the top shows counts + percentages.
 *  • If GPS positions are recorded the tooltip shows lat/lng.
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable,
  useWindowDimensions,
} from 'react-native';
import type { Shot } from '../store/roundStore';

// ─── Colour tokens ────────────────────────────────────────────────────────────
const C = {
  left:       '#ef4444',   // red
  straight:   '#4ade80',   // green
  right:      '#3b82f6',   // blue
  bg:         '#0a1a10',
  fairway:    '#0d2518',
  fairwayBdr: '#1a4a2e',
  text:       '#d1fae5',
  muted:      '#4a7c5e',
  centerLine: '#4ade8066',
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface Props {
  shots: Shot[];
  /** Optional: filter to a single club (e.g. '7 Iron'). All clubs if omitted. */
  filterClub?: string | null;
}

interface PlottedDot {
  id: number;
  x: number;   // 0–1, where 0 = far left, 0.5 = centre, 1 = far right
  y: number;   // 0–1, where 0 = top (far), 1 = bottom (close)
  result: 'left' | 'right' | 'straight';
  club: string;
  yards: number | null;
  gps: { lat: number; lng: number } | null;
}

// ─── Stable seeded pseudo-random using shot timestamp ─────────────────────────
function seededRand(seed: number): number {
  // simple LCG — keeps dots stable across re-renders
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ShotDispersionMap({ shots, filterClub = null }: Props) {
  const { width } = useWindowDimensions();
  const mapW = Math.min(width - 32, 380);
  const mapH = mapW * 1.35;

  const [selected, setSelected] = useState<PlottedDot | null>(null);

  // ── Filter + compute stats ────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      shots.filter(
        (s) =>
          (s.result === 'left' || s.result === 'right' || s.result === 'center') &&
          (filterClub == null || s.club === filterClub),
      ),
    [shots, filterClub],
  );

  const total     = filtered.length;
  const leftCnt   = filtered.filter((s) => s.result === 'left').length;
  const rightCnt  = filtered.filter((s) => s.result === 'right').length;
  const strtCnt   = filtered.filter((s) => s.result === 'center').length;
  const leftPct   = total ? Math.round((leftCnt  / total) * 100) : 0;
  const rightPct  = total ? Math.round((rightCnt / total) * 100) : 0;
  const strtPct   = total ? Math.round((strtCnt  / total) * 100) : 0;

  // ── Build dot positions ───────────────────────────────────────────────────
  const dots: PlottedDot[] = useMemo(() => {
    if (total === 0) return [];

    // Y range: use yardsBefore when available. Fallback to sequential position.
    const yards = filtered.map((s) => s.yardsBefore ?? null);
    const validY = yards.filter((y): y is number => y != null);
    const yMax = validY.length > 0 ? Math.max(...validY) : null;
    const yMin = validY.length > 0 ? Math.min(...validY) : null;

    return filtered.map((s, i) => {
      const rng = seededRand(s.timestamp ?? i * 73);

      // X position:
      //   straight → narrow band around 0.5  (±0.06)
      //   left     → left of centre           (0.1–0.44)
      //   right    → right of centre          (0.56–0.90)
      let x: number;
      if (s.result === 'center') {
        x = 0.5 + (rng - 0.5) * 0.12;
      } else if (s.result === 'left') {
        x = 0.1 + rng * 0.34;
      } else {
        x = 0.56 + rng * 0.34;
      }

      // Y position (0 = far/top, 1 = close/bottom)
      let y: number;
      const yb = s.yardsBefore ?? null;
      if (yb != null && yMax != null && yMin != null && yMax > yMin) {
        // further shots → higher on canvas (lower y value)
        y = 0.08 + ((yMax - yb) / (yMax - yMin)) * 0.84;
      } else {
        // fallback: distribute evenly with slight jitter
        y = 0.08 + (i / Math.max(total - 1, 1)) * 0.84 + (rng - 0.5) * 0.06;
      }

      return {
        id:     i,
        x:      Math.max(0.05, Math.min(0.95, x)),
        y:      Math.max(0.05, Math.min(0.95, y)),
        result: s.result as 'left' | 'right' | 'straight',
        club:   s.club ?? '—',
        yards:  yb,
        gps:    s.gpsLat != null && s.gpsLng != null
                  ? { lat: s.gpsLat, lng: s.gpsLng } : null,
      };
    });
  }, [filtered, total]);

  // ── Dot radius scales slightly with total shot count ──────────────────────
  const dotR = total > 30 ? 5 : total > 15 ? 6 : 7;

  if (total === 0) {
    return (
      <View style={[styles.emptyBox, { width: mapW }]}>
        <Text style={styles.emptyIcon}>⛳</Text>
        <Text style={styles.emptyText}>No shots yet</Text>
        <Text style={styles.emptyHint}>Log shots during your round to see dispersion patterns.</Text>
      </View>
    );
  }

  return (
    <View style={{ alignItems: 'center' }}>
      {/* ── Stats bar ─────────────────────────────────────────────────── */}
      <View style={[styles.statsBar, { width: mapW }]}>
        <StatChip label="← Left"    pct={leftPct}  count={leftCnt}  color={C.left}     />
        <StatChip label="↑ Straight" pct={strtPct} count={strtCnt}  color={C.straight} />
        <StatChip label="Right →"   pct={rightPct} count={rightCnt} color={C.right}    />
      </View>

      {/* ── Direction bar ─────────────────────────────────────────────── */}
      <View style={[styles.dirBar, { width: mapW }]}>
        <View style={{ flex: leftPct  || 0.1, backgroundColor: C.left,     borderRadius: 3 }} />
        <View style={{ flex: strtPct  || 0.1, backgroundColor: C.straight, borderRadius: 3 }} />
        <View style={{ flex: rightPct || 0.1, backgroundColor: C.right,    borderRadius: 3 }} />
      </View>

      {/* ── Dot map ───────────────────────────────────────────────────── */}
      <Pressable
        accessible={false}
        onPress={() => setSelected(null)}
        style={[styles.map, { width: mapW, height: mapH }]}
      >
        {/* Fairway corridor (centre 30% width) */}
        <View style={[styles.fairway, { left: mapW * 0.35, width: mapW * 0.30, height: mapH }]} />

        {/* Centre line */}
        <View style={[styles.centreLine, { left: mapW * 0.5 - 1, height: mapH }]} />

        {/* Axis labels */}
        <Text style={[styles.axisLabel, { top: 4, left: mapW * 0.5, transform: [{ translateX: -16 }] }]}>FAR</Text>
        <Text style={[styles.axisLabel, { bottom: 4, left: mapW * 0.5, transform: [{ translateX: -22 }] }]}>CLOSE</Text>
        <Text style={[styles.axisLabel, { top: mapH / 2 - 8, left: 4 }]}>◀ L</Text>
        <Text style={[styles.axisLabel, { top: mapH / 2 - 8, right: 4 }]}>R ▶</Text>

        {/* Dots */}
        {dots.map((d) => (
          <Pressable
            key={d.id}
            onPress={(e) => { e.stopPropagation(); setSelected(d === selected ? null : d); }}
            style={[
              styles.dot,
              {
                width:  dotR * 2,
                height: dotR * 2,
                borderRadius: dotR,
                backgroundColor: C[d.result],
                left: d.x * mapW - dotR,
                top:  d.y * mapH - dotR,
                // highlight selected
                borderWidth: d === selected ? 2 : 0,
                borderColor: '#fff',
                opacity: selected != null && d !== selected ? 0.4 : 1,
              },
            ]}
          />
        ))}
      </Pressable>

      {/* ── Selected shot tooltip ─────────────────────────────────────── */}
      {selected && (
        <View style={[styles.tooltip, { width: mapW }]}>
          <View style={[styles.tooltipDot, { backgroundColor: C[selected.result] }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.tooltipTitle}>
              {selected.result.toUpperCase()} · {selected.club}
              {selected.yards != null ? `  ·  ${selected.yards} yds` : ''}
            </Text>
            {selected.gps ? (
              <Text style={styles.tooltipGps}>
                GPS  {selected.gps.lat.toFixed(5)}°N  {selected.gps.lng.toFixed(5)}°W
              </Text>
            ) : (
              <Text style={styles.tooltipGps}>No GPS data for this shot</Text>
            )}
          </View>
          <Pressable onPress={() => setSelected(null)}>
            <Text style={{ color: '#6b7280', fontSize: 16, paddingHorizontal: 6 }}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* ── Legend ────────────────────────────────────────────────────── */}
      <View style={[styles.legend, { width: mapW }]}>
        {(['left', 'straight', 'right'] as const).map((r) => (
          <View key={r} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: C[r] }]} />
            <Text style={styles.legendLabel}>
              {r === 'left' ? 'Left' : r === 'straight' ? 'Straight' : 'Right'}
            </Text>
          </View>
        ))}
        <Text style={styles.legendTotal}>{total} shots</Text>
      </View>
    </View>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────
function StatChip({
  label, pct, count, color,
}: { label: string; pct: number; count: number; color: string }) {
  return (
    <View style={styles.chip}>
      <View style={[styles.chipBar, { backgroundColor: color }]}>
        <Text style={styles.chipPct}>{pct}%</Text>
      </View>
      <Text style={[styles.chipLabel, { color }]}>{label}</Text>
      <Text style={styles.chipCount}>{count}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  emptyBox: {
    backgroundColor: C.bg,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyIcon:  { fontSize: 36 },
  emptyText:  { color: C.text,  fontSize: 16, fontWeight: '700' },
  emptyHint:  { color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },

  statsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  chip: { alignItems: 'center', gap: 3 },
  chipBar: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  chipPct:   { color: '#fff', fontSize: 16, fontWeight: '900' },
  chipLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  chipCount: { color: C.muted, fontSize: 10, fontWeight: '600' },

  dirBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    gap: 2,
    marginBottom: 10,
  },

  map: {
    backgroundColor: C.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.fairwayBdr,
    overflow: 'hidden',
  },
  fairway: {
    position: 'absolute',
    top: 0,
    backgroundColor: C.fairway,
  },
  centreLine: {
    position: 'absolute',
    top: 0,
    width: 1,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: C.centerLine,
  },
  axisLabel: {
    position: 'absolute',
    color: C.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dot: {
    position: 'absolute',
  },

  tooltip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0d2215',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: C.fairwayBdr,
  },
  tooltipDot:   { width: 12, height: 12, borderRadius: 6 },
  tooltipTitle: { color: C.text,  fontSize: 13, fontWeight: '700' },
  tooltipGps:   { color: C.muted, fontSize: 10, marginTop: 2 },

  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  legendItem:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:   { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { color: C.muted, fontSize: 11, fontWeight: '700' },
  legendTotal: { color: C.muted, fontSize: 11, fontWeight: '600', marginLeft: 'auto' },
});
