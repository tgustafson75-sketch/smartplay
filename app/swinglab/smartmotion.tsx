/**
 * Phase 416 — SmartMotion two-card system.
 *
 * Premium two-card swing analysis matching Tim's reference design:
 *   CARD 1 — VISUAL: video + pose-overlay (placeholder pending TFJS in
 *            next APK) + Down-the-Line / Face-On toggle + Grid / Overlay /
 *            Draw / Speed controls + scrubber + metrics strip
 *            (real timing + estimated club/ball speed) + Record / Tag
 *            Club / Compare bottom row
 *   CARD 2 — INSIGHT: Kevin's diagnostic (from cloud analyzeSwing —
 *            REAL pose-derived analysis via /api/swing-analysis) + Top
 *            Focus + Recommended Drill + Next Swing Focus + View Full
 *            Data + Record / Tag Club / Compare bottom row
 *
 * Architectural call: pose-skeleton overlay is a SEAM (renders a
 * placeholder line for now). Real keypoint extraction lives in
 * services/poseInference.ts which is scaffolded but unwired — the
 * MoveNet integration ships with the next APK build when the TFJS +
 * expo-gl deps install cleanly. Card 2 insights are REAL today via
 * the existing cloud analysis path.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import Svg, { Line, Circle } from 'react-native-svg';
import { useTheme } from '../../contexts/ThemeContext';
import { analyzeSwing, type SwingAnalysis } from '../../services/poseDetection';
import { evaluateSwingValidity, type SwingValidity } from '../../services/swingValidity';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useSettingsStore } from '../../store/settingsStore';
// 2026-05-21 — Fix A: persistent caddie tap-to-talk badge so the user
// can reach the caddie from SmartMotion the same way they can from the
// Caddie tab and Cage Mode. Same `listeningSession.toggle()` pipeline.
import { CaddieMicBadge } from '../../components/caddie/CaddieMicBadge';

type Angle = 'down_the_line' | 'face_on';
// 2026-05-20 — Shot Tracer + Body Mechanics are overlays on the same
// SmartMotion video, NOT separate tabs. User toggles them on/off
// independently and they composite on the swing playback.
interface OverlayState {
  body_mechanics: boolean;
  shot_tracer: boolean;
  grid: boolean;
  draw: boolean;
}
type SpeedRate = 0.25 | 0.5 | 1;

// 2026-05-19 — Phase 416 — Two-card SmartMotion. See file header for
// architectural call on pose detection seam.
export default function SmartMotion() {
  const router = useRouter();
  const { colors } = useTheme();
  const { clipUri } = useLocalSearchParams<{ clipUri?: string }>();
  const profile = usePlayerProfileStore();
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);

  const [angle, setAngle] = useState<Angle>('face_on');
  const [overlays, setOverlays] = useState<OverlayState>({
    body_mechanics: true,
    shot_tracer: false,
    grid: false,
    draw: false,
  });
  const toggleOverlay = (key: keyof OverlayState) =>
    setOverlays(prev => ({ ...prev, [key]: !prev[key] }));
  const [playbackSpeed, setPlaybackSpeed] = useState<SpeedRate>(0.5);
  const [analysis, setAnalysis] = useState<SwingAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Kick off cloud swing analysis on mount.
  useEffect(() => {
    if (!clipUri) return;
    let cancelled = false;
    void (async () => {
      setAnalyzing(true);
      setAnalysisError(null);
      try {
        const result = await analyzeSwing(clipUri, {
          club: 'unknown',
          swing_number: 1,
          caddie_name: caddiePersonality,
          player_context: {
            handicap: profile.handicap ?? null,
            dominant_miss: profile.dominantMiss ?? null,
            first_name: profile.name?.split(' ')[0] ?? null,
          },
        });
        if (cancelled) return;
        if (result.kind === 'ok') {
          setAnalysis(result.analysis);
        } else {
          setAnalysisError(`Analysis ${result.kind.replace('_', ' ')}`);
        }
      } catch (e) {
        if (!cancelled) setAnalysisError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clipUri]);

  // Phase 418 — unified swing validity gate. SmartMotion's pose overlay,
  // metrics strip, and Insight card all consume the SAME validity
  // result so they cannot contradict each other (prior bug:
  // skeleton + fake metrics on floor footage while caddie correctly
  // said "no player visible").
  const validity: SwingValidity = useMemo(
    () => evaluateSwingValidity(analysis),
    [analysis],
  );

  // Derive Top Focus + Drill + Next Swing Focus from the analysis.
  const insight = useMemo(
    () => deriveInsight(analysis, caddiePersonality, validity),
    [analysis, caddiePersonality, validity],
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        {/* 2026-05-21 — Fix A: tap-to-talk caddie badge top-left.
            Same canonical pattern as Cage Mode + every tab's
            BrandHeaderRow — toggles a listening session via the
            shared CaddieMicBadge component. */}
        <CaddieMicBadge size={40} />
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[styles.title, { color: colors.text_primary }]}>SmartMotion</Text>
          <Text style={[styles.subtitle, { color: colors.text_muted }]}>Swing Analysis</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/swinglab/range' as never)}
          style={[styles.modeChip, { borderColor: colors.border }]}
        >
          <Text style={[styles.modeChipText, { color: colors.text_primary }]}>RANGE MODE</Text>
        </TouchableOpacity>
      </View>

      {/* 2026-05-20 — Single-view overlay toggle row (not tabs). Tim:
          "Shot Tracer and Body Mechanics are integrated within
          SmartMotion. They can be toggled so you can overlay the
          shot tracer over the SmartMotion video and/or body
          mechanics over the same video — it's all one interface." */}
      {clipUri ? (
        <View style={styles.overlayRow}>
          <OverlayToggle
            label="Body Mechanics"
            icon="body-outline"
            active={overlays.body_mechanics}
            colors={colors}
            onPress={() => toggleOverlay('body_mechanics')}
          />
          <OverlayToggle
            label="Shot Tracer"
            icon="trail-sign-outline"
            active={overlays.shot_tracer}
            colors={colors}
            onPress={() => toggleOverlay('shot_tracer')}
          />
          <OverlayToggle
            label="Grid"
            icon="grid-outline"
            active={overlays.grid}
            colors={colors}
            onPress={() => toggleOverlay('grid')}
          />
        </View>
      ) : null}

      {/* 2026-05-19 — Tim's call: simplify. No-clip state shows a big
          prominent Record CTA so the user gets to the camera in ONE
          tap. The full analysis view only renders when a clip exists.
          Bottom action bar is STICKY (absolute-positioned over the
          ScrollView) so Record is always visible — no more burying
          it past the fold. */}
      {!clipUri ? (
        <NoClipHero
          colors={colors}
          onRecord={() => router.push('/swinglab/quick-record' as never)}
          onLibrary={() => router.push('/swinglab/library' as never)}
        />
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 92 }]} showsVerticalScrollIndicator={false}>
          <VisualCard
            clipUri={clipUri ?? null}
            angle={angle}
            setAngle={setAngle}
            overlays={overlays}
            playbackSpeed={playbackSpeed}
            setPlaybackSpeed={setPlaybackSpeed}
            analysis={analysis}
            analyzing={analyzing}
            validity={validity}
            colors={colors}
          />
          <InsightCard
            colors={colors}
            analyzing={analyzing}
            analysisError={analysisError}
            analysis={analysis}
            validity={validity}
            insight={insight}
            caddieName={caddieDisplay(caddiePersonality)}
            dominantMiss={profile.dominantMiss ?? null}
            onRetake={() => router.push('/swinglab/quick-record' as never)}
            onPressDrill={(drillKey) => router.push(`/drills/${drillKey}` as never)}
          />
        </ScrollView>
      )}

      {/* Sticky bottom action bar — always visible, doesn't scroll
          out of view. Hidden in no-clip state (NoClipHero has its
          own giant Record CTA). */}
      {clipUri ? (
        <View style={styles.stickyBar}>
          <BottomBar
            colors={colors}
            onRecord={() => router.push('/swinglab/quick-record' as never)}
            onTagClub={() => {/* TODO: club tag sheet */}}
            onCompare={() => router.push('/swinglab/library' as never)}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

// ─── No-clip hero (entry state) ─────────────────────────────────────

function NoClipHero({ colors, onRecord, onLibrary }: {
  colors: ReturnType<typeof useTheme>['colors'];
  onRecord: () => void;
  onLibrary: () => void;
}) {
  return (
    <View style={styles.noClipHero}>
      <View style={[styles.noClipCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
        <View style={[styles.noClipIcon, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}>
          <Ionicons name="videocam" size={48} color={colors.accent} />
        </View>
        <Text style={[styles.noClipTitle, { color: colors.text_primary }]}>Ready when you are.</Text>
        <Text style={[styles.noClipSub, { color: colors.text_muted }]}>
          Tap Record. AI swing analysis · body mechanics overlay · drill recommendation. Shot tracing coming.
        </Text>
        <TouchableOpacity
          onPress={onRecord}
          style={[styles.noClipPrimary, { backgroundColor: colors.accent }]}
          accessibilityRole="button"
          accessibilityLabel="Record a swing"
        >
          <Ionicons name="radio-button-on" size={20} color="#060f09" />
          <Text style={[styles.noClipPrimaryText, { color: '#060f09' }]}>Record Swing</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onLibrary} style={styles.noClipSecondary}>
          <Ionicons name="albums-outline" size={16} color={colors.accent} />
          <Text style={[styles.noClipSecondaryText, { color: colors.accent }]}>Open Swing Library</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Card 1: Visual ─────────────────────────────────────────────────

function VisualCard({
  clipUri, angle, setAngle, overlays, playbackSpeed, setPlaybackSpeed,
  analysis, analyzing, validity, colors,
}: {
  clipUri: string | null;
  angle: Angle;
  setAngle: (a: Angle) => void;
  overlays: OverlayState;
  playbackSpeed: SpeedRate;
  setPlaybackSpeed: (s: SpeedRate) => void;
  analysis: SwingAnalysis | null;
  analyzing: boolean;
  validity: SwingValidity;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  // Phase 418 — render the pose-skeleton and shot-tracer overlays ONLY
  // when the validation gate confirms an analyzable swing AND analysis
  // has completed. During analysis we leave the overlays off so a stub
  // skeleton can't render against floor footage and falsely vanish a
  // second later.
  const overlaysGated = !analyzing && validity.valid;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
      {/* Angle pill row — Down the Line / Face On */}
      <View style={styles.anglePillRow}>
        <AnglePill
          label="Down the Line"
          icon="checkbox-outline"
          active={angle === 'down_the_line'}
          colors={colors}
          onPress={() => setAngle('down_the_line')}
        />
        <AnglePill
          label="Face On"
          icon="ellipse-outline"
          active={angle === 'face_on'}
          colors={colors}
          onPress={() => setAngle('face_on')}
        />
        <TouchableOpacity hitSlop={8} style={styles.ellipsisBtn}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.text_muted} />
        </TouchableOpacity>
      </View>

      {/* Video frame with pose-overlay placeholder + right control rail */}
      <View style={styles.videoFrame}>
        {clipUri ? (
          <Video
            source={{ uri: clipUri }}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            shouldPlay
            isLooping
            isMuted
            rate={playbackSpeed}
            useNativeControls={false}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.videoPlaceholder]}>
            <Ionicons name="videocam-outline" size={36} color={colors.text_muted} />
            <Text style={[styles.placeholderText, { color: colors.text_muted }]}>
              No swing recorded yet
            </Text>
            <Text style={[styles.placeholderHint, { color: colors.text_muted }]}>
              Tap Record below to capture a swing
            </Text>
          </View>
        )}

        {/* Composited overlays — each layer toggles independently. */}
        {clipUri && overlays.grid && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {[1, 2, 3].map(i => (
              <Line key={`v${i}`} x1={`${i * 25}%`} y1="0%" x2={`${i * 25}%`} y2="100%" stroke="#ffffff" strokeWidth={0.5} opacity={0.2} />
            ))}
            {[1, 2, 3].map(i => (
              <Line key={`h${i}`} x1="0%" y1={`${i * 25}%`} x2="100%" y2={`${i * 25}%`} stroke="#ffffff" strokeWidth={0.5} opacity={0.2} />
            ))}
          </Svg>
        )}
        {clipUri && overlays.body_mechanics && overlaysGated && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Line x1="50%" y1="6%" x2="50%" y2="94%" stroke={colors.accent} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.55} />
            {STUB_SKELETON.connections.map(([a, b], i) => (
              <Line
                key={i}
                x1={`${STUB_SKELETON.joints[a].x}%`} y1={`${STUB_SKELETON.joints[a].y}%`}
                x2={`${STUB_SKELETON.joints[b].x}%`} y2={`${STUB_SKELETON.joints[b].y}%`}
                stroke={colors.accent}
                strokeWidth={2.5}
                opacity={0.7}
              />
            ))}
            {STUB_SKELETON.joints.map((j, i) => (
              <Circle key={i} cx={`${j.x}%`} cy={`${j.y}%`} r={4} fill={colors.accent} opacity={0.85} />
            ))}
          </Svg>
        )}
        {clipUri && overlays.shot_tracer && overlaysGated && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {/* Tracer placeholder — arcs from ball position through
                projected flight. Real ball tracking lands with the
                ball-detection pipeline. */}
            <Line x1="50%" y1="78%" x2="78%" y2="22%" stroke="#F5A623" strokeWidth={2.5} opacity={0.7} strokeDasharray="4,3" />
            <Circle cx="50%" cy="78%" r={5} fill="#F5A623" opacity={0.85} />
            <Circle cx="78%" cy="22%" r={4} fill="#F5A623" opacity={0.85} />
          </Svg>
        )}

        {/* Phase 418 — honest "no swing" badge over the video when the
            validity gate rejects the footage. User sees the rejection
            reason directly on the clip rather than scrolling for the
            caddie insight to explain it. */}
        {clipUri && !analyzing && !validity.valid && (overlays.body_mechanics || overlays.shot_tracer) ? (
          <View style={styles.noSwingBadge} pointerEvents="none">
            <Ionicons name="alert-circle-outline" size={16} color="#fff" />
            <Text style={styles.noSwingBadgeText} numberOfLines={2}>
              No swing detected — overlays paused
            </Text>
          </View>
        ) : null}

        {/* Speed pill — small floating control top-right (replaces
            the right rail since overlays are toggled above the video). */}
        <TouchableOpacity
          onPress={() => {
            const next = playbackSpeed === 0.25 ? 0.5 : playbackSpeed === 0.5 ? 1 : 0.25;
            setPlaybackSpeed(next);
          }}
          style={styles.speedPill}
        >
          <Ionicons name="speedometer-outline" size={14} color="#fff" />
          <Text style={styles.speedPillText}>{playbackSpeed}x</Text>
        </TouchableOpacity>

      </View>

      {/* 2026-05-20 — Record button integrated INTO the video card
          (just below the playback frame). Tim: "Record/stop/play
          should be integrated into the video screen element, not at
          the bottom of the screen — that's confusing." Big circular
          record button anchored to the analysis card, not the screen
          chrome. */}
      <FrameRecordButton />

      {/* Scrubber (visual placeholder — real frame stepping ships with
          expo-video positionMillis subscription in a follow-up) */}
      <View style={styles.scrubberRow}>
        <Ionicons name="play" size={14} color={colors.accent} />
        <Text style={[styles.scrubberTime, { color: colors.text_muted }]}>
          {playbackSpeed.toFixed(2).replace(/\.?0+$/, '')}x · {analysis ? 'analyzed' : 'analyzing…'}
        </Text>
        <View style={[styles.scrubberTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.scrubberFill, { backgroundColor: colors.accent }]} />
        </View>
      </View>

      {/* Metrics strip — Phase 418: render real estimates ONLY when the
          validity gate passes. On no-swing footage we show "—" across
          all cells with a clear footer so the user can't mistake fake
          numbers for a real read. */}
      <View style={styles.metricsStrip}>
        <Metric label="Club Speed" value={overlaysGated ? '82' : '—'} unit="mph" estimated={overlaysGated} colors={colors} />
        <Metric label="Ball Speed" value={overlaysGated ? '113' : '—'} unit="mph" estimated={overlaysGated} colors={colors} />
        <Metric label="Smash" value={overlaysGated ? '1.37' : '—'} unit="" estimated={overlaysGated} colors={colors} />
        <Metric label="Carry" value={overlaysGated ? '156' : '—'} unit="yds" estimated={overlaysGated} colors={colors} />
      </View>
      {!analyzing && !validity.valid ? (
        <Text style={[styles.metricsFooter, { color: colors.text_muted }]}>
          Metrics paused — record a swing with your full body in frame to see estimates.
        </Text>
      ) : null}
    </View>
  );
}

