/**
 * 2026-06-15 (Tim — shot-shape drills) — "WHAT DO YOU WANT TO PRACTICE?"
 * short-game shot-shape picker (mockup-driven). Pick a shot type → its intended
 * shape is the goal → record through Smart Motion's drill flow → the review shows
 * intended-vs-actual launch (origin→departure read). Honest sense-of-progress,
 * not lab precision ([[shot-shape-drills]]).
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { SHOT_SHAPES, type ShotShapeDef } from '../../services/practice/shotShapes';
import { safeBack } from '../../services/safeBack';
import { ACCENT_GREEN, ACCENT_AMBER, ACCENT_SKY } from '../../theme/tokens';

// 2026-06-23 (Tim) — launch-height tints on the disciplined 3-color brand
// palette (was green/orange/cyan): high=GREEN, medium=AMBER, low=SKY.
const HEIGHT_TINT: Record<string, string> = { high: ACCENT_GREEN, medium: ACCENT_AMBER, low: ACCENT_SKY };

export default function ShotShapesPicker() {
  const router = useRouter();
  const { colors } = useTheme();

  const pick = (s: ShotShapeDef) => {
    // Ride Smart Motion's existing drill capture flow; drillShotType carries the
    // intended shape into the review for the intended-vs-actual compare card.
    router.push(
      `/swinglab/smartmotion?drillId=shot_${s.id}&drillName=${encodeURIComponent(s.name)}&drillShots=3&drillFocus=shot_shape&drillShotType=${s.id}` as never,
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>What do you want to practice?</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        <Text style={[styles.sub, { color: colors.text_muted }]}>
          Pick a shot. I&apos;ll record it and show you what you went for vs. what came out — launch + direction. Sense of progress, not a TrackMan.
        </Text>
        {SHOT_SHAPES.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => pick(s)}
            accessibilityRole="button"
            accessibilityLabel={`Practice ${s.name}`}
          >
            <View style={[styles.tileIcon, { backgroundColor: `${HEIGHT_TINT[s.intendedHeight]}22` }]}>
              <Ionicons name={s.icon as React.ComponentProps<typeof Ionicons>['name']} size={22} color={HEIGHT_TINT[s.intendedHeight]} />
            </View>
            <Text style={[styles.tileName, { color: colors.text_primary }]}>{s.name}</Text>
            <Text style={[styles.tileBlurb, { color: colors.text_muted }]}>{s.blurb}</Text>
            <Text style={[styles.tileMeta, { color: HEIGHT_TINT[s.intendedHeight] }]}>
              {s.intendedHeight.toUpperCase()} LAUNCH
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', flex: 1, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, paddingBottom: 40, justifyContent: 'space-between' },
  sub: { width: '100%', fontSize: 14, lineHeight: 20, marginBottom: 6 },
  tile: { width: '47%', borderWidth: 1, borderRadius: 14, padding: 14 },
  tileIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  tileName: { fontSize: 15, fontWeight: '800' },
  tileBlurb: { fontSize: 12, lineHeight: 17, marginTop: 4, minHeight: 34 },
  tileMeta: { fontSize: 10, fontWeight: '900', letterSpacing: 1, marginTop: 8 },
});
