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
import { View, Text, Pressable, ScrollView, StyleSheet, Image, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { BrandHeaderRow } from '../../components/brand/BrandHeaderRow';
import { useDeviceLayout, WIDE_CONTENT_MAX_WIDTH } from '../../hooks/useDeviceLayout';
import { SETUP_CHECK_ENABLED } from '../../services/swing/setupCheck';

// 2026-06-16 (Tim — mockup) — branded SmartMotion icons for the hero + feature row.
const ICON_FEATURE_SM = require('../../assets/icons/smartmotion/feature-smartmotion.png');
const ICON_FEAT_ANALYSIS = require('../../assets/icons/smartmotion/metric-tempo.png');
const ICON_FEAT_ACOUSTIC = require('../../assets/icons/smartmotion/acoustic-listening.png');
const ICON_FEAT_BODY = require('../../assets/icons/smartmotion/biomech-posture.png');


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
// 2026-06-16 (Tim — mockup-driven redesign) — sectioned hierarchy:
//   ANALYZE & IMPROVE → Smart Motion HERO (image + feature row)
//   PRACTICE BETTER   → Drills / Tempo / Swing Library (full-width colored cards)
//   PLAY SMARTER      → Coach Mode / On-Course Caddie
//   ADVANCED TOOLS    → compact tile grid + Fit Profile / SmartPlan full-width

// The hero (rendered specially, not as a LauncherCard).
const HERO_CARD: LauncherCardSpec = {
  key: 'smartmotion',
  icon: 'camera-outline',
  title: 'Smart Motion',
  sub: 'AI-powered swing analysis with acoustic detection & body mechanics',
  route: '/swinglab/smartmotion',
  accent: '#88F700',
  tag: 'CORE',
};

const PRACTICE_SECTION: LauncherCardSpec[] = [
  {
    key: 'drills',
    icon: 'flag-outline',
    title: 'Drills',
    sub: 'Targeted drills for primary issues and common faults',
    route: '/drills',
    accent: '#3b9eff',
    tag: 'PRACTICE',
  },
  {
    key: 'tempo',
    icon: 'musical-notes-outline',
    title: 'Tempo Trainer',
    sub: 'Improve rhythm and timing with guided tempo training',
    route: '/swinglab/tempo-trainer',
    accent: '#f5a623',
    tag: 'TEMPO',
  },
  {
    key: 'library',
    icon: 'albums-outline',
    title: 'Swing Library',
    sub: 'View, compare, and analyze your captured swings',
    route: '/swinglab/library',
    accent: '#a78bfa',
    tag: 'REVIEW',
  },
];

const PLAY_SECTION: LauncherCardSpec[] = [
  {
    key: 'coach-mode',
    icon: 'school-outline',
    title: 'Coach Mode',
    sub: 'Watch and analyze other players + manage your team',
    route: '/swinglab/coach-mode',
    accent: '#34d399',
    tag: 'COACH',
  },
  // 2026-06-16 (Tim — mockup) — On-Course Caddie shortcut into the live round flow.
  {
    key: 'oncourse',
    icon: 'disc-outline',
    title: 'On-Course Caddie',
    sub: 'Real-time caddie help, club recs, wind, slopes & more',
    route: '/(tabs)/play',
    accent: '#22d3ee',
    tag: 'PLAY',
  },
];

// 2026-06-13 (Tim) — surface the Practice Engine on the practice tab where it
// belongs (it was buried in the caddie Tools menu — discoverability gap, see memory
// practice-engine-smartmotion). All run THROUGH Smart Motion. Copy from the spec
// (no i18n keys yet — LauncherCard falls back to spec.title/sub).
// ADVANCED TOOLS — compact tile grid (small icon + title + short sub, no chevron).
const ADVANCED_GRID: LauncherCardSpec[] = [
  ...(SETUP_CHECK_ENABLED ? [{
    key: 'setup-check',
    icon: 'body-outline' as const,
    title: 'Setup Check',
    sub: 'Verify fundamentals before you play',
    route: '/swinglab/setup-check',
    accent: '#88F700',
    tag: 'PREP',
  }] : []),
  {
    key: 'open-range',
    icon: 'infinite-outline',
    title: 'Open Range',
    sub: 'Track all shots and get detailed stats',
    route: '/practice/open-range',
    accent: '#22d3ee',
    tag: 'RANGE',
  },
  {
    key: 'shot-shapes',
    icon: 'git-network-outline',
    title: 'Shot Shapes',
    sub: 'Compare shot patterns & results',
    route: '/practice/shot-shapes',
    accent: '#fb7185',
    tag: 'SHORT GAME',
  },
  {
    key: 'focus-session',
    icon: 'locate-outline',
    title: 'Focus Session',
    sub: 'Stay locked in with interleaved practice',
    route: '/practice/session',
    accent: '#fb7185',
    tag: 'FOCUS',
  },
  {
    key: 'preround',
    icon: 'timer-outline',
    title: 'Pre-Round Warm Up',
    sub: 'Adaptive warm-up that ends you on a good one',
    route: '/practice/preround',
    accent: '#88F700',
    tag: 'PREP',
  },
];

// Full-width cards below the grid (richer one-liners).
const FULL_SECTION: LauncherCardSpec[] = [
  {
    key: 'fit-profile',
    icon: 'construct-outline',
    title: 'Fit Profile',
    sub: 'Build your bag with real data from your game',
    route: '/practice/fit-profile',
    accent: '#22d3ee',
    tag: 'FITTING',
  },
  {
    key: 'smartplan',
    icon: 'calendar-outline',
    title: 'SmartPlan',
    sub: 'Your personalized improvement plan',
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

        {/* 2026-06-16 (Tim — mockup-driven) — sectioned hierarchy: Smart Motion hero,
            then full-width colored cards by intent, then a compact Advanced grid. */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>
          {t('swinglab.sec_analyze', { defaultValue: 'ANALYZE & IMPROVE' })}
        </Text>
        <SmartMotionHero
          spec={HERO_CARD}
          colors={colors}
          onPress={() => router.push(HERO_CARD.route as never)}
        />

        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>
          {t('swinglab.sec_practice', { defaultValue: 'PRACTICE BETTER' })}
        </Text>
        {PRACTICE_SECTION.map((card) => (
          <LauncherCard key={card.key} spec={card} colors={colors} onPress={() => router.push(card.route as never)} />
        ))}

        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>
          {t('swinglab.sec_play', { defaultValue: 'PLAY SMARTER' })}
        </Text>
        {PLAY_SECTION.map((card) => (
          <LauncherCard key={card.key} spec={card} colors={colors} onPress={() => router.push(card.route as never)} />
        ))}

        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>
          {t('swinglab.sec_advanced', { defaultValue: 'ADVANCED TOOLS' })}
        </Text>
        <View style={styles.grid}>
          {ADVANCED_GRID.map((card) => (
            <AdvancedTile key={card.key} spec={card} colors={colors} onPress={() => router.push(card.route as never)} />
          ))}
        </View>
        {FULL_SECTION.map((card) => (
          <LauncherCard key={card.key} spec={card} colors={colors} onPress={() => router.push(card.route as never)} />
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

// Full-width horizontal card (accent spine + colored icon box + title/tag + sub + chevron).
function LauncherCard({ spec, colors, onPress }: LauncherCardProps) {
  const { t } = useTranslation();
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
        { backgroundColor: colors.surface_elevated, borderColor: pressed ? accent : colors.border, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <View style={[styles.accentSpine, { backgroundColor: accent }]} />
      <View style={[styles.iconBox, { backgroundColor: hexFade(accent, 0.14), borderColor: accent }]}>
        <Ionicons name={spec.icon} size={24} color={accent} />
      </View>
      <View style={styles.cardText}>
        <View style={styles.titleRow}>
          <Text style={[styles.cardTitle, { color: colors.text_primary }]} numberOfLines={1}>{title}</Text>
          <View style={[styles.tag, { backgroundColor: hexFade(accent, 0.16), borderColor: hexFade(accent, 0.5) }]}>
            <Text style={[styles.tagText, { color: accent }]}>{spec.tag}</Text>
          </View>
        </View>
        <Text style={[styles.cardSub, { color: colors.text_muted }]} numberOfLines={2}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
    </Pressable>
  );
}

// Compact tile for the Advanced Tools grid (small icon + title + short sub, no chevron).
function AdvancedTile({ spec, colors, onPress }: LauncherCardProps) {
  const accent = spec.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${spec.title}. ${spec.sub}`}
      style={({ pressed }) => [
        styles.advTile,
        { backgroundColor: colors.surface_elevated, borderColor: pressed ? accent : colors.border, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <Ionicons name={spec.icon} size={22} color={accent} style={{ marginBottom: 6 }} />
      <Text style={[styles.advTitle, { color: colors.text_primary }]} numberOfLines={2}>{spec.title}</Text>
      <Text style={[styles.advSub, { color: colors.text_muted }]} numberOfLines={2}>{spec.sub}</Text>
    </Pressable>
  );
}

function HeroFeature({ icon, label, colors }: { icon: ImageSourcePropType; label: string; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.heroFeat}>
      <Image source={icon} style={styles.heroFeatIcon} resizeMode="contain" />
      <Text style={[styles.heroFeatLabel, { color: colors.text_secondary }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// Smart Motion HERO — the marquee card: branded media + CORE badge + feature row.
function SmartMotionHero({ spec, colors, onPress }: LauncherCardProps) {
  const accent = spec.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${spec.title}. ${spec.sub}`}
      style={({ pressed }) => [styles.hero, { borderColor: pressed ? accent : colors.border, opacity: pressed ? 0.95 : 1 }]}
    >
      <View style={[styles.accentSpine, { backgroundColor: accent }]} />
      <LinearGradient colors={['#0c2a14', '#06140b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.heroTopRow}>
        <View style={[styles.heroMedia, { borderColor: hexFade(accent, 0.5), backgroundColor: hexFade(accent, 0.1) }]}>
          <Image source={ICON_FEATURE_SM} style={styles.heroMediaIcon} resizeMode="contain" />
          <View style={[styles.heroPlay, { backgroundColor: accent }]}>
            <Ionicons name="play" size={16} color="#06140b" />
          </View>
        </View>
        <View style={styles.heroText}>
          <View style={styles.titleRow}>
            <Text style={[styles.heroTitle, { color: colors.text_primary }]} numberOfLines={1}>{spec.title}</Text>
            <View style={[styles.tag, { backgroundColor: hexFade(accent, 0.16), borderColor: hexFade(accent, 0.5) }]}>
              <Text style={[styles.tagText, { color: accent }]}>{spec.tag}</Text>
            </View>
          </View>
          <Text style={[styles.heroSub, { color: colors.text_secondary }]} numberOfLines={2}>{spec.sub}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
      </View>
      <View style={styles.heroFeatures}>
        <HeroFeature icon={ICON_FEAT_ANALYSIS} label="Swing Analysis" colors={colors} />
        <HeroFeature icon={ICON_FEAT_ACOUSTIC} label="Acoustic Detection" colors={colors} />
        <HeroFeature icon={ICON_FEAT_BODY} label="Body Mechanics" colors={colors} />
      </View>
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
  // 2026-06-16 (Tim) — 2-up grid of compact, icon-led tiles (was big full-width
  // buttons). space-between gives a clean gutter without percentage+gap overflow,
  // and wraps to rows of two on any width; a lone last tile sits left at 48%.
  // Full-width horizontal card (Practice Better / Play Smarter / Fit Profile / SmartPlan).
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
    width: 52,
    height: 52,
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

  // ADVANCED TOOLS grid — 2-up compact tiles (wraps cleanly; 4-up felt cramped on a
  // phone, 2-up keeps the titles + subs legible while staying icon-led + dense).
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  advTile: {
    width: '48%',
    marginBottom: 10,
    minHeight: 92,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  advTitle: { fontSize: 13, fontWeight: '800', marginBottom: 3 },
  advSub: { fontSize: 11, lineHeight: 14 },

  // SMART MOTION hero.
  hero: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    paddingLeft: 18,
    overflow: 'hidden',
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroMedia: {
    width: 96, height: 96, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  heroMediaIcon: { width: 64, height: 64 },
  heroPlay: {
    position: 'absolute', width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  heroText: { flex: 1, minWidth: 0 },
  heroTitle: { fontSize: 20, fontWeight: '800' },
  heroSub: { fontSize: 13, lineHeight: 18 },
  heroFeatures: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, gap: 8 },
  heroFeat: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  heroFeatIcon: { width: 18, height: 18 },
  heroFeatLabel: { fontSize: 11, fontWeight: '600' },
});
