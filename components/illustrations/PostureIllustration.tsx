/**
 * Phase 111 — Posture illustration.
 *
 * Three side-view spine angles showing rounded (slumped), athletic
 * (correct), and upright (overly straight) postures — represented as
 * angled lines from hip to head, NOT body silhouettes.
 */

import React from 'react';
import Svg, { Line, Circle, Text as SvgText, Rect } from 'react-native-svg';

interface Props {
  size?: number;
  okColor?: string;
  warnColor?: string;
}

export default function PostureIllustration({
  size = 220,
  okColor = '#00C896',
  warnColor = '#ef4444',
}: Props) {
  const w = size;
  const h = size * 0.85;
  const groundY = h * 0.85;
  const colCx = (col: number) => w * (0.18 + col * 0.32);

  // Per-column spine lines: from a shared hip point up to a head circle.
  // Each column varies the spine tilt + head position.
  function PostureCol({
    col,
    spineTopX,
    spineTopY,
    label,
    color,
    bold = false,
  }: { col: number; spineTopX: number; spineTopY: number; label: string; color: string; bold?: boolean }) {
    const cx = colCx(col);
    const hipX = cx;
    const hipY = groundY - h * 0.30;
    const headX = cx + spineTopX;
    const headY = hipY - spineTopY;
    return (
      <>
        {/* Ground line */}
        <Line x1={cx - w * 0.10} y1={groundY} x2={cx + w * 0.10} y2={groundY} stroke="#6b7280" strokeWidth={1} />
        {/* Legs (two parallel lines from hip to ground) */}
        <Line x1={hipX - w * 0.04} y1={hipY} x2={hipX - w * 0.04} y2={groundY} stroke="#9ca3af" strokeWidth={2} />
        <Line x1={hipX + w * 0.04} y1={hipY} x2={hipX + w * 0.04} y2={groundY} stroke="#9ca3af" strokeWidth={2} />
        {/* Spine */}
        <Line x1={hipX} y1={hipY} x2={headX} y2={headY} stroke={color} strokeWidth={bold ? 3 : 2} />
        {/* Head */}
        <Circle cx={headX} cy={headY - 6} r={6} fill="none" stroke={color} strokeWidth={bold ? 2.5 : 1.5} />
        {/* Hip dot */}
        <Rect x={hipX - 3} y={hipY - 3} width={6} height={6} rx={1} fill={color} />
        <SvgText x={cx - 22} y={h * 0.97} fontSize={10} fill={color} fontWeight={bold ? '700' : '600'}>
          {label}
        </SvgText>
      </>
    );
  }

  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {/* Rounded — spine tips forward with head dropped */}
      <PostureCol col={0} spineTopX={w * 0.10} spineTopY={h * 0.18} label="rounded" color={warnColor} />
      {/* Athletic — moderate forward tilt, head over ball */}
      <PostureCol col={1} spineTopX={w * 0.05} spineTopY={h * 0.30} label="athletic" color={okColor} bold />
      {/* Upright — vertical spine, head back */}
      <PostureCol col={2} spineTopX={-w * 0.01} spineTopY={h * 0.32} label="upright" color={warnColor} />
    </Svg>
  );
}
