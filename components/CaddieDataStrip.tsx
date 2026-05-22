import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useOffCourseStore } from '../services/offCourseDetector';
import { useMovementModeStore } from '../services/movementModeDetector';
// 2026-05-21 — Fix O: in-strip manual hole back/forward nav. Reuses the
// same setCurrentHole entry point the cockpit stepper, scorecard row tap,
// SmartFinder picker, and voice "hole N" intent all hit. setCurrentHole
// calls noteManualOverride() so a user correcting a wrong auto-transition
// holds for 20s before holeDetection can re-fire — manual wins.
import { useRoundStore } from '../store/roundStore';

export interface CaddieDataStripProps {
  yardage: number | null;
  playsLike: number | null;
  hole: { current: number; total: number };
  targetDirection: string;
  stroke: number;
  visible: boolean;
  bottomOffset?: number;
  stripLayout?: 'horizontal' | 'grid';
  // Phase 400-followup — surfaces whether the PLAYS yardage was derived
  // from live GPS or from the scorecard. Shown as a small pill in the
  // strip's top-right corner so users never confuse the static fallback
  // for a live reading. null = pre-round / no data shown yet.
  yardageSource?: 'live' | 'static' | null;
  // 2026-05-19 — Running round totals. When at least one hole has been
  // scored, the strip swaps the STROKE cell for SCORE (e.g. "12 +1")
  // so the user sees the round total without leaving the Caddie tab.
  // null = no scores yet → fall back to STROKE display.
  totalScore?: number | null;
  scoreVsPar?: number | null;
  onPress: () => void;
}

