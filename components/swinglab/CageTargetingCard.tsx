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

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Image, useWindowDimensions } from 'react-native';
import Svg, { Circle as SvgCircle, Line as SvgLine, Ellipse as SvgEllipse, Polygon as SvgPolygon } from 'react-native-svg';
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
            { borderColor: hasTarget ? '#F0C030' : colors.border, opacity: !frameUri ? 0.4 : pressed ? 0.7 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={hasTarget ? 'Edit target' : 'Set target'}
        >
          <Ionicons name={hasTarget ? 'locate' : 'locate-outline'} size={16} color={hasTarget ? '#F0C030' : colors.text_muted} />
          <Text style={[styles.btnText, { color: hasTarget ? '#F0C030' : colors.text_primary }]}>
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
  const tint = mode === 'ball' ? '#00C896' : '#F0C030';

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
                <SvgCircle cx={existingTarget.x * frameW} cy={existingTarget.y * frameH} r={10} stroke="#F0C030" strokeWidth={2} strokeOpacity={0.45} fill="none" />
                <SvgLine x1={existingTarget.x * frameW - 8} y1={existingTarget.y * frameH} x2={existingTarget.x * frameW + 8} y2={existingTarget.y * frameH} stroke="#F0C030" strokeWidth={1.5} strokeOpacity={0.45} />
                <SvgLine x1={existingTarget.x * frameW} y1={existingTarget.y * frameH - 8} x2={existingTarget.x * frameW} y2={existingTarget.y * frameH + 8} stroke="#F0C030" strokeWidth={1.5} strokeOpacity={0.45} />
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
  ballArea, target, launchDir = null,
}: {
  ballArea: BallArea | null;
  target: TargetPoint | null;
  /** Face-on only: draws an APPROXIMATE diagonal launch line up from the ball
   *  toward the target side ('left' for RH, 'right' for LH). Labeled ~LAUNCH —
   *  it's an estimate to be refined with real shot tracing later. */
  launchDir?: 'left' | 'right' | null;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  if (!ballArea && !target) return null;
  const { w, h } = size;
  const LIME = '#7CE04F';      // ball-area box (grass green, per design)
  const WHITE = '#FFFFFF';     // target line + ring

  // Target geometry (pixels).
  let targetLine: { x: number; topY: number; ringY: number } | null = null;
  if (target && w > 0) {
    const tx = target.x * w;
    const ringY = target.y * h;
    const topY = Math.max(0.04 * h, ringY - 0.30 * h);
    targetLine = { x: tx, topY, ringY };
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

  // Approximate face-on launch line — diagonal up from the ball toward the
  // target side. Rough by design (refined later with real tracing).
  let launchLine: { x1: number; y1: number; x2: number; y2: number; labelX: number; labelY: number } | null = null;
  if (ballArea && launchDir && w > 0) {
    const bx = ballArea.x * w;
    const by = ballArea.y * h;
    const r = ballArea.r * w;
    const sign = launchDir === 'left' ? -1 : 1;
    const x1 = bx, y1 = by - r * 0.4;
    const x2 = bx + sign * 0.17 * w, y2 = Math.max(0.07 * h, by - 0.45 * h);
    launchLine = { x1, y1, x2, y2, labelX: x2, labelY: y2 };
  }

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
                x1={targetLine.x} y1={targetLine.topY}
                x2={targetLine.x} y2={targetLine.ringY}
                stroke={WHITE} strokeWidth={2} strokeDasharray="7,6" opacity={0.95}
              />
              {/* flat ring on the ground at the base of the aim line */}
              <SvgEllipse
                cx={targetLine.x} cy={targetLine.ringY}
                rx={Math.max(10, 0.06 * w)} ry={Math.max(4, 0.02 * w)}
                stroke={WHITE} strokeWidth={1.6} fill="none" opacity={0.9}
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
        </Svg>
      )}
      {/* Pill labels with a downward caret (RN views — crisp text). */}
      {targetLine && (
        <View style={[overlayStyles.pillWrap, { left: targetLine.x, top: targetLine.topY - 30 }]}>
          <View style={overlayStyles.pill}><Text style={overlayStyles.pillText}>TARGET</Text></View>
          <View style={overlayStyles.caret} />
        </View>
      )}
      {ballQuad && (
        <View style={[overlayStyles.pillWrap, { left: ballQuad.cx, top: ballQuad.topY - 30 }]}>
          <View style={overlayStyles.pill}><Text style={overlayStyles.pillText}>BALL AREA</Text></View>
          <View style={overlayStyles.caret} />
        </View>
      )}
      {launchLine && (
        <View style={[overlayStyles.pillWrap, { left: launchLine.labelX, top: launchLine.labelY - 26 }]}>
          <View style={overlayStyles.pill}><Text style={overlayStyles.pillText}>~ LAUNCH</Text></View>
        </View>
      )}
    </View>
  );
}

const PILL_BG = 'rgba(18,20,24,0.9)';
const overlayStyles = StyleSheet.create({
  // Centered over its anchor x; caret points down at the line/box.
  pillWrap: { position: 'absolute', alignItems: 'center', transform: [{ translateX: -45 }], width: 90 },
  pill: { backgroundColor: PILL_BG, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
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
