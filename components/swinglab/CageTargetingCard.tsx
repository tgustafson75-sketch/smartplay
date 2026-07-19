/**
 * 2026-05-27 — Fix EO: Cage Targeting card.
 *
 * Lives on the swing detail screen for cage / range / uploaded swings.
 * Lets the user place two markers on the address frame:
 *
 *   1. Ball area — center + radius circle showing where the ball is
 *      sitting at address. Phase 1: tap to place center. Phase 2: auto-
 *      detected via gpt-4o vision on the address frame and prefilled.
 *
 *   2. Target — point marker showing the player's aim (cage bullseye /
 *      pin / wall target). User-placed only; there's no reliable visual
 *      signal for "where the user is AIMING" without explicit input.
 *
 * Both are stored on the CageSession as normalized 0-1 coordinates so
 * they survive playback at any video size + future re-renders on
 * different devices.
 *
 * UX shape modeled after the existing CoachNoteCard / SmartCapture
 * pattern: a card with "Set" buttons that flip into a tap-to-place
 * modal. The modal renders the address frame (entry.thumbnail_uri or
 * fault frame) full-screen with the existing markers visible so the
 * user can drag/replace.
 */

import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Image, useWindowDimensions, PanResponder } from 'react-native';
import Svg, { Circle as SvgCircle, Line as SvgLine, Ellipse as SvgEllipse, Polygon as SvgPolygon, Polyline as SvgPolyline, Path as SvgPath } from 'react-native-svg';
import { cleanArc, catmullRomBezier } from '../../services/swing/smoothArc';
import { translateRig } from '../../services/cage/targetRig';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../theme/tokens';

interface BallArea { x: number; y: number; r: number }
interface TargetPoint { x: number; y: number }

interface Props {
  colors: ThemeColors;
  /** Address frame URI to display in the placement modal. Pass the
   *  best available source (thumbnail, fault frame, first video frame).
   *  When null, the card still renders but the Set buttons are disabled. */
  frameUri: string | null;
  ballArea: BallArea | null;
  target: TargetPoint | null;
  onChangeBallArea: (area: BallArea | null) => void;
  onChangeTarget: (target: TargetPoint | null) => void;
  /** Optional: kick off auto-detection of the ball position. When
   *  provided, the card renders an "Auto-detect ball" affordance.
   *  Phase 2 callers wire this to /api/swing-analysis?mode=detect_ball.
   *  Phase 1 callers omit it — manual tap is the only path. */
  onAutoDetectBall?: () => void;
  autoDetecting?: boolean;
}

type PlacementMode = null | 'ball' | 'target';

