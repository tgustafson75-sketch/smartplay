/**
 * RoundReplay — visualize all logged shots from the current round.
 *
 * For each shot we know: hole, club, result (left/right/center/short/long),
 * gpsDistance / distance. We derive a normalized landing position from those
 * fields and progressively draw shot paths on the hole image.
 *
 * Rendering approach:
 *   • Reuses the same SVG + Animated layer pattern as the main SmartVision map.
 *   • Ball starts at the tee overlay (or default 0.5, 0.85) each hole.
 *   • Each shot path: ballPos → estimatedLanding based on result + distance.
 *   • All prior shots on the same hole stay visible (cumulative per hole).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Image,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { MaterialCommunityIcons as MCIcon } from '@expo/vector-icons';

import { Palette } from '../../constants/theme';
import { useRoundStore } from '../../store/roundStore';
import { COURSE_DB } from '../../data/courses';
import type { Shot } from '../../store/roundStore';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NormPoint { x: number; y: number }

interface ShotSegment {
  shot: Shot;
  from: NormPoint;
  to:   NormPoint;
  holeIdx: number; // 0-based
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Lateral displacement from miss result in normalized units */
function lateralOffset(result: Shot['result']): number {
  if (result === 'left')  return -0.08;
  if (result === 'right') return  0.08;
  return 0;
}

/** Longitudinal fraction from miss result (short / long bias) */
function longBias(result: Shot['result']): number {
  if (result === 'short') return 0.78;
  if (result === 'long')  return 1.10;
  return 1.0;
}

/**
 * Given a shot starting at `from` moving toward `pin`, place the landing point.
 * `fraction` = "how far along the hole did the ball travel" (0-1).
 */
function estimateLanding(
  from:     NormPoint,
  pin:      NormPoint,
  fraction: number,
  shot:     Shot,
): NormPoint {
  const dx = pin.x - from.x;
  const dy = pin.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const unitX = dx / len;
  const unitY = dy / len;
  const perpX = -unitY;

  const travel   = fraction * longBias(shot.result);
  const lateral  = lateralOffset(shot.result);

  return {
    x: Math.max(0.02, Math.min(0.98, from.x + unitX * travel * len + perpX * lateral)),
    y: Math.max(0.02, Math.min(0.98, from.y + unitY * travel * len)),
  };
}

/**
 * Build all shot segments for replay, tracking the running ball position.
 * Shots are ordered by timestamp within each hole.
 */
function buildSegments(shots: Shot[], courseIdx: number): ShotSegment[] {
  const holeDistance = (holeIdx: number): number =>
    COURSE_DB[courseIdx]?.holes[holeIdx]?.distance ?? 350;

  const teePos = (holeIdx: number): NormPoint => ({ x: 0.5, y: 0.85 });
  const pinPos = (_holeIdx: number): NormPoint => ({ x: 0.5, y: 0.15 });

  // Group + sort by hole then timestamp
  const byHole = new Map<number, Shot[]>();
  for (const s of shots) {
    const arr = byHole.get(s.hole) ?? [];
    arr.push(s);
    byHole.set(s.hole, arr);
  }
  byHole.forEach((arr) => arr.sort((a, b) => a.timestamp - b.timestamp));

  const segments: ShotSegment[] = [];
  byHole.forEach((holeShotsArr, hole) => {
    const holeIdx = hole - 1;
    const holeDist = holeDistance(holeIdx);
    let ball = teePos(holeIdx);
    const pin = pinPos(holeIdx);

    for (const shot of holeShotsArr) {
      const yards = shot.gpsDistance ?? shot.distance ?? 0;
      const fraction = holeDist > 0 ? yards / holeDist : 0.5;
      const landing  = estimateLanding(ball, pin, fraction, shot);
      segments.push({ shot, from: ball, to: landing, holeIdx });
      ball = landing;
    }
  });
  return segments;
}

// ── Result colour ─────────────────────────────────────────────────────────────

