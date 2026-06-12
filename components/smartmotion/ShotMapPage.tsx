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
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ClubId } from '../../services/clubRecognition';
import { fullCarryYards } from '../../services/swing/carryEstimate';

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

const LIME = '#88F700';

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
  colors,
  topInset,
  onBack,
  width,
  style,
}: {
  mode: 'cage' | 'range' | 'course';
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
  colors: ThemeColors;
  topInset: number;
  onBack: () => void;
  width: number;
  style?: StyleProp<ViewStyle>;
}) {
  // Lateral fraction (−1 left … +1 right), capped at ~25° = full deflection.
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
        <Text style={[styles.header, { color: colors.text_primary }]}>SHOT MAP</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onBack} hitSlop={8} style={[styles.backChip, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={14} color={colors.text_muted} />
          <Text style={[styles.backChipText, { color: colors.text_muted }]}>Capture</Text>
        </Pressable>
      </View>

      {mode === 'cage' ? (
        <CageBullseye
          lateral={lateral}
          dirLabel={dirLabel}
          canvasFeet={canvasFeet}
          cameraBehindFeet={cameraBehindFeet}
          onChangeCanvasFeet={onChangeCanvasFeet}
          onChangeCameraBehindFeet={onChangeCameraBehindFeet}
          colors={colors}
        />
      ) : (
        <CourseMap
          club={club}
          handicap={handicap}
          learnedCarry={learnedCarry}
          estCarry={estCarry}
          effortPct={effortPct}
          lateral={lateral}
          dirLabel={dirLabel}
          colors={colors}
        />
      )}
    </ScrollView>
  );
}

// ─── Full-swing vertical "course" map ────────────────────────────────
function CourseMap({
  club, handicap, learnedCarry, estCarry, effortPct, lateral, dirLabel, colors,
}: {
  club: ClubId | null;
  handicap: number | null;
  learnedCarry: number | null;
  estCarry: number | null;
  effortPct: number | null;
  lateral: number;
  dirLabel: string | null;
  colors: ThemeColors;
}) {
  // Scale the field to the club's full carry (so a 7-iron map isn't driver-sized),
  // floored so a tiny club still reads. estCarry is the partial-effort estimate.
  const full = fullCarryYards(club, handicap, learnedCarry);
  const maxRange = Math.max(full ?? 0, estCarry ?? 0, 120);
  const downFrac = estCarry != null ? Math.min(1, estCarry / maxRange) : null;
  const has = estCarry != null;

  return (
    <View style={styles.body}>
      <View style={styles.fieldWrap}>
        <LinearGradient
          colors={['#0c2a17', '#0a3a1f', '#093e21']}
          style={styles.field}
        >
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
            <View
              style={[
                styles.ball,
                { bottom: `${Math.max(2, downFrac * 96)}%`, left: `${50 + lateral * 38}%` },
              ]}
            >
              <View style={styles.ballDot} />
              <View style={styles.ballPill}>
                <Text style={styles.ballPillText}>~{estCarry}y</Text>
              </View>
            </View>
          ) : null}
        </LinearGradient>
      </View>

      {has ? (
        <View style={styles.readRow}>
          <Stat label="CARRY" value={`~${estCarry}y`} colors={colors} est />
          <Stat label="DIRECTION" value={dirLabel ?? '—'} colors={colors} est={!!dirLabel} />
          <Stat label="EFFORT" value={effortPct != null ? `${effortPct}%` : '—'} colors={colors} />
        </View>
      ) : (
        <Text style={[styles.empty, { color: colors.text_muted }]}>
          Set your target effort on the capture screen, then record a down-the-line swing — your shot plots here from the effort estimate and the ball-trace start direction.
        </Text>
      )}
      <Text style={[styles.note, { color: colors.text_muted }]}>
        Estimated from your club × effort and the acoustic-anchored trace. Refines as your real carry data builds.
      </Text>
    </View>
  );
}

// ─── Cage bullseye + confirmable geometry ────────────────────────────
function CageBullseye({
  lateral, dirLabel, canvasFeet, cameraBehindFeet, onChangeCanvasFeet, onChangeCameraBehindFeet, colors,
}: {
  lateral: number;
  dirLabel: string | null;
  canvasFeet: number;
  cameraBehindFeet: number;
  onChangeCanvasFeet: (n: number) => void;
  onChangeCameraBehindFeet: (n: number) => void;
  colors: ThemeColors;
}) {
  const rings = [1, 0.74, 0.5, 0.28];
  const hasImpact = dirLabel != null;
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
                  borderColor: i === rings.length - 1 ? LIME : 'rgba(136,247,0,0.4)',
                },
              ]}
            />
          ))}
          {/* crosshair */}
          <View style={styles.crossH} />
          <View style={styles.crossV} />
          {/* estimated impact — lateral start only (depth/height need higher fps) */}
          {hasImpact ? (
            <View style={[styles.impact, { left: `${50 + lateral * 42}%` }]}>
              <View style={styles.impactDot} />
            </View>
          ) : null}
        </View>
        {hasImpact ? (
          <View style={styles.impactLabel}>
            <Text style={styles.impactLabelText}>est · preview · {dirLabel} start</Text>
          </View>
        ) : null}
      </View>

      {/* Confirmable geometry */}
      <View style={[styles.geoCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
        <Text style={[styles.geoTitle, { color: colors.text_muted }]}>CONFIRM YOUR CAGE SETUP</Text>
        <Stepper label="Ball → canvas" value={canvasFeet} unit="ft" onChange={onChangeCanvasFeet} min={1} colors={colors} />
        <Stepper label="Camera behind you" value={cameraBehindFeet} unit="ft" onChange={onChangeCameraBehindFeet} min={0} colors={colors} />
        <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.totalLabel, { color: colors.text_secondary }]}>Throw distance</Text>
          <Text style={[styles.totalValue, { color: colors.accent }]}>{canvasFeet + cameraBehindFeet} ft</Text>
        </View>
      </View>
      <Text style={[styles.note, { color: colors.text_muted }]}>
        Lateral start comes from the acoustic-anchored trace; depth + height on the bullseye sharpen with higher-frame-rate capture. Line the rings up over your net&apos;s bullseye.
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
  gridLabel: { position: 'absolute', right: 6, bottom: 2, color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: '700' },
  centerLine: { position: 'absolute', left: '50%', top: '4%', bottom: '6%', width: 1, marginLeft: -0.5, backgroundColor: 'rgba(255,255,255,0.18)' },
  tee: { position: 'absolute', bottom: '3%', left: '50%', marginLeft: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', opacity: 0.85 },
  ball: { position: 'absolute', alignItems: 'center', marginLeft: -6 },
  ballDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: LIME, borderWidth: 2, borderColor: '#06281b' },
  ballPill: { marginTop: 2, backgroundColor: 'rgba(6,15,9,0.85)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  ballPillText: { color: LIME, fontSize: 10, fontWeight: '800' },

  readRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 9 },
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

  geoCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 4 },
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
