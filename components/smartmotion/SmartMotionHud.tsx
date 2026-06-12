/**
 * 2026-06-07 — Smart Motion HUD kit (rebuild Phase 1).
 *
 * Presentational components for the redesigned Smart Motion surface,
 * matching the clean launch-monitor mockups in
 * `~/Downloads/SmartMotion Redesign Pics`:
 *   - dark chrome + brand green (#00C896 / colors.accent)
 *   - right-rail metric cards, bottom speed stats + tempo + body row
 *   - "Ball Smash Detected" acoustic card
 *   - Down-the-Line / Face-On segmented toggle
 *   - GOOD SWING verdict badge + footer chips
 *
 * These are PURE presentation — no data fetching, no capture logic.
 * The unified Smart Motion screen feeds them from the real pipelines
 * (swingMetricsService, pose biomechanics, acoustic segmentation).
 *
 * Metric honesty (see memory smartmotion-metrics-honesty): we do NOT
 * render spin rate / face angle / launch angle — a phone + single mic
 * can't measure them. Cards carry an `estimate` flag so AI/pose-derived
 * values read as estimates, consistent with swingMetricsService tiering.
 */

import React from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type DimensionValue,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../theme/tokens';

// 2026-06-12 — acoustic status badges (Tim's set) for the pickup card header.
const ICON_ACOUSTIC = {
  listening: require('../../assets/icons/smartmotion/acoustic-listening.png'),
  strike: require('../../assets/icons/smartmotion/acoustic-strike.png'),
  silent: require('../../assets/icons/smartmotion/acoustic-silent.png'),
  confirmed: require('../../assets/icons/smartmotion/acoustic-confirmed.png'),
};

export type Angle = 'down_the_line' | 'face_on';
export type SmTone = 'good' | 'warn' | 'bad' | 'neutral';

function toneColor(tone: SmTone, colors: ThemeColors): string {
  switch (tone) {
    case 'good': return colors.success;
    case 'warn': return colors.warning;
    case 'bad': return colors.error;
    default: return colors.text_muted;
  }
}

// ─── Header ──────────────────────────────────────────────────────────

