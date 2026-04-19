import React from 'react';
import { Text, View } from 'react-native';

interface YardageDisplayProps {
  front?: number | null;
  middle?: number | null;
  back?: number | null;
  /** Size variant: 'large' (main hero), 'medium' (cards), 'small' (compact). Default: 'medium' */
  size?: 'large' | 'medium' | 'small';
  /** Tint for the middle yardage. Default: '#A7F3D0' */
  middleColor?: string;
  /** Tint when GPS is weak / stale. */
  weak?: boolean;
}

const SIZES = {
  large:  { mid: 52, dim: 14, label: 10, midWeight: '900' as const, dimWeight: '700' as const },
  medium: { mid: 18, dim: 13, label: 9,  midWeight: '800' as const, dimWeight: '700' as const },
  small:  { mid: 15, dim: 12, label: 8,  midWeight: '700' as const, dimWeight: '600' as const },
};

export default function YardageDisplay({
  front,
  middle,
  back,
  size = 'medium',
  middleColor,
  weak = false,
}: YardageDisplayProps) {
  const sz = SIZES[size];

  const fVal = front  ?? '--';
  const mVal = middle ?? '--';
  const bVal = back   ?? '--';

  const midColor = middleColor ?? (weak ? '#fcd34d' : '#A7F3D0');
  const dimColor = weak ? '#f59e0b' : '#9ca3af';
  const labelColor = weak ? '#f59e0b' : '#6b7280';

  return (
    <View style={{ alignItems: 'center' }}>
      <Text>
        <Text style={{ color: dimColor, fontSize: sz.dim, fontWeight: sz.dimWeight, opacity: 0.75 }}>
          {'F '}
        </Text>
        <Text style={{ color: dimColor, fontSize: sz.dim, fontWeight: sz.dimWeight, opacity: 0.75 }}>
          {fVal}
        </Text>
        <Text style={{ color: midColor, fontSize: sz.mid, fontWeight: sz.midWeight }}>
          {'  '}
        </Text>
        <Text style={{ color: midColor, fontSize: sz.mid, fontWeight: sz.midWeight }}>
          {mVal}
        </Text>
        <Text style={{ color: dimColor, fontSize: sz.dim, fontWeight: sz.dimWeight, opacity: 0.75 }}>
          {'  B '}
        </Text>
        <Text style={{ color: dimColor, fontSize: sz.dim, fontWeight: sz.dimWeight, opacity: 0.75 }}>
          {bVal}
        </Text>
      </Text>
      <Text style={{ color: labelColor, fontSize: sz.label, fontWeight: '700', letterSpacing: 1.2, marginTop: 2 }}>
        F · MID · B
      </Text>
    </View>
  );
}
