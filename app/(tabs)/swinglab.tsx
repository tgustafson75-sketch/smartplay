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
 * Current cards (2026-06-11): Smart Motion (/swinglab/smartmotion — the marquee
 * capture flow, cage/range/course in one), Coach Mode (/swinglab/coach-mode),
 * Drills (/drills → app/drills/index.tsx), Swing Library (/swinglab/library),
 * and Tempo Trainer (/swinglab/tempo-trainer — Tour-Tempo audio metronome).
 * Card title/sub render from i18n (swinglab.card_<key>_title/sub).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { QuickTutorial } from '../../components/QuickTutorial';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { BrandHeaderRow } from '../../components/brand/BrandHeaderRow';
import { useDeviceLayout, WIDE_CONTENT_MAX_WIDTH } from '../../hooks/useDeviceLayout';
import { SETUP_CHECK_ENABLED } from '../../services/swing/setupCheck';


interface LauncherCardSpec {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  sub: string;
  /** Route to push on tap. */
  route: string;
  /** 2026-06-13 (Tim) — visual dressing: per-card accent + a short role tag so the
   *  cards read at a glance and are sequenced/colored by alignment to the north star. */
  accent: string;
  tag: string;
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
// 2026-06-13 (Tim) — sequenced by alignment to the north star (phone sensors + AI
// = the wow). The capture/AI core leads; coaching-others trails. Each card carries
// an accent + a one-word role tag for at-a-glance scanning.
//   1 Smart Motion  — THE wow: AI capture + analysis (CORE)
//   2 Drills        — goal-driven practice THROUGH Smart Motion (PRACTICE)
//   3 Tempo Trainer — the headline metric, trained directly (TEMPO)
//   4 Swing Library — the payoff: your AI-analyzed swings (REVIEW)
//   5 Coach Mode    — analyze someone ELSE (secondary to the solo wow) (COACH)
const CARDS: LauncherCardSpec[] = [
  {
    key: 'smartmotion',
    icon: 'camera-outline',
    title: 'Smart Motion',
    sub: 'AI swing analysis · acoustic swing detection · body mechanics',
    route: '/swinglab/smartmotion',
    accent: '#88F700',
    tag: 'CORE',
  },
  {
    key: 'drills',
    icon: 'golf-outline',
    title: 'Drills',
    sub: 'Primary Issue · Common Faults · pro instructor videos',
    route: '/drills',
    accent: '#3b9eff',
    tag: 'PRACTICE',
  },
  // 2026-06-11 — Tempo Trainer (Tour Tempo): tick takeaway · tick top · tock strike, 3:1.
  {
    key: 'tempo',
    icon: 'musical-notes-outline',
    title: 'Tempo Trainer',
    sub: 'Swing to the beat · Tour-Tempo 3:1 · tick·tick·tock',
    route: '/swinglab/tempo-trainer',
    accent: '#f5a623',
    tag: 'TEMPO',
  },
  {
    key: 'library',
    icon: 'albums-outline',
    title: 'Swing Library',
    sub: 'Captured swings, uploads from camera roll',
    route: '/swinglab/library',
    accent: '#a78bfa',
    tag: 'REVIEW',
  },
  // 2026-05-23 — Coach Mode: watch + analyze someone else's swing (player roster +
  // coach notes). For Tank (instructor) + parent-coaching-kid via the family roster.
  {
    key: 'coach-mode',
    icon: 'school-outline',
    title: 'Coach Mode',
    sub: 'Watch + analyze someone else\'s swing · player roster · coach notes',
    route: '/swinglab/coach-mode',
    accent: '#34d399',
    tag: 'COACH',
  },
];

// 2026-06-13 (Tim) — surface the Practice Engine on the practice tab where it
// belongs (it was buried in the caddie Tools menu — discoverability gap, see memory
// practice-engine-smartmotion). All run THROUGH Smart Motion. Copy from the spec
// (no i18n keys yet — LauncherCard falls back to spec.title/sub).
const PRACTICE_CARDS: LauncherCardSpec[] = [
  // 2026-06-14 (Tim) — pre-round Setup Check. Gated behind SETUP_CHECK_ENABLED
  // (the server SETUP_SYSTEM_PROMPT is staged, not deployed) so the card stays
  // hidden until the bundled Vercel deploy — never a dead entry. Flip the flag
  // in services/swing/setupCheck.ts post-deploy and this appears.
  // 2026-06-15 (Tim) — the adaptive pre-round warm-up: pick your time, it composes
  // the sequence (stretch → setup → swings → brief → confidence ball) + honest readiness.
  {
    key: 'preround',
    icon: 'timer-outline',
    title: 'Pre-Round Warm Up',
    sub: 'Got 10/20/30 min? An adaptive warm-up that ends you on a good one',
    route: '/practice/preround',
    accent: '#88F700',
    tag: 'PRE-ROUND',
  },
  ...(SETUP_CHECK_ENABLED ? [{
    key: 'setup-check',
    icon: 'body-outline' as const,
    title: 'Setup Check',
    sub: 'Pre-round fundamentals from one address photo — grip, stance, ball position',
    route: '/swinglab/setup-check',
    accent: '#88F700',
    tag: 'PRE-ROUND',
  }] : []),
  {
    key: 'open-range',
    icon: 'infinite-outline',
    title: 'Open Range',
    sub: 'Quantify the mash — balls, flight-seen, on-line rate, per club',
    route: '/practice/open-range',
    accent: '#22d3ee',
    tag: 'RANGE',
  },
  // 2026-06-15 (Tim — shot-shape drills) — pick a short-game shot, record it,
  // see what you went for vs what came out (origin→departure launch read).
  {
    key: 'shot-shapes',
    icon: 'analytics-outline',
    title: 'Shot Shapes',
    sub: 'Flop, pitch, chip, runner — what you went for vs what came out',
    route: '/practice/shot-shapes',
    accent: '#fb7185',
    tag: 'SHORT GAME',
  },
  {
    key: 'focus-session',
    icon: 'list-outline',
    title: 'Focus Session',
    sub: 'Interleaved practice for one focus — auto-advances as you swing',
    route: '/practice/session',
    accent: '#fb7185',
    tag: 'FOCUS',
  },
  // 2026-06-15 (Tim — AI club fitting v1) — honest Fit Profile: your tracked
  // distance ladder + gaps to fill + redundant clubs. A starting point, not a spec.
  {
    key: 'fit-profile',
    icon: 'construct-outline',
    title: 'Fit Profile',
    sub: 'Your distance ladder, gaps to fill + redundant clubs — from real shots',
    route: '/practice/fit-profile',
    accent: '#22d3ee',
    tag: 'FITTING',
  },
  {
    key: 'smartplan',
    icon: 'calendar-outline',
    title: 'SmartPlan',
    sub: 'A weighted weekly plan from your goal · tap a day to run it',
    route: '/practice/smartplan',
    accent: '#a3e635',
    tag: 'PLAN',
  },
];

/** Fade a hex color to an rgba string (for tinted icon boxes + tag chips). */
function hexFade(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function SwingLab() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  // 2026-05-24 — beta-minimal responsive: centered max-width on wide
  // surfaces (fold-open, tablet, landscape). Narrow form factors render
  // unchanged.
  const { isWide } = useDeviceLayout();

  // 2026-06-08 — Acoustic Test Bench removed (acoustic is wired into
  // SmartMotion calibration now); SwingLab shows all cards.
  const visibleCards = CARDS;

  // 2026-06-11 — Removed the spoken "turn on Active Listening for hands-free
  // swing commands" prompt. Active listening is Caddie-tab + round-only and was
  // deliberately NOT wired into SmartMotion (one mic, owned by the camera during
  // capture), so the prompt promised a capability that doesn't exist in any
  // SwingLab mode — and its warm-up/collision timing made it fire unreliably.
  // The QuickTutorial intro below is the only voice on this tab now.

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && { alignItems: 'center' }]}
        showsVerticalScrollIndicator={false}
      >
       <View style={isWide ? { width: '100%', maxWidth: WIDE_CONTENT_MAX_WIDTH } : undefined}>
        {/* BRAND HEADER — shared v3-style row, matches every other tab. */}
        <BrandHeaderRow />

        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>{t('swinglab.practice')}</Text>

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

        {/* PRACTICE ENGINE — goal-driven practice that runs through Smart Motion. */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>
          {t('swinglab.practice_engine', { defaultValue: 'PRACTICE ENGINE' })}
        </Text>
        {PRACTICE_CARDS.map((card) => (
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
        title={t('swinglab.tut_title')}
        lines={[
          t('swinglab.tut_1'),
          t('swinglab.tut_2'),
          t('swinglab.tut_3'),
        ]}
        spokenText={t('swinglab.tut_spoken')}
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
  const { t } = useTranslation();
  // Localized when a key exists; falls back to the spec copy otherwise (so new
  // cards — e.g. the Practice Engine section — need no i18n churn to ship).
  const title = t('swinglab.card_' + spec.key + '_title', { defaultValue: spec.title });
  const sub = t('swinglab.card_' + spec.key + '_sub', { defaultValue: spec.sub });
  const accent = spec.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface_elevated,
          borderColor: pressed ? accent : colors.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      {/* Accent spine — a slim colored bar so each card reads distinctly at a glance. */}
      <View style={[styles.accentSpine, { backgroundColor: accent }]} />
      <View style={[styles.iconBox, { backgroundColor: hexFade(accent, 0.14), borderColor: accent }]}>
        <Ionicons name={spec.icon} size={26} color={accent} />
      </View>
      <View style={styles.cardText}>
        <View style={styles.titleRow}>
          <Text style={[styles.cardTitle, { color: colors.text_primary }]}>{title}</Text>
          <View style={[styles.tag, { backgroundColor: hexFade(accent, 0.16), borderColor: hexFade(accent, 0.5) }]}>
            <Text style={[styles.tagText, { color: accent }]}>{spec.tag}</Text>
          </View>
        </View>
        <Text style={[styles.cardSub, { color: colors.text_muted }]} numberOfLines={2}>
          {sub}
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
    paddingLeft: 18, // room for the accent spine
    overflow: 'hidden',
  },
  accentSpine: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 5,
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { fontSize: 17, fontWeight: '800' },
  tag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  tagText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  cardSub: { fontSize: 12, lineHeight: 17 },
});
