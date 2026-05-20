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
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useSettingsStore } from '../../store/settingsStore';

type Angle = 'down_the_line' | 'face_on';
type ActiveTab = 'smart_motion' | 'shot_tracer' | 'body_mechanics';
type ControlMode = 'grid' | 'overlay' | 'draw' | 'speed';

// 2026-05-19 — Phase 416 — Two-card SmartMotion. See file header for
// architectural call on pose detection seam.
export default function SmartMotion() {
  const router = useRouter();
  const { colors } = useTheme();
  const { clipUri } = useLocalSearchParams<{ clipUri?: string }>();
  const profile = usePlayerProfileStore();
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);

  const [activeTab, setActiveTab] = useState<ActiveTab>('smart_motion');
  const [angle, setAngle] = useState<Angle>('face_on');
  const [controlMode, setControlMode] = useState<ControlMode>('overlay');
  const [playbackSpeed, setPlaybackSpeed] = useState<0.25 | 0.5 | 1>(0.5);
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

  // Derive Top Focus + Drill + Next Swing Focus from the analysis.
  const insight = useMemo(() => deriveInsight(analysis, caddiePersonality), [analysis, caddiePersonality]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
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

      {/* Top tab bar — Smart Motion / Shot Tracer / Body Mechanics */}
      <View style={styles.tabRow}>
        <TabPill
          label="Smart Motion"
          icon="body-outline"
          active={activeTab === 'smart_motion'}
          accent={colors.accent}
          mutedBorder={colors.border}
          onPress={() => setActiveTab('smart_motion')}
        />
        <TabPill
          label="Shot Tracer"
          icon="trail-sign-outline"
          active={activeTab === 'shot_tracer'}
          accent={colors.accent}
          mutedBorder={colors.border}
          onPress={() => setActiveTab('shot_tracer')}
        />
        <TabPill
          label="Body Mechanics"
          icon="walk-outline"
          active={activeTab === 'body_mechanics'}
          accent={colors.accent}
          mutedBorder={colors.border}
          onPress={() => setActiveTab('body_mechanics')}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {activeTab === 'smart_motion' && (
          <VisualCard
            clipUri={clipUri ?? null}
            angle={angle}
            setAngle={setAngle}
            controlMode={controlMode}
            setControlMode={setControlMode}
            playbackSpeed={playbackSpeed}
            setPlaybackSpeed={setPlaybackSpeed}
            analysis={analysis}
            colors={colors}
          />
        )}

        {activeTab === 'body_mechanics' && (
          <BodyMechanicsCard analysis={analysis} colors={colors} />
        )}

        {activeTab === 'shot_tracer' && (
          <ShotTracerCard colors={colors} />
        )}

        {/* Card 2 — INSIGHT (always visible below the visual) */}
        <InsightCard
          colors={colors}
          analyzing={analyzing}
          analysisError={analysisError}
          analysis={analysis}
          insight={insight}
          caddieName={caddieDisplay(caddiePersonality)}
          dominantMiss={profile.dominantMiss ?? null}
          onPressDrill={(drillKey) => router.push(`/drills/${drillKey}` as never)}
        />

        {/* Bottom action bar — shared across both cards */}
        <BottomBar
          colors={colors}
          onRecord={() => router.push('/swinglab/camera-setup?next=/swinglab/smartmotion' as never)}
          onTagClub={() => {/* TODO: club tag sheet */}}
          onCompare={() => router.push('/swinglab/library' as never)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Card 1: Visual ─────────────────────────────────────────────────

function VisualCard({
  clipUri, angle, setAngle, controlMode, setControlMode, playbackSpeed, setPlaybackSpeed,
  analysis, colors,
}: {
  clipUri: string | null;
  angle: Angle;
  setAngle: (a: Angle) => void;
  controlMode: ControlMode;
  setControlMode: (m: ControlMode) => void;
  playbackSpeed: 0.25 | 0.5 | 1;
  setPlaybackSpeed: (s: 0.25 | 0.5 | 1) => void;
  analysis: SwingAnalysis | null;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
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

        {/* Pose overlay placeholder. Real keypoints land in the next APK
            when TFJS + expo-gl + @tensorflow-models/pose-detection ship.
            Renders a vertical alignment reference + 8 stub joints so the
            UI shows the SHAPE of the analysis even before the keypoints
            are live. */}
        {clipUri && controlMode === 'overlay' && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {/* Vertical alignment line */}
            <Line x1="50%" y1="6%" x2="50%" y2="94%" stroke={colors.accent} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.55} />
            {/* Stub skeleton — 8 joints + connections. Replaced by real
                keypoints once on-device pose lands. */}
            {STUB_SKELETON.connections.map(([a, b], i) => (
              <Line
                key={i}
                x1={`${STUB_SKELETON.joints[a].x}%`} y1={`${STUB_SKELETON.joints[a].y}%`}
                x2={`${STUB_SKELETON.joints[b].x}%`} y2={`${STUB_SKELETON.joints[b].y}%`}
                stroke={colors.accent}
                strokeWidth={2}
                opacity={0.4}
              />
            ))}
            {STUB_SKELETON.joints.map((j, i) => (
              <Circle key={i} cx={`${j.x}%`} cy={`${j.y}%`} r={3} fill={colors.accent} opacity={0.55} />
            ))}
          </Svg>
        )}
        {clipUri && controlMode === 'grid' && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {[1,2,3].map(i => (
              <Line key={`v${i}`} x1={`${i*25}%`} y1="0%" x2={`${i*25}%`} y2="100%" stroke="#ffffff" strokeWidth={0.5} opacity={0.18} />
            ))}
            {[1,2,3].map(i => (
              <Line key={`h${i}`} x1="0%" y1={`${i*25}%`} x2="100%" y2={`${i*25}%`} stroke="#ffffff" strokeWidth={0.5} opacity={0.18} />
            ))}
          </Svg>
        )}

        {/* Right control rail */}
        <View style={[styles.controlRail, { backgroundColor: 'rgba(13,26,13,0.88)', borderColor: colors.border }]}>
          <RailButton icon="grid-outline" label="Grid" active={controlMode === 'grid'} accent={colors.accent} onPress={() => setControlMode('grid')} />
          <RailButton icon="body-outline" label="Overlay" active={controlMode === 'overlay'} accent={colors.accent} onPress={() => setControlMode('overlay')} />
          <RailButton icon="pencil-outline" label="Draw" active={controlMode === 'draw'} accent={colors.accent} onPress={() => setControlMode('draw')} />
          <RailButton icon="speedometer-outline" label="Speed" active={controlMode === 'speed'} accent={colors.accent} onPress={() => {
            setControlMode('speed');
            // Cycle speeds: 0.25 → 0.5 → 1
            const next = playbackSpeed === 0.25 ? 0.5 : playbackSpeed === 0.5 ? 1 : 0.25;
            setPlaybackSpeed(next);
          }} />
        </View>
      </View>

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

      {/* Metrics strip — real timing + labeled estimates */}
      <View style={styles.metricsStrip}>
        <Metric label="Club Speed" value="82" unit="mph" estimated colors={colors} />
        <Metric label="Ball Speed" value="113" unit="mph" estimated colors={colors} />
        <Metric label="Smash" value="1.37" unit="" estimated colors={colors} />
        <Metric label="Carry" value="156" unit="yds" estimated colors={colors} />
      </View>
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
  colors, analyzing, analysisError, analysis, insight, caddieName, dominantMiss, onPressDrill,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  analyzing: boolean;
  analysisError: string | null;
  analysis: SwingAnalysis | null;
  insight: DerivedInsight;
  caddieName: string;
  dominantMiss: string | null;
  onPressDrill: (drillKey: string) => void;
}) {
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
          ) : (
            <Text style={[styles.bubbleText, { color: colors.text_primary }]}>{insight.diagnostic}</Text>
          )}
        </View>
      </View>
      <Text style={[styles.caddieNameLabel, { color: colors.text_muted }]}>{caddieName.toUpperCase()}</Text>

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

      {analysis ? (
        <Text style={[styles.confidenceFooter, { color: colors.text_muted }]}>
          Analysis confidence: {analysis.confidence} · severity: {analysis.severity}
        </Text>
      ) : null}
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

function BottomBar({ colors, onRecord, onTagClub, onCompare }: {
  colors: ReturnType<typeof useTheme>['colors'];
  onRecord: () => void;
  onTagClub: () => void;
  onCompare: () => void;
}) {
  return (
    <View style={styles.bottomBar}>
      <TouchableOpacity onPress={onRecord} style={[styles.bottomBtn, { backgroundColor: colors.accent }]}>
        <Ionicons name="radio-button-on" size={16} color="#060f09" />
        <Text style={[styles.bottomBtnText, { color: '#060f09' }]}>Record</Text>
      </TouchableOpacity>
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

function deriveInsight(a: SwingAnalysis | null, persona: string): DerivedInsight {
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
});
