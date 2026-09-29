import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useDistanceFormat } from '../hooks/useDistanceUnit';
import { useOffCourseStore } from '../services/offCourseDetector';
import { useMovementModeStore } from '../services/movementModeDetector';
// 2026-05-21 — Fix O: in-strip manual hole back/forward nav. Reuses the
// same setCurrentHole entry point the cockpit stepper, scorecard row tap,
// SmartFinder picker, and voice "hole N" intent all hit. setCurrentHole
// calls noteManualOverride() so a user correcting a wrong auto-transition
// holds for 20s before holeDetection can re-fire — manual wins.
import { useRoundStore } from '../store/roundStore';
// 2026-05-22 — Ghost Rounds. Subscribed inline so the "vs last" row updates
// the moment a score is logged (logScore → ghostStore.updateHole). Only
// renders when a ghost is active; defensive against null ghostRecord.
import { useGhostStore } from '../store/ghostStore';
import { useTranslation } from 'react-i18next';

export interface CaddieDataStripProps {
  yardage: number | null;
  playsLike: number | null;
  /** Yards the plays-like adjustment added/removed vs the raw distance (plays − raw). Shown as a
   *  small "(+3)" beside PLAYS so the adjustment is VISIBLE — otherwise PLAYS looks like the raw
   *  number (the portrait strip dropped the separate yards cell). null/0 = no adjustment shown. */
  playsLikeDelta?: number | null;
  hole: { current: number; total: number; first?: number };
  targetDirection: string;
  stroke: number;
  visible: boolean;
  bottomOffset?: number;
  stripLayout?: 'horizontal' | 'grid';
  // Phase 400-followup — surfaces whether the PLAYS yardage was derived
  // from live GPS or from the scorecard. Shown as a small pill in the
  // strip's top-right corner so users never confuse the static fallback
  // for a live reading. null = pre-round / no data shown yet.
  /**
   * 2026-08-12 (Tim, after Wachusett) — "it started building some hole views, but it took a while,
   * and I didn't get any status updates what was going on… the whole time the yardage showed
   * static."
   *
   * 'building' is the missing third state. The app was doing the right thing — fetching the course
   * map — and said nothing, so a temporary condition looked like a permanent failure. STATIC on a
   * course we're still mapping is not a status, it's a shrug.
   */
  yardageSource?: 'live' | 'static' | 'building' | null;
  /** 2026-09-29 — the optional pace-of-play line (services/paceOfPlay.paceLine), led in the stripe. */
  paceLine?: string | null;
  // 2026-05-19 — Running round totals. When at least one hole has been
  // scored, the strip swaps the STROKE cell for SCORE (e.g. "12 +1")
  // so the user sees the round total without leaving the Caddie tab.
  // null = no scores yet → fall back to STROKE display.
  totalScore?: number | null;
  scoreVsPar?: number | null;
  /**
   * 2026-09-29 (Tim: "Should bottom data bar be two rows? Scoring is very hard with a small screen
   * and we could put a couple more relevant data points.") — THE SCORING ROW. When onScoreStep is
   * given the strip grows a second row: SCORE and PUTTS steppers for the current hole, written
   * straight to the round (the same logScore / logPutts seam the scorecard uses), plus STROKE. The
   * first row gains PAR. Still no running total — his standing "mentals matter" call.
   */
  par?: number | null;
  holeScore?: number | null;
  holePutts?: number | null;
  /**
   * Called ONCE per settled entry, with the hole the taps were made on — never per tap. logScore's
   * first-score auto-advance moves the round, so committing per tap walked "+ +" across two holes
   * (the cockpit stepper's 08-08 "burned holes" defect, repeated here and caught in review 09-30).
   */
  onScoreStep?: (score: number, hole: number) => void;
  onPuttsStep?: (putts: number, hole: number) => void;
  onPress: () => void;
}

