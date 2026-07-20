import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText, Rect } from 'react-native-svg';
import type { ShotResult, ShotLocation } from '../../store/roundStore';
import type { HoleGeometry } from '../../services/courseGeometryService';
import { haversineYards, projectToAxis } from '../../utils/geoDistance';

/**
 * Phase B — Hole-level shot map.
 *
 * Renders shots projected into a tee→green oriented top-down view. Because golfcourseapi
 * exposes only point geometry today (tee + green), the canvas shows:
 *
 *   - the tee marker at the bottom
 *   - the green marker at the top
 *   - a tee→green axis line (centerline approximation)
 *   - each shot's start_location plotted, numbered, and connected by lines
 *   - tap a shot to expand club / outcome / parsed utterance / yardage
 *
 * If geometry is missing entirely, the component falls back to a normalized projection
 * using the first shot's start_location and the last shot's end_location as the axis.
 */

const CANVAS_W = 320;
const CANVAS_H = 480;
const PAD = 30;

type Props = {
  hole: number;
  shots: ShotResult[];
  geometry?: HoleGeometry | null;
  onClose?: () => void;
  onPrevHole?: () => void;
  onNextHole?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
};

function pickAxis(shots: ShotResult[], geometry?: HoleGeometry | null): {
  origin: ShotLocation | null;
  destination: ShotLocation | null;
} {
  if (geometry?.tee && geometry?.green) {
    return { origin: geometry.tee, destination: geometry.green };
  }
  // Fallback: first shot start → last shot end (or last shot start if no end)
  const first = shots[0]?.start_location ?? shots[0]?.gps_location ?? null;
  const lastShot = shots[shots.length - 1];
  const last = lastShot?.end_location ?? lastShot?.start_location ?? lastShot?.gps_location ?? null;
  return { origin: first, destination: last };
}

