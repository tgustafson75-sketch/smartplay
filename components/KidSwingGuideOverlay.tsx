/**
 * 2026-05-22 — Kid Swing Guide Overlay (AR ideal-position cues).
 *
 * SVG overlay on top of expo-camera (or any view) that shows the four
 * ideal swing positions as kid-friendly ghost markers so a parent or
 * captain can record + review with a visual reference. NOT real-time
 * pose comparison — we don't ship pose detection on-device yet — but
 * a visible "stand here / swing to here / finish here" guide a kid can
 * literally aim at while their parent records.
 *
 * Phases shown:
 *   - address  — feet markers + ball position
 *   - top      — top-of-backswing arc + shaft angle hint
 *   - impact   — ball + impact zone star
 *   - finish   — balanced finish silhouette
 *   - all      — overlays all four at once with phase chips
 *
 * Tone calibrated to ageBand (matches juniorSwingAnalyzer):
 *   - tiny:    big emoji + short words ("FEET HERE", smiley face at impact)
 *   - junior:  simple cues ("balanced finish", arrows)
 *   - teen:    technical but minimal ("address", "top", "impact", "finish")
 *   - adult:   text-only, no emoji
 *
 * Handedness mirrors the entire layout (lefty stance + swing arc flipped).
 *
 * 3D upgrade path: this component intentionally uses 2D SVG so it works
 * on every device with no expo-gl dependency. A 3D variant
 * (components/KidSwingGuideOverlay3D.tsx) can swap in behind the same
 * prop contract once we wire ArShotTraceOverlay3D's three.js stack into
 * a kid scene. ArShotTrace's router pattern would pick the right one.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText, Polygon } from 'react-native-svg';
import { ageBand, type AgeBand } from '../store/familyStore';

export type GuidePhase = 'address' | 'top' | 'impact' | 'finish' | 'all';

export interface KidSwingGuideOverlayProps {
  width: number;
  height: number;
  /** Which phase to show. 'all' draws every guide stacked. */
  phase?: GuidePhase;
  /** Family member's age — drives ageBand → tone. Defaults to junior
   *  when null/unknown. */
  age?: number | null;
  /** Right or left dominant. Defaults to right. Lefty flips horizontally. */
  handedness?: 'right' | 'left' | 'unknown';
  /** Optional name shown in the encouragement banner. */
  firstName?: string | null;
  /** When true, hides text encouragement banner (e.g. for screen-share
   *  recording where you just want the markers). */
  silentMode?: boolean;
}

