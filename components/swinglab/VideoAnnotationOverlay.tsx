/**
 * 2026-05-25 — Fix AH: coach annotation toolkit for the SmartMotion +
 * Coach Mode video surfaces. Tim's directive: "make sure there are
 * marking tools to free hand, circle, line, or add text box."
 *
 * v1 scope (this batch):
 *   - Freehand strokes (PanResponder traces a path)
 *   - Circle (two-tap: center, then radius)
 *   - Line (two-tap: start, then end)
 *   - Text box (tap position, type in modal, label sticks at coord)
 *   - 4-color palette (white default + brand-green + red + amber)
 *   - Undo (last shape)  · Clear (all)
 *   - Visibility toggle (hide to see clean video, show to overlay
 *     again — strokes persist in state)
 *   - DRAW mode toggle. When OFF, taps pass through (zoom/scrub).
 *     When ON, drawing captures all gestures.
 *
 * Architecture:
 *   - Renders absolutely above the video frame
 *   - Uses react-native-svg for rendering (simpler than Skia for
 *     piecewise shapes; perf is fine for the 5-20 strokes a coach
 *     typically draws on one frame)
 *   - All shape data is screen-coord based, anchored to the overlay
 *     container — strokes don't move when video scrubs. Persistence
 *     across playback is intentional: coach pauses, draws, resumes
 *     so the student sees motion *behind* the annotation. Clear when
 *     moving to a new key frame.
 *
 * Not in v1 (deferred):
 *   - Per-frame anchoring (annotations stick to specific frame and
 *     hide when scrubbed away). Needs Video position sync.
 *   - Persist to swing record so annotations save across sessions.
 *   - Eraser tool (Clear suffices for v1).
 */

