import React from "react";
import {
  SmartVisionIcon,
  SwingLabIcon,
  CaddieMicIcon,
  CameraIcon,
  PracticeIcon,
  TargetIcon,
  PatternIcon,
  ScorecardIcon,
  HistoryIcon,
  PlayIcon,
} from "./SmartCaddieIcons";

export type IconName =
  | "smartvision"
  | "swinglab"
  | "caddie"
  | "camera"
  | "practice"
  | "target"
  | "pattern"
  | "scorecard"
  | "history"
  | "play";

interface IconProps {
  name: IconName;
  size?: number;
  active?: boolean;
}

export default function Icon({ name, size = 24, active = false }: IconProps) {
  const props = { size, active };
  switch (name) {
    case "smartvision": return <SmartVisionIcon {...props} />;
    case "swinglab":    return <SwingLabIcon {...props} />;
    case "caddie":      return <CaddieMicIcon {...props} />;
    case "camera":      return <CameraIcon {...props} />;
    case "practice":    return <PracticeIcon {...props} />;
    case "target":      return <TargetIcon {...props} />;
    case "pattern":     return <PatternIcon {...props} />;
    case "scorecard":   return <ScorecardIcon {...props} />;
    case "history":     return <HistoryIcon {...props} />;
    case "play":        return <PlayIcon {...props} />;
    default:            return null;
  }
}
