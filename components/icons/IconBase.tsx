/**
 * SmartCaddie Icon System
 * ─────────────────────────────────────────────────────────────────────────────
 * All icons share: 24×24 viewBox, stroke-width 2, no gradients, no glow.
 * Active state = brand green (#1F6F54), inactive = white (dark) or black (bright).
 */

import React from 'react';
import Svg, { Path, Circle, Line, Rect, Ellipse } from 'react-native-svg';

// ── Shared types ─────────────────────────────────────────────────────────────
export type IconProps = {
  active?: boolean;
  theme?: 'dark' | 'bright';
  size?: number;
};

// ── Color helper ─────────────────────────────────────────────────────────────
export function getIconColor(active = false, theme: 'dark' | 'bright' = 'dark'): string {
  if (active) return '#A7F3D0';                       // active: mint green
  return theme === 'bright' ? '#1a2e22' : '#FFFFFF';  // inactive: nearly black or white
}

// ── Base wrapper ─────────────────────────────────────────────────────────────
export const IconBase = ({
  children,
  size = 24,
}: {
  children: React.ReactNode;
  size?: number;
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {children}
  </Svg>
);

// ── Tab icons ─────────────────────────────────────────────────────────────────

/** Caddie — round golf ball with dimples (logo style) */
export const CaddieIcon = ({ active, theme, size }: IconProps) => {
  const c = getIconColor(active, theme);
  return (
    <IconBase size={size}>
      {/* Ball outline */}
      <Circle cx="12" cy="12" r="9" stroke={c} strokeWidth="2" />
      {/* Dimple rows — curved lines across the ball */}
      <Path d="M7 8.5 Q9 7 12 7.5 Q15 8 17 8.5" stroke={c} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <Path d="M5.5 12 Q8 10.5 12 11 Q16 11.5 18.5 12" stroke={c} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <Path d="M7 15.5 Q9 17 12 16.5 Q15 16 17 15.5" stroke={c} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      {/* Vertical seam arc */}
      <Path d="M12 3 Q14.5 7 14 12 Q13.5 17 12 21" stroke={c} strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </IconBase>
  );
};

/** Play — golf flag on a green (pin + flag) */
export const PlayIcon = ({ active, theme, size }: IconProps) => {
  const c = getIconColor(active, theme);
  return (
    <IconBase size={size}>
      {/* Pin shaft */}
      <Line x1="11" y1="3" x2="11" y2="20" stroke={c} strokeWidth="2" strokeLinecap="round" />
      {/* Flag */}
      <Path d="M11 3 L19 6.5 L11 10" stroke={c} strokeWidth="1.5" strokeLinejoin="round" fill={c} fillOpacity="0.25" />
      {/* Ground line */}
      <Line x1="6" y1="20" x2="16" y2="20" stroke={c} strokeWidth="2" strokeLinecap="round" />
      {/* Ball on green */}
      <Circle cx="17" cy="20" r="2" fill={c} />
    </IconBase>
  );
};

/** Scorecard — clipboard with score lines  */
export const ScorecardIcon = ({ active, theme, size }: IconProps) => {
  const c = getIconColor(active, theme);
  return (
    <IconBase size={size}>
      <Rect x="4" y="3" width="16" height="18" rx="2" stroke={c} strokeWidth="2" />
      <Line x1="8" y1="8"  x2="16" y2="8"  stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="8" y1="12" x2="16" y2="12" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="8" y1="16" x2="13" y2="16" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </IconBase>
  );
};

/** Practice — target / bullseye  */
export const PracticeIcon = ({ active, theme, size }: IconProps) => {
  const c = getIconColor(active, theme);
  return (
    <IconBase size={size}>
      <Circle cx="12" cy="12" r="9"  stroke={c} strokeWidth="2" />
      <Circle cx="12" cy="12" r="5"  stroke={c} strokeWidth="1.5" />
      <Circle cx="12" cy="12" r="2"  fill={c} />
    </IconBase>
  );
};

/** History / Dashboard — bar chart  */
export const HistoryIcon = ({ active, theme, size }: IconProps) => {
  const c = getIconColor(active, theme);
  return (
    <IconBase size={size}>
      <Rect x="3"  y="14" width="4" height="7" rx="1" stroke={c} strokeWidth="1.5" />
      <Rect x="10" y="9"  width="4" height="12" rx="1" stroke={c} strokeWidth="1.5" />
      <Rect x="17" y="4"  width="4" height="17" rx="1" stroke={c} strokeWidth="1.5" />
    </IconBase>
  );
};

// ── Feature icons ─────────────────────────────────────────────────────────────

/** Rangefinder — crosshair with distance ticks  */
export const RangeIcon = ({ active, theme, size }: IconProps) => {
  const c = getIconColor(active, theme);
  return (
    <IconBase size={size}>
      <Circle cx="12" cy="12" r="8" stroke={c} strokeWidth="2" />
      <Line x1="12" y1="4"  x2="12" y2="7"  stroke={c} strokeWidth="2" strokeLinecap="round" />
      <Line x1="12" y1="17" x2="12" y2="20" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <Line x1="4"  y1="12" x2="7"  y2="12" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <Line x1="17" y1="12" x2="20" y2="12" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <Circle cx="12" cy="12" r="1.5" fill={c} />
    </IconBase>
  );
};

/** SmartVision — golf ball with trailing trajectory arcs (speed lines) */
export const SmartVisionIcon = ({ active, theme, size }: IconProps) => {
  const c = getIconColor(active, theme);
  return (
    <IconBase size={size}>
      {/* Ball */}
      <Circle cx="8" cy="13" r="5" stroke={c} strokeWidth="2" />
      {/* Dimple hint */}
      <Path d="M5.5 11.5 Q8 10.5 10.5 11.5" stroke={c} strokeWidth="1" strokeLinecap="round" fill="none" />
      <Path d="M5.5 13.5 Q8 12.5 10.5 13.5" stroke={c} strokeWidth="1" strokeLinecap="round" fill="none" />
      {/* Trajectory arcs — sweeping right from ball */}
      <Path d="M13 10 Q18 8 22 9" stroke={c} strokeWidth="2" strokeLinecap="round" fill="none" />
      <Path d="M13 13 Q18 12 22 12" stroke={c} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <Path d="M13 16 Q18 16 22 15" stroke={c} strokeWidth="1" strokeLinecap="round" fill="none" />
    </IconBase>
  );
};

/** SwingLab — two arc swing paths */
export const SwingLabIcon = ({ active, theme, size }: IconProps) => {
  const c = getIconColor(active, theme);
  return (
    <IconBase size={size}>
      <Path d="M4 16 Q10 8 16 12" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <Path d="M4 19 Q10 11 16 15" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5" />
      {/* Ball at impact */}
      <Circle cx="16" cy="12" r="2" fill={c} />
    </IconBase>
  );
};

/** Course flag — pin + flag */
export const CourseIcon = ({ active, theme, size }: IconProps) => {
  const c = getIconColor(active, theme);
  return (
    <IconBase size={size}>
      <Line x1="12" y1="4" x2="12" y2="20" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <Path d="M12 4 Q16 6 12 9" stroke={c} strokeWidth="1.5" fill={c} fillOpacity="0.3" />
    </IconBase>
  );
};