export function SmartMotionHeader({
  mode,
  onSettings,
  style,
}: {
  mode: Angle;
  onSettings?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const subtitle = mode === 'down_the_line' ? 'DOWN THE LINE ANALYSIS' : 'FACE-ON ANALYSIS';
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }, style]}>
      <View style={styles.headerBrand}>
        <Text numberOfLines={1} style={[styles.brandWordmark, { color: colors.text_primary }]}>SMARTMOTION</Text>
        <Text numberOfLines={1} style={[styles.brandSub, { color: colors.accent }]}>{subtitle}</Text>
      </View>
      {onSettings ? (
        <Pressable onPress={onSettings} hitSlop={10} accessibilityRole="button" accessibilityLabel="Settings">
          <Ionicons name="settings-outline" size={20} color={colors.text_muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Down-the-Line / Face-On toggle ──────────────────────────────────

export function ModeToggle({
  value,
  onChange,
  style,
  compact = false,
  isPutt = false,
  onPutt,
}: {
  value: Angle;
  onChange: (a: Angle) => void;
  style?: StyleProp<ViewStyle>;
  /** Compact = small DTL / FO icon chips (keeps the center clear so the
   *  target-anchor box behind the controls stays visible). */
  compact?: boolean;
  /** When true the PUTT chip is the active one (putt mode). */
  isPutt?: boolean;
  /** When provided, a PUTT chip is shown; tapping it enters putt mode. */
  onPutt?: () => void;
}) {
  const { colors } = useTheme();
  type Opt = { key: string; label: string; short: string; icon: React.ComponentProps<typeof Ionicons>['name']; putt: boolean };
  const opts: Opt[] = [
    { key: 'down_the_line', label: 'DOWN THE LINE', short: 'DTL', icon: 'git-branch-outline', putt: false },
    { key: 'face_on', label: 'FACE-ON', short: 'FO', icon: 'person-outline', putt: false },
    ...(onPutt ? [{ key: 'putt', label: 'PUTT', short: 'PUTT', icon: 'golf-outline' as const, putt: true }] : []),
  ];
  return (
    <View style={[styles.toggle, compact && styles.toggleCompact, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      {opts.map((o) => {
        const active = o.putt ? isPutt : (!isPutt && o.key === value);
        return (
          <Pressable
            key={o.key}
            onPress={() => (o.putt ? onPutt?.() : onChange(o.key as Angle))}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active }}
            style={[compact ? styles.toggleBtnCompact : styles.toggleBtn, active && { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}
          >
            {compact ? <Ionicons name={o.icon} size={14} color={active ? colors.accent : colors.text_muted} /> : null}
            <Text style={[styles.toggleLabel, { color: active ? colors.accent : colors.text_muted }]}>{compact ? o.short : o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Metric card + rail ──────────────────────────────────────────────

export interface MetricSpec {
  key: string;
  label: string;
  /** Formatted value, or null for genuinely-missing real metrics. */
  value: string | null;
  unit?: string;
  /** Sub-status line, e.g. "IN TO OUT", "DOWN", "OPEN". */
  status?: string;
  statusTone?: SmTone;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** AI/pose-derived → shows an "est" chip per the honesty policy. */
  estimate?: boolean;
  /** Confidence tier of the estimate. 'low' is shown as "est · low" so a
   *  noisy-frame read is visibly distinct from a clean one (honesty). */
  confidence?: 'high' | 'med' | 'low';
}

export function MetricCard({ spec, style }: { spec: MetricSpec; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.metricCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }, style]}>
      <View style={styles.metricTop}>
        {spec.icon ? <Ionicons name={spec.icon} size={14} color={colors.text_muted} /> : null}
        <Text style={[styles.metricLabel, { color: colors.text_muted }]} numberOfLines={1}>{spec.label}</Text>
        {spec.estimate ? (
          <Text style={[styles.estChip, { color: colors.text_muted, borderColor: colors.border }]}>
            {spec.confidence === 'low' ? 'est · low' : 'est'}
          </Text>
        ) : null}
      </View>
      <View style={styles.metricValueRow}>
        <Text style={[styles.metricValue, { color: colors.text_primary }]}>
          {spec.value ?? '—'}
        </Text>
        {spec.value != null && spec.unit ? (
          <Text style={[styles.metricUnit, { color: colors.text_muted }]}>{spec.unit}</Text>
        ) : null}
      </View>
      {spec.status ? (
        <Text style={[styles.metricStatus, { color: toneColor(spec.statusTone ?? 'neutral', colors) }]} numberOfLines={1}>
          {spec.status}
        </Text>
      ) : null}
    </View>
  );
}

export function MetricRail({ metrics, style }: { metrics: MetricSpec[]; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.rail, style]}>
      {metrics.map((m) => <MetricCard key={m.key} spec={m} />)}
    </View>
  );
}

// ─── Speed stats (bottom strip) ──────────────────────────────────────

export function SpeedStat({
  label,
  value,
  unit,
  tone = 'neutral',
  estimate,
  style,
}: {
  label: string;
  value: string | null;
  unit?: string;
  tone?: SmTone;
  estimate?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.speedStat, { backgroundColor: colors.surface_elevated, borderColor: colors.border }, style]}>
      <Text style={[styles.speedLabel, { color: colors.text_muted }]} numberOfLines={1}>
        {label}{estimate ? ' · est' : ''}
      </Text>
      <Text style={[styles.speedValue, { color: tone === 'neutral' ? colors.text_primary : toneColor(tone, colors) }]}>
        {value != null ? `${estimate ? '~' : ''}${value}` : '—'}
      </Text>
      {value != null && unit ? <Text style={[styles.speedUnit, { color: colors.text_muted }]}>{unit}</Text> : null}
    </View>
  );
}

// ─── Tempo bar ───────────────────────────────────────────────────────

export function TempoBar({
  ratio,
  idealLow = 2.8,
  idealHigh = 3.4,
  style,
}: {
  ratio: number | null;
  idealLow?: number;
  idealHigh?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  // Map ratio onto a 2.0–4.0 visual track.
  const trackLo = 2.0;
  const trackHi = 4.0;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const pos = ratio == null ? null : clamp((ratio - trackLo) / (trackHi - trackLo));
  const idealStart = clamp((idealLow - trackLo) / (trackHi - trackLo));
  const idealWidth = clamp((idealHigh - idealLow) / (trackHi - trackLo));
  const inIdeal = ratio != null && ratio >= idealLow && ratio <= idealHigh;
  return (
    <View style={[styles.tempoWrap, { backgroundColor: colors.surface_elevated, borderColor: colors.border }, style]}>
      <View style={styles.tempoHead}>
        <Text style={[styles.metricLabel, { color: colors.text_muted }]}>TEMPO</Text>
        <Text style={[styles.tempoRatio, { color: colors.text_primary }]}>
          {ratio == null ? '—' : `${ratio.toFixed(1)} : 1`}
        </Text>
        <Text style={[styles.tempoVerdict, { color: inIdeal ? colors.success : colors.warning }]}>
          {ratio == null ? '' : inIdeal ? 'GOOD' : 'OFF'}
        </Text>
      </View>
      <View style={[styles.tempoTrack, { backgroundColor: colors.surface }]}>
        <View style={[styles.tempoIdeal, { left: `${idealStart * 100}%`, width: `${idealWidth * 100}%`, backgroundColor: colors.accent_muted }]} />
        {pos != null ? (
          <View style={[styles.tempoMarker, { left: `${pos * 100}%`, backgroundColor: inIdeal ? colors.success : colors.warning }]} />
        ) : null}
      </View>
      <Text style={[styles.tempoRange, { color: colors.text_muted }]}>IDEAL {idealLow.toFixed(1)}–{idealHigh.toFixed(1)}</Text>
    </View>
  );
}

// ─── Body analysis row ───────────────────────────────────────────────

export interface BodyItem {
  key: string;
  label: string;
  tone: SmTone;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** 2026-06-12 — custom biomech badge (the dashed-line set) for this metric. Stays
   *  lime (on-theme); the verdict text below carries the result tone. */
  image?: ImageSourcePropType;
}

const TONE_VERDICT: Record<SmTone, string> = {
  good: 'Good',
  warn: 'Check',
  bad: 'Fault',
  neutral: '—',
};

export function BodyAnalysisRow({ items, style }: { items: BodyItem[]; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.bodyWrap, { backgroundColor: colors.surface_elevated, borderColor: colors.border }, style]}>
      <Text style={[styles.metricLabel, { color: colors.text_muted, marginBottom: 8 }]}>BODY ANALYSIS</Text>
      <View style={styles.bodyRow}>
        {items.map((it) => (
          <View key={it.key} style={styles.bodyItem}>
            {it.image
              ? <Image source={it.image} style={styles.bodyBadge} resizeMode="contain" />
              : <Ionicons name={it.icon ?? 'body-outline'} size={18} color={toneColor(it.tone, colors)} />}
            <Text style={[styles.bodyLabel, { color: colors.text_secondary }]} numberOfLines={1}>{it.label}</Text>
            <Text style={[styles.bodyVerdict, { color: toneColor(it.tone, colors) }]}>{TONE_VERDICT[it.tone]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Acoustic pickup card ────────────────────────────────────────────

export function AcousticPickupCard({
  detected,
  swingCount,
  calibrated = true,
  levelDb = null,
  listening = false,
  style,
}: {
  detected: boolean;
  /** Swings detected in the open window (multi-swing flow). */
  swingCount?: number;
  calibrated?: boolean;
  /** Live mic level in dBFS (~[-60,0]) while recording. When provided the
   *  meter shows the REAL signal; when null (idle/review) the meter sits at
   *  empty — it never fakes a level. */
  levelDb?: number | null;
  /** True ONLY while a recording is actually running. Drives the "Listening…"
   *  copy so we never claim to be listening when no mic capture is active. */
  listening?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const active = detected && calibrated;
  const accent = active ? colors.accent : colors.text_muted;
  // Single level METER (not an equalizer): the fill + needle read like a
  // VU / signal meter. Driven by the live mic level (dBFS → 0..1) when
  // recording; empty when there's no live signal (honest — no fake motion).
  const FLOOR_DB = -60;
  const level = levelDb != null
    ? Math.max(0, Math.min(1, (levelDb - FLOOR_DB) / (0 - FLOOR_DB)))
    : 0;
  const pct = `${Math.round(level * 100)}%` as DimensionValue;
  return (
    <View style={[styles.acousticCard, { backgroundColor: colors.surface_elevated, borderColor: active ? colors.accent : colors.border }, style]}>
      <View style={styles.acousticHead}>
        {/* State badge: confirmed (strike found) → listening (mic live) → silent (idle). */}
        <Image
          source={detected ? ICON_ACOUSTIC.confirmed : listening ? ICON_ACOUSTIC.listening : ICON_ACOUSTIC.silent}
          style={[styles.acousticBadge, !active && { opacity: 0.6 }]}
          resizeMode="contain"
        />
        <Text style={[styles.acousticTitle, { color: colors.text_muted }]}>ACOUSTIC PICKUP</Text>
      </View>
      <View style={[styles.meterTrack, { backgroundColor: colors.surface }]}>
        <View style={[styles.meterFill, { width: pct, backgroundColor: accent, opacity: active ? 1 : 0.5 }]} />
        <View style={[styles.meterNeedle, { left: pct, backgroundColor: active ? colors.success : accent }]} />
      </View>
      <Text style={[styles.acousticStatus, { color: active ? colors.success : colors.text_muted }]}>
        {!calibrated
          ? 'Tap to calibrate (10 strikes)'
          : detected
            ? (swingCount != null ? `${swingCount} swing${swingCount === 1 ? '' : 's'} detected` : 'Ball Smash Detected')
            : listening
              ? 'Listening…'
              : 'Calibrated ✓ — Record to listen'}
      </Text>
    </View>
  );
}

// ─── Capture framing guides ──────────────────────────────────────────
// Alignment overlay drawn on the live camera / replay, matching the
// redesign mockups. Down-the-line gets a target line down the middle +
// a ball-area marker; face-on gets vertical target/ball reference lines.
// Decorative + framing aid only (pointerEvents none) — no fake tracer.

function GuideLabel({ text, color, bg }: { text: string; color: string; bg: string }) {
  return <Text style={[styles.guideLabel, { color, backgroundColor: bg }]}>{text}</Text>;
}

export function CaptureGuides({
  mode, handedness = 'right', style, aspect = null,
}: {
  mode: Angle;
  /** Swinger's hand — mirrors the face-on TARGET/BALL guides for lefties. */
  handedness?: 'right' | 'left';
  /** Ball position (normalized 0-1). Retained for caller compatibility; no
   *  longer drawn (foot-placement anchors removed 2026-06-10 — they read goofy
   *  and the swing analysis never depended on them). */
  ball?: { x: number; y: number; r: number } | null;
  /** Viewport width/height. On the Galaxy Z Fold COVER screen (measured 0.40 from
   *  Tim's 2026-06-11 cage shots) the face-on 32/68 columns crowd into the centre
   *  ("tiny within the spine"); we spread them to 18/82 there. Threshold 0.45
   *  cleanly separates the 0.40 cover from normal phones (~0.46+) and the unfolded
   *  inner screen (~0.87), which stay at 32/68. */
  aspect?: number | null;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const line = colors.accent;
  const labelBg = colors.overlay;
  const narrow = aspect != null && aspect < 0.45;
  if (mode === 'down_the_line') {
    // Down-the-line is center-symmetric (target up, ball bottom-center) —
    // no handedness mirroring needed for the target line.
    return (
      <View style={[StyleSheet.absoluteFill, styles.guideRoot, style]} pointerEvents="none">
        <View style={styles.guideTopCenter}>
          <GuideLabel text="TARGET" color={colors.text_primary} bg={labelBg} />
        </View>
        <View style={[styles.guideVLine, { borderColor: line, left: '50%' }]} />
        {/* Ball box is drawn by CageTargetingOverlay (single anchor) — not here. */}
      </View>
    );
  }
  // Face-on: RH golfer aims target-line left, ball-line right. Lefty
  // mirrors — swap the two columns. On the narrow Fold cover screen the columns
  // spread to 18/82 so they don't crowd into the spine.
  const near = narrow ? '18%' : '32%';
  const far = narrow ? '82%' : '68%';
  const targetLeft = handedness === 'left' ? far : near;
  const ballLeft = handedness === 'left' ? near : far;
  return (
    <View style={[StyleSheet.absoluteFill, styles.guideRoot, style]} pointerEvents="none">
      <View style={[styles.guideVLine, { borderColor: line, left: targetLeft }]} />
      <View style={[styles.guideVLine, { borderColor: line, left: ballLeft }]} />
      <View style={[styles.guideSideLabel, { left: targetLeft }]}>
        <GuideLabel text="TARGET LINE" color={colors.text_primary} bg={labelBg} />
      </View>
      <View style={[styles.guideSideLabel, { left: ballLeft }]}>
        <GuideLabel text="BALL LINE" color={colors.text_primary} bg={labelBg} />
      </View>
      {/* Ball box is drawn by CageTargetingOverlay (single anchor) — not here. */}
    </View>
  );
}

// ─── Verdict badge ───────────────────────────────────────────────────

export function VerdictBadge({
  verdict,
  tone = 'good',
  style,
}: {
  verdict: string;
  tone?: SmTone;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const c = toneColor(tone, colors);
  const icon = tone === 'good' ? 'checkmark-circle' : tone === 'bad' ? 'alert-circle' : 'information-circle';
  return (
    <View style={[styles.verdict, { backgroundColor: colors.surface_elevated, borderColor: c }, style]}>
      <Ionicons name={icon} size={18} color={c} />
      <Text style={[styles.verdictText, { color: c }]}>{verdict}</Text>
    </View>
  );
}

// ─── Footer chips ────────────────────────────────────────────────────

export function FooterChips({
  club,
  shot,
  distanceYds,
  distanceEst = false,
  onClubPress,
  style,
}: {
  club?: string | null;
  shot?: number | null;
  distanceYds?: number | null;
  /** When true, the DIST value is a labeled estimate (shows "· est"). */
  distanceEst?: boolean;
  /** Tap handler for the CLUB chip — opens the club picker. When set, the
   *  CLUB chip becomes pressable and shows a tag affordance when untagged. */
  onClubPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const Chip = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <View style={styles.chip}>
      <Text style={[styles.chipLabel, { color: colors.text_muted }]}>
        {label}{sub ? <Text style={{ fontWeight: '600' }}> · {sub}</Text> : null}
      </Text>
      <Text style={[styles.chipValue, { color: colors.accent }]}>{value}</Text>
    </View>
  );
  return (
    <View style={[styles.footer, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      {onClubPress ? (
        <Pressable onPress={onClubPress} style={styles.chip} accessibilityRole="button" accessibilityLabel="Set club">
          <Text style={[styles.chipLabel, { color: colors.text_muted }]}>CLUB</Text>
          <Text style={[styles.chipValue, { color: club ? colors.accent : colors.text_muted }]}>{club ?? 'Tag ▾'}</Text>
        </Pressable>
      ) : (
        <Chip label="CLUB" value={club ?? '—'} />
      )}
      <Chip label="SHOT" value={shot != null ? String(shot) : '—'} />
      <Chip label="DIST" sub={distanceYds != null && distanceEst ? 'est' : undefined} value={distanceYds != null ? `${distanceYds} YDS` : '—'} />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  // 2026-06-12 — stack wordmark over subtitle (was a row with no gap, so "SMARTMOTION"
  // and "DOWN THE LINE ANALYSIS" ran together / overlapped — Tim). Column reads clean
  // at any width (Fold open/closed + normal phones).
  headerBrand: { flexDirection: 'column', alignItems: 'flex-start', flex: 1, minWidth: 0 },
  brandWordmark: { fontSize: 13, fontWeight: '800', letterSpacing: 1.2 },
  brandSub: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginTop: 1 },

  toggle: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3, gap: 3 },
  toggleCompact: { alignSelf: 'flex-start' },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: 'transparent', alignItems: 'center' },
  toggleBtnCompact: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: 'transparent' },
  toggleLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  rail: { gap: 8 },
  metricCard: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  metricTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metricLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, flexShrink: 1 },
  estChip: { fontSize: 8, fontWeight: '700', letterSpacing: 0.5, borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' },
  metricValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 },
  metricValue: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  metricUnit: { fontSize: 11, fontWeight: '600' },
  metricStatus: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginTop: 2 },

  speedStat: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center' },
  speedLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  speedValue: { fontSize: 20, fontWeight: '900', marginTop: 3 },
  speedUnit: { fontSize: 9, fontWeight: '600', marginTop: 1 },

  tempoWrap: { borderWidth: 1, borderRadius: 12, padding: 10 },
  tempoHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tempoRatio: { fontSize: 14, fontWeight: '900', flex: 1 },
  tempoVerdict: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  tempoTrack: { height: 8, borderRadius: 4, marginTop: 8, overflow: 'hidden', justifyContent: 'center' },
  tempoIdeal: { position: 'absolute', top: 0, bottom: 0, borderRadius: 4 },
  tempoMarker: { position: 'absolute', width: 4, top: -2, bottom: -2, borderRadius: 2, marginLeft: -2 },
  tempoRange: { fontSize: 9, fontWeight: '600', letterSpacing: 0.6, marginTop: 6 },

  bodyWrap: { borderWidth: 1, borderRadius: 12, padding: 10 },
  bodyRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  bodyItem: { flex: 1, alignItems: 'center', gap: 3 },
  bodyBadge: { width: 44, height: 44 },
  bodyLabel: { fontSize: 10, fontWeight: '600' },
  bodyVerdict: { fontSize: 11, fontWeight: '800' },

  acousticCard: { borderWidth: 1, borderRadius: 12, padding: 10 },
  acousticHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  acousticBadge: { width: 26, height: 26 },
  acousticTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  meterTrack: { height: 10, borderRadius: 5, marginTop: 10, marginBottom: 2, overflow: 'visible', justifyContent: 'center' },
  meterFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 5 },
  meterNeedle: { position: 'absolute', top: -3, bottom: -3, width: 3, borderRadius: 2, marginLeft: -1.5 },
  acousticStatus: { fontSize: 11, fontWeight: '700', marginTop: 6 },

  verdict: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  verdictText: { fontSize: 13, fontWeight: '900', letterSpacing: 1 },

  guideRoot: { alignItems: 'center', justifyContent: 'center' },
  guideLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  guideTopCenter: { position: 'absolute', top: '14%' },
  guideVLine: { position: 'absolute', top: '14%', bottom: '22%', width: 0, borderLeftWidth: 1.5, borderStyle: 'dashed', marginLeft: -0.75, opacity: 0.7 },
  guideSideLabel: { position: 'absolute', top: '10%', marginLeft: -34 },
  // Lead/trail foot stance anchors — soft, general (translucent dot + label),
  // centered on the computed point via negative margins.
  guideBallArea: { position: 'absolute', bottom: '14%', alignItems: 'center', gap: 4 },
  guideBallBox: { width: 54, height: 30, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 6, opacity: 0.7 },

  footer: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, paddingVertical: 8 },
  chip: { flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 },
  chipLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  chipValue: { fontSize: 13, fontWeight: '900' },
});
