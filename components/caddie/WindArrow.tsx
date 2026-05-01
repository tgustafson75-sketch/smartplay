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
 * Phase C — Wind arrow.
 *
 * Caddie-mode visualization of wind relative to shot direction. Mike sees an arrow
 * and immediately knows whether the wind is helping, hurting, or sideways. No
 * reading required.
 *
 * Conventions:
 *   - Arrow up = tailwind (helping). Color: green.
 *   - Arrow down = headwind (hurting). Color: red/orange.
 *   - Arrow sideways = crosswind. Color: amber.
 *   - Calm (<3 mph): small neutral circle, no arrow.
 *   - Stale weather (>10 min) or null: subtle "—" placeholder.
 *
 * If shotBearingDeg is null (unknown shot direction), the arrow rotates by
 * compass-true wind direction (no shot-relative rotation) and the color
 * collapses to neutral.
 *
 * Sized for both Fold-closed and Fold-open aspect ratios via the optional
 * `compact` prop (smaller chrome when screen width is tight).
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
  neutral: '#6b7280',
  calm: '#9ca3af',
  stale: '#374151',
};

function classifyWind(alongMph: number, crossMph: number): 'tail' | 'head' | 'cross' {
  // Threshold: if along is dominant (>1.5x cross), classify by along sign; else cross
  if (Math.abs(alongMph) > Math.abs(crossMph) * 1.5) {
    return alongMph >= 0 ? 'tail' : 'head';
  }
  return 'cross';
}

export default function WindArrow({ weather, shotBearingDeg, compact }: Props) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1.08, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const size = compact ? 56 : 72;
  const stroke = compact ? 2.5 : 3;

  // No data
  if (!weather || weather.wind_direction_deg == null) {
    return (
      <View style={[styles.container, compact && styles.containerCompact]}>
        <Text style={[styles.placeholder, { color: COLORS.stale }]}>—</Text>
        <Text style={[styles.label, { color: COLORS.stale }]}>wind</Text>
      </View>
    );
  }

  const speedMph = weather.wind_speed_mph ?? 0;

  // Calm
  if (speedMph < 3) {
    return (
      <View style={[styles.container, compact && styles.containerCompact]}>
        <View style={[styles.calmCircle, { width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25 }]} />
        <Text style={[styles.label, { color: COLORS.calm }]}>calm</Text>
      </View>
    );
  }

  // Compute relative angle to shot bearing (or absolute compass-up if no bearing)
  const windToDeg = (weather.wind_direction_deg + 180) % 360;
  let arrowAngle: number;
  let alongMph = 0;
  let crossMph = 0;
  let category: 'tail' | 'head' | 'cross' | 'neutral' = 'neutral';

  if (shotBearingDeg != null) {
    let rel = windToDeg - shotBearingDeg;
    rel = ((rel + 540) % 360) - 180;
    arrowAngle = rel; // 0 = up = tailwind
    const r = (rel * Math.PI) / 180;
    alongMph = Math.cos(r) * speedMph;
    crossMph = Math.sin(r) * speedMph;
    category = classifyWind(alongMph, crossMph);
  } else {
    // No bearing — rotate by compass (windToDeg, 0 = up = north). Neutral coloring.
    arrowAngle = windToDeg;
    category = 'neutral';
  }

  const color =
    category === 'tail' ? COLORS.tailwind
    : category === 'head' ? COLORS.headwind
    : category === 'cross' ? COLORS.cross
    : COLORS.neutral;

  // Length scales with speed — clamp 3..30 mph to 0.5..1.0 of available space
  const speedNorm = Math.max(0, Math.min(1, (speedMph - 3) / 27));
  const arrowLength = size * (0.5 + 0.4 * speedNorm);
  const headSize = compact ? 7 : 9;

  // Build a vertical arrow centered at (size/2, size/2), shaft from y_bottom to y_top.
  const cx = size / 2;
  const cy = size / 2;
  const half = arrowLength / 2;
  const shaftTop = cy - half;
  const shaftBottom = cy + half;
  const headPath = `M ${cx} ${shaftTop - headSize} L ${cx - headSize} ${shaftTop} L ${cx + headSize} ${shaftTop} Z`;

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
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
      <Text style={[styles.speed, { color }]}>
        {Math.round(speedMph)}{' '}<Text style={styles.unit}>mph</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  containerCompact: { padding: 4 },
  placeholder: {
    fontSize: 28, fontWeight: '700',
  },
  label: {
    fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginTop: 2,
  },
  calmCircle: {
    backgroundColor: '#1e3a28',
    borderWidth: 1.5,
    borderColor: '#9ca3af',
    marginBottom: 4,
  },
  speed: {
    fontSize: 13, fontWeight: '800', marginTop: 2,
  },
  unit: { fontSize: 10, fontWeight: '600' },
});