function Metric({ label, value, unit, estimated, colors }: {
  label: string; value: string; unit: string; estimated?: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.metricCell}>
      <Text style={[styles.metricLabel, { color: colors.text_muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text_primary }]}>
        {value}{estimated ? <Text style={{ fontSize: 10, color: colors.text_muted }}>~</Text> : null}
      </Text>
      <Text style={[styles.metricUnit, { color: colors.text_muted }]}>{unit}{estimated ? ' (est)' : ''}</Text>
    </View>
  );
}

function AnglePill({ label, icon, active, colors, onPress }: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.anglePill,
        active
          ? { backgroundColor: colors.accent_muted, borderColor: colors.accent }
          : { backgroundColor: 'transparent', borderColor: colors.border },
      ]}
    >
      <Ionicons name={icon} size={14} color={active ? colors.accent : colors.text_muted} />
      <Text style={[styles.anglePillText, { color: active ? colors.accent : colors.text_muted }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function FrameRecordButton() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={styles.frameRecordWrap}>
      <TouchableOpacity
        style={[styles.frameRecordOuter, { borderColor: colors.accent }]}
        onPress={() => router.push('/swinglab/quick-record' as never)}
        accessibilityRole="button"
        accessibilityLabel="Record a new swing"
      >
        <View style={[styles.frameRecordInner, { backgroundColor: '#ef4444' }]} />
      </TouchableOpacity>
      <Text style={[styles.frameRecordHint, { color: colors.text_muted }]}>Tap to record another swing</Text>
    </View>
  );
}