export default function KidSwingGuideOverlay({
  width, height,
  phase = 'all',
  age = null,
  handedness = 'right',
  firstName = null,
  silentMode = false,
}: KidSwingGuideOverlayProps) {
  const band = ageBand(age);
  const lefty = handedness === 'left';

  // Anchor anatomy in screen-relative coords. The ball sits ~58% from
  // top (chest-height for a typical phone capture from across the
  // hitting bay). Feet at ~78%. Pin/target rises from ball position.
  const ballX = width * 0.5;
  const ballY = height * 0.58;
  // Right-handed: lead foot LEFT of ball (lower x). Lefty mirrors.
  const stanceWidth = width * 0.18;
  const leadFootX  = lefty ? ballX + stanceWidth * 0.45 : ballX - stanceWidth * 0.45;
  const trailFootX = lefty ? ballX - stanceWidth * 0.55 : ballX + stanceWidth * 0.55;
  const feetY = height * 0.78;

  // Top-of-backswing club end position — opposite shoulder, above head.
  const topX = lefty ? ballX + width * 0.28 : ballX - width * 0.28;
  const topY = height * 0.20;

  // Finish silhouette anchor — pelvis facing target side.
  const finishX = lefty ? ballX - width * 0.16 : ballX + width * 0.16;
  const finishY = height * 0.50;

  const showAddress = phase === 'address' || phase === 'all';
  const showTop     = phase === 'top'     || phase === 'all';
  const showImpact  = phase === 'impact'  || phase === 'all';
  const showFinish  = phase === 'finish'  || phase === 'all';

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      <Svg width={width} height={height}>
        {/* ─── Address: feet markers + ball position ───────────────── */}
        {showAddress && (
          <>
            <FootMarker x={leadFootX} y={feetY} label="lead" />
            <FootMarker x={trailFootX} y={feetY} label="trail" />
            <Line
              x1={leadFootX} y1={feetY - 8} x2={trailFootX} y2={feetY - 8}
              stroke="rgba(134, 239, 172, 0.55)" strokeWidth={1.5} strokeDasharray="4,3"
            />
            <Circle
              cx={ballX} cy={ballY + 4}
              r={8}
              fill="rgba(255,255,255,0.92)" stroke="#86efac" strokeWidth={2}
            />
            {labelFor('address', band, ballX, ballY - 22, lefty)}
          </>
        )}

        {/* ─── Top: arc from ball up to top-of-backswing ──────────── */}
        {showTop && (
          <>
            <Path
              d={`M ${ballX} ${ballY} Q ${(ballX + topX) / 2} ${(ballY + topY) / 2 - height * 0.18} ${topX} ${topY}`}
              stroke="rgba(192, 132, 252, 0.7)" strokeWidth={2.5} strokeDasharray="6,4" fill="none"
            />
            <Circle cx={topX} cy={topY} r={10} fill="rgba(192, 132, 252, 0.9)" />
            {labelFor('top', band, topX + (lefty ? -8 : 8), topY - 6, lefty, 'right')}
          </>
        )}

        {/* ─── Impact: ball + zone star ───────────────────────────── */}
        {showImpact && (
          <>
            <Polygon
              points={star(ballX, ballY + 4, 22, 9)}
              fill="rgba(250, 204, 21, 0.30)" stroke="#facc15" strokeWidth={1.5}
            />
            {labelFor('impact', band, ballX, ballY + 36, lefty)}
          </>
        )}

        {/* ─── Finish: balanced silhouette mark ───────────────────── */}
        {showFinish && (
          <>
            <Circle cx={finishX} cy={finishY} r={14}
              fill="rgba(34, 197, 94, 0.20)" stroke="#22c55e" strokeWidth={2} strokeDasharray="3,3" />
            <Line
              x1={finishX} y1={finishY + 14} x2={finishX} y2={feetY - 18}
              stroke="rgba(34, 197, 94, 0.55)" strokeWidth={1.5}
            />
            {labelFor('finish', band, finishX, finishY - 22, lefty)}
          </>
        )}
      </Svg>

      {!silentMode && (
        <View style={styles.encourageBanner}>
          <Text style={styles.encourageText}>
            {encouragementFor(band, firstName, phase)}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Marker subcomponents ────────────────────────────────────────────────

function FootMarker({ x, y, label }: { x: number; y: number; label: 'lead' | 'trail' }) {
  return (
    <>
      <Circle cx={x} cy={y} r={10}
        fill="rgba(134, 239, 172, 0.18)" stroke="#86efac" strokeWidth={2} />
      <Circle cx={x} cy={y} r={3} fill="#86efac" />
      <SvgText x={x} y={y + 22}
        textAnchor="middle"
        fontSize={9} fontWeight="800" fill="rgba(0,0,0,0.85)"
        stroke="rgba(255,255,255,0.85)" strokeWidth={2}>
        {label === 'lead' ? 'LEAD' : 'TRAIL'}
      </SvgText>
      <SvgText x={x} y={y + 22}
        textAnchor="middle"
        fontSize={9} fontWeight="800" fill="#0a1410">
        {label === 'lead' ? 'LEAD' : 'TRAIL'}
      </SvgText>
    </>
  );
}

function labelFor(
  phase: 'address' | 'top' | 'impact' | 'finish',
  band: AgeBand,
  x: number, y: number, lefty: boolean,
  anchor: 'middle' | 'start' | 'right' = 'middle',
): React.ReactElement {
  const text = labelText(phase, band);
  void lefty;
  return (
    <>
      <SvgText x={x} y={y}
        textAnchor={anchor === 'right' ? 'start' : anchor}
        fontSize={band === 'tiny' ? 14 : band === 'junior' ? 12 : 11}
        fontWeight="900"
        fill="none" stroke="rgba(0,0,0,0.85)" strokeWidth={3}>
        {text}
      </SvgText>
      <SvgText x={x} y={y}
        textAnchor={anchor === 'right' ? 'start' : anchor}
        fontSize={band === 'tiny' ? 14 : band === 'junior' ? 12 : 11}
        fontWeight="900"
        fill={phaseColor(phase)}>
        {text}
      </SvgText>
    </>
  );
}

function phaseColor(phase: 'address' | 'top' | 'impact' | 'finish'): string {
  switch (phase) {
    case 'address': return '#86efac';
    case 'top':     return '#c084fc';
    case 'impact':  return '#facc15';
    case 'finish':  return '#22c55e';
  }
}

function labelText(phase: 'address' | 'top' | 'impact' | 'finish', band: AgeBand): string {
  if (band === 'tiny') {
    switch (phase) {
      case 'address': return '⛳ BALL';
      case 'top':     return '⬆ TOP';
      case 'impact':  return '⭐ HIT';
      case 'finish':  return '🌳 STAND TALL';
    }
  }
  if (band === 'junior') {
    switch (phase) {
      case 'address': return 'BALL HERE';
      case 'top':     return 'SWING TO HERE';
      case 'impact':  return 'WATCH THE BALL';
      case 'finish':  return 'BALANCED FINISH';
    }
  }
  switch (phase) {
    case 'address': return 'ADDRESS';
    case 'top':     return 'TOP';
    case 'impact':  return 'IMPACT';
    case 'finish':  return 'FINISH';
  }
}

function encouragementFor(band: AgeBand, name: string | null, phase: GuidePhase): string {
  const n = name ?? '';
  if (band === 'tiny') {
    if (phase === 'address') return `${n}! Feet on the dots — eyes on the ball.`;
    if (phase === 'top')     return `Swing aaaall the way up to the purple dot!`;
    if (phase === 'impact')  return `Hit the star — bonk!`;
    if (phase === 'finish')  return `Stand like a tree! Don't fall!`;
    return `Watch the dots, ${n}! Big smooth swing.`;
  }
  if (band === 'junior') {
    if (phase === 'address') return `${n}, line your feet up with the markers and put the ball on the spot.`;
    if (phase === 'top')     return `Take it back to the purple — full shoulder turn.`;
    if (phase === 'impact')  return `Eyes locked on the star at impact.`;
    if (phase === 'finish')  return `Hold the finish two beats — balanced + tall.`;
    return `Follow the markers — address, top, impact, finish.`;
  }
  if (band === 'teen') {
    if (phase === 'address') return `${n} — square the stance to the line, ball on the marker.`;
    if (phase === 'top')     return `Full turn to the top marker. Wrist hinged.`;
    if (phase === 'impact')  return `Compression through impact — stay over it.`;
    if (phase === 'finish')  return `Finish balanced, belt buckle to target.`;
    return `Address → Top → Impact → Finish. Hit the marks.`;
  }
  if (phase === 'address') return `Address.`;
  if (phase === 'top')     return `Top of backswing.`;
  if (phase === 'impact')  return `Impact zone.`;
  if (phase === 'finish')  return `Balanced finish.`;
  return `Position guide.`;
}

// ─── Math helpers ────────────────────────────────────────────────────────

function star(cx: number, cy: number, rOuter: number, rInner: number): string {
  // 5-point star centered at (cx, cy). Points string for SVG <Polygon>.
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const angle = (Math.PI / 2) + (i * Math.PI) / 5;
    const x = cx + Math.cos(angle) * r;
    const y = cy - Math.sin(angle) * r;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  encourageBanner: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(134, 239, 172, 0.45)',
  },
  encourageText: {
    color: '#86efac',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});
