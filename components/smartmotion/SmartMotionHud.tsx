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
// Type-only (erased at compile — no runtime dep on the heavy pose/analysis modules).
import type { SwingAnalysis } from '../../services/poseDetection';
import type { SwingBiomechanics } from '../../services/poseAnalysisApi';

// 2026-06-12 — acoustic status badges (Tim's set) for the pickup card header.
const ICON_ACOUSTIC = {
  listening: require('../../assets/icons/smartmotion/acoustic-listening.png'),
  strike: require('../../assets/icons/smartmotion/acoustic-strike.png'),
  silent: require('../../assets/icons/smartmotion/acoustic-silent.png'),
  confirmed: require('../../assets/icons/smartmotion/acoustic-confirmed.png'),
};

// 2026-07-30 (Tim — "those icons and data are supposed to be together"): the body-analysis
// tiles showed "—" on the swing-detail screen while the BIOMECHANICS narrative above them had
// real numbers. Root cause: the tiles were reading a shot_map SNAPSHOT that persisted only
// {key,label,tone,icon} — the measured `value` was stripped. Fix = both the live capture screen
// and the detail screen now derive the row FRESH from the SAME source (session.biomechanics)
// via deriveBodyItems below, so the icons always carry the numbers. Moved here (with the badge
// asset map) from smartmotion.tsx so it's the ONE shared definition.
export const ICON_BIOMECH = {
  sway: require('../../assets/icons/smartmotion/biomech-sway.png'),
  tilt: require('../../assets/icons/smartmotion/biomech-tilt.png'),
  posture: require('../../assets/icons/smartmotion/biomech-posture.png'),
  weight: require('../../assets/icons/smartmotion/biomech-weight.png'),
  shoulder: require('../../assets/icons/smartmotion/biomech-shoulder.png'),
  hip: require('../../assets/icons/smartmotion/biomech-hip.png'),
} as const;

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
  isPutt = false,
  onSettings,
  style,
}: {
  mode: Angle;
  isPutt?: boolean;
  onSettings?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  /**
   * 2026-08-19 (Tim, from a round: "it's set to down the line and putt, not full and putt like it
   * should be in terms of the toggle settings").
   *
   * A HALF-FIX OF MY OWN, and the same shape I have been correcting all week. On 08-19 the mode
   * control stopped being a three-way camera-angle cycler and became Full swing ⇄ Putting, because
   * the camera angle is now DETECTED from the pose geometry rather than declared. The control
   * changed; every label describing it did not. So the toggle switched between full and putt while
   * this header kept announcing "DOWN THE LINE ANALYSIS" — naming a setting the player no longer
   * has, and directly contradicting the control they just used.
   *
   * The subtitle now says what the player CHOSE (the shot type). The detected angle is a measurement,
   * not a setting, and belongs where measurements go — it already rides the analysis itself.
   */
  const subtitle = isPutt ? 'PUTT ANALYSIS' : 'FULL SWING ANALYSIS';
  void mode; // retained in the props contract; no longer a user-facing label
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
  // 2026-07-20 (Tim — "clean numbers everywhere, no extra labels; beta is implied") — the
  // `estimate` flag no longer paints an ` · est` label or a `~` on the value. Honesty is kept
  // by only showing a value when one exists ("—" otherwise) and never fabricating one; the beta
  // context implies these tighten over time. Prop retained for API stability.
  void estimate;
  return (
    <View style={[styles.speedStat, { backgroundColor: colors.surface_elevated, borderColor: colors.border }, style]}>
      <Text style={[styles.speedLabel, { color: colors.text_muted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.speedValue, { color: tone === 'neutral' ? colors.text_primary : toneColor(tone, colors) }]}>
        {value != null ? value : '—'}
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
  /** 2026-06-30 (audit C5/C7) — the MEASURED number for this metric (e.g. "12°", "~38%").
   *  A leading "~" marks a low-confidence read (metric_confidence < 0.5). Omitted when
   *  there's no measured value (honest — no fabricated number). */
  value?: string;
}

/**
 * Build the four BODY ANALYSIS tiles (Sway / Tilt / Posture / Weight) from the swing's
 * analysis + biomechanics. Moved here 2026-07-30 (from smartmotion.tsx) so the live capture
 * screen AND the swing-detail screen derive them from the SAME source — see ICON_BIOMECH note.
 * tone = qualitative (mapped from AI fault categories); value = the MEASURED number when present
 * (else omitted → tile shows "—", never a fabricated number).
 */
export function deriveBodyItems(a: SwingAnalysis | null, bio: SwingBiomechanics | null): BodyItem[] {
  const fault = a?.primary_fault;
  const issue = a?.detected_issue;
  const n = !a;
  // 2026-08-06 (card inventory, finding #5) — a green "Good" must be BACKED by a measurement, never asserted
  // just because the AI named no fault. Weight already gated on bio.weightShiftPct; sway/tilt/posture now
  // match: if the underlying metric wasn't measured, the tone is neutral ("—"), not a baseless green. A named
  // fault still wins (it's a real signal even when the scalar is null).
  const sway: SmTone = n ? 'neutral'
    : fault === 'sway' || fault === 'head_movement' ? 'bad'
    : (bio?.hipSlideRatio == null && bio?.headDriftPxNorm == null) ? 'neutral'
    : 'good';
  const tilt: SmTone = n ? 'neutral'
    : fault === 'reverse_pivot' || fault === 'plane_too_flat' || fault === 'plane_too_steep' ? 'warn'
    : bio?.shoulderTiltDeg == null ? 'neutral'
    : 'good';
  const posture: SmTone = n ? 'neutral'
    : fault === 'early_extension' || fault === 'spine_angle_loss' || issue === 'early_extension' ? 'bad'
    : bio?.spineAngleDeltaDeg == null ? 'neutral'
    : 'good';
  // 2026-06-11 (audit) — only claim "good" weight shift when it was actually MEASURED
  // (bio.weightShiftPct present); a null metric is neutral ("—"), not a baseless green.
  const weight: SmTone = n ? 'neutral'
    : fault === 'reverse_pivot' ? 'bad'
    : bio?.weightShiftPct == null ? 'neutral'
    : bio.weightShiftPct < 30 ? 'warn' : 'good';
  // 2026-06-30 (audit C5/C7) — surface the MEASURED number on each tile. "~" marks a
  // low-confidence read (metric_confidence < 0.5). Sway has no intuitive scalar (head-drift
  // is normalized pixels), so it stays qualitative — honest, no fabricated number.
  const conf = bio?.metric_confidence as Record<string, number | undefined> | undefined;
  const hedge = (k: string): string => (conf && typeof conf[k] === 'number' && conf[k]! < 0.5 ? '~' : '');
  const degVal = (v: number | null | undefined, k: string) => (v == null ? undefined : `${hedge(k)}${Math.round(v)}°`);
  const pctVal = (v: number | null | undefined, k: string) => (v == null ? undefined : `${hedge(k)}${Math.round(v)}%`);
  return [
    { key: 'sway', label: 'Sway', tone: sway, icon: 'swap-horizontal-outline', image: ICON_BIOMECH.sway },
    { key: 'tilt', label: 'Tilt', tone: tilt, icon: 'contract-outline', image: ICON_BIOMECH.tilt, value: degVal(bio?.shoulderTiltDeg, 'shoulderTilt') },
    { key: 'posture', label: 'Posture', tone: posture, icon: 'body-outline', image: ICON_BIOMECH.posture, value: degVal(bio?.spineAngleDeltaDeg, 'spineAngleDelta') },
    { key: 'weight', label: 'Weight', tone: weight, icon: 'scale-outline', image: ICON_BIOMECH.weight, value: pctVal(bio?.weightShiftPct, 'weightShift') },
  ];
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
            {it.value ? <Text style={[styles.bodyValue, { color: colors.text_muted }]} numberOfLines={1}>{it.value}</Text> : null}
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
  heardCount = null,
  calibrated = true,
  levelDb = null,
  listening = false,
  style,
}: {
  detected: boolean;
  /** Swings detected in the open window (multi-swing flow). */
  swingCount?: number;
  /**
   * 2026-08-24 (Tim) — what the MICROPHONE actually heard, which is not always what got analysed.
   *
   * `swingCount` comes from segments, and in range mode a segment only exists once VIDEO confirms
   * the strike. So a five-swing set could hear five and show "1 swing detected", which reads as the
   * pickup having missed them. It didn't — the analysis did. Saying "heard 5 · analysed 1" is the
   * honest version and tells the player something true about their session, which is the whole
   * point of having a microphone on the mat.
   */
  heardCount?: number | null;
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
            ? (swingCount != null
                ? (heardCount != null && heardCount > swingCount
                    // Heard more than we could analyse — say both, so a missing swing reads as an
                    // analysis limit rather than a deaf microphone.
                    ? `heard ${heardCount} · analysed ${swingCount}`
                    : `${swingCount} swing${swingCount === 1 ? '' : 's'} detected`)
                : heardCount != null && heardCount > 0
                  ? `${heardCount} strike${heardCount === 1 ? '' : 's'} heard`
                  : 'Ball Smash Detected')
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
    // 2026-06-13 (Tim) — the down-the-line TARGET is now the ANCHORED, draggable
    // ball→target rig (EditableCageTargets / CageTargetingOverlay), which sits in
    // the outer third per handedness. The old static center line + "TARGET" label
    // here were a leftover that drew a second dashed line down the MIDDLE — pure
    // duplication (this guide never sensed anything). Removed so the only target
    // line is the anchored one. Face-on still uses its own guides below.
    return null;
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

/**
 * The MEASURED swing breakdown — one dimension per row, each with its verdict colour, the number it is
 * based on, and a plain-English note.
 *
 * 2026-08-19 (Tim: the SmartMotion read "looks different" from the swing library). It DID: this card
 * existed only inside app/swinglab/smartmotion.tsx, so the live review showed six measured dimensions
 * with their numbers while the saved swing showed four icon tiles and a few verdict bullets — two
 * renderers over one set of numbers, drifting apart with every change to either. Lifted here, beside
 * BodyAnalysisRow, and consumed by BOTH screens off the SAME pure buildPoseSwingRead(bio, tempo). Two
 * derivations of "what this swing did" would eventually disagree and the player would be told one
 * thing on the range and another in the library — the drift this codebase keeps paying for.
 *
 * `variant` is presentation only: 'overlay' is the dark translucent treatment that sits in the review
 * deck, 'card' is the themed surface used on the library detail screen. The ROWS are identical.
 */
export function SwingBreakdownCard({
  read, variant = 'card', style,
}: {
  read: { usable: boolean; dimensions: { key: string; label: string; display?: string | null; note: string; verdict: string }[] };
  variant?: 'overlay' | 'card';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  if (!read.usable || read.dimensions.length === 0) return null;
  const overlay = variant === 'overlay';
  const bg = overlay ? 'rgba(6,15,9,0.78)' : colors.surface;
  const border = overlay ? 'rgba(124,224,79,0.28)' : colors.border;
  const labelColor = overlay ? 'rgba(255,255,255,0.55)' : colors.accent;
  const titleColor = overlay ? '#F1F5F9' : colors.text_primary;
  const noteColor = overlay ? 'rgba(255,255,255,0.78)' : colors.text_secondary;
  return (
    <View style={[styles.breakdownCard, { backgroundColor: bg, borderColor: border }, style]}>
      <Text style={[styles.metricLabel, { color: labelColor }]}>SWING BREAKDOWN</Text>
      {read.dimensions.map((d) => {
        const vc = d.verdict === 'strength' ? '#88F700' : d.verdict === 'solid' ? '#7ED3A3' : d.verdict === 'watch' ? '#f59e0b' : '#ef4444';
        return (
          <View key={d.key} style={styles.breakdownRow}>
            <View style={[styles.breakdownDot, { backgroundColor: vc }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.breakdownTitle, { color: titleColor }]}>
                {d.label}{d.display ? `  ${d.display}` : ''}
              </Text>
              <Text style={[styles.breakdownNote, { color: noteColor }]}>{d.note}</Text>
            </View>
          </View>
        );
      })}
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
  // 2026-08-19 — every chip text can SHRINK and is capped at one line. Each chip is flex:1 (a third of
  // the bar), but nothing inside was allowed to give way, so the longest value — "DIST · est 128 YDS" —
  // overflowed its third and was clipped clean off the screen edge by the panel's overflow:hidden
  // (Tim's 08-18 capture). Same class as the fit-profile ladder column and the strike-confirmed line.
  const Chip = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <View style={styles.chip}>
      <Text style={[styles.chipLabel, { color: 'rgba(255,255,255,0.85)' }]} numberOfLines={1}>
        {label}{sub ? <Text style={{ fontWeight: '600' }}> · {sub}</Text> : null}
      </Text>
      <Text style={[styles.chipValue, { color: '#88F700' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </Text>
    </View>
  );
  return (
    <View style={[styles.footer, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      {onClubPress ? (
        <Pressable onPress={onClubPress} style={styles.chip} accessibilityRole="button" accessibilityLabel="Set club">
          <Text style={[styles.chipLabel, { color: 'rgba(255,255,255,0.85)' }]} numberOfLines={1}>CLUB</Text>
          <Text style={[styles.chipValue, { color: club ? '#88F700' : 'rgba(255,255,255,0.55)' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{club ?? 'Tag ▾'}</Text>
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
  breakdownCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  breakdownRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  breakdownDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  breakdownTitle: { fontSize: 13, fontWeight: '800' },
  breakdownNote: { fontSize: 12, lineHeight: 16 },
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
  bodyValue: { fontSize: 10, fontWeight: '700', marginTop: 1, opacity: 0.85 },

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

  footer: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 6 },
  chip: { flex: 1, minWidth: 0, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 },
  chipLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, flexShrink: 1 },
  chipValue: { fontSize: 13, fontWeight: '900', flexShrink: 1 },
});
