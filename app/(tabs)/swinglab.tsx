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
import { QuickTutorial } from '../../components/QuickTutorial';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { BrandHeaderRow } from '../../components/brand/BrandHeaderRow';
import { useDeviceLayout, WIDE_CONTENT_MAX_WIDTH } from '../../hooks/useDeviceLayout';
import { useSettingsStore } from '../../store/settingsStore';
import { speak, configureAudioForSpeech, isSpeaking } from '../../services/voiceService';
import { isActiveListeningEnabled } from '../../services/listeningSession';
import { useTrustLevelStore } from '../../store/trustLevelStore';
import { getApiBaseUrl } from '../../services/apiBase';

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
  // 2026-06-07 — Rebuild: Smart Motion is now THE go-to capture surface.
  // Cage Mode + quick-record are being merged into it (open ~1-min
  // window, acoustic multi-swing segmentation, clean redesign). The
  // standalone Cage Mode card was removed here; its capability lives in
  // Smart Motion. Coach Mode stays separate (instructor tool). See
  // memory smartmotion-rebuild.
  {
    key: 'smartmotion',
    icon: 'camera-outline',
    title: 'Smart Motion',
    sub: 'AI swing analysis · acoustic swing detection · body mechanics',
    route: '/swinglab/smartmotion',
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
];

export default function SwingLab() {
  const router = useRouter();
  const { colors } = useTheme();
  const trustLevel = useTrustLevelStore(s => s.level);
  // 2026-05-24 — beta-minimal responsive: centered max-width on wide
  // surfaces (fold-open, tablet, landscape). Narrow form factors render
  // unchanged.
  const { isWide } = useDeviceLayout();

  // 2026-06-08 — Acoustic Test Bench removed (acoustic is wired into
  // SmartMotion calibration now); SwingLab shows all cards.
  const visibleCards = CARDS;

  React.useEffect(() => {
    if (trustLevel === 1) return;
    if (swingLabListeningPromptShown) return;
    if (isActiveListeningEnabled()) return;
    // 2026-06-10 — Reliability fix. The prompt was (a) marked "shown" the
    // instant the tab mounted — so a fast nav-in/out, or a clipped collision,
    // permanently suppressed it (you'd see the text but never hear it again),
    // and (b) firing into any in-flight TTS (e.g. the launch greeting), which
    // clipped it AND left the audio session flaky for the next turns. Now:
    //   • wait longer for the tab transition + any greeting tail to clear,
    //   • SKIP this visit if something is still speaking (no collision) and
    //     leave the flag UNSET so it retries cleanly next time,
    //   • mark "shown" only after it actually plays in full.
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        if (cancelled || isSpeaking()) return; // never collide with in-flight TTS
        try {
          const s = useSettingsStore.getState();
          const apiUrl = getApiBaseUrl();
          await configureAudioForSpeech();
          if (cancelled || isSpeaking()) return;
          await speak(
            'Heads up - turn on Active Listening for hands-free swing commands, or just tap me to talk.',
            s.voiceGender,
            s.language,
            apiUrl,
            { userInitiated: true },
          );
          if (!cancelled) swingLabListeningPromptShown = true; // only after a clean full play
        } catch {
          // Non-fatal; advisory only. Leave the flag unset so it can retry.
        }
      })();
    }, 1200);
    return () => { cancelled = true; clearTimeout(t); };
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
          "Tap Smart Motion to capture and analyze your swings; Coach Mode is for working with someone else.",
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