/** The scoring row's height — the caddie tab's layout budget lifts everything above the strip by it. */
export const STRIP_SCORING_ROW_HEIGHT = 50;
/**
 * Taps on either stepper settle for this long before the entry is written. Longer than the cockpit's
 * 1.6s because this row is a PAIR — score then putts — and both must land before the score's
 * auto-advance moves the round on.
 */
export const STRIP_SCORE_SETTLE_MS = 2_500;

/**
 * One tap from blank is the common case, not a count from zero: + sets par (− one under), then each
 * tap moves one. Bounded 1..15.
 */
export function stepHoleScore(current: number | null | undefined, dir: 1 | -1, par: number | null | undefined): number {
  const p = typeof par === 'number' && par > 0 ? par : 4;
  if (current == null || current <= 0) return dir > 0 ? p : Math.max(1, p - 1);
  return Math.min(15, Math.max(1, current + dir));
}

/** Blank + is a two-putt, blank − a one-putt. Never below 0, never above the hole's score. */
export function stepHolePutts(current: number | null | undefined, dir: 1 | -1, score: number | null | undefined): number {
  const cap = typeof score === 'number' && score > 0 ? score : 10;
  if (current == null) return Math.min(cap, dir > 0 ? 2 : 1);
  return Math.min(cap, Math.max(0, current + dir));
}

