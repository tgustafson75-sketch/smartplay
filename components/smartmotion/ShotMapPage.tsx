/**
 * 2026-06-12 — Smart Motion PAGE 3: the SHOT MAP (Tim).
 *
 * Two honest views, gated to down-the-line modes:
 *   • RANGE / COURSE (full swing) — a vertical "course" rectangle. The shot is
 *     plotted from REAL signals only: downrange position = the effort→carry
 *     estimate (carryEstimate.ts), lateral = the acoustic-anchored DTL ball-trace
 *     start direction. Both are labeled "est"; with no read the field shows an
 *     empty state, never a fabricated dot.
 *   • CAGE — a bullseye the user lines up over their net's bullseye, plus the
 *     CONFIRMABLE geometry (distance to the canvas + camera-behind) that defines
 *     the true throw distance. The estimated impact marker is the lateral start
 *     from the trace ONLY (cage depth/height needs higher-fps capture), shown as
 *     "est · preview" — honest about what today's capture can and can't resolve.
 *
 * No fabricated data: every number traces to a real measurement (trace, effort)
 * or a user-confirmed input (the two distances).
 *
 * 2026-09-12 (Tim) — "the range shot map has not reported right. User knows if they just hit 250
 * plus and where, and could tap it, and then the caddie would update the yardage data and overall
 * logic."
 *
 * THE RANGE IS THE OPPOSITE CASE TO THE CAGE, and the rule flips with it. In a cage the camera sees
 * everything, so asking the player to tap is a design failure. On a RANGE the ball leaves the
 * measurable volume entirely — nothing on this phone can see where a 250-yard drive landed — while
 * the player watched it land next to a marker. There the player IS the sensor, and asking is not a
 * fallback, it is the only ground truth available.
 *
 * Until now the downrange dot was fullCarryYards(club, effort) — an estimate off an industry table
 * scaled by handicap, which carryEstimate itself flags as a placeholder ("(future) explicit user
 * club-distance setting — none exists yet"). Honest, labelled "est", and still not his shot.
 *
 * One tap now reports the real one. It goes to clubStatsStore through recordTotal, so it improves
 * every club call the caddie makes rather than decorating one screen — and that path already gates
 * on isPlausibleForClub, so a stray tap cannot poison a ladder.
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ClubId } from '../../services/clubRecognition';
import { fullCarryYards } from '../../services/swing/carryEstimate';
import { useTranslation } from 'react-i18next';

export interface ShotTrace {
  side: 'left' | 'right' | 'straight';
  divergenceDeg: number;
}

interface ThemeColors {
  background: string;
  surface_elevated: string;
  border: string;
  text_primary: string;
  text_secondary: string;
  text_muted: string;
  accent: string;
}

// 2026-06-12 — bright lime (#88F700) reads great on the dark camera overlay but WASHES
// OUT on the light theme's near-white background (Tim). Use a darker, saturated green for
// the light-mode strokes/values so the bullseye + numbers keep real contrast.
const limeFor = (isDark: boolean) => (isDark ? '#88F700' : '#2f7d12');
const ringFaintFor = (isDark: boolean) => (isDark ? 'rgba(136,247,0,0.4)' : 'rgba(47,125,18,0.5)');
const crossFor = (isDark: boolean) => (isDark ? 'rgba(136,247,0,0.3)' : 'rgba(47,125,18,0.4)');

export function ShotMapPage({
  mode,
  club,
  handicap,
  learnedCarry,
  estCarry,
  effortPct,
  trace,
  canvasFeet,
  cameraBehindFeet,
  onChangeCanvasFeet,
  onChangeCameraBehindFeet,
  onReportShot,
  reported,
  colors,
  isDark,
  topInset,
  onBack,
  width,
  style,
}: {
  mode: 'course' | 'range' | 'sim';
  club: ClubId | null;
  handicap: number | null;
  learnedCarry: number | null;
  estCarry: number | null;
  effortPct: number | null;
  trace: ShotTrace | null;
  canvasFeet: number;
  cameraBehindFeet: number;
  onChangeCanvasFeet: (n: number) => void;
  onChangeCameraBehindFeet: (n: number) => void;
  /**
   * Range only. Fired when the player taps where the shot actually finished.
   * `yards` is distance down the field; `lateralFrac` is −1 (left) … +1 (right).
   */
  onReportShot?: (yards: number, lateralFrac: number) => void;
  /** The reported shot for THIS swing, once given — plotted instead of the estimate. */
  reported?: { yards: number; lateralFrac: number } | null;
  colors: ThemeColors;
  isDark: boolean;
  topInset: number;
  onBack: () => void;
  width: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  // Lateral fraction (−1 left … +1 right), capped at ~25° = full deflection.
  /**
   * 2026-08-26 (adversarial pass) — `lateral` collapsed TWO different states onto 0: a trace that
   * measured ON LINE, and NO TRACE AT ALL. The dot was plotted dead centre either way, so a swing
   * whose launch direction we never read was drawn as a shot hit straight down the middle. The
   * DIRECTION stat said "—" honestly while the dot — the thing the eye actually reads — asserted
   * the opposite.
   *
   * This file's own header promises "with no read the field shows an empty state, never a
   * fabricated dot" and "every number traces to a real measurement". The centre-by-default dot was
   * exactly the fabrication it forbids.
   */
  const lateralKnown = trace != null;
  const lateral = trace && trace.side !== 'straight'
    ? Math.min(1, trace.divergenceDeg / 25) * (trace.side === 'left' ? -1 : 1)
    : 0;
  const dirLabel = trace
    ? trace.side === 'straight' ? 'ON LINE' : `${trace.divergenceDeg}° ${trace.side === 'left' ? 'L' : 'R'}`
    : null;

  return (
    <ScrollView
      style={[{ width, backgroundColor: colors.background }, style]}
      contentContainerStyle={{ paddingTop: topInset + 8, paddingBottom: 28 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <Ionicons name="map-outline" size={16} color={colors.accent} />
        <Text style={[styles.header, { color: colors.text_primary }]}>{t('smartmotion_shot_map_page.shot_map_page.shot_map')}</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onBack} hitSlop={8} style={[styles.backChip, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={14} color={colors.text_muted} />
          <Text style={[styles.backChipText, { color: colors.text_muted }]}>{t('smartmotion_shot_map_page.shot_map_page.capture')}</Text>
        </Pressable>
      </View>

      {mode === 'sim' ? (
        <CageBullseye
          lateral={lateral}
          dirLabel={dirLabel}
          canvasFeet={canvasFeet}
          cameraBehindFeet={cameraBehindFeet}
          onChangeCanvasFeet={onChangeCanvasFeet}
          onChangeCameraBehindFeet={onChangeCameraBehindFeet}
          colors={colors}
          isDark={isDark}
        />
      ) : (
        <CourseMap
          club={club}
          handicap={handicap}
          learnedCarry={learnedCarry}
          estCarry={estCarry}
          lateralKnown={lateralKnown}
          effortPct={effortPct}
          lateral={lateral}
          dirLabel={dirLabel}
          onReportShot={onReportShot}
          reported={reported ?? null}
          colors={colors}
        />
      )}
    </ScrollView>
  );
}

// ─── Full-swing vertical "course" map ────────────────────────────────
function CourseMap({
  club, handicap, learnedCarry, estCarry, effortPct, lateral, lateralKnown, dirLabel,
  onReportShot, reported, colors,
}: {
  club: ClubId | null;
  handicap: number | null;
  learnedCarry: number | null;
  estCarry: number | null;
  effortPct: number | null;
  lateral: number;
  /** False when no ball-trace was read — the downrange estimate stands, the LINE does not. */
  lateralKnown: boolean;
  dirLabel: string | null;
  onReportShot?: (yards: number, lateralFrac: number) => void;
  reported?: { yards: number; lateralFrac: number } | null;
  colors: ThemeColors;
}) {
  const { t } = useTranslation();
  // Scale the field to the club's full carry (so a 7-iron map isn't driver-sized),
  // floored so a tiny club still reads. estCarry is the partial-effort estimate.
  const full = fullCarryYards(club, handicap, learnedCarry);
  /**
   * 2026-09-12 — the field must reach FURTHER than the estimate, or a player who out-hits the model
   * cannot tap where the ball actually went. Headroom of a third above whatever we think, so "I hit
   * that 250" is reachable on a map built from a 190-yard guess.
   */
  const maxRange = Math.round(Math.max((full ?? 0) * 1.35, (estCarry ?? 0) * 1.35, reported?.yards ? reported.yards * 1.1 : 0, 120));
  const [fieldH, setFieldH] = React.useState(0);
  const fieldWidthRef = React.useRef(1);

  /** A reported shot REPLACES the estimate — it is a measurement and the estimate never was. */
  const plotYards = reported?.yards ?? estCarry;
  const plotLateral = reported ? reported.lateralFrac : lateral;
  const plotLateralKnown = reported ? true : lateralKnown;
  const downFrac = plotYards != null ? Math.min(1, plotYards / maxRange) : null;
  const has = plotYards != null;

  const onFieldTap = React.useCallback((e: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!onReportShot || fieldH <= 0) return;
    const { locationX, locationY } = e.nativeEvent;
    // The field is bottom-anchored at the tee, so distance grows UPWARD.
    const yards = Math.round(Math.max(1, (1 - locationY / fieldH) * maxRange));
    // styles.ball uses left: 50% + lateral*38, so invert that to keep the dot under the finger.
    const lateralFrac = Math.max(-1, Math.min(1, ((locationX / Math.max(1, fieldWidthRef.current)) * 100 - 50) / 38));
    onReportShot(yards, lateralFrac);
  }, [onReportShot, fieldH, maxRange]);

  return (
    <View style={styles.body}>
      <View style={styles.fieldWrap}>
        <LinearGradient
          colors={['#0c2a17', '#0a3a1f', '#093e21']}
          style={styles.field}
          onLayout={(e) => {
            setFieldH(e.nativeEvent.layout.height);
            fieldWidthRef.current = e.nativeEvent.layout.width;
          }}
        >
          {/**
            * 2026-09-12 — TAP WHERE IT ACTUALLY FINISHED.
            *
            * Covers the whole field, behind the markers, so the gridlines and the dot stay readable.
            * Only mounted when a handler is supplied — the cage view must never become tappable,
            * because there the camera can see the answer and asking would be the design failure.
            */}
          {onReportShot ? (
            <Pressable
              onPress={onFieldTap}
              style={StyleSheet.absoluteFill}
              accessibilityRole="button"
              accessibilityLabel={t('smartmotion_shot_map_page.a11y.tap_where_the_shot_finished')}
            />
          ) : null}
          {/* yard gridlines */}
          {[0.25, 0.5, 0.75].map((f) => (
            <View key={f} style={[styles.gridline, { bottom: `${f * 100}%` }]}>
              <Text style={styles.gridLabel}>{Math.round(maxRange * f)}y</Text>
            </View>
          ))}
          {/* center aim line */}
          <View style={styles.centerLine} />
          {/* tee */}
          <View style={styles.tee} />
          {/* ball marker — only when we have an honest carry estimate */}
          {has && downFrac != null ? (
            plotLateralKnown ? (
              <View
                style={[
                  styles.ball,
                  { bottom: `${Math.max(2, downFrac * 96)}%`, left: `${50 + plotLateral * 38}%` },
                ]}
              >
                <View style={styles.ballDot} />
                <View style={styles.ballPill}>
                  {/* A reported shot is a MEASUREMENT and drops the "~" that marks an estimate. */}
                  <Text style={styles.ballPillText}>{reported ? `${reported.yards}y` : `~${estCarry}y`}</Text>
                </View>
              </View>
            ) : (
              /* Distance read, line NOT read — a band across the field at that distance says
                 "somewhere along here", which is the truth. A dot would say "straight". */
              <View style={[styles.distanceBand, { bottom: `${Math.max(2, downFrac * 96)}%` }]}>
                <View style={styles.distanceBandLine} />
                <View style={styles.ballPill}>
                  <Text style={styles.ballPillText}>{t('smartmotion_shot_map_page.course_map.y_line_not_read', { estCarry: plotYards })}</Text>
                </View>
              </View>
            )
          ) : null}
        </LinearGradient>
      </View>

      {has ? (
        <View style={styles.readRow}>
          {/* 2026-07-07 (audit M2) — this is a PLANNED carry (full-club distance ×
              your target effort), NOT a measured outcome. Label it so a chunk that
              flew 30y isn't shown here as "~129y CARRY" like a real result. */}
          <Stat label={t('smartmotion_shot_map_page.label.plan_carry')} value={`~${estCarry}y`} colors={colors} est />
          <Stat label={t('smartmotion_shot_map_page.label.direction')} value={dirLabel ?? 'not read'} colors={colors} est={!!dirLabel} />
          <Stat label={t('smartmotion_shot_map_page.label.effort')} value={effortPct != null ? `${effortPct}%` : '—'} colors={colors} />
        </View>
      ) : (
        <Text style={[styles.empty, { color: colors.text_muted }]}>
          {t('smartmotion_shot_map_page.course_map.set_your_target_effort_on')}
        </Text>
      )}
      <Text style={[styles.note, { color: colors.text_muted }]}>
        {t('smartmotion_shot_map_page.course_map.estimated_from_your_club_effort')}
      </Text>
    </View>
  );
}

// ─── Cage bullseye + confirmable geometry ────────────────────────────
function CageBullseye({
  lateral, dirLabel, canvasFeet, cameraBehindFeet, onChangeCanvasFeet, onChangeCameraBehindFeet, colors, isDark,
}: {
  lateral: number;
  dirLabel: string | null;
  canvasFeet: number;
  cameraBehindFeet: number;
  onChangeCanvasFeet: (n: number) => void;
  onChangeCameraBehindFeet: (n: number) => void;
  colors: ThemeColors;
  isDark: boolean;
}) {
  const { t } = useTranslation();
  const rings = [1, 0.74, 0.5, 0.28];
  const hasImpact = dirLabel != null;
  const lime = limeFor(isDark);
  const ringFaint = ringFaintFor(isDark);
  const cross = crossFor(isDark);
  return (
    <View style={styles.body}>
      <View style={styles.bullseyeWrap}>
        <View style={styles.bullseye}>
          {rings.map((r, i) => (
            <View
              key={r}
              style={[
                styles.ring,
                {
                  width: `${r * 100}%`,
                  height: `${r * 100}%`,
                  borderColor: i === rings.length - 1 ? lime : ringFaint,
                },
              ]}
            />
          ))}
          {/* crosshair */}
          <View style={[styles.crossH, { backgroundColor: cross }]} />
          <View style={[styles.crossV, { backgroundColor: cross }]} />
          {/* estimated impact — lateral start only (depth/height need higher fps) */}
          {hasImpact ? (
            <View style={[styles.impact, { left: `${50 + lateral * 42}%` }]}>
              <View style={styles.impactDot} />
            </View>
          ) : null}
        </View>
        {hasImpact ? (
          <View style={styles.impactLabel}>
            <Text style={styles.impactLabelText}>{t('smartmotion_shot_map_page.cage_bullseye.est_preview_start', { dirLabel })}</Text>
          </View>
        ) : null}
      </View>

      {/* Confirmable geometry */}
      <View style={[styles.geoCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
        <Text style={[styles.geoTitle, { color: colors.text_muted }]}>{t('smartmotion_shot_map_page.cage_bullseye.confirm_your_cage_setup')}</Text>
        <Stepper label={t('smartmotion_shot_map_page.label.ball_canvas')} value={canvasFeet} unit="ft" onChange={onChangeCanvasFeet} min={1} colors={colors} />
        <Stepper label={t('smartmotion_shot_map_page.label.camera_behind_you')} value={cameraBehindFeet} unit="ft" onChange={onChangeCameraBehindFeet} min={0} colors={colors} />
        <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.totalLabel, { color: colors.text_secondary }]}>{t('smartmotion_shot_map_page.cage_bullseye.throw_distance')}</Text>
          <Text style={[styles.totalValue, { color: colors.accent }]}>{t('smartmotion_shot_map_page.cage_bullseye.ft', { camera_behind_feet: Math.max(1, canvasFeet + cameraBehindFeet) })}</Text>
        </View>
      </View>
      <Text style={[styles.note, { color: colors.text_muted }]}>
        {t('smartmotion_shot_map_page.cage_bullseye.lateral_start_comes_from_the')}
      </Text>
    </View>
  );
}

function Stepper({
  label, value, unit, onChange, min, colors,
}: {
  label: string; value: number; unit: string; onChange: (n: number) => void; min: number; colors: ThemeColors;
}) {
  return (
    <View style={styles.stepRow}>
      <Text style={[styles.stepLabel, { color: colors.text_secondary }]}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} hitSlop={8} style={[styles.stepBtn, { borderColor: colors.border }]}>
        <Ionicons name="remove" size={16} color={colors.text_primary} />
      </Pressable>
      <Text style={[styles.stepValue, { color: colors.text_primary }]}>{value}<Text style={styles.stepUnit}> {unit}</Text></Text>
      <Pressable onPress={() => onChange(value + 1)} hitSlop={8} style={[styles.stepBtn, { borderColor: colors.border }]}>
        <Ionicons name="add" size={16} color={colors.text_primary} />
      </Pressable>
    </View>
  );
}