export default function CaddieDataStrip({
  yardage,
  playsLike,
  hole,
  targetDirection,
  stroke,
  visible,
  bottomOffset = 0,
  stripLayout = 'horizontal',
  yardageSource = null,
  // 2026-05-19 — totalScore/scoreVsPar accepted as props for forward
  // compat but NOT rendered in the strip per Tim's "don't show the
  // score the whole time, mentals matter" call. Scoring lives in the
  // expandable tool arrow only.
  totalScore: _totalScore = null,
  scoreVsPar: _scoreVsPar = null,
  onPress,
}: CaddieDataStripProps) {
  void _totalScore; void _scoreVsPar;
  const lastCellLabel = 'STROKE';
  const lastCellValue = String(stroke);
  // 2026-05-21 — Fix O: stable handle for the inline hole nav arrows
  // below. Pulled once here so the inner Pressables don't re-read the
  // store on every press.
  const setCurrentHole = useRoundStore((s) => s.setCurrentHole);
  const handleHolePrev = () => {
    if (hole.current <= 1) return;
    void Haptics.selectionAsync().catch(() => undefined);
    setCurrentHole(Math.max(1, hole.current - 1));
  };
  const handleHoleNext = () => {
    if (hole.current >= hole.total) return;
    void Haptics.selectionAsync().catch(() => undefined);
    setCurrentHole(Math.min(hole.total, hole.current + 1));
  };
  // Phase 405 — off-course badge. When the offCourseDetector observes
  // the player >200y from every hole's reference points for 20s, this
  // store flips and the strip shows an amber "OFF COURSE · ~Xy" badge
  // in the top-right. Replaces the previous Phase 400-followup LIVE
  // pill placement when off-course is more important to surface than
  // live-vs-static.
  const isOffCourse = useOffCourseStore(s => s.isOffCourse);
  const yardsToNearestHole = useOffCourseStore(s => s.yardsToNearestHole);
  // Phase 405 wave 3 — movement mode pill (cart vs walking). Renders
  // a small icon-chip next to the source pill so the user can see the
  // app is reading their movement correctly. Hidden when 'unknown'
  // (round not active or no fixes yet) so it doesn't add noise.
  const movementMode = useMovementModeStore(s => s.mode);
  const mountedOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [isMounted, setIsMounted] = useState(visible);
  const pressScale = useRef(new Animated.Value(1)).current;

  // Dot pulse anims — one per separator (4 dots for horizontal, 2 for grid)
  const dotAnims = useRef([
    new Animated.Value(0.7),
    new Animated.Value(0.7),
    new Animated.Value(0.7),
    new Animated.Value(0.7),
  ]).current;

  // Prev values for change-detect pulses
  const prevYardage   = useRef(yardage);
  const prevPlaysLike = useRef(playsLike);
  const prevHole      = useRef(hole.current);
  const prevStroke    = useRef(stroke);

  // ── Visibility animation ─────────────────
  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      Animated.timing(mountedOpacity, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(mountedOpacity, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => setIsMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── Idle dot pulse loop ──────────────────
  useEffect(() => {
    const loops = dotAnims.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(anim, {
            toValue: 0.9,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.4,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      )
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Flash a dot when value changes ──────
  const flashDot = (anim: Animated.Value) => {
    Animated.sequence([
      Animated.timing(anim, { toValue: 1.0, duration: 180, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0.7, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  useEffect(() => {
    if (yardage !== prevYardage.current) { flashDot(dotAnims[1]); prevYardage.current = yardage; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yardage]);

  useEffect(() => {
    if (playsLike !== prevPlaysLike.current) { flashDot(dotAnims[2]); prevPlaysLike.current = playsLike; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playsLike]);

  useEffect(() => {
    if (hole.current !== prevHole.current) { flashDot(dotAnims[0]); prevHole.current = hole.current; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hole.current]);

  useEffect(() => {
    if (stroke !== prevStroke.current) { flashDot(dotAnims[3]); prevStroke.current = stroke; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stroke]);

  // ── Press scale animation ────────────────
  const handlePressIn = () => {
    Animated.timing(pressScale, {
      toValue: 0.98,
      duration: 80,
      useNativeDriver: true,
    }).start();
  };
  const handlePressOut = () => {
    Animated.timing(pressScale, {
      toValue: 1.0,
      duration: 100,
      useNativeDriver: true,
    }).start();
  };

  if (!isMounted) return null;

  // ── GRID LAYOUT (WIDE mode) ──────────────
  // Phase AY — YARDS removed (lives on SmartVision now).
  if (stripLayout === 'grid') {
    // 2026-05-21 — Fix O: HOLE rendered as a custom cell with manual
    // ◀/▶ nav arrows. PLAYS keeps the generic template.
    const row2 = [
      { label: 'TARGET', value: targetDirection, dotIdx: 2 },
      { label: lastCellLabel, value: lastCellValue, dotIdx: null },
      null,
    ];

    return (
      <Animated.View
        style={[
          styles.wrapperGrid,
          { opacity: mountedOpacity, transform: [{ scale: pressScale }] },
        ]}
      >
        <Pressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={styles.pressable}
        >
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.tintOverlay]} />

          <View style={styles.gridRow}>
            {/* HOLE cell with manual ◀/▶ — Fix O. */}
            <View style={styles.gridCell}>
              <Text style={styles.cellLabel}>HOLE</Text>
              <View style={styles.holeNavRow}>
                <Pressable
                  onPress={handleHolePrev}
                  disabled={hole.current <= 1}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Previous hole"
                  style={styles.holeNavBtn}
                >
                  <Ionicons
                    name="chevron-back"
                    size={16}
                    color={hole.current <= 1 ? 'rgba(107,125,114,0.35)' : 'rgba(0,200,150,0.85)'}
                  />
                </Pressable>
                <Text style={[styles.cellValue, { fontSize: 20 }]}>{`${hole.current}/${hole.total}`}</Text>
                <Pressable
                  onPress={handleHoleNext}
                  disabled={hole.current >= hole.total}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Next hole"
                  style={styles.holeNavBtn}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={hole.current >= hole.total ? 'rgba(107,125,114,0.35)' : 'rgba(0,200,150,0.85)'}
                  />
                </Pressable>
              </View>
            </View>
            <Animated.View style={[styles.dot, { opacity: dotAnims[0] }]} />
            <View style={styles.gridCell}>
              <Text style={styles.cellLabel}>PLAYS</Text>
              <Text style={[styles.cellValue, { fontSize: 22 }]}>
                {playsLike != null ? String(playsLike) : '—'}
              </Text>
            </View>
            <Animated.View style={[styles.dot, { opacity: dotAnims[1] }]} />
            <View style={styles.gridCell} />
          </View>

          <View style={[styles.gridRow, styles.gridRowBorder]}>
            {row2.map((c, i) =>
              c === null ? (
                <View key={i} style={styles.gridCell} />
              ) : (
                <React.Fragment key={c.label}>
                  <View style={styles.gridCell}>
                    <Text style={styles.cellLabel}>{c.label}</Text>
                    <Text style={[styles.cellValue, { fontSize: c.label === 'TARGET' ? 14 : 22 }]}>
                      {c.value}
                    </Text>
                  </View>
                  {c.dotIdx !== null && (
                    <Animated.View style={[styles.dot, { opacity: dotAnims[c.dotIdx] }]} />
                  )}
                </React.Fragment>
              )
            )}
          </View>

          <Ionicons
            name="chevron-up"
            size={11}
            color="rgba(107, 125, 114, 0.5)"
            style={styles.chevronHintGrid}
          />
        </Pressable>
      </Animated.View>
    );
  }

  // ── HORIZONTAL LAYOUT (portrait, default) ─
  // Phase AY — YARDS column removed (hole-stated yardage now lives on
  // SmartVision). Remaining 4 cells get a larger font since they have
  // more horizontal room.
  // 2026-05-21 — Fix O: the HOLE cell is now rendered separately (it has
  // its own ◀/▶ stepper arrows for manual hole nav) instead of via the
  // generic cell template. The remaining 3 cells use the cell array.
  const cells = [
    { label: 'PLAYS',  value: playsLike != null ? String(playsLike) : '—', fontSize: 20 },
    { label: 'TARGET', value: targetDirection,                             fontSize: 14 },
    { label: lastCellLabel, value: lastCellValue,                          fontSize: 20 },
  ];

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { bottom: bottomOffset, opacity: mountedOpacity, transform: [{ scale: pressScale }] },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.pressable}
      >
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.tintOverlay]} />

        <View style={styles.row}>
          {/* 2026-05-21 — Fix O: manual HOLE nav. Inner Pressables
              catch their own taps (nested Pressables don't bubble to
              the outer expand-to-cockpit handler in React Native).
              Tapping the value text between the arrows still expands
              the cockpit, so the affordance doesn't get hijacked. */}
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>HOLE</Text>
            <View style={styles.holeNavRow}>
              <Pressable
                onPress={handleHolePrev}
                disabled={hole.current <= 1}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Previous hole"
                style={styles.holeNavBtn}
              >
                <Ionicons
                  name="chevron-back"
                  size={14}
                  color={hole.current <= 1 ? 'rgba(107,125,114,0.35)' : 'rgba(0,200,150,0.85)'}
                />
              </Pressable>
              <Text style={[styles.cellValue, { fontSize: 18 }]}>{`${hole.current}/${hole.total}`}</Text>
              <Pressable
                onPress={handleHoleNext}
                disabled={hole.current >= hole.total}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Next hole"
                style={styles.holeNavBtn}
              >
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={hole.current >= hole.total ? 'rgba(107,125,114,0.35)' : 'rgba(0,200,150,0.85)'}
                />
              </Pressable>
            </View>
          </View>
          <Animated.View style={[styles.dot, { opacity: dotAnims[0] }]} />
          {cells.map((cell, i) => (
            <React.Fragment key={cell.label}>
              <View style={styles.cell}>
                <Text style={styles.cellLabel}>{cell.label}</Text>
                <Text style={[styles.cellValue, { fontSize: cell.fontSize }]}>
                  {cell.value}
                </Text>
              </View>
              {i < cells.length - 1 && (
                <Animated.View style={[styles.dot, { opacity: dotAnims[i + 1] }]} />
              )}
            </React.Fragment>
          ))}

          <Ionicons
            name="chevron-up"
            size={12}
            color="rgba(107, 125, 114, 0.5)"
            style={styles.chevronHint}
          />
        </View>
        {yardageSource && (
          <View
            style={[
              styles.sourcePill,
              yardageSource === 'live' ? styles.sourcePillLive : styles.sourcePillStatic,
            ]}
          >
            <Text
              style={[
                styles.sourcePillText,
                yardageSource === 'live' ? styles.sourcePillTextLive : styles.sourcePillTextStatic,
              ]}
            >
              {yardageSource === 'live' ? 'LIVE' : 'STATIC'}
            </Text>
          </View>
        )}
        {isOffCourse && (
          <View style={styles.offCoursePill}>
            <Ionicons name="warning-outline" size={9} color="#fbbf24" />
            <Text style={styles.offCoursePillText}>
              {yardsToNearestHole != null ? `OFF COURSE · ${yardsToNearestHole}y` : 'OFF COURSE'}
            </Text>
          </View>
        )}
        {(movementMode === 'cart' || movementMode === 'walking') && (
          <View style={styles.movementPill}>
            <Ionicons
              name={movementMode === 'cart' ? 'car-outline' : 'walk-outline'}
              size={10}
              color="#9ca3af"
            />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // ── Horizontal (portrait) wrapper ────────
  wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 84,
    borderRadius: 0,
    borderTopWidth: 1,
    borderTopColor: 'rgba(30, 58, 40, 0.5)',
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    overflow: 'hidden',
    zIndex: 5,
  },
  // ── Grid (wide) wrapper ──────────────────
  wrapperGrid: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 40, 0.5)',
    overflow: 'hidden',
  },
  pressable: {
    flex: 1,
  },
  tintOverlay: {
    backgroundColor: 'rgba(13, 26, 13, 0.5)',
    borderRadius: 0,
  },
  // ── Horizontal row ───────────────────────
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Grid rows ────────────────────────────
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  gridRowBorder: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(30, 58, 40, 0.4)',
  },
  gridCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Shared cell text ─────────────────────
  cellLabel: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.2,
    color: 'rgba(107, 125, 114, 0.9)',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  cellValue: {
    fontWeight: '700',
    letterSpacing: -0.5,
    color: '#ffffff',
  },
  // 2026-05-21 — Fix O: hole-nav arrow row used by both horizontal and
  // grid layouts. Compact ◀/▶ around the hole value. Inner Pressables
  // own their own taps; the value text between them still propagates
  // to the outer expand-to-cockpit handler.
  holeNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  holeNavBtn: {
    paddingHorizontal: 2,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#00C896',
  },
  chevronHint: {
    position: 'absolute',
    right: 16,
    top: '50%',
    marginTop: -6,
  },
  chevronHintGrid: {
    position: 'absolute',
    right: 12,
    top: 10,
  },
  sourcePill: {
    position: 'absolute',
    top: 4,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  sourcePillLive: {
    borderColor: 'rgba(0, 200, 150, 0.6)',
    backgroundColor: 'rgba(0, 200, 150, 0.12)',
  },
  sourcePillStatic: {
    borderColor: 'rgba(251, 191, 36, 0.55)',
    backgroundColor: 'rgba(251, 191, 36, 0.10)',
  },
  sourcePillText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  sourcePillTextLive: {
    color: '#00C896',
  },
  sourcePillTextStatic: {
    color: '#fbbf24',
  },
  // Phase 405 — off-course badge. Top-right of the strip (opposite the
  // LIVE/STATIC source pill in the top-left) so they don't collide.
  // Amber border + warning icon makes it unmistakable; the inline
  // yardage tells the user how far they are from the nearest hole.
  offCoursePill: {
    position: 'absolute',
    top: 4,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.7)',
    backgroundColor: 'rgba(251,191,36,0.15)',
  },
  offCoursePillText: {
    color: '#fbbf24',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  // Phase 405 wave 3 — movement-mode pill (icon-only, beside the
  // off-course pill in the top-right). Subtle gray so it reads as a
  // status hint, not an alert.
  movementPill: {
    position: 'absolute',
    top: 4,
    right: 78,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(156,163,175,0.45)',
    backgroundColor: 'rgba(156,163,175,0.10)',
  },
});
