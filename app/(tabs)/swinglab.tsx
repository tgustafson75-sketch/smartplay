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
import { View, Text, Pressable, ScrollView, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import BrandHeaderRow from '../../components/brand/BrandHeaderRow';

type Status = 'LIVE' | 'BETA' | 'SOON';

interface LauncherCardSpec {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  status: Status;
  sub: string;
  /** Route to push on tap. null = non-navigable (status SOON). */
  route: string | null;
}

const CARDS: LauncherCardSpec[] = [
  {
    key: 'drills',
    icon: 'library-outline',
    title: 'Drills',
    status: 'LIVE',
    sub: 'Primary Issue · Common Faults · pro instructor videos',
    // Diagnostic catalog (v3-style — issue → fix mapping).
    // Pro's prior prescriptive drills are still reachable at
    // /swinglab/drills-legacy if a power user wants them.
    route: '/drills',
  },
  {
    key: 'range',
    icon: 'videocam-outline',
    title: 'Range Mode',
    status: 'BETA',
    sub: 'Multi-shot session: range, studio, or backyard cage',
    route: '/swinglab/range',
  },
  {
    key: 'smartmotion',
    icon: 'camera-outline',
    title: 'SmartMotion',
    status: 'BETA',
    sub: 'Single-swing video + audio narration',
    // Routes through the Camera Setup gate first; user proceeds to
    // the actual capture (cage-drill) after the 5-item checklist passes.
    route: '/swinglab/camera-setup?next=%2Fswinglab%2Fcage-drill',
  },
  {
    key: 'arena',
    icon: 'trophy-outline',
    title: 'Arena',
    status: 'LIVE',
    sub: 'Bag distances · tempo trainer · putting clock',
    // v3-style practice-drills launcher. Pro's gameplay challenges
    // (CTP / Scramble / Sim / Skills) are still reachable via the
    // "Open Arena →" footer link on the practice screen.
    route: '/arena/practice',
  },
  {
    key: 'library',
    icon: 'albums-outline',
    title: 'Swing Library',
    status: 'BETA',
    sub: 'Captured swings, uploads from camera roll',
    route: '/swinglab/library',
  },
  {
    key: 'acoustic',
    icon: 'pulse-outline',
    title: 'Acoustic Test Bench',
    status: 'BETA',
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
  const disabled = spec.route == null;
  const statusColor =
    spec.status === 'LIVE' ? colors.accent
    : spec.status === 'BETA' ? '#F0C030'
    : colors.text_muted;
  const statusBg =
    spec.status === 'LIVE' ? colors.accent_muted
    : spec.status === 'BETA' ? 'rgba(240,192,48,0.12)'
    : 'rgba(156,163,175,0.10)';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${spec.title}. ${spec.sub}`}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface_elevated,
          borderColor: colors.border,
          opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}>
        <Ionicons name={spec.icon} size={26} color={colors.accent} />
      </View>
      <View style={styles.cardText}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardTitle, { color: colors.text_primary }]}>{spec.title}</Text>
          <View style={[styles.statusPill, { backgroundColor: statusBg, borderColor: statusColor }]}>
            <Text style={[styles.statusPillText, { color: statusColor }]}>{spec.status}</Text>
          </View>
        </View>
        <Text style={[styles.cardSub, { color: colors.text_muted }]} numberOfLines={2}>
          {spec.sub}
        </Text>
      </View>
      {!disabled && (
        <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
      )}
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
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  cardTitle: { fontSize: 17, fontWeight: '800' },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  cardSub: { fontSize: 12, lineHeight: 17 },
});
