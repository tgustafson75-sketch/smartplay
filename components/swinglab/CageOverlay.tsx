/**
 * Phase AM — Cage setup camera overlay.
 *
 * Multi-purpose visual scaffold that renders on top of the CameraView
 * during cage drill setup. Three layered elements:
 *
 *   1. Body alignment box — rectangular frame the user fits their swing
 *      inside (top above head, bottom below feet, sides shoulder + club
 *      length). STATIC — sized to viewport.
 *   2. Bullseye reticle — DRAGGABLE crosshair indicating target /
 *      bullseye center. User aligns this to flag, range bag, etc. Last
 *      position persists via useCageOverlayCalibrationStore.
 *   3. Strike zone — DRAGGABLE rectangle marking ball address / impact
 *      zone. User aligns to where the ball sits on the ground. Last
 *      position persists.
 *
 * Tim 2026-05-14: "make the center crosshairs moveable for user to move
 * to center of the bullseye or target and fix that location."
 *
 * Color feedback driven by phase:
 *   SETUP / NOT_READY → amber ("frame your swing")
 *   CHECKING          → amber pulsing
 *   READY             → green
 *
 * Aspect-aware: scales correctly for Fold open (~8:9 wide) and standard
 * portrait phone (~9:19.5 tall). The body box is sized as a fraction of
 * viewport height so it always fits.
 *
 * Drag interactions use Pressable + PanResponder. Wrapper switches
 * pointerEvents off body-box / labels (decorative) but ON for the two
 * draggable controls so taps land on them.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, PanResponder, Animated } from 'react-native';
import Svg, { Rect, Line, Circle } from 'react-native-svg';
import { useCageOverlayCalibrationStore } from '../../store/cageOverlayCalibrationStore';

export type CageOverlayPhase = 'SETUP' | 'CHECKING' | 'READY' | 'NOT_READY';

interface Props {
  phase: CageOverlayPhase;
}

const COLOR_BY_PHASE: Record<CageOverlayPhase, { stroke: string; fill: string; label: string }> = {
  SETUP:     { stroke: '#F5A623', fill: 'rgba(245,166,35,0.06)', label: 'Drag bullseye to target · drag BALL to address' },
  CHECKING:  { stroke: '#F5A623', fill: 'rgba(245,166,35,0.10)', label: 'Checking alignment…' },
  READY:     { stroke: '#00C896', fill: 'rgba(0,200,150,0.10)', label: 'Locked in — ready to swing' },
  NOT_READY: { stroke: '#ef4444', fill: 'rgba(239,68,68,0.10)', label: "Adjust your position" },
};

export default function CageOverlay({ phase }: Props) {
  const { width: W, height: H } = useWindowDimensions();
  const aspect = H / W;
  const isFoldOpen = aspect < 1.5;

  const palette = COLOR_BY_PHASE[phase];

  // Body alignment box — STATIC defaults sized to viewport.
  // 2026-05-27 — Fix ER: defaults compute as before; user-saved
  // bodyBox in the calibration store overrides via the live state
  // below. When the user adjusts the box to fit their actual cage,
  // the stored fractions take effect and we ignore the defaults.
  const defaultBoxHeightFrac = isFoldOpen ? 0.78 : 0.62;
  const defaultBoxWidthFrac = isFoldOpen ? 0.45 : 0.62;
  const savedBodyBox = useCageOverlayCalibrationStore((s) => s.bodyBox);
  const setBodyBoxStore = useCageOverlayCalibrationStore((s) => s.setBodyBox);
  // Live pixel-space body box (move + resize). Restored from store
  // on mount; persisted on gesture release.
  const [bodyBox, setBodyBox] = useState({
    cx: (savedBodyBox?.cx ?? 0.5) * W,
    cy: (savedBodyBox?.cy ?? 0.5) * H,
    w: (savedBodyBox?.w ?? defaultBoxWidthFrac) * W,
    h: (savedBodyBox?.h ?? defaultBoxHeightFrac) * H,
  });
  // Re-seed on viewport change (Fold / rotation).
  useEffect(() => {
    setBodyBox({
      cx: (savedBodyBox?.cx ?? 0.5) * W,
      cy: (savedBodyBox?.cy ?? 0.5) * H,
      w: (savedBodyBox?.w ?? defaultBoxWidthFrac) * W,
      h: (savedBodyBox?.h ?? defaultBoxHeightFrac) * H,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H]);
  const boxWidth = bodyBox.w;
  const boxHeight = bodyBox.h;
  const boxLeft = bodyBox.cx - bodyBox.w / 2;
  const boxTop = bodyBox.cy - bodyBox.h / 2;

  // Strike zone dimensions — fixed; only the center position is mobile.
  const strikeW = boxWidth * 0.28;
  const strikeH = boxHeight * 0.18;

  // ─── Draggable positions ────────────────────────────────────────────
  // Read persisted fractions; fall back to viewport-center defaults.
  // Stored as fractions so the same calibration works across phone
  // rotations + Fold open/closed.
  const savedBullseye = useCageOverlayCalibrationStore((s) => s.bullseye);
  const savedBallBox = useCageOverlayCalibrationStore((s) => s.ballBox);
  const setBullseyeStore = useCageOverlayCalibrationStore((s) => s.setBullseye);
  const setBallBoxStore = useCageOverlayCalibrationStore((s) => s.setBallBox);

  const defaultBullseye = { x: 0.5, y: 0.5 };
  const defaultBallBox = { x: 0.5, y: (boxTop + boxHeight * 0.71) / H };

  // Live pixel positions (state) — restored from store on mount, updated
  // on drag, persisted on release.
  const [bullseye, setBullseye] = useState({
    x: (savedBullseye?.x ?? defaultBullseye.x) * W,
    y: (savedBullseye?.y ?? defaultBullseye.y) * H,
  });
  const [ballBox, setBallBox] = useState({
    x: (savedBallBox?.x ?? defaultBallBox.x) * W,
    y: (savedBallBox?.y ?? defaultBallBox.y) * H,
  });

  // Re-seed when viewport changes (Fold open ↔ closed): convert stored
  // fractions to the new pixel dimensions so the markers don't appear
  // to drift after a rotation.
  useEffect(() => {
    setBullseye({
      x: (savedBullseye?.x ?? defaultBullseye.x) * W,
      y: (savedBullseye?.y ?? defaultBullseye.y) * H,
    });
    setBallBox({
      x: (savedBallBox?.x ?? defaultBallBox.x) * W,
      y: (savedBallBox?.y ?? defaultBallBox.y) * H,
    });
    // defaultBallBox depends on boxTop/boxHeight which depend on W/H — the
    // W/H dep here is the canonical trigger. Keep deps minimal so we
    // don't re-seed mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H]);

  // Live refs read inside PanResponder closures (captured once at create
  // time, so we can't read directly from state).
  const bullseyeRef = useRef(bullseye);
  bullseyeRef.current = bullseye;
  const ballBoxRef = useRef(ballBox);
  ballBoxRef.current = ballBox;

  // Track drag-start position so the move handler can compute the new
  // anchor as start + delta, instead of jumping to the touch point.
  const dragStart = useRef({ x: 0, y: 0 });
  const [draggingTarget, setDraggingTarget] = useState<'bullseye' | 'ballBox' | null>(null);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const bullseyePR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      dragStart.current = { x: bullseyeRef.current.x, y: bullseyeRef.current.y };
      setDraggingTarget('bullseye');
    },
    onPanResponderMove: (_, gesture) => {
      const nx = clamp(dragStart.current.x + gesture.dx, 0, W);
      const ny = clamp(dragStart.current.y + gesture.dy, 0, H);
      setBullseye({ x: nx, y: ny });
    },
    onPanResponderRelease: () => {
      const pos = bullseyeRef.current;
      setBullseyeStore({ x: pos.x / W, y: pos.y / H });
      setDraggingTarget(null);
    },
    onPanResponderTerminate: () => setDraggingTarget(null),
  })).current;

  const ballBoxPR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      dragStart.current = { x: ballBoxRef.current.x, y: ballBoxRef.current.y };
      setDraggingTarget('ballBox');
    },
    onPanResponderMove: (_, gesture) => {
      const nx = clamp(dragStart.current.x + gesture.dx, strikeW / 2, W - strikeW / 2);
      const ny = clamp(dragStart.current.y + gesture.dy, strikeH / 2, H - strikeH / 2);
      setBallBox({ x: nx, y: ny });
    },
    onPanResponderRelease: () => {
      const pos = ballBoxRef.current;
      setBallBoxStore({ x: pos.x / W, y: pos.y / H });
      setDraggingTarget(null);
    },
    onPanResponderTerminate: () => setDraggingTarget(null),
  })).current;

  // 2026-05-27 — Fix ER: body-box move + resize PanResponders.
  // - bodyMovePR: drag from inside the box → translate the whole box
  // - bodyResizePR (×4 corners): drag a corner → resize from that corner,
  //   keeping the opposite corner anchored. Maintains arbitrary aspect
  //   ratio so the user can match a non-square cage.
  const bodyBoxRef = useRef(bodyBox);
  bodyBoxRef.current = bodyBox;
  const bodyDragStart = useRef({ cx: 0, cy: 0, w: 0, h: 0 });
  const persistBodyBox = () => {
    const b = bodyBoxRef.current;
    setBodyBoxStore({ cx: b.cx / W, cy: b.cy / H, w: b.w / W, h: b.h / H });
  };
  const bodyMovePR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      bodyDragStart.current = { ...bodyBoxRef.current };
    },
    onPanResponderMove: (_, g) => {
      const cx = clamp(bodyDragStart.current.cx + g.dx, bodyDragStart.current.w / 2, W - bodyDragStart.current.w / 2);
      const cy = clamp(bodyDragStart.current.cy + g.dy, bodyDragStart.current.h / 2, H - bodyDragStart.current.h / 2);
      setBodyBox({ ...bodyBoxRef.current, cx, cy });
    },
    onPanResponderRelease: () => persistBodyBox(),
  })).current;

  // Corner resize: each corner pulls the box edge from that direction.
  // sx/sy = -1 (left/top edge) or +1 (right/bottom edge). When dragging
  // the bottom-right corner the right edge + bottom edge follow the
  // gesture; top-left stays anchored. Same logic for the other 3.
  const MIN_DIM = 80; // px — keep the box visible / draggable
  const makeResizePR = (sx: -1 | 1, sy: -1 | 1) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      bodyDragStart.current = { ...bodyBoxRef.current };
    },
    onPanResponderMove: (_, g) => {
      const start = bodyDragStart.current;
      // New width / height: when sx=+1, gesture.dx grows the box.
      // When sx=-1, gesture.dx grows the box if dx < 0 (left drag).
      const dw = Math.max(MIN_DIM - start.w, sx * g.dx * 2);
      const dh = Math.max(MIN_DIM - start.h, sy * g.dy * 2);
      const w = Math.min(W, start.w + dw);
      const h = Math.min(H, start.h + dh);
      // Keep center fixed via symmetric resize (×2 above). Box grows
      // outward from center as the user pulls the corner. Simpler than
      // anchor-opposite-corner math and avoids the box drifting off-
      // screen on aggressive resizes.
      setBodyBox({ ...start, w, h });
    },
    onPanResponderRelease: () => persistBodyBox(),
  });
  const bodyResizeTLPR = useRef(makeResizePR(-1, -1)).current;
  const bodyResizeTRPR = useRef(makeResizePR(+1, -1)).current;
  const bodyResizeBLPR = useRef(makeResizePR(-1, +1)).current;
  const bodyResizeBRPR = useRef(makeResizePR(+1, +1)).current;

  // Pulse the active drag handle ~10% larger so the user gets clear
  // tactile feedback that they grabbed it.
  const bullseyeScale = useRef(new Animated.Value(1)).current;
  const ballBoxScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(bullseyeScale, {
      toValue: draggingTarget === 'bullseye' ? 1.15 : 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
    Animated.timing(ballBoxScale, {
      toValue: draggingTarget === 'ballBox' ? 1.10 : 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [draggingTarget, bullseyeScale, ballBoxScale]);

  // Derived strike-box top-left from the saved center.
  const strikeLeft = ballBox.x - strikeW / 2;
  const strikeTop = ballBox.y - strikeH / 2;

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Static decorative SVG — body box outline + corner brackets.
          pointerEvents=none here; the draggable hit-areas overlay below. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={W} height={H}>
          <Rect
            x={boxLeft}
            y={boxTop}
            width={boxWidth}
            height={boxHeight}
            stroke={palette.stroke}
            strokeWidth={2.5}
            strokeDasharray={phase === 'CHECKING' ? '8,4' : 'none'}
            fill={palette.fill}
            rx={12}
          />
          {[
            [boxLeft, boxTop, 1, 1],
            [boxLeft + boxWidth, boxTop, -1, 1],
            [boxLeft, boxTop + boxHeight, 1, -1],
            [boxLeft + boxWidth, boxTop + boxHeight, -1, -1],
          ].map(([x, y, dx, dy], i) => (
            <React.Fragment key={i}>
              <Line x1={x} y1={y} x2={x + 18 * dx} y2={y} stroke={palette.stroke} strokeWidth={4} strokeLinecap="round" />
              <Line x1={x} y1={y} x2={x} y2={y + 18 * dy} stroke={palette.stroke} strokeWidth={4} strokeLinecap="round" />
            </React.Fragment>
          ))}
        </Svg>
      </View>

      {/* 2026-05-27 — Fix ER: body-box drag + resize hit-areas.
          - Center hit-area: drag the whole box.
          - 4 corner squares: drag a corner to resize from center
            (symmetric — keeps the box visually anchored).
          Sized generously (44×44 corners, full-rect center minus
          corner cutouts) so users can grab them without precision.
          Sits BELOW the bullseye/ballBox draggables so those still
          win for taps inside their hit-area. SETUP-only render —
          we don't want the resize handles obscuring CHECKING/READY
          chrome on a tight cage view. */}
      {phase === 'SETUP' && (
        <>
          <View
            {...bodyMovePR.panHandlers}
            style={{
              position: 'absolute',
              left: boxLeft + 22,
              top: boxTop + 22,
              width: Math.max(0, boxWidth - 44),
              height: Math.max(0, boxHeight - 44),
            }}
          />
          {([
            { key: 'tl', handlers: bodyResizeTLPR, left: boxLeft - 22, top: boxTop - 22 },
            { key: 'tr', handlers: bodyResizeTRPR, left: boxLeft + boxWidth - 22, top: boxTop - 22 },
            { key: 'bl', handlers: bodyResizeBLPR, left: boxLeft - 22, top: boxTop + boxHeight - 22 },
            { key: 'br', handlers: bodyResizeBRPR, left: boxLeft + boxWidth - 22, top: boxTop + boxHeight - 22 },
          ] as const).map(c => (
            <View
              key={c.key}
              {...c.handlers.panHandlers}
              style={{
                position: 'absolute',
                left: c.left,
                top: c.top,
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* Tiny visible handle dot inside the larger hit-area. */}
              <View style={{
                width: 14, height: 14, borderRadius: 7,
                backgroundColor: palette.stroke,
                borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.5)',
              }} />
            </View>
          ))}
        </>
      )}

      {/* Draggable bullseye crosshair — anchored at the saved center, sits
          on top of the static body-box. Generous hit-slop (40px) so users
          can grab it without precise tapping. */}
      <Animated.View
        {...bullseyePR.panHandlers}
        style={[
          styles.bullseyeWrap,
          {
            left: bullseye.x - 32,
            top: bullseye.y - 32,
            transform: [{ scale: bullseyeScale }],
          },
        ]}
      >
        <Svg width={64} height={64}>
          <Circle cx={32} cy={32} r={28} stroke={palette.stroke} strokeWidth={2} fill="rgba(0,0,0,0.001)" opacity={0.7} />
          <Circle cx={32} cy={32} r={3} fill={palette.stroke} />
          <Line x1={32 - 18} y1={32} x2={32 - 6} y2={32} stroke={palette.stroke} strokeWidth={2} opacity={0.8} />
          <Line x1={32 + 6} y1={32} x2={32 + 18} y2={32} stroke={palette.stroke} strokeWidth={2} opacity={0.8} />
          <Line x1={32} y1={32 - 18} x2={32} y2={32 - 6} stroke={palette.stroke} strokeWidth={2} opacity={0.8} />
          <Line x1={32} y1={32 + 6} x2={32} y2={32 + 18} stroke={palette.stroke} strokeWidth={2} opacity={0.8} />
        </Svg>
      </Animated.View>

      {/* Draggable ball-address strike-box */}
      <Animated.View
        {...ballBoxPR.panHandlers}
        style={[
          styles.ballBoxWrap,
          {
            left: strikeLeft,
            top: strikeTop,
            width: strikeW,
            height: strikeH,
            transform: [{ scale: ballBoxScale }],
          },
        ]}
      >
        <View
          style={[
            styles.ballBoxInner,
            { borderColor: palette.stroke, backgroundColor: phase === 'READY' ? 'rgba(0,200,150,0.05)' : 'rgba(0,0,0,0.001)' },
          ]}
        />
        <View style={styles.zoneLabel}>
          <Text style={[styles.zoneLabelText, { color: palette.stroke }]}>BALL</Text>
        </View>
      </Animated.View>

      {/* Guidance text — outside any draggable so it doesn't move. */}
      <View pointerEvents="none" style={[styles.labelWrap, { top: boxTop + boxHeight + 12 }]}>
        <Text
          style={[styles.label, { color: palette.stroke }]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >{palette.label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bullseyeWrap: {
    position: 'absolute',
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballBoxWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballBoxInner: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 4,
    opacity: 0.7,
  },
  labelWrap: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
    // 2026-05-22 — Z Fold cover-display fix. Without horizontal padding
    // the long SETUP label ("Drag bullseye to target · drag BALL to
    // address") overflowed past the screen edge with letter-spacing
    // pushing the last word out. Padding + numberOfLines:2 + auto-fit
    // on the Text below let it wrap or shrink cleanly on narrow
    // screens (Z Fold cover ~6:13 portrait) while leaving normal-width
    // phones unaffected.
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  zoneLabel: {
    position: 'absolute',
    top: -14,
    left: 0,
  },
  zoneLabelText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