export default function CaddieDataStrip({
  yardage,
  playsLike,
  playsLikeDelta = null,
  hole,
  targetDirection,
  stroke,
  visible,
  bottomOffset = 0,
  stripLayout = 'horizontal',
  yardageSource = null,
  paceLine = null,
  // 2026-05-19 — totalScore/scoreVsPar accepted as props for forward
  // compat but NOT rendered in the strip per Tim's "don't show the
  // score the whole time, mentals matter" call. Scoring lives in the
  // expandable tool arrow only.
  totalScore: _totalScore = null,
  scoreVsPar: _scoreVsPar = null,
  par = null,
  holeScore = null,
  holePutts = null,
  onScoreStep,
  onPuttsStep,
  onPress,
}: CaddieDataStripProps) {
  const { t } = useTranslation();
  /**
   * 2026-09-29 (narrow-screen audit) — on a phone-width strip each cell is (W−56)/4: 80dp at 375,
   * 84 at 393. The HOLE cell's two 22-glyph arrows with 8dp padding and 4dp gaps took 84 of it, so
   * "7/18" shrank to nothing on every iPhone — invisible on the open Fold (~158dp cells). Narrow
   * screens get slimmer arrows and a wider HOLE cell; the touch target stays ~50dp via hitSlop.
   */
  const { width: screenW } = useWindowDimensions();
  // ── Scoring row: pending entry, stamped with its hole, committed once ──
  const [pendingScore, setPendingScore] = useState<number | null>(null);
  const [pendingPutts, setPendingPutts] = useState<number | null>(null);
  const pendingRef = useRef<{ hole: number | null; score: number | null; putts: number | null }>({ hole: null, score: null, putts: null });
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef<() => void>(() => undefined);
  commitRef.current = () => {
    if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
    const { hole: h, score: sc, putts: pt } = pendingRef.current;
    pendingRef.current = { hole: null, score: null, putts: null };
    setPendingScore(null);
    setPendingPutts(null);
    if (h == null) return;
    // Putts first: logPutts never moves the round; logScore's first score may advance it.
    if (pt != null) onPuttsStep?.(pt, h);
    if (sc != null) onScoreStep?.(sc, h);
  };
  // The hole changed (arrows, voice, GPS) with an entry pending → it lands on the hole it was tapped on.
  const currentHoleNum = hole.current;
  useEffect(() => {
    if (pendingRef.current.hole != null && pendingRef.current.hole !== currentHoleNum) commitRef.current();
  }, [currentHoleNum]);
  // Leaving the screen never drops a score just tapped in.
  useEffect(() => () => commitRef.current(), []);
  const narrowStrip = screenW < 500;
  void _totalScore; void _scoreVsPar;
  const lastCellLabel = 'STROKE';
  const lastCellValue = String(stroke);
  // 2026-05-21 — Fix O: stable handle for the inline hole nav arrows
  // below. Pulled once here so the inner Pressables don't re-read the
  // store on every press.
  const setCurrentHole = useRoundStore((s) => s.setCurrentHole);
  const handleHolePrev = () => {
    if (hole.current <= (hole.first ?? 1)) return;
    void Haptics.selectionAsync().catch(() => undefined);
    setCurrentHole(Math.max(hole.first ?? 1, hole.current - 1));
  };
  const handleHoleNext = () => {
    if (hole.current >= hole.total) return;
    void Haptics.selectionAsync().catch(() => undefined);
    setCurrentHole(Math.min(hole.total, hole.current + 1));
  };
  // 2026-05-22 — Ghost line. Re-renders when ghostStore mutates (activate
  // or per-hole delta from logScore). getHoleDeltaLine returns null when
  // no ghost is active, which collapses the row entirely (no chrome cost).
  const ghostLine = useGhostStore(s => {
    if (!s.ghostRecord) return null;
    return s.getHoleDeltaLine(hole.current);
  });

  // Phase 405 — off-course badge. When the offCourseDetector observes
  // the player >200y from every hole's reference points for 20s, this
  // store flips and the strip shows an amber "OFF COURSE · ~Xy" badge
  // in the top-right. Replaces the previous Phase 400-followup LIVE
  // pill placement when off-course is more important to surface than
  // live-vs-static.
  const isOffCourse = useOffCourseStore(s => s.isOffCourse);
  const yardsToNearestHole = useOffCourseStore(s => s.yardsToNearestHole);
  const { fmtCompact } = useDistanceFormat();
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
              <Text style={styles.cellLabel}>{t('caddie_data_strip.text.hole')}</Text>
              <View style={styles.holeNavRow}>
                <Pressable
                  onPress={handleHolePrev}
                  disabled={hole.current <= (hole.first ?? 1)}
                  hitSlop={14}
                  accessibilityRole="button"
                  accessibilityLabel={t('caddie_data_strip.accessibility_label.previous_hole')}
                  style={styles.holeNavBtn}
                >
                  <Ionicons
                    name="chevron-back"
                    size={24}
                    color={hole.current <= (hole.first ?? 1) ? 'rgba(107,125,114,0.35)' : 'rgba(0,200,150,0.85)'}
                  />
                </Pressable>
                <Text style={[styles.cellValue, styles.holeValue, { fontSize: 24 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{`${hole.current}/${hole.total}`}</Text>
                <Pressable
                  onPress={handleHoleNext}
                  disabled={hole.current >= hole.total}
                  hitSlop={14}
                  accessibilityRole="button"
                  accessibilityLabel={t('caddie_data_strip.accessibility_label.next_hole')}
                  style={styles.holeNavBtn}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={24}
                    color={hole.current >= hole.total ? 'rgba(107,125,114,0.35)' : 'rgba(0,200,150,0.85)'}
                  />
                </Pressable>
              </View>
            </View>
            <Animated.View style={[styles.dot, { opacity: dotAnims[0] }]} />
            <View style={styles.gridCell}>
              <Text style={styles.cellLabel}>{t('caddie_data_strip.text.plays')}</Text>
              <Text style={[styles.cellValue, { fontSize: 22 }]}>
                {playsLike != null ? String(playsLike) : '—'}
                {playsLike != null && playsLikeDelta ? (
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#88F700' }}> ({playsLikeDelta > 0 ? '+' : ''}{playsLikeDelta})</Text>
                ) : null}
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
  // 2026-07-28 (Tim — "plays-like numbers are jumbled") — the PLAYS delta was baked into the value
  // STRING ("254 (+5)") at the full 20px, so it wrapped to a second line in the narrow cell and
  // collided with the header. Carry the delta SEPARATELY and render it as a small inline span (like
  // the grid layout already does), and force the value to a single line.
  const twoRow = typeof onScoreStep === 'function';
  const cells: { label: string; value: string; delta: number | null; fontSize: number }[] = twoRow
    ? [
        { label: 'PAR',    value: par != null ? String(par) : '—',              delta: null, fontSize: 20 },
        { label: 'PLAYS',  value: playsLike != null ? String(playsLike) : '—', delta: playsLike != null && playsLikeDelta ? playsLikeDelta : null, fontSize: 20 },
        { label: 'TARGET', value: targetDirection,                             delta: null, fontSize: 14 },
      ]
    : [
        { label: 'PLAYS',  value: playsLike != null ? String(playsLike) : '—', delta: playsLike != null && playsLikeDelta ? playsLikeDelta : null, fontSize: 20 },
        { label: 'TARGET', value: targetDirection,                             delta: null, fontSize: 14 },
        { label: lastCellLabel, value: lastCellValue,                          delta: null, fontSize: 20 },
      ];
  const stepper = (
    label: string,
    value: number | null,
    onMinus: () => void,
    onPlus: () => void,
    testID: string,
  ) => (
    <View style={styles.scoreCell} testID={testID}>
      <Text style={styles.cellLabel} maxFontSizeMultiplier={1.2}>{label}</Text>
      <View style={styles.stepRow}>
        <Pressable
          onPress={onMinus}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${label.toLowerCase()} down`}
          style={styles.stepBtn}
          testID={`${testID}-minus`}
        >
          <Ionicons name="remove" size={20} color="rgba(0,200,150,0.9)" />
        </Pressable>
        <Text style={[styles.cellValue, styles.stepValue]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {value != null ? String(value) : '—'}
        </Text>
        <Pressable
          onPress={onPlus}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${label.toLowerCase()} up`}
          style={styles.stepBtn}
          testID={`${testID}-plus`}
        >
          <Ionicons name="add" size={20} color="rgba(0,200,150,0.9)" />
        </Pressable>
      </View>
    </View>
  );
  const shownScore = pendingScore ?? holeScore;
  const shownPutts = pendingPutts ?? holePutts;
  const stepEntry = (which: 'score' | 'putts', dir: 1 | -1) => () => {
    void Haptics.selectionAsync().catch(() => undefined);
    const p = pendingRef.current;
    if (p.hole != null && p.hole !== hole.current) commitRef.current();
    const cur = pendingRef.current;
    cur.hole = hole.current;
    if (which === 'score') {
      cur.score = stepHoleScore(cur.score ?? holeScore, dir, par);
      setPendingScore(cur.score);
    } else {
      cur.putts = stepHolePutts(cur.putts ?? holePutts, dir, cur.score ?? holeScore);
      setPendingPutts(cur.putts);
    }
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => commitRef.current(), STRIP_SCORE_SETTLE_MS);
  };

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { bottom: bottomOffset, opacity: mountedOpacity, transform: [{ scale: pressScale }] },
        twoRow && { height: 84 + STRIP_SCORING_ROW_HEIGHT },
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
          <View style={[styles.cell, narrowStrip && styles.holeCellNarrow]}>
            <Text style={styles.cellLabel}>{t('caddie_data_strip.text.hole')}</Text>
            <View style={[styles.holeNavRow, narrowStrip && styles.holeNavRowNarrow]}>
              <Pressable
                onPress={handleHolePrev}
                disabled={hole.current <= (hole.first ?? 1)}
                hitSlop={narrowStrip ? 18 : 14}
                accessibilityRole="button"
                accessibilityLabel={t('caddie_data_strip.accessibility_label.previous_hole')}
                style={[styles.holeNavBtn, narrowStrip && styles.holeNavBtnNarrow]}
              >
                <Ionicons
                  name="chevron-back"
                  size={narrowStrip ? 18 : 22}
                  color={hole.current <= (hole.first ?? 1) ? 'rgba(107,125,114,0.35)' : 'rgba(0,200,150,0.85)'}
                />
              </Pressable>
              <Text style={[styles.cellValue, styles.holeValue, { fontSize: 22 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{`${hole.current}/${hole.total}`}</Text>
              <Pressable
                onPress={handleHoleNext}
                disabled={hole.current >= hole.total}
                hitSlop={narrowStrip ? 18 : 14}
                accessibilityRole="button"
                accessibilityLabel={t('caddie_data_strip.accessibility_label.next_hole')}
                style={[styles.holeNavBtn, narrowStrip && styles.holeNavBtnNarrow]}
              >
                <Ionicons
                  name="chevron-forward"
                  size={narrowStrip ? 18 : 22}
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
                <Text
                  style={[styles.cellValue, { fontSize: cell.fontSize }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {cell.value}
                  {cell.delta ? (
                    <Text style={styles.cellDelta}> ({cell.delta > 0 ? '+' : ''}{cell.delta})</Text>
                  ) : null}
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
        {twoRow && (
          <View style={styles.scoreRow}>
            {stepper('SCORE', shownScore, stepEntry('score', -1), stepEntry('score', 1), 'strip-score')}
            <View style={styles.scoreDivider} />
            {stepper('PUTTS', shownPutts, stepEntry('putts', -1), stepEntry('putts', 1), 'strip-putts')}
            <View style={styles.scoreDivider} />
            <View style={styles.strokeCell}>
              <Text style={styles.cellLabel} maxFontSizeMultiplier={1.2}>{lastCellLabel}</Text>
              <Text style={[styles.cellValue, { fontSize: 20 }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>{lastCellValue}</Text>
            </View>
          </View>
        )}
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
                yardageSource === 'building' ? { opacity: 0.9 } : null,
              ]}
            >
              {yardageSource === 'live' ? 'LIVE' : yardageSource === 'building' ? 'MAPPING…' : 'STATIC'}
            </Text>
          </View>
        )}
        {/* 2026-09-29 (narrow-screen audit) — the OFF COURSE pill (~124dp wide) and the cart/walk pill
            were each absolutely positioned (right 8 / right 78) and overlapped whenever both showed.
            One right-aligned row now lays them out side by side. */}
        {(isOffCourse || movementMode === 'cart' || movementMode === 'walking') && (
          <View style={styles.topRightRow} pointerEvents="none">
            {(movementMode === 'cart' || movementMode === 'walking') && (
              <View style={[styles.movementPill, styles.inRow]}>
                <Ionicons
                  name={movementMode === 'cart' ? 'car-outline' : 'walk-outline'}
                  size={10}
                  color="#9ca3af"
                />
              </View>
            )}
            {isOffCourse && (
              <View style={[styles.offCoursePill, styles.inRow]}>
                <Ionicons name="warning-outline" size={9} color="#fbbf24" />
                <Text style={styles.offCoursePillText}>
                  {yardsToNearestHole != null ? `OFF COURSE · ${fmtCompact(yardsToNearestHole)}` : 'OFF COURSE'}
                </Text>
              </View>
            )}
          </View>
        )}
        {/* 2026-05-22 — Ghost Rounds. A thin top stripe that renders only
            when a ghost is active. Doesn't displace the existing cells
            (positioned absolute above the data row) so the strip's height
            stays at 84 in the layout sense. Tap routes the same as the
            rest of the strip (expand cockpit). */}
        {paceLine ? (
          <View style={[styles.ghostStripe, twoRow && { bottom: STRIP_SCORING_ROW_HEIGHT + 1 }]}>
            <Ionicons name="timer-outline" size={9} color="#a78bfa" />
            <Text style={styles.ghostStripeText} numberOfLines={1} maxFontSizeMultiplier={1.1}>
              {ghostLine ? `${paceLine} · ${ghostLine}` : paceLine}
            </Text>
          </View>
        ) : ghostLine ? (
          <View style={[styles.ghostStripe, twoRow && { bottom: STRIP_SCORING_ROW_HEIGHT + 1 }]}>
            <Ionicons name="footsteps-outline" size={9} color="#a78bfa" />
            <Text style={styles.ghostStripeText} numberOfLines={1} maxFontSizeMultiplier={1.1}>
              {ghostLine}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /**
   * ── Horizontal (portrait) wrapper ────────
   *
   * 2026-09-11 (Tim's inspiration board) — this was a flush edge-to-edge bar with square corners and
   * a top hairline, because it used to butt against the page below a boxed hero. The reference this
   * tab was designed from floats ONE rounded data pill over a full-bleed portrait, and the hero is
   * now full-bleed, so the strip is inset and rounded to match. Every cell it carries is unchanged —
   * Tim: "it cannot erase the added functions we have, would like it to be a blend of the two."
   *
   * Still as low as it can sit (the Phase AT instruction): a 10dp float is what makes it read as a
   * pill ON the portrait rather than a bar bolted to the tab row.
   */
  wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 10,
    right: 10,
    height: 84,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 40, 0.5)',
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
    // 2026-07-28 (containment) — reserve a top band so the absolutely-positioned status pills
    // (STATIC/LIVE top-left, OFF COURSE top-right) sit ABOVE the cell labels instead of overlapping
    // them. Values are single-line now, so there's vertical room for this.
    paddingTop: 10,
  },
  // ── Scoring row (two-row strip) ──────────
  scoreRow: {
    height: STRIP_SCORING_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(107, 125, 114, 0.35)',
  },
  scoreCell: { flex: 1.3, alignItems: 'center', justifyContent: 'center' },
  strokeCell: { flex: 0.8, alignItems: 'center', justifyContent: 'center' },
  scoreDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: 'rgba(107, 125, 114, 0.35)' },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  stepBtn: {
    width: 32,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 200, 150, 0.12)',
  },
  stepValue: { fontSize: 20, minWidth: 30, textAlign: 'center' },
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
  // 2026-07-28 — small green PLAYS delta span, sized so "254 (+5)" stays on ONE line in the cell.
  cellDelta: {
    fontSize: 12,
    fontWeight: '800',
    color: '#88F700',
  },
  // 2026-05-21 — Fix O: hole-nav arrow row used by both horizontal and
  // grid layouts. Compact ◀/▶ around the hole value. Inner Pressables
  // own their own taps; the value text between them still propagates
  // to the outer expand-to-cockpit handler.
  holeNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  // 2026-07-28 (containment) — the hole value shrinks to fit its flex cell (with the ◀/▶ steppers)
  // on a narrow/folded strip instead of overflowing into the neighbouring PLAYS cell.
  holeValue: {
    flexShrink: 1,
    textAlign: 'center',
  },
  // 2026-06-13 (Tim) — the bottom-strip hole arrows were too small to hit on the
  // course. Bigger glyphs (below) + a real ~36px touch target here.
  holeNavBtn: {
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holeNavBtnNarrow: { paddingHorizontal: 1 },
  holeNavRowNarrow: { gap: 0 },
  // At 320dp: cell ≈ 1.4/4.4 of 264 = 84; arrows 2×(18+2) = 40 → ~44dp for "18/18" (fits ≥0.6 scale).
  holeCellNarrow: { flex: 1.4 },
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
  topRightRow: {
    position: 'absolute', top: 4, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  inRow: { position: 'relative', top: undefined, right: undefined },
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
  // 2026-05-22 — Ghost stripe (purple = "from the past"). Absolute-positioned
  // along the bottom edge of the strip so it doesn't squeeze the existing
  // cells. ~14px tall; intentionally small so the live data stays primary.
  ghostStripe: {
    position: 'absolute',
    bottom: 2,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 14,
  },
  ghostStripeText: {
    color: '#c4b5fd',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
});