import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal,
  PanResponder, type LayoutChangeEvent, type GestureResponderEvent,
} from 'react-native';
import Svg, { Path, Circle, Line, Text as SvgText, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

// 2026-05-26 — Fix DX: two new coach tools.
//  - 'straight' = swing-plane / spine / shaft alignment guide.
//    Two-tap defines an angle, but the rendered line EXTENDS to the
//    overlay edges so the coach sees a full alignment plane (which
//    is what they actually draw on whiteboard swing analysis).
//  - 'roi' = region-of-interest marker. Two-tap circle but rendered
//    with a dashed border + semi-transparent fill so it visually
//    reads as "focus area" (e.g., impact zone, hip position) instead
//    of the existing solid-outline circle (which reads as "this
//    specific shape"). Distinct tools so the coach picks intent.
type Tool = 'freehand' | 'circle' | 'line' | 'straight' | 'roi' | 'text';
type ShapeColor = '#ffffff' | '#00C896' | '#ef4444' | '#f59e0b';

interface Shape {
  id: string;
  type: Tool;
  color: ShapeColor;
  /** freehand: SVG path d-string. circle/roi: cx/cy/r. line/straight:
   *  x1/y1/x2/y2. text: x/y + text. Each shape uses its own subset;
   *  the others stay undefined. */
  d?: string;
  cx?: number; cy?: number; r?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  x?: number; y?: number; text?: string;
}

interface PendingTwoPoint {
  type: 'circle' | 'line' | 'straight' | 'roi';
  x1: number; y1: number;
}

const COLORS: ShapeColor[] = ['#ffffff', '#00C896', '#ef4444', '#f59e0b'];

export default function VideoAnnotationOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tool, setTool] = useState<Tool>('freehand');
  const [color, setColor] = useState<ShapeColor>('#ffffff');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [pendingPath, setPendingPath] = useState<string>('');
  const [pendingTwoPoint, setPendingTwoPoint] = useState<PendingTwoPoint | null>(null);
  const [textInputModal, setTextInputModal] = useState<{ x: number; y: number } | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // 2026-05-26 — Fix DX: live drag endpoint for the new straight + roi
  // tools. These use a drag-to-size flow (CT-scanner style — Tim's
  // 25-year medical-imaging muscle memory) rather than the existing
  // tap-tap flow used by line + circle. Ref mirrors state so the
  // PanResponder's stable closure reads fresh coords.
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const dragEndRef = useRef<{ x: number; y: number } | null>(null);

  // Track the latest pendingPath in a ref so PanResponder's stable
  // closure can read the current value when onPanResponderRelease
  // fires. setState updates would otherwise see a stale snapshot.
  const pendingPathRef = useRef<string>('');

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  const onTapTwoPoint = (x: number, y: number) => {
    if (tool !== 'circle' && tool !== 'line') return;
    if (!pendingTwoPoint) {
      setPendingTwoPoint({ type: tool, x1: x, y1: y });
      return;
    }
    if (pendingTwoPoint.type === 'circle') {
      const r = Math.hypot(x - pendingTwoPoint.x1, y - pendingTwoPoint.y1);
      addShape({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'circle',
        color,
        cx: pendingTwoPoint.x1,
        cy: pendingTwoPoint.y1,
        r,
      });
    } else {
      addShape({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'line',
        color,
        x1: pendingTwoPoint.x1,
        y1: pendingTwoPoint.y1,
        x2: x,
        y2: y,
      });
    }
    setPendingTwoPoint(null);
  };

  const addShape = (s: Shape) => setShapes(prev => [...prev, s]);
  const undo = () => setShapes(prev => prev.slice(0, -1));
  const clearAll = () => {
    setShapes([]); setPendingTwoPoint(null);
    setPendingPath(''); pendingPathRef.current = '';
    setDragEnd(null); dragEndRef.current = null;
  };

  // 2026-05-26 — Fix DX: extend a two-point line to the overlay edges.
  // Used by the 'straight' tool so a drawn segment renders as a full
  // alignment plane (swing plane / spine / shaft / target-line). The
  // math is parametric: P(t) = P1 + t·(P2-P1); find t at each rect-edge
  // intersection, keep the min and max that land inside the rect.
  const extendToBounds = (x1: number, y1: number, x2: number, y2: number, w: number, h: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return { ex1: x1, ey1: y1, ex2: x2, ey2: y2 };
    const ts: number[] = [];
    if (dx !== 0) { ts.push(-x1 / dx); ts.push((w - x1) / dx); }
    if (dy !== 0) { ts.push(-y1 / dy); ts.push((h - y1) / dy); }
    const inside = ts.filter(t => {
      const x = x1 + t * dx;
      const y = y1 + t * dy;
      return x >= -0.5 && x <= w + 0.5 && y >= -0.5 && y <= h + 0.5;
    });
    if (inside.length < 2) return { ex1: x1, ey1: y1, ex2: x2, ey2: y2 };
    const tMin = Math.min(...inside);
    const tMax = Math.max(...inside);
    return {
      ex1: x1 + tMin * dx, ey1: y1 + tMin * dy,
      ex2: x1 + tMax * dx, ey2: y1 + tMax * dy,
    };
  };

  // Angle from horizontal, folded to -90..+90 so a line is direction-
  // agnostic ("a 45° line" reads the same drawn either way). Screen
  // Y points down so we flip the sign — positive = "rising left-to-
  // right" which matches a coach's whiteboard intuition.
  const angleFromHorizontal = (x1: number, y1: number, x2: number, y2: number) => {
    const rad = Math.atan2(y2 - y1, x2 - x1);
    let deg = rad * 180 / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    return Math.round(-deg);
  };

  // 2026-05-26 — Fix CK: the stable PanResponder closure was reading
  // `enabled`, `tool`, and `color` from the INITIAL render's closure
  // (all captured at module-eval). After the user tapped DRAW, the
  // capture-phase callbacks let the gesture in via enabledRef (correct),
  // but every handler body immediately returned because the closure
  // still saw enabled === false. Same staleness for tool ('freehand'
  // initial) and color ('#ffffff' initial). Result: Tim tapped DRAW,
  // picked a color, dragged on the video, and saw NOTHING — no stroke,
  // no error, just silent failure (his exact report).
  //
  // Fix: ALL handler-body reads go through refs, not closure variables.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;

  const panResponder = useRef(
    PanResponder.create({
      // Only intercept gestures when annotation mode is enabled.
      // 2026-05-25 — Fix AH follow-up: use CAPTURE-phase variants so
      // the overlay grabs the gesture BEFORE parent ScrollViews (the
      // swing detail screen's outer scroll) consume it. Tim flagged
      // drawing didn't register because the parent scroll was
      // capturing the touch. Capture variants run during the capture
      // phase of the touch-routing tree (root → leaf), giving the
      // leaf precedence over upstream scrollables.
      onStartShouldSetPanResponderCapture: () => enabledRef.current,
      onMoveShouldSetPanResponderCapture: () => enabledRef.current,
      onStartShouldSetPanResponder: () => enabledRef.current,
      onMoveShouldSetPanResponder: () => enabledRef.current,
      onPanResponderTerminationRequest: () => !enabledRef.current,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        if (!enabledRef.current) return;
        const { locationX, locationY } = e.nativeEvent;
        const t = toolRef.current;
        if (t === 'freehand') {
          const p = `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
          setPendingPath(p);
          pendingPathRef.current = p;
        } else if (t === 'text') {
          setTextInputModal({ x: locationX, y: locationY });
        } else if (t === 'straight' || t === 'roi') {
          // 2026-05-26 — Fix DX: drag-to-size for the CT-scanner-style
          // tools. Touch-down anchors the start point; Move updates
          // the live endpoint preview; Release commits the shape.
          setPendingTwoPoint({ type: t, x1: locationX, y1: locationY });
          const end = { x: locationX, y: locationY };
          dragEndRef.current = end;
          setDragEnd(end);
        } else {
          onTapTwoPoint(locationX, locationY);
        }
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        if (!enabledRef.current) return;
        const t = toolRef.current;
        const { locationX, locationY } = e.nativeEvent;
        if (t === 'freehand') {
          const next = `${pendingPathRef.current} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
          pendingPathRef.current = next;
          setPendingPath(next);
        } else if (t === 'straight' || t === 'roi') {
          const end = { x: locationX, y: locationY };
          dragEndRef.current = end;
          setDragEnd(end);
        }
      },
      onPanResponderRelease: () => {
        if (!enabledRef.current) return;
        const t = toolRef.current;
        if (t === 'freehand') {
          const d = pendingPathRef.current;
          if (d && d.length > 0) {
            addShape({
              id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              type: 'freehand',
              color: colorRef.current,
              d,
            });
          }
          pendingPathRef.current = '';
          setPendingPath('');
        } else if (t === 'straight' || t === 'roi') {
          const start = pendingTwoPoint;
          const end = dragEndRef.current;
          if (start && end) {
            const dx = end.x - start.x1;
            const dy = end.y - start.y1;
            const distSq = dx * dx + dy * dy;
            // Minimum 8px drag — a stationary tap on these tools is a
            // miss-tap (typically the user picked the tool then tapped
            // to confirm); we don't want to commit a zero-size shape.
            if (distSq >= 64) {
              if (t === 'straight') {
                addShape({
                  id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  type: 'straight',
                  color: colorRef.current,
                  x1: start.x1, y1: start.y1, x2: end.x, y2: end.y,
                });
              } else {
                addShape({
                  id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  type: 'roi',
                  color: colorRef.current,
                  cx: start.x1, cy: start.y1, r: Math.hypot(dx, dy),
                });
              }
            }
          }
          setPendingTwoPoint(null);
          setDragEnd(null);
          dragEndRef.current = null;
        }
      },
    }),
  ).current;

  const commitText = () => {
    if (!textInputModal) return;
    const t = textDraft.trim();
    if (t) {
      addShape({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'text',
        color,
        x: textInputModal.x,
        y: textInputModal.y,
        text: t,
      });
    }
    setTextDraft('');
    setTextInputModal(null);
  };

  return (
    <>
      {/* Top toolbar — toggle DRAW mode + per-tool selection */}
      <View style={styles.toolbar} pointerEvents="box-none">
        <View style={styles.toolbarPills} pointerEvents="auto">
          {/* 2026-05-26 — Tim wanted the annotation toolkit rebranded
              as 'SmartCapture' so it reads as an intentional, named
              feature rather than a generic draw toggle. Sits inside
              the Smart* family (SmartMotion / SmartVision / SmartFinder /
              SmartPlay) and reinforces that this is the official mark-
              up + screenshot-save channel. Full screenshot-export flow
              is a follow-up batch; rename + the Fix CK stroke fix ship
              together so the rebrand also works the first time. */}
          <ToolPill
            icon={enabled ? 'create' : 'create-outline'}
            label={enabled ? 'SMARTCAPTURE ON' : 'SmartCapture'}
            active={enabled}
            onPress={() => setEnabled(v => !v)}
            wide
          />
          {enabled && (
            <>
              <ToolPill icon="brush" active={tool === 'freehand'} onPress={() => setTool('freehand')} accessibilityLabel="Freehand" />
              <ToolPill icon="ellipse-outline" active={tool === 'circle'} onPress={() => setTool('circle')} accessibilityLabel="Circle" />
              <ToolPill icon="remove-outline" active={tool === 'line'} onPress={() => setTool('line')} accessibilityLabel="Line segment" />
              {/* 2026-05-26 — Fix DX: 'straight' = swing-plane / spine /
                  shaft alignment guide. Drag to define angle; rendered
                  line extends edge-to-edge with an angle-from-horizontal
                  readout. Pairs with 'roi' below for CT-scanner-style
                  measurement workflow Tim's 25-year medical imaging
                  muscle memory expects. */}
              <ToolPill icon="git-network-outline" active={tool === 'straight'} onPress={() => setTool('straight')} accessibilityLabel="Straight alignment line" />
              <ToolPill icon="aperture-outline" active={tool === 'roi'} onPress={() => setTool('roi')} accessibilityLabel="ROI region" />
              <ToolPill icon="text-outline" active={tool === 'text'} onPress={() => setTool('text')} accessibilityLabel="Text label" />
            </>
          )}
        </View>
        {enabled && (
          <View style={styles.toolbarPills} pointerEvents="auto">
            {COLORS.map(c => (
              <TouchableOpacity
                key={c}
                onPress={() => setColor(c)}
                style={[
                  styles.colorChip,
                  { backgroundColor: c, borderColor: color === c ? '#00C896' : 'transparent' },
                ]}
                accessibilityLabel={`Color ${c}`}
              />
            ))}
            <ToolPill icon="arrow-undo-outline" onPress={undo} accessibilityLabel="Undo" />
            <ToolPill icon="trash-outline" onPress={clearAll} accessibilityLabel="Clear all" />
            <ToolPill
              icon={visible ? 'eye-outline' : 'eye-off-outline'}
              onPress={() => setVisible(v => !v)}
              accessibilityLabel="Toggle visibility"
            />
          </View>
        )}
      </View>

      {/* Drawing surface — only captures taps when enabled is true.
          Renders the SVG overlay always (when visible) so toggling
          enabled doesn't make annotations disappear. */}
      <View
        style={StyleSheet.absoluteFill}
        onLayout={onLayout}
        pointerEvents={enabled ? 'auto' : 'box-none'}
        {...panResponder.panHandlers}
      >
        {visible && size.w > 0 && (
          // 2026-05-25 — Fix AH follow-up: pointerEvents='none' on the
          // Svg so it NEVER intercepts taps even when the wrapper is
          // 'auto'. Shapes are render-only — no onPress anywhere.
          // Without this, the Svg root defaulted to 'auto' and the
          // play/pause/seek video controls underneath stopped working.
          <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill} pointerEvents="none">
            {shapes.map(s => {
              if (s.type === 'freehand' && s.d) {
                return <Path key={s.id} d={s.d} stroke={s.color} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
              }
              if (s.type === 'circle' && s.r != null) {
                return <Circle key={s.id} cx={s.cx} cy={s.cy} r={s.r} stroke={s.color} strokeWidth={3} fill="none" />;
              }
              if (s.type === 'line' && s.x2 != null) {
                return <Line key={s.id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={3} strokeLinecap="round" />;
              }
              // 2026-05-26 — Fix DX: straight alignment line. Extends to
              // overlay edges + shows angle-from-horizontal label
              // (positive = rising left-to-right, matching whiteboard).
              if (s.type === 'straight' && s.x1 != null && s.y1 != null && s.x2 != null && s.y2 != null) {
                const { ex1, ey1, ex2, ey2 } = extendToBounds(s.x1, s.y1, s.x2, s.y2, size.w, size.h);
                const deg = angleFromHorizontal(s.x1, s.y1, s.x2, s.y2);
                const mx = (ex1 + ex2) / 2;
                const my = (ey1 + ey2) / 2;
                const label = `${deg >= 0 ? '+' : ''}${deg}°`;
                return (
                  <React.Fragment key={s.id}>
                    <Line x1={ex1} y1={ey1} x2={ex2} y2={ey2} stroke={s.color} strokeWidth={2} strokeOpacity={0.9} />
                    {/* Small endpoint markers so the original tap points
                        stay visible — the coach can see where they
                        actually anchored within the extended plane. */}
                    <Circle cx={s.x1} cy={s.y1} r={3} fill={s.color} />
                    <Circle cx={s.x2} cy={s.y2} r={3} fill={s.color} />
                    <Rect x={mx - 22} y={my - 10} width={44} height={18} rx={4} fill="rgba(0,0,0,0.55)" />
                    <SvgText x={mx} y={my + 4} fill={s.color} fontSize="11" fontWeight="800" textAnchor="middle">{label}</SvgText>
                  </React.Fragment>
                );
              }
              // 2026-05-26 — Fix DX: ROI = region of interest. Dashed
              // border + 14%-opacity fill differentiates from the solid
              // outline circle (which reads as "this specific shape").
              // Diameter readout is in % of overlay height — relative,
              // not absolute, since pixels don't translate to a real
              // measurement without per-frame scale calibration.
              if (s.type === 'roi' && s.r != null && s.cx != null && s.cy != null) {
                const diaPct = size.h > 0 ? Math.round((2 * s.r / size.h) * 100) : 0;
                const labelY = s.cy - s.r - 8;
                return (
                  <React.Fragment key={s.id}>
                    <Circle cx={s.cx} cy={s.cy} r={s.r} stroke={s.color} strokeWidth={2} strokeDasharray="6,4" fill={s.color} fillOpacity={0.14} />
                    {/* Crosshair at center — CT-tool convention so the
                        coach sees the anchor point even with semi-fill. */}
                    <Line x1={s.cx - 5} y1={s.cy} x2={s.cx + 5} y2={s.cy} stroke={s.color} strokeWidth={1.5} />
                    <Line x1={s.cx} y1={s.cy - 5} x2={s.cx} y2={s.cy + 5} stroke={s.color} strokeWidth={1.5} />
                    <Rect x={s.cx - 26} y={labelY - 10} width={52} height={16} rx={4} fill="rgba(0,0,0,0.55)" />
                    <SvgText x={s.cx} y={labelY + 2} fill={s.color} fontSize="10" fontWeight="800" textAnchor="middle">{`Ø ${diaPct}%`}</SvgText>
                  </React.Fragment>
                );
              }
              if (s.type === 'text' && s.text) {
                return <SvgText key={s.id} x={s.x} y={s.y} fill={s.color} fontSize="16" fontWeight="700">{s.text}</SvgText>;
              }
              return null;
            })}
            {pendingPath ? (
              <Path d={pendingPath} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ) : null}
            {/* 2026-05-26 — Fix DX: live drag preview for straight + roi.
                Coach sees the line / circle update as they drag, with
                the live angle / diameter readout — same workflow as a
                CT scanner's pre-commit preview. */}
            {pendingTwoPoint && dragEnd && pendingTwoPoint.type === 'straight' ? (() => {
              const { x1, y1 } = pendingTwoPoint;
              const { x: x2, y: y2 } = dragEnd;
              const { ex1, ey1, ex2, ey2 } = extendToBounds(x1, y1, x2, y2, size.w, size.h);
              const deg = angleFromHorizontal(x1, y1, x2, y2);
              const mx = (ex1 + ex2) / 2;
              const my = (ey1 + ey2) / 2;
              return (
                <React.Fragment>
                  <Line x1={ex1} y1={ey1} x2={ex2} y2={ey2} stroke={color} strokeWidth={2} strokeOpacity={0.55} strokeDasharray="4,4" />
                  <Circle cx={x1} cy={y1} r={4} fill={color} opacity={0.8} />
                  <Circle cx={x2} cy={y2} r={4} fill={color} opacity={0.8} />
                  <Rect x={mx - 22} y={my - 10} width={44} height={18} rx={4} fill="rgba(0,0,0,0.55)" />
                  <SvgText x={mx} y={my + 4} fill={color} fontSize="11" fontWeight="800" textAnchor="middle">{`${deg >= 0 ? '+' : ''}${deg}°`}</SvgText>
                </React.Fragment>
              );
            })() : null}
            {pendingTwoPoint && dragEnd && pendingTwoPoint.type === 'roi' ? (() => {
              const { x1, y1 } = pendingTwoPoint;
              const { x: x2, y: y2 } = dragEnd;
              const r = Math.hypot(x2 - x1, y2 - y1);
              const diaPct = size.h > 0 ? Math.round((2 * r / size.h) * 100) : 0;
              const labelY = y1 - r - 8;
              return (
                <React.Fragment>
                  <Circle cx={x1} cy={y1} r={r} stroke={color} strokeWidth={2} strokeDasharray="6,4" fill={color} fillOpacity={0.10} />
                  <Line x1={x1 - 5} y1={y1} x2={x1 + 5} y2={y1} stroke={color} strokeWidth={1.5} />
                  <Line x1={x1} y1={y1 - 5} x2={x1} y2={y1 + 5} stroke={color} strokeWidth={1.5} />
                  <Rect x={x1 - 26} y={labelY - 10} width={52} height={16} rx={4} fill="rgba(0,0,0,0.55)" />
                  <SvgText x={x1} y={labelY + 2} fill={color} fontSize="10" fontWeight="800" textAnchor="middle">{`Ø ${diaPct}%`}</SvgText>
                </React.Fragment>
              );
            })() : null}
            {pendingTwoPoint && !dragEnd && (pendingTwoPoint.type === 'circle' || pendingTwoPoint.type === 'line') ? (
              <Circle cx={pendingTwoPoint.x1} cy={pendingTwoPoint.y1} r={6} fill={color} opacity={0.6} />
            ) : null}
          </Svg>
        )}
      </View>

      {/* Text input modal */}
      <Modal visible={textInputModal != null} transparent animationType="fade" onRequestClose={() => setTextInputModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Label</Text>
            <TextInput
              value={textDraft}
              onChangeText={setTextDraft}
              placeholder="early extension"
              placeholderTextColor="#64748b"
              autoFocus
              style={styles.modalInput}
              onSubmitEditing={commitText}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setTextDraft(''); setTextInputModal(null); }}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={commitText} style={styles.modalSave}>
                <Text style={styles.modalSaveText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function ToolPill({
  icon, label, active, onPress, wide, accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  active?: boolean;
  onPress: () => void;
  wide?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label ?? icon}
      style={[
        styles.pill,
        wide && { paddingHorizontal: 12 },
        { borderColor: active ? '#00C896' : '#1e3a28', backgroundColor: active ? 'rgba(0, 200, 150, 0.22)' : 'rgba(13, 36, 24, 0.92)' },
      ]}
      hitSlop={4}
    >
      <Ionicons name={icon} size={16} color={active ? '#00C896' : '#f8fafc'} />
      {label ? <Text style={[styles.pillLabel, { color: active ? '#00C896' : '#f8fafc' }]}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    position: 'absolute', top: 4, left: 4, right: 4,
    flexDirection: 'column', gap: 6,
    zIndex: 50,
  },
  toolbarPills: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  pillLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  colorChip: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2,
  },
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 360,
    backgroundColor: '#0d2418',
    borderRadius: 14, padding: 16, gap: 12,
    borderWidth: 1, borderColor: '#1e3a28',
  },
  modalTitle: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  modalInput: {
    backgroundColor: '#060f09',
    borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28',
    padding: 12, color: '#f8fafc', fontSize: 15,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, alignItems: 'center' },
  modalCancel: { color: '#94a3b8', fontSize: 13, fontWeight: '700' },
  modalSave: { backgroundColor: '#00C896', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  modalSaveText: { color: '#0d1a0d', fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
});