function Stat({ label, value, colors, est }: { label: string; value: string; colors: ThemeColors; est?: boolean }) {
  return (
    <View style={[styles.stat, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
      <View style={styles.statTop}>
        <Text style={[styles.statLabel, { color: colors.text_muted }]} numberOfLines={1}>{label}</Text>
        {est ? <Text style={[styles.estChip, { color: colors.text_muted, borderColor: colors.border }]}>est</Text> : null}
      </View>
      <Text style={[styles.statValue, { color: colors.text_primary }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 },
  header: { fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  backChip: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 },
  backChipText: { fontSize: 11, fontWeight: '700' },
  body: { paddingHorizontal: 14, paddingTop: 6, gap: 12 },

  // course
  fieldWrap: { alignItems: 'center' },
  field: { width: '54%', aspectRatio: 0.6, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(136,247,0,0.25)' },
  gridline: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center' },
  gridLabel: { position: 'absolute', right: 6, bottom: 2, color: 'rgba(255,255,255,0.75)', fontSize: 9, fontWeight: '700' },
  centerLine: { position: 'absolute', left: '50%', top: '4%', bottom: '6%', width: 1, marginLeft: -0.5, backgroundColor: 'rgba(255,255,255,0.18)' },
  tee: { position: 'absolute', bottom: '3%', left: '50%', marginLeft: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', opacity: 0.85 },
  ball: { position: 'absolute', alignItems: 'center', marginLeft: -6 },
  distanceBand: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  distanceBandLine: { alignSelf: 'stretch', height: 2, backgroundColor: 'rgba(136,247,0,0.32)' },
  ballDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#88F700', borderWidth: 2, borderColor: '#06281b' },
  ballPill: { marginTop: 2, backgroundColor: 'rgba(6,15,9,0.85)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  ballPillText: { color: '#88F700', fontSize: 10, fontWeight: '800' },

  readRow: { flexDirection: 'row', gap: 8 },
  // 2026-06-12 — soft shadow so cards separate from a LIGHT-mode near-white background
  // (Tim: cards washed out). Subtle enough to be invisible on the dark theme.
  stat: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 9, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 0.6, flexShrink: 1 },
  estChip: { fontSize: 7, fontWeight: '800', borderWidth: 1, borderRadius: 4, paddingHorizontal: 3, overflow: 'hidden' },
  statValue: { fontSize: 16, fontWeight: '900', marginTop: 2 },
  empty: { fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: 6 },
  note: { fontSize: 10.5, lineHeight: 15, textAlign: 'center', paddingHorizontal: 4, paddingBottom: 8 },

  // cage
  bullseyeWrap: { alignItems: 'center', gap: 6 },
  bullseye: { width: '62%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1.5, borderRadius: 999 },
  crossH: { position: 'absolute', width: '62%', height: 1, backgroundColor: 'rgba(136,247,0,0.3)' },
  crossV: { position: 'absolute', height: '62%', width: 1, backgroundColor: 'rgba(136,247,0,0.3)' },
  impact: { position: 'absolute', top: '50%', marginTop: -7, marginLeft: -7 },
  impactDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#f5c451', borderWidth: 2, borderColor: '#06281b' },
  impactLabel: { backgroundColor: 'rgba(6,15,9,0.85)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  impactLabelText: { color: '#f5c451', fontSize: 10, fontWeight: '700' },

  geoCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 4, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  geoTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  stepLabel: { fontSize: 13, fontWeight: '600' },
  stepBtn: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontSize: 15, fontWeight: '900', minWidth: 46, textAlign: 'center' },
  stepUnit: { fontSize: 10, fontWeight: '700' },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, marginTop: 6, paddingTop: 8 },
  totalLabel: { fontSize: 12, fontWeight: '700' },
  totalValue: { fontSize: 16, fontWeight: '900' },
});