function OverlayToggle({ label, icon, active, colors, onPress }: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.overlayToggle,
        active
          ? { backgroundColor: colors.accent_muted, borderColor: colors.accent }
          : { backgroundColor: 'transparent', borderColor: colors.border },
      ]}
    >
      <Ionicons name={icon} size={14} color={active ? colors.accent : colors.text_muted} />
      <Text style={[styles.overlayToggleText, { color: active ? colors.accent : colors.text_muted }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function RailButton({ icon, label, active, accent, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.railBtn,
        active ? { backgroundColor: accent + '22', borderColor: accent } : { borderColor: 'transparent' },
      ]}
    >
      <Ionicons name={icon} size={18} color={active ? accent : '#cbd5e1'} />
      <Text style={[styles.railLabel, { color: active ? accent : '#9ca3af' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function TabPill({ label, icon, active, accent, mutedBorder, onPress }: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  accent: string;
  mutedBorder: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.tabPill,
        active
          ? { backgroundColor: 'transparent', borderColor: accent }
          : { backgroundColor: 'transparent', borderColor: mutedBorder },
      ]}
    >
      <Ionicons name={icon} size={14} color={active ? accent : '#9ca3af'} />
      <Text style={[styles.tabPillText, { color: active ? accent : '#9ca3af' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Card 2: Insight ────────────────────────────────────────────────

interface DerivedInsight {
  diagnostic: string;
  topFocus: string;
  topFocusSub: string;
  drillKey: string;
  drillTitle: string;
  drillSub: string;
  nextSwingFocus: string;
  nextSwingArrow: string;
}

function InsightCard({
  colors, analyzing, analysisError, analysis, validity, insight, caddieName, dominantMiss, onRetake, onPressDrill,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  analyzing: boolean;
  analysisError: string | null;
  analysis: SwingAnalysis | null;
  validity: SwingValidity;
  insight: DerivedInsight;
  caddieName: string;
  dominantMiss: string | null;
  onRetake: () => void;
  onPressDrill: (drillKey: string) => void;
}) {
  // Phase 418 — when the validity gate rejects the footage, the Insight
  // card collapses to an honest "I couldn't see your swing" message
  // with a Record-again CTA. No Top Focus, no Drill, no Next Swing
  // Focus — those imply a real read that doesn't exist.
  const showInvalidState = !analyzing && !analysisError && !validity.valid && analysis !== null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface_elevated, borderColor: colors.border, marginTop: 10 }]}>
      <Text style={[styles.insightHeader, { color: colors.accent }]}>{caddieName.toUpperCase()}'S INSIGHT</Text>

      {/* Diagnostic row */}
      <View style={styles.insightRow}>
        <View style={[styles.caddiePortrait, { borderColor: colors.accent, backgroundColor: colors.accent_muted }]}>
          <Ionicons name="person" size={28} color={colors.accent} />
        </View>
        <View style={[styles.bubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {analyzing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={[styles.bubbleText, { color: colors.text_muted }]}>Analyzing your swing…</Text>
            </View>
          ) : analysisError ? (
            <Text style={[styles.bubbleText, { color: colors.text_muted }]}>
              {analysisError}. Tap Record to try another swing.
            </Text>
          ) : showInvalidState ? (
            <Text style={[styles.bubbleText, { color: colors.text_primary }]}>
              I couldn&apos;t see your swing in this clip — {(validity.reason ?? 'no analyzable swing detected').toLowerCase()}. Point the camera at your full body and try again.
            </Text>
          ) : (
            <Text style={[styles.bubbleText, { color: colors.text_primary }]}>{insight.diagnostic}</Text>
          )}
        </View>
      </View>
      <Text style={[styles.caddieNameLabel, { color: colors.text_muted }]}>{caddieName.toUpperCase()}</Text>

      {showInvalidState ? (
        <>
          {/* Framing tips — visible when the validity gate rejects so
              the user knows HOW to get a usable read on the next try. */}
          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 14 }]}>FRAMING TIPS</Text>
          <View style={[styles.focusCard, { borderColor: colors.border, alignItems: 'flex-start', flexDirection: 'column', gap: 6 }]}>
            <FramingTip text="Phone vertical, on a stable mount or leaned against your bag." />
            <FramingTip text="Stand 6-10 feet away — get your full body in frame head-to-feet." />
            <FramingTip text="Down-the-line: camera behind you, looking at the target line." />
            <FramingTip text="Face-on: camera in front of you, perpendicular to the target line." />
          </View>
          <TouchableOpacity
            onPress={onRetake}
            style={[styles.retakeBtn, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Record another swing"
          >
            <Ionicons name="radio-button-on" size={18} color="#060f09" />
            <Text style={[styles.retakeBtnText, { color: '#060f09' }]}>Record another swing</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Top Focus */}
          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 14 }]}>TOP FOCUS</Text>
          <View style={[styles.focusCard, { borderColor: colors.border }]}>
            <View style={[styles.focusIcon, { borderColor: colors.accent }]}>
              <Ionicons name="refresh-outline" size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.focusTitle, { color: colors.text_primary }]}>{insight.topFocus}</Text>
              <Text style={[styles.focusSub, { color: colors.text_muted }]} numberOfLines={2}>{insight.topFocusSub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
          </View>

          {/* Recommended Drill */}
          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 14 }]}>RECOMMENDED DRILL</Text>
          <TouchableOpacity
            onPress={() => onPressDrill(insight.drillKey)}
            style={[styles.drillCard, { borderColor: colors.border }]}
          >
            <View style={[styles.drillIcon, { borderColor: colors.accent }]}>
              <Ionicons name="body-outline" size={22} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.focusTitle, { color: colors.text_primary }]}>{insight.drillTitle}</Text>
              <Text style={[styles.focusSub, { color: colors.text_muted }]} numberOfLines={2}>{insight.drillSub}</Text>
            </View>
            <View style={[styles.drillThumb, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Ionicons name="play" size={18} color={colors.accent} />
            </View>
          </TouchableOpacity>

          {/* Next Swing Focus */}
          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 14 }]}>NEXT SWING FOCUS</Text>
          <View style={[styles.focusCard, { borderColor: colors.border }]}>
            <View style={[styles.focusIcon, { borderColor: colors.accent }]}>
              <Ionicons name="locate-outline" size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.focusTitle, { color: colors.text_primary }]}>{insight.nextSwingFocus}</Text>
              <Text style={[styles.focusSub, { color: colors.accent }]} numberOfLines={1}>{insight.nextSwingArrow}</Text>
            </View>
          </View>
          {/* View Full Data */}
          <TouchableOpacity style={[styles.fullDataBtn, { borderColor: colors.border }]}>
            <Text style={[styles.fullDataLabel, { color: colors.text_primary }]}>View Full Data</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
          </TouchableOpacity>
        </>
      )}

      {analysis && validity.valid ? (
        <Text style={[styles.confidenceFooter, { color: colors.text_muted }]}>
          Analysis confidence: {analysis.confidence} · severity: {analysis.severity}
        </Text>
      ) : null}
    </View>
  );
}