function resultColor(result: Shot['result']): string {
  if (result === 'left' || result === 'right') return Palette.warn;
  if (result === 'short' || result === 'long') return '#60a5fa';
  return Palette.positive;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function RoundReplay({ onClose }: Props) {
  const shots            = useRoundStore((s) => s.shots);
  const selectedCourseIdx = useRoundStore((s) => s.selectedCourseIdx);
  const courseData       = COURSE_DB[selectedCourseIdx] ?? COURSE_DB[0];

  // Build all segments sorted by hole then timestamp
  const segments = useMemo(
    () => buildSegments(shots, selectedCourseIdx),
    [shots, selectedCourseIdx],
  );

  const [index,     setIndex]     = useState(0);
  const [autoPlay,  setAutoPlay]  = useState(false);
  const [mapSize,   setMapSize]   = useState({ w: 1, h: 1 });

  // Fade-in for each new segment
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Segments up to and including current index (same hole only)
  const current = segments[index] ?? null;

  const visibleSegments = useMemo(() => {
    if (!current) return [];
    return segments.slice(0, index + 1).filter((s) => s.holeIdx === current.holeIdx);
  }, [segments, index, current]);

  // Trigger fade-in on index change
  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [index]);

  // Auto-play
  useEffect(() => {
    if (!autoPlay) return;
    const id = setInterval(() => {
      setIndex((i) => {
        if (i >= segments.length - 1) {
          setAutoPlay(false);
          return i;
        }
        return i + 1;
      });
    }, 1600);
    return () => clearInterval(id);
  }, [autoPlay, segments.length]);

  // Hole image source
  const holeSource: ImageSourcePropType | undefined =
    current ? courseData?.holes[current.holeIdx]?.fullImage : undefined;

  const step = useCallback((dir: 1 | -1) => {
    setAutoPlay(false);
    setIndex((i) => Math.max(0, Math.min(segments.length - 1, i + dir)));
  }, [segments.length]);

  if (shots.length === 0) {
    return (
      <View style={s.container}>
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>No Round Data</Text>
          <Text style={s.emptyBody}>Log shots during a round to replay them here.</Text>
          <Pressable style={s.closeBtn} onPress={onClose}>
            <Text style={s.closeTxt}>Close</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Pixel conversion helpers
  const toPixel = (n: NormPoint) => ({ x: n.x * mapSize.w, y: n.y * mapSize.h });

  return (
    <View style={s.container}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Round Replay</Text>
        <Text style={s.headerSub}>{shots.length} shots · {courseData?.name ?? 'Course'}</Text>
        <Pressable style={s.closeBtn} onPress={onClose}>
          <MCIcon name="close" size={18} color={Palette.muted} />
        </Pressable>
      </View>

      {/* ── Hole Map ───────────────────────────────────────────────────── */}
      <View
        style={s.mapWrap}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setMapSize({ w: width, h: height });
        }}
      >
        {holeSource ? (
          <Image
            source={holeSource}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, s.mapFallback]}>
            <Text style={s.mapFallbackTxt}>
              Hole {current ? current.holeIdx + 1 : '—'}
            </Text>
          </View>
        )}

        {/* SVG paths for all visible shots this hole */}
        {mapSize.w > 1 && (
          <Animated.View
            style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]}
            pointerEvents="none"
          >
            <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
              {visibleSegments.map((seg, i) => {
                const from = toPixel(seg.from);
                const to   = toPixel(seg.to);
                const col  = resultColor(seg.shot.result);
                const isLatest = i === visibleSegments.length - 1;
                return (
                  <React.Fragment key={`seg-${seg.shot.timestamp}-${i}`}>
                    <Path
                      d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                      stroke={isLatest ? col : 'rgba(255,255,255,0.35)'}
                      strokeWidth={isLatest ? 2.5 : 1.5}
                      strokeLinecap="round"
                      strokeDasharray={isLatest ? undefined : '5,4'}
                      fill="none"
                    />
                    {/* Landing dot */}
                    <Circle cx={to.x} cy={to.y} r={isLatest ? 7 : 4} fill={col} opacity={isLatest ? 0.92 : 0.5} />
                    <Circle cx={to.x} cy={to.y} r={isLatest ? 3 : 1.5} fill="#fff" opacity={isLatest ? 1 : 0.7} />
                  </React.Fragment>
                );
              })}
              {/* Tee dot */}
              {current && (() => {
                const tee = toPixel({ x: 0.5, y: 0.85 });
                return (
                  <>
                    <Circle cx={tee.x} cy={tee.y} r={8} fill="#fff" opacity={0.9} />
                    <Circle cx={tee.x} cy={tee.y} r={5} fill="#1a1a1a" />
                  </>
                );
              })()}
              {/* Pin */}
              {current && (() => {
                const pin = toPixel({ x: 0.5, y: 0.15 });
                return (
                  <>
                    <Circle cx={pin.x} cy={pin.y} r={8} fill="#e63946" opacity={0.9} />
                    <Circle cx={pin.x} cy={pin.y} r={3} fill="#fff" />
                  </>
                );
              })()}
            </Svg>
          </Animated.View>
        )}

        {/* Shot context badge */}
        {current && (
          <Animated.View style={[s.badge, { opacity: fadeAnim }]} pointerEvents="none">
            <Text style={s.badgeHole}>Hole {current.holeIdx + 1}</Text>
            <Text style={s.badgeClub}>{current.shot.club}</Text>
            <Text style={[s.badgeDist, { color: resultColor(current.shot.result) }]}>
              {current.shot.gpsDistance ?? current.shot.distance ?? '—'} yds · {current.shot.result}
            </Text>
          </Animated.View>
        )}

        {/* Shot counter pill */}
        <View style={s.counter} pointerEvents="none">
          <Text style={s.counterTxt}>{index + 1} / {segments.length}</Text>
        </View>
      </View>

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <View style={s.controls}>
        <Pressable
          style={[s.ctrlBtn, index === 0 && s.ctrlDisabled]}
          onPress={() => step(-1)}
          disabled={index === 0}
        >
          <MCIcon name="chevron-left" size={24} color={index === 0 ? Palette.muted : '#fff'} />
          <Text style={[s.ctrlTxt, index === 0 && { color: Palette.muted }]}>Prev</Text>
        </Pressable>

        <Pressable
          style={[s.ctrlBtn, { borderColor: Palette.positive }]}
          onPress={() => setAutoPlay((p) => !p)}
        >
          <MCIcon name={autoPlay ? 'pause' : 'play'} size={24} color={Palette.positive} />
          <Text style={[s.ctrlTxt, { color: Palette.positive }]}>{autoPlay ? 'Pause' : 'Play'}</Text>
        </Pressable>

        <Pressable
          style={[s.ctrlBtn, index >= segments.length - 1 && s.ctrlDisabled]}
          onPress={() => step(1)}
          disabled={index >= segments.length - 1}
        >
          <MCIcon name="chevron-right" size={24} color={index >= segments.length - 1 ? Palette.muted : '#fff'} />
          <Text style={[s.ctrlTxt, index >= segments.length - 1 && { color: Palette.muted }]}>Next</Text>
        </Pressable>
      </View>

      {/* ── Shot list summary for current hole ─────────────────────────── */}
      {current && (
        <View style={s.shotList}>
          <Text style={s.shotListTitle}>Hole {current.holeIdx + 1} shots</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {visibleSegments.map((seg, i) => (
              <Pressable
                key={`pill-${seg.shot.timestamp}-${i}`}
                onPress={() => {
                  // jump to this segment's global index
                  const globalIdx = segments.indexOf(seg);
                  if (globalIdx >= 0) setIndex(globalIdx);
                }}
                style={[
                  s.shotPill,
                  { borderColor: resultColor(seg.shot.result) },
                  seg === current && { backgroundColor: 'rgba(46,204,113,0.12)' },
                ]}
              >
                <Text style={{ color: resultColor(seg.shot.result), fontSize: 11, fontWeight: '700' }}>
                  #{i + 1} {seg.shot.club}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Palette.brand },
  header:      { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: Palette.border },
  headerTitle: { color: Palette.positive, fontSize: 16, fontWeight: '700', letterSpacing: 0.5, flex: 1 },
  headerSub:   { color: Palette.muted, fontSize: 12 },
  closeBtn:    { padding: 4 },
  closeTxt:    { color: Palette.muted, fontSize: 14 },

  mapWrap:       { flex: 1, backgroundColor: '#071e16', overflow: 'hidden' },
  mapFallback:   { backgroundColor: '#0d2b18', alignItems: 'center', justifyContent: 'center' },
  mapFallbackTxt:{ color: Palette.positive, fontSize: 28, fontWeight: '800' },

  badge: {
    position: 'absolute', bottom: 12, left: 12,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(46,204,113,0.35)',
    gap: 2,
  },
  badgeHole: { color: Palette.muted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  badgeClub: { color: '#fff',        fontSize: 17, fontWeight: '700' },
  badgeDist: { fontSize: 13, fontWeight: '600' },

  counter: {
    position: 'absolute', top: 10, right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4,
  },
  counterTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },

  controls: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: Palette.border,
  },
  ctrlBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: Palette.border,
  },
  ctrlDisabled: { opacity: 0.4 },
  ctrlTxt:      { color: '#fff', fontSize: 13, fontWeight: '600' },

  shotList:      { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 8 },
  shotListTitle: { color: Palette.muted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  shotPill: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 16, borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  emptyTitle: { color: Palette.positive, fontSize: 20, fontWeight: '700' },
  emptyBody:  { color: Palette.muted, fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
