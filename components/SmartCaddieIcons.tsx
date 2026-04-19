import React from "react";
import Svg, { Path, Circle, Line } from "react-native-svg";

const stroke = (active?: boolean) => active ? "#1F6F54" : "#FFFFFF";

export const SmartVisionIcon = ({ size = 24, active = false }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M3 16 Q12 4 21 10" stroke={stroke(active)} strokeWidth="2" fill="none" />
    <Circle cx="21" cy="10" r="2" fill={stroke(active)} />
  </Svg>
);

export const SwingLabIcon = ({ size = 24, active = false }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 16 Q10 8 16 12" stroke={stroke(active)} strokeWidth="2" />
    <Path d="M6 18 Q12 10 20 14" stroke={stroke(active)} strokeWidth="1.5" opacity="0.6" />
  </Svg>
);

export const CaddieMicIcon = ({ size = 24, active = false }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 3 a4 4 0 0 1 4 4 v4 a4 4 0 0 1 -8 0 v-4 a4 4 0 0 1 4 -4"
      stroke={stroke(active)}
      strokeWidth="2"
    />
    <Line x1="12" y1="15" x2="12" y2="20" stroke={stroke(active)} strokeWidth="2" />
    <Path d="M8 20 h8" stroke={stroke(active)} strokeWidth="2" />
  </Svg>
);

export const CameraIcon = ({ size = 24, active = false }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 7 h4 l2 -2 h4 l2 2 h4 v10 h-16 z" stroke={stroke(active)} strokeWidth="2" />
    <Circle cx="12" cy="12" r="3" stroke={stroke(active)} strokeWidth="2" />
  </Svg>
);

export const PracticeIcon = ({ size = 24, active = false }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="8" cy="6" r="2" fill={stroke(active)} />
    <Path d="M8 8 L10 12 L7 20" stroke={stroke(active)} strokeWidth="2" />
    <Path d="M10 12 L15 10" stroke={stroke(active)} strokeWidth="2" />
  </Svg>
);

export const TargetIcon = ({ size = 24, active = false }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="8" stroke={stroke(active)} strokeWidth="2" />
    <Circle cx="12" cy="12" r="4" stroke={stroke(active)} strokeWidth="2" />
    <Circle cx="12" cy="12" r="1.5" fill={stroke(active)} />
  </Svg>
);

export const PatternIcon = ({ size = 24, active = false }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="8" cy="12" r="1.5" fill={stroke(active)} />
    <Circle cx="12" cy="8" r="1.5" fill={stroke(active)} />
    <Circle cx="16" cy="14" r="1.5" fill={stroke(active)} />
    <Path d="M8 12 L12 8 L16 14" stroke={stroke(active)} strokeWidth="1.5" />
  </Svg>
);

export const ScorecardIcon = ({ size = 24, active = false }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M5 4 h14 a1 1 0 0 1 1 1 v14 a1 1 0 0 1 -1 1 h-14 a1 1 0 0 1 -1 -1 v-14 a1 1 0 0 1 1 -1 z" stroke={stroke(active)} strokeWidth="2" />
    <Line x1="8" y1="9" x2="16" y2="9" stroke={stroke(active)} strokeWidth="1.5" />
    <Line x1="8" y1="13" x2="16" y2="13" stroke={stroke(active)} strokeWidth="1.5" />
    <Line x1="8" y1="17" x2="13" y2="17" stroke={stroke(active)} strokeWidth="1.5" />
  </Svg>
);

export const HistoryIcon = ({ size = 24, active = false }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="8" stroke={stroke(active)} strokeWidth="2" />
    <Path d="M12 8 v4 l3 2" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" />
  </Svg>
);

export const PlayIcon = ({ size = 24, active = false }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="9" stroke={stroke(active)} strokeWidth="2" />
    <Path d="M10 8 l6 4 -6 4 z" fill={stroke(active)} />
  </Svg>
);
