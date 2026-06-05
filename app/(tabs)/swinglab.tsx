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

import React, { useMemo } from 'react';
import { QuickTutorial } from '../../components/QuickTutorial';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { BrandHeaderRow } from '../../components/brand/BrandHeaderRow';
import { useDeviceLayout, WIDE_CONTENT_MAX_WIDTH } from '../../hooks/useDeviceLayout';
// 2026-05-28 — Fix FG: hide Acoustic Test Bench from non-owner Tools
// once the user has applied a calibration. Owner still sees it for
// triage. Calibration state lives on the acoustic store; isOwnerEmail
// is the standard gate used across the app.
import { useAcousticCalibrationStore } from '../../store/acousticCalibrationStore';
import { usePlayerProfileStore, isOwnerEmail } from '../../store/playerProfileStore';
import { useSettingsStore } from '../../store/settingsStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';
import { isActiveListeningEnabled } from '../../services/listeningSession';
import { useTrustLevelStore } from '../../store/trustLevelStore';

let swingLabListeningPromptShown = false;

interface LauncherCardSpec {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  sub: string;
  /** Route to push on tap. */
  route: string;
}

// 2026-05-19 — Reordered per Tim: SmartMotion first (the marquee
// camera flow), then Range Mode, then Drills, then Library, then
// Acoustic. SmartMotion also gets expanded sub copy covering AI Swing
// Analysis + Body Mechanics + Tracing future state so the user sees
// the full SmartMotion value prop at a glance.
//
// 2026-05-20 — Day 1 / Fix 2: Arena card removed. The route
// /arena/practice 404'd (no app/arena/ directory) and was a user-
// visible launch blocker on the SwingLab tab. Pulled the card
// entirely rather than building a stub.
const CARDS: LauncherCardSpec[] = [
  {
    key: 'smartmotion',
    icon: 'camera-outline',
    title: 'SmartMotion',
    sub: 'AI Swing Analysis · Body Mechanics · Shot Tracing (coming)',
    route: '/swinglab/smartmotion',
  },
  // 2026-05-21 — Day 2 / Fix 9B: Cage Mode added as its own card so
  // it's discoverable alongside SmartMotion. Cage Mode is the
  // dedicated practice + lesson environment (bullseye gate, ball-speed
  // detection, watch IMU, cage calibration, batch-count selector).
  // SmartMotion stays the quick swing check. Zero overlap.
  {
    key: 'cage-mode',
    icon: 'scan-outline',
    title: 'Cage Mode',
    sub: 'Practice + lessons · bullseye gate · ball-speed · 1/3/5/10 swing batches',
    route: '/swinglab/cage-mode',
  },
  // 2026-05-23 — Coach Mode (Fix #8). Wrapper for "watching someone
  // else swing" — pro picks/adds a student, captures their swing
  // (glasses or phone), gets full Phase K swing analysis routed
  // correctly via Fix #7's perspective threading, adds coach notes.
  // For Tank (real golf instructor) — also handles parent-coaching-
  // kid via the family roster.
  {
    key: 'coach-mode',
    icon: 'school-outline',
    title: 'Coach Mode',
    sub: 'Watch + analyze someone else\'s swing · player roster · coach notes',
    route: '/swinglab/coach-mode',
  },
  // 2026-05-25 — Range Mode retired. Cage Mode handles multi-shot
  // sessions; SmartMotion handles single-swing capture. Range was the
  // redundant middle option.
  {
    key: 'drills',
    icon: 'library-outline',
    title: 'Drills',
    sub: 'Primary Issue · Common Faults · pro instructor videos',
    route: '/drills',
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
  const trustLevel = useTrustLevelStore(s => s.level);
  // 2026-05-24 — beta-minimal responsive: centered max-width on wide
  // surfaces (fold-open, tablet, landscape). Narrow form factors render
  // unchanged.
  const { isWide } = useDeviceLayout();

  // 2026-05-28 — Fix FG: filter Acoustic Test Bench out of the card
  // list for non-owners once they've applied a calibration. The bench
  // is a one-time setup for typical users; after that it's diagnostic
  // clutter. Owner always sees it (triage / debug). Non-owners who
  // never calibrated also still see it so they CAN run it once.
  const appliedCalibration = useAcousticCalibrationStore(s => s.appliedCalibration);
  const ownerEmail = usePlayerProfileStore(s => s.email);
  const visibleCards = useMemo(() => {
    const isOwner = isOwnerEmail(ownerEmail);
    if (isOwner) return CARDS;
    if (!appliedCalibration) return CARDS;
    return CARDS.filter(c => c.key !== 'acoustic');
  }, [appliedCalibration, ownerEmail]);

  React.useEffect(() => {
    if (trustLevel === 1) return;
    if (swingLabListeningPromptShown) return;
    if (isActiveListeningEnabled()) return;
    swingLabListeningPromptShown = true;
    void (async () => {
      try {
        const s = useSettingsStore.getState();
        const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
        await configureAudioForSpeech();
        await speak(
          'Heads up - turn on Active Listening for hands-free swing commands, or just tap me to talk.',
          s.voiceGender,
          s.language,
          apiUrl,
          { userInitiated: true },
        );
      } catch {
        // Non-fatal; prompt is advisory only.
      }
    })();
  }, [trustLevel]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && { alignItems: 'center' }]}
        showsVerticalScrollIndicator={false}
      >
       <View style={isWide ? { width: '100%', maxWidth: WIDE_CONTENT_MAX_WIDTH } : undefined}>
        {/* BRAND HEADER — shared v3-style row, matches every other tab. */}
        <BrandHeaderRow />

        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>PRACTICE</Text>

        {visibleCards.map((card) => (
          <LauncherCard
            key={card.key}
            spec={card}
            colors={colors}
            onPress={() => {
              if (card.route) router.push(card.route as never);
            }}
          />
        ))}
       </View>
      </ScrollView>
      <QuickTutorial
        slug="swinglab_intro"
        title="SwingLab"
        lines={[
          "SwingLab is your practice hub — capture swings, run drills, study reps.",
          "Tap any card to jump in — SmartMotion for quick, Cage Mode for full sessions.",
          "Every swing you analyze feeds my read of your tendencies on the course.",
        ]}
        spokenText="SwingLab. Practice hub. Tap a card to jump in."
      />
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