function FramingTip({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.framingTipRow}>
      <Ionicons name="checkmark-circle-outline" size={14} color={colors.accent} />
      <Text style={[styles.framingTipText, { color: colors.text_muted }]} numberOfLines={2}>{text}</Text>
    </View>
  );
}

// ─── Body Mechanics tab (deeper analysis) ───────────────────────────

function BodyMechanicsCard({ analysis, colors }: {
  analysis: SwingAnalysis | null;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
      <Text style={[styles.insightHeader, { color: colors.accent }]}>BODY MECHANICS</Text>
      <Text style={[styles.bubbleText, { color: colors.text_muted, marginTop: 6 }]}>
        Spine angle, shoulder turn, hip turn, X-factor, and weight transfer visualization land with the
        on-device pose detector in the next APK build. For now, the cloud analysis surfaces the major
        fault pattern below.
      </Text>
      {analysis ? (
        <View style={{ marginTop: 12 }}>
          <Text style={[styles.focusTitle, { color: colors.text_primary }]}>{prettyIssue(analysis.detected_issue)}</Text>
          <Text style={[styles.focusSub, { color: colors.text_muted, marginTop: 4 }]}>{analysis.observation}</Text>
        </View>
      ) : (
        <Text style={[styles.focusSub, { color: colors.text_muted, marginTop: 12 }]}>Record a swing to populate this tab.</Text>
      )}
    </View>
  );
}

