/**
 * rangebook.tsx — AI Rangebook View
 * Opens when the player taps the hole thumbnail during a round.
 * Shows: animated last-shot path, recommended caddie line, optional scatter dots,
 * minimal text overlay, and an "Explain" voice button.
 *
 * Performance rules:
 *  – No AI calls, no network requests, no blocking operations
 *  – All data read synchronously from stores at mount
 *  – Voice only on explicit user tap
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Path, Circle } from 'react-native-svg';
import { useRoundStore }     from '../store/roundStore';
import { useAiProfileStore, buildAiHint } from '../store/aiProfileStore';
import type { Shot } from '../store/roundStore';
import { speakJob as _speakJob, PRIORITY as ENGINE_PRIORITY } from '../services/voice';
import { selectAndSpeak, VOICE_PRIORITY } from '../services/voicePriority';

// ── Types ─────────────────────────────────────────────────────────────────────
type Phase   = 'early' | 'mid' | 'late';
type Trend   = 'neutral' | 'confident' | 'struggling';
type Pressure = 'normal' | 'elevated';

interface NarrationContext {
  pressure: Pressure;
  phase:    Phase;
  trend:    Trend;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map a ShotResult to an SVG path d-attribute (normalized coords in a 160×240 canvas). */
function buildShotPath(result: Shot['result']): string {
  // Tee = (80, 220), Green target = (80, 30)
  // Control point shifts horizontally based on miss direction
  const sx = 80, sy = 220;
  const ex = 80, ey = 30;
  const cx =
    result === 'left'  ? 30  :
    result === 'right' ? 130 :
    80; // center / short / long go straight
  return `M ${sx} ${sy} Q ${cx} ${(sy + ey) / 2} ${ex} ${ey}`;
}

/** The recommended caddie line — slightly adjusted for AI miss bias. */
function buildCaddiePath(missBias: string | null): string {
  const sx = 80, sy = 220;
  const ey = 30;
  let ex = 80;
  if (missBias === 'right') ex = 65;  // aim left
  if (missBias === 'left')  ex = 95;  // aim right
  // Slight arc toward the recommended aim
  const cx = (sx + ex) / 2;
  return `M ${sx} ${sy} Q ${cx} ${(sy + ey) / 2} ${ex} ${ey}`;
}

/** Build the base narration sentence from the last shot result. */
function buildBaseNarration(lastShot: Shot | undefined): string {
  if (!lastShot) return 'Play center.';
  if (lastShot.result === 'right')  return 'You missed right here last time. Favor left.';
  if (lastShot.result === 'left')   return 'You missed left here last time. Favor right.';
  if (lastShot.result === 'center') return 'You played this well. Same line.';
  return 'Play center.';
}

/** Apply situational context (max 1 extra phrase appended). */
function applyContext(message: string, ctx: NarrationContext): string {
  if (ctx.pressure === 'elevated') return `${message} Smooth swing.`;
  if (ctx.phase === 'late') {
    if (ctx.trend === 'struggling') return 'Play center.';
    if (ctx.trend === 'confident')  return `${message} You can go at it.`;
  }
  return message;
}

/** Compute trend from last 3 shots across the whole round. */
function computeTrend(shots: Shot[]): Trend {
  if (shots.length < 3) return 'neutral';
  const last3 = shots.slice(-3);
  const centers = last3.filter((s) => s.result === 'center').length;
  if (centers >= 2) return 'confident';
  if (centers === 0) return 'struggling';
  return 'neutral';
}

/** Minimal safe-speak guard — store ref updated on each call. */
type SpokenRecord = { message: string; ts: number } | null;

