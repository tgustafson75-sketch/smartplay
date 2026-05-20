/**
 * SwingLab tab — v3-style flat launcher (Phase v3-port step 1/5).
 *
 * Replaces Pro's previous collapsible-sections layout with v3's clean
 * 6-card launcher. Every card routes to a dedicated screen; no nested
 * collapsibles or inline drill catalogs here. The tab is purely a
 * directory.
 *
 * Why this changed:
 *   Pro's prior layout (collapsible sections with personalization
 *   badges, inline drill detail, watch banner) was information-dense
 *   but undiscoverable. v3's flat card list reads in one glance.
 *   We KEEP the underlying drill content + Cage Mode + Swing Library
 *   logic — they just live behind named cards now.
 *
 * Preservation of existing functionality:
 *   - The previous SwingLab body was copied verbatim to
 *     /app/swinglab/drills.tsx so the Drills card surfaces it as a
 *     dedicated screen. Nothing has been deleted.
 *   - Arena, Swing Library, Acoustic Test Bench route to Pro's
 *     existing screens (unchanged).
 *   - Range Mode + SmartMotion + dedicated Drill detail are tracked
 *     for follow-up steps in the v3-port plan. SmartMotion currently
 *     routes to /swinglab/cage-drill (Pro's existing single-swing
 *     capture); Range Mode shows a "Coming soon" treatment until its
 *     dedicated screen lands.
 */

import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { BrandHeaderRow } from '../../components/brand/BrandHeaderRow';

interface LauncherCardSpec {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  sub: string;
  /** Route to push on tap. */
  route: string;
}

// 2026-05-19 — Reordered per Tim: SmartMotion first (the marquee
// camera flow), then Range Mode, then Drills, then Arena, then
// Library, then Acoustic. SmartMotion also gets expanded sub copy
// covering AI Swing Analysis + Body Mechanics + Tracing future state
// so the user sees the full SmartMotion value prop at a glance.
const CARDS: LauncherCardSpec[] = [
  {
    key: 'smartmotion',
    icon: 'camera-outline',
    title: 'SmartMotion',
    sub: 'AI Swing Analysis · Body Mechanics · Shot Tracing (coming)',
    route: '/swinglab/camera-setup?next=%2Fswinglab%2Fcage-drill',
  },
  {
    key: 'range',
    icon: 'videocam-outline',
    title: 'Range Mode',
    sub: 'Multi-shot session: range, studio, or backyard cage',
    route: '/swinglab/range',
  },
  {
    key: 'drills',
    icon: 'library-outline',
    title: 'Drills',
    sub: 'Primary Issue · Common Faults · pro instructor videos',
    route: '/drills',
  },
  {
    key: 'arena',
    icon: 'trophy-outline',
    title: 'Arena',
    sub: 'Bag distances · tempo trainer · putting clock',
    route: '/arena/practice',
  },
  {
    key: 'library',
    icon: 'albums-outline',
    title: 'Swing Library',
    sub: 'Captured swings, uploads from camera roll',
    route: '/swinglab/library',
  },
  {
    key: 'acoustic',
    icon: 'pulse-outline',
    title: 'Acoustic Test Bench',
    sub: 'Validate strike-detection pipeline before the range',
    route: '/acoustic-test',
  },
];

export default function SwingLab() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* BRAND HEADER — shared v3-style row, matches every other tab. */}
        <BrandHeaderRow />

        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>PRACTICE</Text>

        {CARDS.map((card) => (
          <LauncherCard
            key={card.key}
            spec={card}
            colors={colors}
            onPress={() => {
              if (card.route) router.push(card.route as never);
            }}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

interface LauncherCardProps {
  spec: LauncherCardSpec;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}

function LauncherCard({ spec, colors, onPress }: LauncherCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${spec.title}. ${spec.sub}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface_elevated,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}>
        <Ionicons name={spec.icon} size={26} color={colors.accent} />
      </View>
      <View style={styles.cardText}>
        <Text style={[styles.cardTitle, { color: colors.text_primary }]}>{spec.title}</Text>
        <Text style={[styles.cardSub, { color: colors.text_muted }]} numberOfLines={2}>
          {spec.sub}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingBottom: 32,
  },
  brandWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 12,
  },
  brandBadge: { width: 56, height: 56, borderRadius: 28 },
  brandTitleBlock: { flex: 1 },
  brandWordmarkRow: { flexDirection: 'row', alignItems: 'baseline' },
  brandName1: { fontSize: 18, fontWeight: '800', letterSpacing: 2.5 },
  brandName2: { fontSize: 18, fontWeight: '800', letterSpacing: 2.5 },
  brandTagline: { fontSize: 10, fontWeight: '500', letterSpacing: 1.4, marginTop: 2 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 17, fontWeight: '800', marginBottom: 4 },
  cardSub: { fontSize: 12, lineHeight: 17 },
});