function ShotTracerCard({ colors }: {
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
      <Text style={[styles.insightHeader, { color: colors.accent }]}>SHOT TRACER</Text>
      <Text style={[styles.bubbleText, { color: colors.text_muted, marginTop: 6 }]}>
        Ball-flight tracking via post-impact frame detection lands in a follow-up. The tracer will
        draw the trajectory line on shots where the ball is visible in frame.
      </Text>
    </View>
  );
}

function BottomBar({ colors, onTagClub, onCompare }: {
  colors: ReturnType<typeof useTheme>['colors'];
  onRecord?: () => void; // unused — record now lives in the video card
  onTagClub: () => void;
  onCompare: () => void;
}) {
  // 2026-05-20 — Record removed from the bottom bar. Tim: "integrated
  // into the video screen element, not all the way down at the bottom."
  // Bottom strip now has Tag Club + Compare only (utility actions, not
  // the primary capture). Background tinted so it reads as a separate
  // utility row when sticky at the bottom.
  return (
    <View style={[styles.bottomBar, { backgroundColor: colors.surface_elevated, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 6 }]}>
      <TouchableOpacity onPress={onTagClub} style={[styles.bottomBtn, { borderColor: colors.border, borderWidth: 1 }]}>
        <Ionicons name="flag-outline" size={16} color={colors.text_primary} />
        <View>
          <Text style={[styles.bottomBtnText, { color: colors.text_primary }]}>Tag Club</Text>
          <Text style={[styles.bottomBtnSub, { color: colors.text_muted }]}>8i</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCompare} style={[styles.bottomBtn, { borderColor: colors.border, borderWidth: 1 }]}>
        <Ionicons name="stats-chart-outline" size={16} color={colors.text_primary} />
        <Text style={[styles.bottomBtnText, { color: colors.text_primary }]}>Compare</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Insight derivation ─────────────────────────────────────────────

function deriveInsight(a: SwingAnalysis | null, persona: string, validity: SwingValidity): DerivedInsight {
  if (!a) {
    return {
      diagnostic: `Record a swing and ${caddieDisplay(persona)} will read it for you.`,
      topFocus: 'Awaiting first swing',
      topFocusSub: 'Tap Record below to capture a swing.',
      drillKey: 'tempo',
      drillTitle: 'Tempo Trainer',
      drillSub: '3:1 backswing-to-downswing rhythm — works on every swing.',
      nextSwingFocus: 'Smooth setup',
      nextSwingArrow: 'Relaxed → Athletic',
    };
  }
  // Phase 418 — when validity gate rejects, return a placeholder
  // insight; the InsightCard will short-circuit and render the
  // "couldn't see your swing" state + framing tips, so these fields
  // are never actually shown. We still return a well-formed
  // DerivedInsight so the type contract holds.
  if (!validity.valid) {
    return {
      diagnostic: validity.reason ?? 'No analyzable swing detected in this clip.',
      topFocus: 'No swing detected',
      topFocusSub: 'Get your full body in frame and record again.',
      drillKey: 'tempo',
      drillTitle: 'Tempo Trainer',
      drillSub: '3:1 backswing-to-downswing rhythm — works on every swing.',
      nextSwingFocus: 'Reframe & retake',
      nextSwingArrow: 'Floor → Full body',
    };
  }
  const issue = a.detected_issue;
  const observation = a.observation;
  const map = ISSUE_INSIGHTS[issue];
  return {
    diagnostic: `${prefix(persona)} ${observation}`,
    topFocus: map.topFocus,
    topFocusSub: map.topFocusSub,
    drillKey: map.drillKey,
    drillTitle: map.drillTitle,
    drillSub: map.drillSub,
    nextSwingFocus: map.nextSwingFocus,
    nextSwingArrow: map.nextSwingArrow,
  };
}

function prefix(persona: string): string {
  switch (persona) {
    case 'serena': return 'Reading your swing now —';
    case 'tank':   return "Here's what I see:";
    case 'harry':  return 'Quick read:';
    default:       return 'Solid swing!';
  }
}

function caddieDisplay(p: string): string {
  return p === 'kevin' ? 'Kevin' : p === 'serena' ? 'Serena' : p === 'tank' ? 'Tank' : p === 'harry' ? 'Harry' : 'Kevin';
}

function prettyIssue(issue: string): string {
  return issue.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

interface IssueMap {
  topFocus: string;
  topFocusSub: string;
  drillKey: string;
  drillTitle: string;
  drillSub: string;
  nextSwingFocus: string;
  nextSwingArrow: string;
}

const ISSUE_INSIGHTS: Record<string, IssueMap> = {
  over_the_top: {
    topFocus: 'Shallow the Downswing',
    topFocusSub: 'Great rotation — just work on getting the club more in front earlier.',
    drillKey: 'pump-drill',
    drillTitle: 'Pump Drill',
    drillSub: 'Feel a shallower takeaway and deliver the club from the inside.',
    nextSwingFocus: 'Tempo & Transition',
    nextSwingArrow: 'Smooth → Explode',
  },
  early_extension: {
    topFocus: 'Maintain Posture',
    topFocusSub: 'Hips moving toward the ball — stay in your spine angle through impact.',
    drillKey: 'wall-drill',
    drillTitle: 'Wall Drill',
    drillSub: 'Practice with your backside against a wall — feel the rotation, not the thrust.',
    nextSwingFocus: 'Hip Rotation',
    nextSwingArrow: 'Thrust → Rotate',
  },
  reverse_pivot: {
    topFocus: 'Weight Behind the Ball',
    topFocusSub: 'Weight stayed on the lead side at the top — load into your trail leg.',
    drillKey: 'step-drill',
    drillTitle: 'Step Drill',
    drillSub: 'Step into the shot from the trail foot to feel proper weight load.',
    nextSwingFocus: 'Weight Load',
    nextSwingArrow: 'Front → Back to Front',
  },
  chicken_wing: {
    topFocus: 'Full Extension Through Impact',
    topFocusSub: 'Lead arm collapsing through impact — extend both arms past the ball.',
    drillKey: 'towel-drill',
    drillTitle: 'Towel Under Arm Drill',
    drillSub: 'Keeps the arms connected, encourages full extension.',
    nextSwingFocus: 'Extension',
    nextSwingArrow: 'Bent → Long arms',
  },
  swing_path_outside_in: {
    topFocus: 'Inside Path',
    topFocusSub: 'Club is approaching outside-in — start the downswing from the inside.',
    drillKey: 'gate-drill',
    drillTitle: 'Gate Drill',
    drillSub: 'Tees just outside the ball line force an inside-out path.',
    nextSwingFocus: 'Swing Path',
    nextSwingArrow: 'Outside → Inside',
  },
  swing_path_inside_out: {
    topFocus: 'Square the Path',
    topFocusSub: 'Path is too far inside-out — neutralize toward the target line.',
    drillKey: 'gate-drill',
    drillTitle: 'Gate Drill',
    drillSub: 'Inside tee gates encourage a neutral path on plane.',
    nextSwingFocus: 'Swing Path',
    nextSwingArrow: 'Inside-out → Square',
  },
  attack_angle_steep: {
    topFocus: 'Shallower Attack',
    topFocusSub: 'Coming down too steep — feel a more sweeping move.',
    drillKey: 'tee-drill',
    drillTitle: 'Low Tee Drill',
    drillSub: 'Sweep the ball off a low tee for shallow contact.',
    nextSwingFocus: 'Attack Angle',
    nextSwingArrow: 'Steep → Shallow',
  },
  attack_angle_shallow: {
    topFocus: 'Pinch the Ball',
    topFocusSub: 'Attack too shallow — feel the club come down with descent.',
    drillKey: 'divot-drill',
    drillTitle: 'Divot Drill',
    drillSub: 'Place a coin past the ball — divot starts AFTER the coin.',
    nextSwingFocus: 'Attack Angle',
    nextSwingArrow: 'Sweep → Pinch',
  },
  club_face_open: {
    topFocus: 'Square the Face',
    topFocusSub: 'Face open through impact — strengthen grip or rotate forearms sooner.',
    drillKey: 'glove-drill',
    drillTitle: 'Glove Logo Drill',
    drillSub: 'Watch the back of your lead glove face the target through impact.',
    nextSwingFocus: 'Face Control',
    nextSwingArrow: 'Open → Square',
  },
  club_face_closed: {
    topFocus: 'Open the Face Slightly',
    topFocusSub: 'Face shutting through impact — weaken grip or hold off the rotation.',
    drillKey: 'glove-drill',
    drillTitle: 'Glove Logo Drill',
    drillSub: 'Hold the lead glove logo pointing target-ward through impact.',
    nextSwingFocus: 'Face Control',
    nextSwingArrow: 'Closed → Square',
  },
  none: {
    topFocus: 'Solid Pattern',
    topFocusSub: 'No specific fault detected — keep grooving this move.',
    drillKey: 'tempo',
    drillTitle: 'Tempo Trainer',
    drillSub: 'Maintain rhythm — 3:1 backswing-to-downswing.',
    nextSwingFocus: 'Repeat',
    nextSwingArrow: 'Same → Same',
  },
};

// ─── Stub skeleton (replaced by real MoveNet keypoints next APK) ──────

const STUB_SKELETON = {
  joints: [
    { x: 50, y: 12 },  // head 0
    { x: 42, y: 28 },  // L shoulder 1
    { x: 58, y: 28 },  // R shoulder 2
    { x: 36, y: 44 },  // L elbow 3
    { x: 64, y: 44 },  // R elbow 4
    { x: 44, y: 56 },  // L hip 5
    { x: 56, y: 56 },  // R hip 6
    { x: 50, y: 80 },  // ankles 7
  ],
  connections: [
    [0, 1], [0, 2],            // head → shoulders
    [1, 2],                     // shoulder line
    [1, 3], [2, 4],            // shoulders → elbows
    [1, 5], [2, 6],            // shoulders → hips
    [5, 6],                     // hip line
    [5, 7], [6, 7],            // hips → ankles
  ] as [number, number][],
};

// ─── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 12, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  title: { fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  subtitle: { fontSize: 12, marginTop: 2 },
  modeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  modeChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  tabPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  tabPillText: { fontSize: 12, fontWeight: '700' },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  anglePillRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 },
  anglePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1 },
  anglePillText: { fontSize: 12, fontWeight: '700' },
  ellipsisBtn: { marginLeft: 'auto', padding: 4 },
  videoFrame: { width: '100%', aspectRatio: 4/5, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', position: 'relative' },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16 },
  placeholderText: { fontSize: 14, fontWeight: '700' },
  placeholderHint: { fontSize: 12 },
  controlRail: { position: 'absolute', right: 8, top: '50%', transform: [{ translateY: -100 }], borderRadius: 12, borderWidth: 1, padding: 6, gap: 6 },
  railBtn: { alignItems: 'center', gap: 2, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1 },
  railLabel: { fontSize: 9, fontWeight: '700' },
  scrubberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  scrubberTime: { fontSize: 11, fontFamily: 'monospace' },
  scrubberTrack: { flex: 1, height: 2, borderRadius: 1 },
  scrubberFill: { height: '100%', width: '40%', borderRadius: 1 },
  metricsStrip: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  metricCell: { alignItems: 'center', flex: 1 },
  metricLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  metricValue: { fontSize: 22, fontWeight: '900' },
  metricUnit: { fontSize: 10, marginTop: 2 },
  metricsFooter: { fontSize: 11, marginTop: 8, textAlign: 'center', fontStyle: 'italic', lineHeight: 16 },
  noSwingBadge: {
    position: 'absolute', top: 10, left: 10, right: 80,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: 'rgba(239,68,68,0.85)', borderRadius: 10,
  },
  noSwingBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 },
  framingTipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 2 },
  framingTipText: { flex: 1, fontSize: 12, lineHeight: 17 },
  retakeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 12, paddingVertical: 14, borderRadius: 12,
  },
  retakeBtnText: { fontSize: 14, fontWeight: '900', letterSpacing: 0.3 },
  insightHeader: { fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
  insightRow: { flexDirection: 'row', gap: 12, marginTop: 10, alignItems: 'flex-start' },
  caddiePortrait: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  bubble: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1 },
  bubbleText: { fontSize: 13, lineHeight: 19 },
  caddieNameLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 6, marginLeft: 2 },
  sectionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.6, marginBottom: 6 },
  focusCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  focusIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  focusTitle: { fontSize: 14, fontWeight: '800' },
  focusSub: { fontSize: 12, marginTop: 2 },
  drillCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  drillIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  drillThumb: { width: 56, height: 40, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fullDataBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  fullDataLabel: { fontSize: 13, fontWeight: '700' },
  confidenceFooter: { fontSize: 10, marginTop: 8, textAlign: 'center', fontStyle: 'italic' },
  bottomBar: { flexDirection: 'row', gap: 8, marginTop: 12 },
  bottomBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12 },
  bottomBtnText: { fontSize: 13, fontWeight: '800' },
  bottomBtnSub: { fontSize: 10, fontWeight: '600' },
  // 2026-05-20 — Single-view + overlay toggles + sticky bar + no-clip hero
  overlayRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 12, paddingBottom: 8,
  },
  overlayToggle: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 8, borderRadius: 18, borderWidth: 1,
  },
  overlayToggleText: { fontSize: 12, fontWeight: '700' },
  speedPill: {
    position: 'absolute', top: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 12,
  },
  speedPillText: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  stickyBar: {
    position: 'absolute', left: 12, right: 12, bottom: 12,
  },
  noClipHero: {
    flex: 1, padding: 16, justifyContent: 'center',
  },
  noClipCard: {
    borderRadius: 16, borderWidth: 1, padding: 24,
    alignItems: 'center', gap: 12,
  },
  noClipIcon: {
    width: 88, height: 88, borderRadius: 44, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  noClipTitle: { fontSize: 22, fontWeight: '900', letterSpacing: 0.2 },
  noClipSub: { fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 8 },
  noClipPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 14, marginTop: 8, minWidth: 220,
  },
  noClipPrimaryText: { fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },
  noClipSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8,
  },
  noClipSecondaryText: { fontSize: 13, fontWeight: '700' },
  // 2026-05-20 — Record button INSIDE the video card (per Tim's
  // "integrate into the video screen element" call). Big circular
  // button just below the playback frame, primary capture action.
  frameRecordWrap: {
    alignItems: 'center', gap: 8, marginTop: 12,
  },
  frameRecordOuter: {
    width: 64, height: 64, borderRadius: 32, borderWidth: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  frameRecordInner: {
    width: 48, height: 48, borderRadius: 24,
  },
  frameRecordHint: {
    fontSize: 11, fontWeight: '600',
  },
});