// ── Component ─────────────────────────────────────────────────────────────────
export default function RangebookView() {
  const router   = useRouter();
  const { hole } = useLocalSearchParams<{ hole: string }>();
  const holeNum  = parseInt(hole ?? '1', 10);
  const { width: screenW } = useWindowDimensions();

  // ── Store reads (synchronous, zero lag) ────────────────────────────────────
  const shots     = useRoundStore((s) => s.shots);
  const aiProfile = useAiProfileStore();

  // Data derived once at mount
  const holeShots    = shots.filter((s) => s.hole === holeNum);
  const lastShot     = holeShots[holeShots.length - 1];
  const allHoleShots = shots; // for trend / phase
  const missBias     = aiProfile.missBias ?? null;

  // ── Animation values ───────────────────────────────────────────────────────
  // strokeDashoffset animates from pathLength → 0 to "draw" the path
  const PATH_LENGTH = 220; // rough arc length for our 160×240 canvas
  const lastShotDash   = useRef(new Animated.Value(PATH_LENGTH)).current;
  const caddieDash     = useRef(new Animated.Value(PATH_LENGTH)).current;
  const scatterOpacity = useRef(new Animated.Value(0)).current;

  // ── Voice state ────────────────────────────────────────────────────────────
  const [isNarrating,    setIsNarrating]    = useState(false);
  const [hasNarratedOnce, setHasNarratedOnce] = useState(false);

  // ── Context ────────────────────────────────────────────────────────────────
  const phase:    Phase    = allHoleShots.length < 5 ? 'early' : allHoleShots.length < 12 ? 'mid' : 'late';
  const trend:    Trend    = computeTrend(allHoleShots);
  const pressure: Pressure = trend === 'struggling' && phase === 'late' ? 'elevated' : 'normal';
  const narrationCtx: NarrationContext = { pressure, phase, trend };

  // ── Text overlay data ──────────────────────────────────────────────────────
  const lastLabel = lastShot
    ? `Last: ${lastShot.club} → ${lastShot.result.charAt(0).toUpperCase() + lastShot.result.slice(1)}`
    : null;

  const biasHint = buildAiHint(aiProfile, lastShot?.club ?? '');
  const playLabel = biasHint
    ? `Play: ${biasHint}`
    : missBias === 'right' ? 'Play: Favor left'
    : missBias === 'left'  ? 'Play: Favor right'
    : null;

  // ── Animation sequence ─────────────────────────────────────────────────────
  useEffect(() => {
    // 1. Draw last shot over 300 ms
    Animated.timing(lastShotDash, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();

    // 2. Draw caddie line after 300 ms delay
    const t = setTimeout(() => {
      Animated.timing(caddieDash, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start();

      // 3. Fade in scatter dots after caddie line finishes
      setTimeout(() => {
        Animated.timing(scatterOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }, 400);
    }, 300);

    return () => clearTimeout(t);
  }, [caddieDash, lastShotDash, scatterOpacity]);

  // ── Voice ──────────────────────────────────────────────────────────────────
  const handleNarration = useCallback(async (force = false) => {
    if (isNarrating) return;
    const base    = buildBaseNarration(lastShot);
    const message = applyContext(base, narrationCtx);

    setIsNarrating(true);
    setHasNarratedOnce(true);

    try {
      await selectAndSpeak(
        [{ text: message, priority: VOICE_PRIORITY.CONTEXT }],
        `rangebook-hole-${holeNum}`,
        force,
        'female',
      );
    } catch {
      // silent fail
    } finally {
      setIsNarrating(false);
    }
  }, [isNarrating, lastShot, narrationCtx, holeNum]);

  // ── Scatter dots (previous shots on this hole, up to 6) ───────────────────
  const scatterShots = holeShots.slice(-6);

  // ── SVG canvas dimensions ──────────────────────────────────────────────────
  const SVG_W = Math.min(screenW * 0.7, 220);
  const SVG_H = SVG_W * 1.5;
  const scale = SVG_W / 160;

  // animated props must be fed into normal Path via native driver workaround
  // react-native-svg AnimatedPath not available — use opacity fade trick + CSS approach
  // We render two Paths and control opacity via Animated.View wrappers
  const AnimatedSvgView = Animated.View;

  const lastShotPath   = buildShotPath(lastShot?.result ?? 'center');
  const caddiePath     = buildCaddiePath(missBias);

  // Compute scatter dot positions
  function shotDotPos(s: Shot, idx: number): { x: number; y: number } {
    const spread = [-20, 20, -30, 30, -10, 10];
    const cx =
      s.result === 'left'  ? 30 + (spread[idx % 6] ?? 0) * 0.3 :
      s.result === 'right' ? 130 + (spread[idx % 6] ?? 0) * 0.3 :
      80 + (spread[idx % 6] ?? 0) * 0.2;
    // y position: distribute across fairway
    const yFrac = 0.4 + (idx / Math.max(scatterShots.length - 1, 1)) * 0.35;
    return { x: cx, y: 220 - yFrac * 190 };
  }

  return (
    <Pressable style={s.root} onPress={() => router.back()}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Hole {holeNum}</Text>
        <Text style={s.headerSub}>AI Rangebook</Text>
      </View>

      {/* SVG canvas */}
      <View style={[s.svgWrap, { width: SVG_W, height: SVG_H }]}>
        <Svg width={SVG_W} height={SVG_H} viewBox={`0 0 160 240`}>
          {/* Fairway guide */}
          <Path d="M 60 220 L 60 30 L 100 30 L 100 220 Z" fill="rgba(255,255,255,0.04)" />
          {/* Green circle at top */}
          <Circle cx={80} cy={28} r={14} fill="rgba(31,111,84,0.25)" stroke="rgba(31,111,84,0.5)" strokeWidth={1} />
          {/* Tee marker at bottom */}
          <Circle cx={80} cy={222} r={5} fill="#1F6F54" opacity={0.7} />

          {/* ── Scatter dots — previous shots (faint) ─── */}
          {scatterShots.map((sh, i) => {
            const { x, y } = shotDotPos(sh, i);
            const color =
              sh.result === 'left'  ? '#60a5fa' :
              sh.result === 'right' ? '#f87171' :
              '#4ade80';
            return (
              <Circle key={i} cx={x} cy={y} r={3.5}
                fill={color} opacity={0.15} />
            );
          })}
        </Svg>

        {/* Last shot path — animated opacity fade-in (proxy for draw animation) */}
        {lastShot && (
          <AnimatedSvgView
            style={[StyleSheet.absoluteFill, { opacity: lastShotDash.interpolate({ inputRange: [0, PATH_LENGTH], outputRange: [1, 0] }) }]}
            pointerEvents="none"
          >
            <Svg width={SVG_W} height={SVG_H} viewBox="0 0 160 240">
              <Path
                d={lastShotPath}
                stroke="#60a5fa"
                strokeWidth={2.5}
                opacity={0.35}
                fill="none"
                strokeLinecap="round"
              />
            </Svg>
          </AnimatedSvgView>
        )}

        {/* Caddie recommended line — animated after delay */}
        <AnimatedSvgView
          style={[StyleSheet.absoluteFill, { opacity: caddieDash.interpolate({ inputRange: [0, PATH_LENGTH], outputRange: [1, 0] }) }]}
          pointerEvents="none"
        >
          <Svg width={SVG_W} height={SVG_H} viewBox="0 0 160 240">
            <Path
              d={caddiePath}
              stroke="#1F6F54"
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
          </Svg>
        </AnimatedSvgView>
      </View>

      {/* Text overlay */}
      <View style={s.textWrap} pointerEvents="none">
        {lastLabel && (
          <Text style={s.lastLabel}>{lastLabel}</Text>
        )}
        {playLabel && (
          <Text style={s.playLabel}>{playLabel}</Text>
        )}
      </View>

      {/* Explain / narration button */}
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          void handleNarration(true);
        }}
        style={({ pressed }) => [
          s.explainBtn,
          pressed && { opacity: 0.7 },
          isNarrating && s.explainBtnActive,
        ]}
      >
        <Text style={s.explainBtnText}>
          {isNarrating ? 'Playing…' : 'Explain'}
        </Text>
      </Pressable>

      {/* Dismiss hint */}
      <Text style={s.dismissHint}>Tap anywhere to close</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050E0A',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 4,
  },
  headerTitle: {
    color: '#A7F3D0',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerSub: {
    color: '#4ADE80',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  svgWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(31,111,84,0.4)',
    backgroundColor: 'rgba(10,26,18,0.8)',
  },
  textWrap: {
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  lastLabel: {
    color: '#93C5FD',
    fontSize: 14,
    fontWeight: '600',
  },
  playLabel: {
    color: '#4ADE80',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  explainBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#0B3D2E',
    borderWidth: 1.5,
    borderColor: '#1F6F54',
  },
  explainBtnActive: {
    borderColor: '#4ADE80',
    backgroundColor: '#0d2b1e',
  },
  explainBtnText: {
    color: '#4ADE80',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dismissHint: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    marginTop: 8,
  },
});
