import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import type { WeatherSnapshot } from '../../services/weatherService';

/**
 * Phase BH — minimal Windage overlay.
 * Just an arrow and the wind speed. No labels, no calm circle, no
 * "wind"/"calm"/"—" placeholders. When data is missing we render
 * nothing so the parent badge stays clean.
 *
 * Conventions:
 *   - Arrow up = tailwind, Arrow down = headwind, sideways = crosswind.
 *   - Color follows the same family.
 *   - When shotBearingDeg is null, the arrow points by compass-true wind
 *     direction with neutral coloring.
 */

type Props = {
  weather: WeatherSnapshot | null;
  shotBearingDeg: number | null;
  compact?: boolean;
};

const COLORS = {
  tailwind: '#00C896',
  headwind: '#ef4444',
  cross: '#F5A623',
  neutral: '#9ca3af',
};

function classifyWind(alongMph: number, crossMph: number): 'tail' | 'head' | 'cross' {
  if (Math.abs(alongMph) > Math.abs(crossMph) * 1.5) {
    return alongMph >= 0 ? 'tail' : 'head';
  }
  return 'cross';
}

export default function WindArrow({ weather, shotBearingDeg, compact }: Props) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1.06, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const size = compact ? 44 : 60;
  const stroke = compact ? 2.5 : 3;

  // Loading state — weather hasn't resolved yet. Render a small dim
  // compass needle so the badge isn't an empty blue circle while the
  // weather fetch / cache lookup races.
  if (!weather || weather.wind_direction_deg == null) {
    return (
      <View style={styles.container}>
        <Text style={[styles.placeholder, { color: COLORS.neutral }]}>—</Text>
      </View>
    );
  }
  const speedMph = weather.wind_speed_mph ?? 0;
  // Calm — show "calm" mph='0' chip so the badge has a clean readable state.
  if (speedMph < 3) {
    return (
      <View style={styles.container}>
        <Text style={[styles.calmText, { color: COLORS.neutral }]}>calm</Text>
      </View>
    );
  }

  const windToDeg = (weather.wind_direction_deg + 180) % 360;
  let arrowAngle: number;
  let category: 'tail' | 'head' | 'cross' | 'neutral' = 'neutral';

  if (shotBearingDeg != null) {
    let rel = windToDeg - shotBearingDeg;
    rel = ((rel + 540) % 360) - 180;
    arrowAngle = rel;
    const r = (rel * Math.PI) / 180;
    const alongMph = Math.cos(r) * speedMph;
    const crossMph = Math.sin(r) * speedMph;
    category = classifyWind(alongMph, crossMph);
  } else {
    arrowAngle = windToDeg;
    category = 'neutral';
  }

  const color =
    category === 'tail' ? COLORS.tailwind
    : category === 'head' ? COLORS.headwind
    : category === 'cross' ? COLORS.cross
    : COLORS.neutral;

  // Length scales with speed — clamp 3..30 mph to 0.55..1.0
  const speedNorm = Math.max(0, Math.min(1, (speedMph - 3) / 27));
  const arrowLength = size * (0.55 + 0.35 * speedNorm);
  const headSize = compact ? 6 : 8;

  const cx = size / 2;
  const cy = size / 2;
  const half = arrowLength / 2;
  const shaftTop = cy - half;
  const shaftBottom = cy + half;
  const headPath = `M ${cx} ${shaftTop - headSize} L ${cx - headSize} ${shaftTop} L ${cx + headSize} ${shaftTop} Z`;

  return (
    <View style={styles.container}>
      <Animated.View style={pulseStyle}>
        <Svg width={size} height={size}>
          <G transform={`rotate(${arrowAngle} ${cx} ${cy})`}>
            <Path
              d={`M ${cx} ${shaftBottom} L ${cx} ${shaftTop}`}
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
            />
            <Path d={headPath} fill={color} />
            <Circle cx={cx} cy={shaftBottom} r={stroke} fill={color} />
          </G>
        </Svg>
      </Animated.View>
      <Text style={[styles.speed, { color }]}>{Math.round(speedMph)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  speed: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: -2,
    letterSpacing: 0.3,
  },
  placeholder: {
    fontSize: 18,
    fontWeight: '600',
    opacity: 0.6,
  },
  calmText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.0,
    textTransform: 'uppercase',
  },
});