export default function CageTargetingCard({
  colors, frameUri, ballArea, target, onChangeBallArea, onChangeTarget,
  onAutoDetectBall, autoDetecting,
}: Props) {
  const [mode, setMode] = useState<PlacementMode>(null);
  const close = () => setMode(null);

  const hasBall = !!ballArea;
  const hasTarget = !!target;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
      <Text style={[styles.eyebrow, { color: colors.accent }]}>CAGE TARGETING</Text>
      <Text style={[styles.helper, { color: colors.text_muted }]}>
        Mark where your ball sat and where you were aiming. Used as a visual reference
        on playback — and feeds future shot-quality reads.
      </Text>

      <View style={styles.row}>
        <Pressable
          onPress={() => frameUri && setMode('ball')}
          disabled={!frameUri}
          style={({ pressed }) => [
            styles.btn,
            { borderColor: hasBall ? '#00C896' : colors.border, opacity: !frameUri ? 0.4 : pressed ? 0.7 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={hasBall ? 'Edit ball area' : 'Set ball area'}
        >
          <Ionicons name={hasBall ? 'ellipse' : 'ellipse-outline'} size={16} color={hasBall ? '#00C896' : colors.text_muted} />
          <Text style={[styles.btnText, { color: hasBall ? '#00C896' : colors.text_primary }]}>
            {hasBall ? 'Ball area set' : 'Set ball area'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => frameUri && setMode('target')}
          disabled={!frameUri}
          style={({ pressed }) => [
            styles.btn,
            { borderColor: hasTarget ? '#88F700' : colors.border, opacity: !frameUri ? 0.4 : pressed ? 0.7 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={hasTarget ? 'Edit target' : 'Set target'}
        >
          <Ionicons name={hasTarget ? 'locate' : 'locate-outline'} size={16} color={hasTarget ? '#88F700' : colors.text_muted} />
          <Text style={[styles.btnText, { color: hasTarget ? '#88F700' : colors.text_primary }]}>
            {hasTarget ? 'Target set' : 'Set target'}
          </Text>
        </Pressable>
      </View>

      {onAutoDetectBall && frameUri && (
        <Pressable
          onPress={onAutoDetectBall}
          disabled={!!autoDetecting}
          style={({ pressed }) => [
            styles.autoBtn,
            { borderColor: colors.accent, opacity: autoDetecting ? 0.5 : pressed ? 0.7 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Auto-detect ball position"
        >
          <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
          <Text style={[styles.autoBtnText, { color: colors.accent }]}>
            {autoDetecting ? 'Detecting…' : 'Auto-detect ball'}
          </Text>
        </Pressable>
      )}

      {(hasBall || hasTarget) && (
        <Pressable
          onPress={() => {
            if (hasBall) onChangeBallArea(null);
            if (hasTarget) onChangeTarget(null);
          }}
          style={styles.clearBtn}
          accessibilityRole="button"
          accessibilityLabel="Clear markers"
        >
          <Ionicons name="close-circle-outline" size={14} color={colors.text_muted} />
          <Text style={[styles.clearBtnText, { color: colors.text_muted }]}>Clear markers</Text>
        </Pressable>
      )}

      {mode && frameUri && (
        <PlacementModal
          mode={mode}
          frameUri={frameUri}
          existingBall={ballArea}
          existingTarget={target}
          onCancel={close}
          onCommitBall={(b) => { onChangeBallArea(b); close(); }}
          onCommitTarget={(t) => { onChangeTarget(t); close(); }}
        />
      )}
    </View>
  );
}

/** Full-screen placement modal. Shows the address frame, existing
 *  markers (so the user can re-tap to replace), and commits on tap.
 *  Tap = place; another tap = replace. Done button closes; X discards
 *  any in-modal placement that wasn't committed. */
function PlacementModal({
  mode, frameUri, existingBall, existingTarget,
  onCancel, onCommitBall, onCommitTarget,
}: {
  mode: 'ball' | 'target';
  frameUri: string;
  existingBall: BallArea | null;
  existingTarget: TargetPoint | null;
  onCancel: () => void;
  onCommitBall: (b: BallArea) => void;
  onCommitTarget: (t: TargetPoint) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  // 16:9 aspect ratio for the frame display; centered in the window
  // with letterbox space above/below for the action bar + safe area.
  const aspectRatio = 16 / 9;
  const padding = 16;
  const maxW = winW - padding * 2;
  const maxH = winH * 0.7;
  let frameW = maxW;
  let frameH = frameW / aspectRatio;
  if (frameH > maxH) {
    frameH = maxH;
    frameW = frameH * aspectRatio;
  }

  const [draft, setDraft] = useState<{ x: number; y: number } | null>(
    mode === 'ball'
      ? existingBall ? { x: existingBall.x, y: existingBall.y } : null
      : existingTarget ? { x: existingTarget.x, y: existingTarget.y } : null
  );

  // 2026-05-27 — Default ball radius when manually placed = 6% of
  // frame height. Captures a typical cage-distance ball (small in
  // frame). User can re-tap to reposition; we don't currently expose
  // a drag-to-resize gesture (kept the surface minimal for v1).
  const DEFAULT_BALL_RADIUS = 0.06;

  const handleTap = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = e.nativeEvent;
    const x = locationX / frameW;
    const y = locationY / frameH;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setDraft({ x, y });
  };

  const commit = () => {
    if (!draft) return;
    if (mode === 'ball') {
      onCommitBall({ x: draft.x, y: draft.y, r: existingBall?.r ?? DEFAULT_BALL_RADIUS });
    } else {
      onCommitTarget({ x: draft.x, y: draft.y });
    }
  };

  const title = mode === 'ball' ? 'Tap where the ball is' : 'Tap your target';
  const tint = mode === 'ball' ? '#00C896' : '#88F700';

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.header}>
          <Pressable onPress={onCancel} hitSlop={14} accessibilityRole="button" accessibilityLabel="Cancel">
            <Ionicons name="close" size={26} color="#ffffff" />
          </Pressable>
          <Text style={modalStyles.title}>{title}</Text>
          <Pressable
            onPress={commit}
            disabled={!draft}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Save placement"
          >
            <Text style={[modalStyles.done, { color: draft ? tint : '#666' }]}>Done</Text>
          </Pressable>
        </View>

        <Pressable onPress={handleTap} style={{ width: frameW, height: frameH }}>
          <Image source={{ uri: frameUri }} style={{ width: frameW, height: frameH }} resizeMode="contain" />
          <Svg
            style={{ position: 'absolute', left: 0, top: 0 }}
            width={frameW}
            height={frameH}
            pointerEvents="none"
          >
            {/* Existing OTHER marker shown dimmed so user has spatial
                context (e.g. when placing target, ball is dim). */}
            {mode === 'target' && existingBall && (
              <SvgCircle
                cx={existingBall.x * frameW}
                cy={existingBall.y * frameH}
                r={existingBall.r * frameH}
                stroke="#00C896" strokeWidth={2} strokeOpacity={0.45}
                fill="#00C896" fillOpacity={0.08}
              />
            )}
            {mode === 'ball' && existingTarget && (
              <>
                <SvgCircle cx={existingTarget.x * frameW} cy={existingTarget.y * frameH} r={10} stroke="#88F700" strokeWidth={2} strokeOpacity={0.45} fill="none" />
                <SvgLine x1={existingTarget.x * frameW - 8} y1={existingTarget.y * frameH} x2={existingTarget.x * frameW + 8} y2={existingTarget.y * frameH} stroke="#88F700" strokeWidth={1.5} strokeOpacity={0.45} />
                <SvgLine x1={existingTarget.x * frameW} y1={existingTarget.y * frameH - 8} x2={existingTarget.x * frameW} y2={existingTarget.y * frameH + 8} stroke="#88F700" strokeWidth={1.5} strokeOpacity={0.45} />
              </>
            )}

            {/* Live draft marker — what the user is about to commit. */}
            {draft && mode === 'ball' && (
              <SvgCircle
                cx={draft.x * frameW}
                cy={draft.y * frameH}
                r={(existingBall?.r ?? DEFAULT_BALL_RADIUS) * frameH}
                stroke={tint} strokeWidth={2.5}
                fill={tint} fillOpacity={0.18}
              />
            )}
            {draft && mode === 'target' && (
              <>
                <SvgCircle cx={draft.x * frameW} cy={draft.y * frameH} r={12} stroke={tint} strokeWidth={2.5} fill="none" />
                <SvgLine x1={draft.x * frameW - 10} y1={draft.y * frameH} x2={draft.x * frameW + 10} y2={draft.y * frameH} stroke={tint} strokeWidth={2} />
                <SvgLine x1={draft.x * frameW} y1={draft.y * frameH - 10} x2={draft.x * frameW} y2={draft.y * frameH + 10} stroke={tint} strokeWidth={2} />
              </>
            )}
          </Svg>
        </Pressable>
      </View>
    </Modal>
  );
}

/** Reusable overlay for displaying ball area + target ON the video.
 *  Matched to the SmartMotion design reference:
 *    TARGET   = dark pill (caret) → white dashed vertical line → flat white
 *               ellipse ring on the ground.
 *    BALL AREA = dark pill (caret) → green perspective trapezoid (ground
 *               quad) around the placed ball.
 *  Measures its own size so the trapezoid / ring render in real pixels
 *  (crisp strokes). Both points are user-placed — honest, no inferred flight. */
export function CageTargetingOverlay({
  ballArea, target, launchDir = null, puttLine = false, targetKind = 'aim',
}: {
  ballArea: BallArea | null;
  target: TargetPoint | null;
  /** Face-on only: draws an APPROXIMATE diagonal launch line up from the ball
   *  toward the target side ('left' for RH, 'right' for LH). Labeled ~LAUNCH —
   *  it's an estimate to be refined with real shot tracing later. */
  launchDir?: 'left' | 'right' | null;
  /** Putt mode (down-the-line): a straight center line from the ball up to a
   *  PIN marker at the top. Line up the PIN icon with the real pin to anchor
   *  the putt line (helps line + distance read). */
  puttLine?: boolean;
  /** How the movable target end reads: 'aim' = the cage/range TARGET ring;
   *  'cup' = a FLAG/cup marker for putt mode (Tim — drag the flag over the real
   *  cup so the ball→cup line is the putt line). */
  targetKind?: 'aim' | 'cup';
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  if (!ballArea && !target) return null;
  const { w, h } = size;
  const LIME = '#88F700';      // ball-area box (grass green, per design)
  // 2026-06-29 (Tim) — target line + aim ring + putt line are now NEON-GREEN brand
  // (was #FFFFFF). "The line should be neon green; the target's a little off brand."
  const AIM = '#88F700';

  // Target geometry (pixels). 2026-06-11 — the aim line now ORIGINATES at the
  // ball-area CENTER and runs to the target, so it reads as a true ball→target
  // aim vector (Tim: anchor the line origin to the ball — they were independent).
  // This is the reference the down-the-line shot trace measures the ball against.
  // Falls back to a vertical placement hint at the target when no ball is set yet.
  let targetLine: { x1: number; y1: number; x2: number; y2: number; ringX: number; ringY: number } | null = null;
  if (target && w > 0) {
    const tx = target.x * w;
    const ty = target.y * h;
    if (ballArea) {
      targetLine = { x1: ballArea.x * w, y1: ballArea.y * h, x2: tx, y2: ty, ringX: tx, ringY: ty };
    } else {
      const topY = Math.max(0.04 * h, ty - 0.30 * h);
      targetLine = { x1: tx, y1: topY, x2: tx, y2: ty, ringX: tx, ringY: ty };
    }
  }

  // Ball-area trapezoid (perspective ground quad), pixels.
  let ballQuad: { points: string; topY: number; cx: number } | null = null;
  if (ballArea && w > 0) {
    const bx = ballArea.x * w;
    const by = ballArea.y * h;
    const r = ballArea.r * w;
    const topY = by - r * 0.8;
    const bottomY = by + r * 1.3;
    const topHalf = r * 0.85;
    const bottomHalf = r * 1.6;
    ballQuad = {
      cx: bx,
      topY,
      points: `${bx - topHalf},${topY} ${bx + topHalf},${topY} ${bx + bottomHalf},${bottomY} ${bx - bottomHalf},${bottomY}`,
    };
  }

  // Putt line — straight center line from the ball up to a PIN marker at the
  // top (down-the-line). Aim the PIN icon at the real pin to anchor the line.
  let puttGeom: { x: number; y1: number; pinY: number } | null = null;
  if (ballArea && puttLine && w > 0) {
    puttGeom = { x: ballArea.x * w, y1: ballArea.y * h - ballArea.r * w * 0.6, pinY: 0.10 * h };
  }

  // Approximate face-on launch line — diagonal up from the ball toward the
  // target side. Rough by design (refined later with real tracing).
  let launchLine: { x1: number; y1: number; x2: number; y2: number; labelX: number; labelY: number } | null = null;
  if (ballArea && launchDir && !puttLine && w > 0) {
    const bx = ballArea.x * w;
    const by = ballArea.y * h;
    const r = ballArea.r * w;
    const sign = launchDir === 'left' ? -1 : 1;
    const x1 = bx, y1 = by - r * 0.4;
    const x2 = bx + sign * 0.17 * w, y2 = Math.max(0.07 * h, by - 0.45 * h);
    launchLine = { x1, y1, x2, y2, labelX: x2, labelY: y2 };
  }

  // 2026-07-10 (audit SM1 — intermittent WHITE SCREEN) — a single non-finite coord (e.g.
  // ball_area_norm.r is NaN when a ball area was placed without a radius) turns an SVG
  // points/line string into "NaN,NaN…" and react-native-svg's NATIVE parser THROWS during
  // render → blank/white screen (the sibling SwingBodyOverlay was hardened; this wasn't).
  // Drop any geometry object carrying a non-finite value so it's simply omitted, never crashes.
  const geomOk = (o: Record<string, unknown> | null): boolean =>
    !!o && Object.values(o).every((v) => typeof v !== 'number' || Number.isFinite(v));
  if (!geomOk(targetLine)) targetLine = null;
  if (ballQuad && (!geomOk({ cx: ballQuad.cx, topY: ballQuad.topY }) || ballQuad.points.includes('NaN'))) ballQuad = null;
  if (!geomOk(launchLine)) launchLine = null;
  if (!geomOk(puttGeom)) puttGeom = null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {w > 0 && (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {targetLine && (
            <>
              <SvgLine
                x1={targetLine.x1} y1={targetLine.y1}
                x2={targetLine.x2} y2={targetLine.y2}
                stroke={AIM} strokeWidth={2} strokeDasharray="7,6" opacity={0.95}
              />
              {/* aim target at the end of the ball→target line — concentric
                  neon-green reticle (brand SMART TARGET look). 2026-06-29 (Tim) —
                  replaces the single off-brand ring. */}
              <SvgEllipse
                cx={targetLine.ringX} cy={targetLine.ringY}
                rx={Math.max(13, 0.072 * w)} ry={Math.max(5, 0.024 * w)}
                stroke={AIM} strokeWidth={1.6} fill="none" opacity={0.95}
              />
              <SvgEllipse
                cx={targetLine.ringX} cy={targetLine.ringY}
                rx={Math.max(6, 0.034 * w)} ry={Math.max(2.5, 0.011 * w)}
                stroke={AIM} strokeWidth={1.4} fill="none" opacity={0.9}
              />
              <SvgCircle
                cx={targetLine.ringX} cy={targetLine.ringY}
                r={2.4} fill={AIM} opacity={0.95}
              />
            </>
          )}
          {ballQuad && (
            <SvgPolygon
              points={ballQuad.points}
              stroke={LIME} strokeWidth={2.4}
              fill={LIME} fillOpacity={0.16}
            />
          )}
          {launchLine && (
            <SvgLine
              x1={launchLine.x1} y1={launchLine.y1}
              x2={launchLine.x2} y2={launchLine.y2}
              stroke={LIME} strokeWidth={2.4} strokeDasharray="8,7" opacity={0.9} strokeLinecap="round"
            />
          )}
          {puttGeom && (
            <>
              <SvgLine
                x1={puttGeom.x} y1={puttGeom.y1}
                x2={puttGeom.x} y2={puttGeom.pinY}
                stroke={AIM} strokeWidth={2} strokeDasharray="7,6" opacity={0.95} strokeLinecap="round"
              />
              <SvgEllipse cx={puttGeom.x} cy={puttGeom.pinY} rx={5} ry={3} stroke={AIM} strokeWidth={1.6} fill="none" opacity={0.9} />
            </>
          )}
        </Svg>
      )}
      {/* CUP label — putt mode only, marks the hole the user drags to */}
      {targetLine && targetKind === 'cup' && (
        <View style={[overlayStyles.pillWrap, { left: targetLine.x2, top: targetLine.y2 - 30 }]}>
          <View style={[overlayStyles.pill, overlayStyles.pinPill]}>
            <Ionicons name="flag" size={12} color="#06281b" />
            <Text style={[overlayStyles.pillText, { color: '#06281b' }]}>CUP</Text>
          </View>
          <View style={overlayStyles.caret} />
        </View>
      )}
      {puttGeom && (
        <View style={[overlayStyles.pillWrap, { left: puttGeom.x, top: puttGeom.pinY - 30 }]}>
          <View style={[overlayStyles.pill, overlayStyles.pinPill]}>
            <Ionicons name="flag" size={12} color="#06281b" />
            <Text style={[overlayStyles.pillText, { color: '#06281b' }]}>PIN</Text>
          </View>
          <View style={overlayStyles.caret} />
        </View>
      )}
    </View>
  );
}

/**
 * 2026-06-11 — DTL ball-trace overlay. Draws the REAL initial departure-direction
 * line from the ball (a straight line, not a fabricated arc), colored green→red by
 * how far off the aim line it started. The caller gates DTL-only + supplies the
 * computed direction (services/swing/ballTrace.computeTraceDirection) and color.
 */
export function BallTraceOverlay({
  trace, color,
}: {
  trace: { from: { x: number; y: number }; to: { x: number; y: number }; side: 'left' | 'right' | 'straight'; divergenceDeg: number } | null;
  color: string;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  if (!trace) return null;
  const { w, h } = size;
  const label = trace.side === 'straight' ? 'ON LINE' : `${trace.divergenceDeg}° ${trace.side.toUpperCase()}`;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {w > 0 && (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <SvgLine
            x1={trace.from.x * w} y1={trace.from.y * h}
            x2={trace.to.x * w} y2={trace.to.y * h}
            stroke={color} strokeWidth={3} strokeLinecap="round" opacity={0.95}
          />
          <SvgCircle cx={trace.from.x * w} cy={trace.from.y * h} r={5} fill={color} />
        </Svg>
      )}
      {w > 0 && (
        <View style={[traceStyles.pill, { left: trace.to.x * w, top: trace.to.y * h - 14, backgroundColor: color }]}>
          <Text style={traceStyles.pillText}>{label}</Text>
        </View>
      )}
    </View>
  );
}

const traceStyles = StyleSheet.create({
  pill: { position: 'absolute', transform: [{ translateX: -28 }], borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3, minWidth: 56, alignItems: 'center' },
  pillText: { color: '#06281b', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  legend: { position: 'absolute', left: 10, bottom: 10, backgroundColor: 'rgba(6,15,9,0.78)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, gap: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  solidSwatch: { width: 18, height: 3.5, borderRadius: 2 },
  dashedSwatch: { width: 18, height: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: 0.55 },
  dash: { width: 4, height: 3.5, borderRadius: 1 },
});

/**
 * 2026-06-25 — MULTI-POINT shot trace overlay (Shot Tracing, Tim).
 *
 * Draws the tiered trace from services/swing/ballTrace.buildShotTrace over the
 * swing video. HONESTY IS THE WHOLE POINT (Tim's law):
 *   • measured — a SOLID polyline through the REAL detected ball positions only.
 *   • projected — a DASHED, FADED continuation, ONLY ever the modeled estimate,
 *     drawn in the same colour but visually unmistakable (dashes + ~45% opacity)
 *     and announced by a "PROJECTED" legend chip. Never blended with measured.
 * With no measured points the caller renders nothing here (it shows the no-track
 * note instead) — we never fabricate an arc.
 */
export function MultiPointTraceOverlay({
  trace, color,
}: {
  trace: {
    tier: 'full' | 'launch' | 'single' | 'none';
    measured: { x: number; y: number }[];
    projected: { x: number; y: number }[] | null;
  } | null;
  color: string;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  if (!trace || trace.tier === 'none' || trace.measured.length < 2) return null;
  const { w, h } = size;
  // 2026-07-18 (audit) — finite-guard every point BEFORE building the SVG `points` string. A
  // "NaN,NaN" in a react-native-svg polyline can hard-crash natively; this closes the last
  // instance of that bug class (siblings SwingBodyOverlay/HoleShotMap already guard the same way).
  const fin = (p: { x: number; y: number } | undefined | null): p is { x: number; y: number } =>
    !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const pt = (p: { x: number; y: number }) => `${p.x * w},${p.y * h}`;
  const measuredPts = trace.measured.filter(fin);
  if (measuredPts.length < 2) return null;
  // 2026-07-18 (Tim — shot tracing) — a ball flight is a SMOOTH ballistic arc, so draw the
  // measured line as a cleaned (de-spiked + averaged) CENTRIPETAL Catmull-Rom curve in pixel
  // space, not a jagged straight polyline through raw CV detections. Still measured-only — we
  // reject/average REAL points, never invent a continuation (the dashed PROJECTED line stays a
  // separate straight extrapolation). Falls back to a polyline for <3 points.
  const measuredPx = cleanArc(measuredPts.map((p, i) => ({ x: p.x * w, y: p.y * h, t: i })));
  const measuredPath = (() => {
    if (measuredPx.length < 3) return null;
    let d = `M ${measuredPx[0].x} ${measuredPx[0].y}`;
    for (let i = 0; i < measuredPx.length - 1; i++) {
      const p0 = measuredPx[i - 1] ?? measuredPx[i];
      const p1 = measuredPx[i];
      const p2 = measuredPx[i + 1];
      const p3 = measuredPx[i + 2] ?? measuredPx[i + 1];
      const { cp1x, cp1y, cp2x, cp2y } = catmullRomBezier(p0, p1, p2, p3);
      d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
    }
    return d;
  })();
  const measuredStr = measuredPts.map(pt).join(' '); // straight fallback for <3 points
  // The dashed projection starts at the last MEASURED point so the segments meet
  // visually, but it's drawn as its own (dashed/faded) polyline — never merged.
  const projPts = (trace.projected ?? []).filter(fin);
  const projStr = projPts.length > 0
    ? [measuredPts[measuredPts.length - 1], ...projPts].map(pt).join(' ')
    : null;
  const origin = measuredPts[0];
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {w > 0 && (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* PROJECTED — dashed + faded, drawn UNDER the measured line. */}
          {projStr && (
            <SvgPolyline
              points={projStr}
              fill="none"
              stroke={color}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="7,7"
              opacity={0.45}
            />
          )}
          {/* MEASURED — solid, full opacity. Smooth clean arc through the real detected
              positions (centripetal spline); straight polyline fallback for <3 points. */}
          {measuredPath ? (
            <SvgPath
              d={measuredPath}
              fill="none"
              stroke={color}
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.97}
            />
          ) : (
            <SvgPolyline
              points={measuredStr}
              fill="none"
              stroke={color}
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.97}
            />
          )}
          {/* origin dot at the ball */}
          <SvgCircle cx={origin.x * w} cy={origin.y * h} r={5} fill={color} />
        </Svg>
      )}
      {/* Legend — makes the measured/projected boundary unmistakable. */}
      {w > 0 && (
        <View style={traceStyles.legend} pointerEvents="none">
          <View style={traceStyles.legendRow}>
            <View style={[traceStyles.solidSwatch, { backgroundColor: color }]} />
            <Text style={traceStyles.legendText}>Measured</Text>
          </View>
          {projStr && (
            <View style={traceStyles.legendRow}>
              <View style={traceStyles.dashedSwatch}>
                <View style={[traceStyles.dash, { backgroundColor: color }]} />
                <View style={[traceStyles.dash, { backgroundColor: color }]} />
                <View style={[traceStyles.dash, { backgroundColor: color }]} />
              </View>
              <Text style={traceStyles.legendText}>Projected</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * 2026-06-11 — DRAG-TO-ANCHOR ball + target, over the live preview (setup) AND the
 * review video. Why drag and not just tap: on Samsung the VIDEO record FOV is a
 * tighter crop than the live PREVIEW, so a box placed against the preview lands too
 * high on the recorded clip (Tim had to nudge it down every time). Our coordinates
 * are consistent (same normalized basis) — the camera hands us two FOVs. So the box
 * is draggable: anchor it in setup, and if the record-crop shifts it, nudge it on
 * the REVIEW frame — which is the actual recorded video, so that placement can't
 * drift. Smooth local drag; commits to the caller (session) on release, so we don't
 * thrash the persisted store every frame.
 */
export function EditableCageTargets({
  ballArea, target, onChangeBallArea, onChangeTarget, targetKind = 'aim',
}: {
  ballArea: BallArea | null;
  target: TargetPoint | null;
  onChangeBallArea: (b: BallArea) => void;
  onChangeTarget: (t: TargetPoint) => void;
  /** 'cup' renders the movable target as a putt FLAG/cup (Tim). Default 'aim'. */
  targetKind?: 'aim' | 'cup';
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef(size);
  useEffect(() => { sizeRef.current = size; }, [size]);

  // Latest committed values + callbacks, via refs so the PanResponders are created
  // ONCE (recreating them mid-gesture would drop the drag).
  const ballRef = useRef(ballArea);
  const targetRef = useRef(target);
  useEffect(() => { ballRef.current = ballArea; }, [ballArea]);
  useEffect(() => { targetRef.current = target; }, [target]);
  const cbRef = useRef({ onChangeBallArea, onChangeTarget });
  useEffect(() => { cbRef.current = { onChangeBallArea, onChangeTarget }; }, [onChangeBallArea, onChangeTarget]);

  // Lock/unlock — EXPLICIT (Tim): setup opens UNLOCKED so you can grab and place
  // the rig immediately; lock freezes it so it can't be nudged ("Locked in").
  // Optional — never blocks recording (caddie-failsafe / no-walls rule).
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(locked);
  useEffect(() => { lockedRef.current = locked; }, [locked]);

  // Live drag state (local → smooth, no per-frame store writes).
  const [liveBall, setLiveBall] = useState<BallArea | null>(null);
  const [liveTarget, setLiveTarget] = useState<TargetPoint | null>(null);
  const ballStart = useRef<BallArea | null>(null);
  const targetStart = useRef<TargetPoint | null>(null);

  // Ball / body drag = move the WHOLE rig (ball + aim line + target) together —
  // "one element" (Tim). The target END stays independently draggable below
  // (free-float: aim side-to-side + depth). Locked → no drag.
  const ballPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !lockedRef.current,
    onMoveShouldSetPanResponder: () => !lockedRef.current,
    onPanResponderGrant: () => { ballStart.current = ballRef.current; targetStart.current = targetRef.current; },
    onPanResponderMove: (_e, g) => {
      const s = ballStart.current; const { w, h } = sizeRef.current;
      if (!s || w === 0 || h === 0) return;
      const rig = translateRig(s, targetStart.current, g.dx / w, g.dy / h);
      setLiveBall(rig.ball);
      if (targetStart.current) setLiveTarget(rig.target);
    },
    onPanResponderRelease: () => {
      const hadTarget = !!targetStart.current;
      setLiveBall((b) => { if (b) cbRef.current.onChangeBallArea(b); return null; });
      setLiveTarget((t) => { if (t && hadTarget) cbRef.current.onChangeTarget(t); return null; });
      ballStart.current = null; targetStart.current = null;
    },
    onPanResponderTerminate: () => {
      const hadTarget = !!targetStart.current;
      setLiveBall((b) => { if (b) cbRef.current.onChangeBallArea(b); return null; });
      setLiveTarget((t) => { if (t && hadTarget) cbRef.current.onChangeTarget(t); return null; });
      ballStart.current = null; targetStart.current = null;
    },
  })).current;

  const targetPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !lockedRef.current,
    onMoveShouldSetPanResponder: () => !lockedRef.current,
    onPanResponderGrant: () => { targetStart.current = targetRef.current; },
    onPanResponderMove: (_e, g) => {
      const s = targetStart.current; const { w, h } = sizeRef.current;
      if (!s || w === 0 || h === 0) return;
      setLiveTarget({ x: clamp01(s.x + g.dx / w), y: clamp01(s.y + g.dy / h) });
    },
    onPanResponderRelease: () => {
      setLiveTarget((t) => { if (t) cbRef.current.onChangeTarget(t); return null; });
      targetStart.current = null;
    },
    onPanResponderTerminate: () => {
      setLiveTarget((t) => { if (t) cbRef.current.onChangeTarget(t); return null; });
      targetStart.current = null;
    },
  })).current;

  const shownBall = liveBall ?? ballArea;
  const shownTarget = liveTarget ?? target;
  const { w, h } = size;
  const HANDLE = 56; // generous touch target around each marker

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {/* Visual layer (non-interactive) — the same overlay used read-only. */}
      <CageTargetingOverlay ballArea={shownBall} target={shownTarget} launchDir={null} targetKind={targetKind} />
      {/* Drag handles — only when UNLOCKED. Drag the BALL knob to move the whole rig
          (ball + line + target) together; drag the TARGET knob to aim/depth on its
          own. box-none lets taps elsewhere pass through. */}
      {!locked && w > 0 && shownBall && (
        <View
          {...ballPan.panHandlers}
          style={[dragStyles.handle, { left: shownBall.x * w - HANDLE / 2, top: shownBall.y * h - HANDLE / 2 }]}
        >
          <View style={[dragStyles.knob, { borderColor: '#88F700' }]} />
        </View>
      )}
      {!locked && w > 0 && shownTarget && (
        <View
          {...targetPan.panHandlers}
          style={[dragStyles.handle, { left: shownTarget.x * w - HANDLE / 2, top: shownTarget.y * h - HANDLE / 2 }]}
        >
          <View style={[dragStyles.knob, { borderColor: '#FFFFFF' }]} />
        </View>
      )}
      {/* Explicit Lock / Unlock toggle (Tim) — replaces the implicit auto-lock. */}
      {w > 0 && (shownBall || shownTarget) && (
        <Pressable
          onPress={() => setLocked((v) => !v)}
          style={[dragStyles.lockPill, { borderColor: locked ? '#88F700' : 'rgba(255,255,255,0.5)' }]}
          accessibilityRole="button"
          accessibilityLabel={locked ? 'Unlock targets to adjust' : 'Lock targets in'}
        >
          <Ionicons name={locked ? 'lock-closed' : 'lock-open'} size={13} color={locked ? '#88F700' : '#FFFFFF'} />
          <Text style={[dragStyles.lockText, { color: locked ? '#88F700' : '#FFFFFF' }]}>
            {locked ? 'LOCKED' : 'ADJUSTING'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const dragStyles = StyleSheet.create({
  handle: { position: 'absolute', width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  knob: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, backgroundColor: 'rgba(255,255,255,0.12)' },
  lockPill: {
    position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1.5,
    backgroundColor: 'rgba(10,16,12,0.78)',
  },
  lockText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
});

const PILL_BG = 'rgba(18,20,24,0.9)';
const overlayStyles = StyleSheet.create({
  // Centered over its anchor x; caret points down at the line/box.
  pillWrap: { position: 'absolute', alignItems: 'center', transform: [{ translateX: -45 }], width: 90 },
  pill: { backgroundColor: PILL_BG, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  pinPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#34d399' },
  pillText: { color: '#ffffff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  caret: {
    width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: PILL_BG,
  },
});

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 10, marginVertical: 10 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  helper: { fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, paddingHorizontal: 10,
    borderRadius: 10, borderWidth: 1.5,
  },
  btnText: { fontSize: 13, fontWeight: '700' },
  autoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
  },
  autoBtnText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 6,
  },
  clearBtnText: { fontSize: 12, fontWeight: '600' },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
  header: {
    position: 'absolute', top: 50, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  title: { color: '#ffffff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  done: { fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
});
