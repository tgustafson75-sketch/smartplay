import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Phase D-1 — Banner for the Course Detail screen.
 *
 * Matches the visual treatment of the locked Caddie-home banner — small Kevin
 * avatar dot left, two-line SmartPlay / Caddie wordmark center, three-dot
 * menu right — without modifying the locked caddie.tsx layout. Pure presentation.
 */
type Props = {
  onMenuPress?: () => void;
};

export default function CourseDetailBanner({ onMenuPress }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.avatarDot} />
      <View style={styles.brand}>
        <Text style={styles.brandName}>SmartPlay<Text style={styles.brandSub}> Caddie</Text></Text>
      </View>
      <TouchableOpacity
        onPress={onMenuPress}
        hitSlop={10}
        style={styles.menuBtn}
        accessibilityRole="button"
        accessibilityLabel="Menu"
      >
        <View style={styles.dot} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#060f09',
  },
  avatarDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0d2418',
    borderWidth: 1,
    borderColor: '#00C896',
  },
  brand: { alignItems: 'center' },
  brandName: { color: '#00C896', fontSize: 16, fontWeight: '800', letterSpacing: 2.5, textTransform: 'uppercase' },
  brandSub: { color: '#ffffff', fontSize: 16, fontWeight: '800', letterSpacing: 2.5, textTransform: 'uppercase' },
  menuBtn: { padding: 8, gap: 3 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#9ca3af' },
});