export default function HoleShotMap({
  hole,
  shots,
  geometry,
  onClose,
  onPrevHole,
  onNextHole,
  prevDisabled,
  nextDisabled,
}: Props) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const { origin, destination } = pickAxis(shots, geometry);

  const projected = useMemo(() => {
    if (!origin || !destination) return [];
    const axisYards = haversineYards(origin, destination);
    // 2026-07-20 (white-screen guard) — `<= 0` does NOT reject NaN (NaN <= 0 is false), so a
    // non-finite hole/shot coordinate flowed into the tee/green <Circle>/<Line> below and crashed
    // react-native-svg's native parser (white-screen the recap). `!(axisYards > 0)` rejects NaN too.
    if (!(axisYards > 0)) return [];

    const points: { x: number; y: number; label: number; loc: ShotLocation }[] = [];
    shots.forEach((s, i) => {
      const loc = s.start_location ?? s.gps_location;
      if (!loc) return;
      const p = projectToAxis(loc, origin, destination);
      points.push({ x: p.x, y: p.y, label: i + 1, loc });
    });

    // Determine bounds — include axis endpoints (0..axisYards) and shot xs
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(0, ...xs) - 20;
    const maxX = Math.max(0, ...xs) + 20;
    const minY = Math.min(0, ...ys) - 20;
    const maxY = Math.max(axisYards, ...ys) + 20;

    const yardsW = maxX - minX;
    const yardsH = maxY - minY;
    const innerW = CANVAS_W - PAD * 2;
    const innerH = CANVAS_H - PAD * 2;
    const scale = Math.min(innerW / yardsW, innerH / yardsH);

    const project = (xYd: number, yYd: number) => ({
      // SVG y is inverted (top is 0); we want green at top, tee at bottom
      sx: PAD + (xYd - minX) * scale,
      sy: PAD + innerH - (yYd - minY) * scale,
    });

    return {
      points: points.map(p => ({ ...p, ...project(p.x, p.y) })),
      teeXY: project(0, 0),
      greenXY: project(0, axisYards),
      axisYards,
      scale,
    };
  }, [shots, origin, destination]);

  const selected = selectedIdx != null ? shots[selectedIdx] : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.headerBtn} accessibilityRole="button">
          <Text style={styles.headerBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Hole {hole}</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.mapWrap}>
        <Svg width={CANVAS_W} height={CANVAS_H}>
          <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#0a1f12" rx={12} />

          {projected && 'teeXY' in projected && (
            <>
              {/* Centerline */}
              <Line
                x1={projected.teeXY.sx}
                y1={projected.teeXY.sy}
                x2={projected.greenXY.sx}
                y2={projected.greenXY.sy}
                stroke="#1e3a28"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              {/* Tee */}
              <Circle cx={projected.teeXY.sx} cy={projected.teeXY.sy} r={6} fill="#6b7280" />
              <SvgText
                x={projected.teeXY.sx}
                y={projected.teeXY.sy + 18}
                fill="#9ca3af"
                fontSize={10}
                textAnchor="middle"
              >
                TEE
              </SvgText>
              {/* Green */}
              <Circle cx={projected.greenXY.sx} cy={projected.greenXY.sy} r={10} fill="#003d20" stroke="#00C896" strokeWidth={1.5} />
              <SvgText
                x={projected.greenXY.sx}
                y={projected.greenXY.sy - 14}
                fill="#00C896"
                fontSize={10}
                textAnchor="middle"
              >
                GREEN
              </SvgText>
              {/* Shot path — guard every coord: a non-finite value in the `d` string makes
                  react-native-svg's native parser throw → white-screen the recap map. */}
              {(() => {
                const fin = (n: number) => Number.isFinite(n);
                const seg = projected.points.filter(p => fin(p.sx) && fin(p.sy));
                if (
                  seg.length < 2 ||
                  !fin(projected.teeXY.sx) || !fin(projected.teeXY.sy) ||
                  !fin(projected.greenXY.sx) || !fin(projected.greenXY.sy)
                ) return null;
                const d =
                  `M ${projected.teeXY.sx} ${projected.teeXY.sy} ` +
                  seg.map(p => `L ${p.sx} ${p.sy}`).join(' ') +
                  ` L ${projected.greenXY.sx} ${projected.greenXY.sy}`;
                return <Path d={d} stroke="#F5A623" strokeWidth={2} fill="none" opacity={0.6} />;
              })()}
              {/* Shot markers */}
              {projected.points.map((p, i) => {
                // Skip (but keep the index so selectedIdx still lines up) any non-finite point.
                if (!Number.isFinite(p.sx) || !Number.isFinite(p.sy)) return null;
                const active = selectedIdx === i;
                return (
                  <React.Fragment key={i}>
                    <Circle
                      cx={p.sx}
                      cy={p.sy}
                      r={active ? 12 : 9}
                      fill={active ? '#F5A623' : '#00C896'}
                      stroke="#0a1f12"
                      strokeWidth={2}
                      onPress={() => setSelectedIdx(i)}
                    />
                    <SvgText
                      x={p.sx}
                      y={p.sy + 3}
                      fill="#060f09"
                      fontSize={10}
                      fontWeight="900"
                      textAnchor="middle"
                    >
                      {p.label}
                    </SvgText>
                  </React.Fragment>
                );
              })}
            </>
          )}
        </Svg>

        {(!origin || !destination) && (
          <View style={styles.emptyOverlay}>
            <Text style={styles.emptyText}>
              No locations recorded for this hole yet.
            </Text>
          </View>
        )}
      </View>

      {/* Selected-shot detail */}
      <View style={styles.detailCard}>
        {selected ? (
          <>
            <Text style={styles.detailHole}>Shot {selectedIdx! + 1}</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>CLUB</Text>
              <Text style={styles.detailValue}>{selected.club ?? '—'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>DISTANCE</Text>
              <Text style={styles.detailValue}>
                {/* Show the distance recorded at shot time — never a
                    render-time recalc (it can drift from the stored value
                    if locations changed). Honesty: one number, the real one. */}
                {selected.distance_yards != null ? selected.distance_yards + ' yd' : '—'}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>OUTCOME</Text>
              <Text style={styles.detailValue}>
                {selected.feel ?? selected.outcome ?? '—'}
                {selected.direction ? ' · ' + selected.direction : ''}
              </Text>
            </View>
            {selected.raw_utterance ? (
              <Text style={styles.utterance}>&quot;{selected.raw_utterance}&quot;</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.detailHint}>Tap a shot marker to see details.</Text>
        )}
      </View>

      <View style={styles.holeNav}>
        <TouchableOpacity
          style={[styles.holeNavBtn, prevDisabled && styles.holeNavBtnDisabled]}
          onPress={onPrevHole}
          disabled={prevDisabled}
        >
          <Text style={[styles.holeNavBtnText, prevDisabled && styles.holeNavBtnTextDisabled]}>
            ← Prev hole
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.holeNavBtn, nextDisabled && styles.holeNavBtnDisabled]}
          onPress={onNextHole}
          disabled={nextDisabled}
        >
          <Text style={[styles.holeNavBtnText, nextDisabled && styles.holeNavBtnTextDisabled]}>
            Next hole →
          </Text>
        </TouchableOpacity>
      </View>

      {/* Hazard labels (no positions yet) */}
      {geometry?.hazards && geometry.hazards.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hazardScroll}>
          {geometry.hazards.map((h, i) => (
            <View key={i} style={styles.hazardChip}>
              <Text style={styles.hazardChipText}>{h.label}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  headerBtn: { width: 80 },
  headerBtnText: { color: '#00C896', fontSize: 16, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  mapWrap: { alignItems: 'center', marginTop: 8 },
  emptyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32,
  },
  emptyText: { color: '#9ca3af', textAlign: 'center', fontSize: 13, lineHeight: 19 },
  detailCard: {
    marginHorizontal: 12, marginTop: 10,
    backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', padding: 12,
  },
  detailHole: { color: '#ffffff', fontSize: 14, fontWeight: '800', marginBottom: 8 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  detailLabel: { color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  detailValue: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  utterance: { color: '#9ca3af', fontStyle: 'italic', fontSize: 12, marginTop: 6 },
  detailHint: { color: '#6b7280', fontSize: 12, fontStyle: 'italic', textAlign: 'center' },
  holeNav: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 12, marginTop: 10,
  },
  holeNavBtn: {
    borderWidth: 1, borderColor: '#00C896', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  holeNavBtnDisabled: { borderColor: '#1e3a28' },
  holeNavBtnText: { color: '#00C896', fontSize: 13, fontWeight: '700' },
  holeNavBtnTextDisabled: { color: '#374151' },
  hazardScroll: { paddingHorizontal: 12, gap: 8, marginTop: 12 },
  hazardChip: {
    backgroundColor: '#1f130a', borderColor: '#F5A623', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5,
  },
  hazardChipText: { color: '#F5A623', fontSize: 11, fontWeight: '600' },
});
