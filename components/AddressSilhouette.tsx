import React from 'react';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';

interface Props {
  type: 'face-on' | 'putting';
  size?: number;
  color?: string;
  accentColor?: string;
}

export default function AddressSilhouette({
  type,
  size = 160,
  color = '#a3b8a8',
  accentColor = '#00C896',
}: Props) {
  return type === 'face-on' ? (
    <FaceOnSilhouette size={size} color={color} accentColor={accentColor} />
  ) : (
    <PuttingSilhouette size={size} color={color} accentColor={accentColor} />
  );
}

// ─── FACE-ON ──────────────────────────────

function FaceOnSilhouette({
  size,
  color,
  accentColor,
}: {
  size: number;
  color: string;
  accentColor: string;
}) {
  const _s = size / 160;

  return (
    <Svg width={size} height={size} viewBox="0 0 160 200">
      {/* Head */}
      <Circle cx={80} cy={16} r={12} fill={color} />

      {/* Torso */}
      <Path
        d="M60 30 Q80 28 100 30 L96 90 Q80 94 64 90 Z"
        fill={color}
      />

      {/* Left arm (lead arm — slightly angled down) */}
      <Path
        d="M62 38 L42 78 L46 82 L50 78 L70 44"
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
      />

      {/* Right arm */}
      <Path
        d="M98 38 L118 78 L114 82 L110 78 L90 44"
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
      />

      {/* Club grip area */}
      <Ellipse cx={80} cy={84} rx={10} ry={6} fill={accentColor} opacity={0.85} />

      {/* Hips */}
      <Rect x={62} y={90} width={36} height={14} rx={7} fill={color} />

      {/* Left leg */}
      <Path
        d="M72 104 L68 148 L62 148 L60 152 L78 152 L78 104"
        fill={color}
      />

      {/* Right leg */}
      <Path
        d="M88 104 L92 148 L98 148 L100 152 L82 152 L82 104"
        fill={color}
      />

      {/* Left foot */}
      <Ellipse cx={67} cy={154} rx={10} ry={5} fill={color} />

      {/* Right foot */}
      <Ellipse cx={93} cy={154} rx={10} ry={5} fill={color} />

      {/* Club shaft */}
      <Line
        x1={80}
        y1={86}
        x2={60}
        y2={162}
        stroke={accentColor}
        strokeWidth={2.5}
        strokeLinecap="round"
      />

      {/* Clubhead */}
      <Ellipse cx={58} cy={164} rx={7} ry={3} fill={accentColor} />

      {/* Alignment lines */}
      <Line
        x1={30}
        y1={170}
        x2={130}
        y2={170}
        stroke={accentColor}
        strokeWidth={1.5}
        strokeDasharray="4,3"
        opacity={0.6}
      />
      <Line
        x1={30}
        y1={176}
        x2={130}
        y2={176}
        stroke={color}
        strokeWidth={1}
        strokeDasharray="4,3"
        opacity={0.4}
      />

      {/* Shoulder line */}
      <Line
        x1={54}
        y1={34}
        x2={106}
        y2={34}
        stroke={accentColor}
        strokeWidth={1}
        strokeDasharray="3,3"
        opacity={0.5}
      />

      {/* Hip line */}
      <Line
        x1={57}
        y1={98}
        x2={103}
        y2={98}
        stroke={accentColor}
        strokeWidth={1}
        strokeDasharray="3,3"
        opacity={0.5}
      />
    </Svg>
  );
}

// ─── PUTTING ──────────────────────────────

function PuttingSilhouette({
  size,
  color,
  accentColor,
}: {
  size: number;
  color: string;
  accentColor: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 160 200">
      {/* Head — more upright posture */}
      <Circle cx={80} cy={18} r={12} fill={color} />

      {/* Neck */}
      <Rect x={76} y={29} width={8} height={8} rx={3} fill={color} />

      {/* Torso — more upright (less tilt) */}
      <Path
        d="M62 36 Q80 34 98 36 L95 86 Q80 90 65 86 Z"
        fill={color}
      />

      {/* Both arms together in pendulum position */}
      <Path
        d="M65 44 L56 86 L60 90 L64 86 L72 50"
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
      />
      <Path
        d="M95 44 L104 86 L100 90 L96 86 L88 50"
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
      />

      {/* Grip — centered */}
      <Ellipse cx={80} cy={88} rx={10} ry={6} fill={accentColor} opacity={0.85} />

      {/* Hips */}
      <Rect x={63} y={86} width={34} height={14} rx={7} fill={color} />

      {/* Left leg — closer together for putting stance */}
      <Path
        d="M73 100 L70 148 L64 148 L63 152 L80 152 L80 100"
        fill={color}
      />

      {/* Right leg */}
      <Path
        d="M87 100 L90 148 L96 148 L97 152 L80 152 L80 100"
        fill={color}
      />

      {/* Left foot */}
      <Ellipse cx={69} cy={154} rx={9} ry={5} fill={color} />

      {/* Right foot */}
      <Ellipse cx={91} cy={154} rx={9} ry={5} fill={color} />

      {/* Putter shaft — more vertical */}
      <Line
        x1={80}
        y1={90}
        x2={80}
        y2={165}
        stroke={accentColor}
        strokeWidth={2.5}
        strokeLinecap="round"
      />

      {/* Putter head */}
      <Rect
        x={68}
        y={163}
        width={24}
        height={5}
        rx={2}
        fill={accentColor}
      />

      {/* Ball */}
      <Circle cx={80} cy={172} r={4} fill={color} opacity={0.6} />

      {/* Pendulum arc guide */}
      <Path
        d="M56 90 Q80 110 104 90"
        fill="none"
        stroke={accentColor}
        strokeWidth={1}
        strokeDasharray="4,3"
        opacity={0.4}
      />

      {/* Foot alignment line */}
      <Line
        x1={40}
        y1={162}
        x2={120}
        y2={162}
        stroke={accentColor}
        strokeWidth={1.5}
        strokeDasharray="4,3"
        opacity={0.6}
      />
    </Svg>
  );
}
