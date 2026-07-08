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
// 2026-06-24 (Tim) — CONTINUOUS COOL SPECTRUM that cascades down the whole hub.
// ONE green→teal→cyan→sky→indigo gradient flows top to bottom; each SECTION owns a
// SEGMENT of that spectrum and graduates strongly across its cards, then hands its end
// hue to the next section's start so the page reads as one flowing cool cascade. NO
// amber/yellow anywhere. Per-card color = linear hex interpolation start→end by the
// card's index, so the gradient auto-adjusts as cards are added/removed (e.g. the
// flag-gated Setup Check changing PREPARE's count still graduates smoothly).
//   ANALYZE  → GREEN  #00C896 (solo hero, no graduation)
//   PRACTICE → TEAL   #2DD4BF → CYAN  #22D3EE
//   PLAY     → CYAN   #22D3EE → SKY   #38BDF8
//   PREPARE  → SKY    #38BDF8 → INDIGO #6366F1
import { ACCENT_GREEN } from '../../theme/tokens';

// Per-section spectrum segments [startHex, endHex]. Endpoints chain so the whole page
// flows green→indigo continuously. ANALYZE is the solo green hero (handled directly).
const SECTION_SEGMENTS = {
  practice: ['#2DD4BF', '#22D3EE'] as const, // teal → cyan
  play: ['#22D3EE', '#38BDF8'] as const,     // cyan → sky
  prepare: ['#38BDF8', '#6366F1'] as const,  // sky  → indigo
} as const;

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
  /** Short role tag rendered in the card. Color is no longer per-card — it is
   *  the section's spectrum segment interpolated by the card's index (see segmentColor()). */
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
  title: 'SmartMotion',
  sub: 'AI-powered swing analysis with acoustic detection & body mechanics',
  route: '/swinglab/smartmotion',
  tag: 'CORE',
};

const PRACTICE_SECTION: LauncherCardSpec[] = [
  {
    key: 'drills',
    icon: 'flag-outline',
    title: 'Drills',
    sub: 'Targeted drills for primary issues and common faults',
    route: '/drills',
    tag: 'PRACTICE',
  },
  {
    key: 'library',
    icon: 'albums-outline',
    title: 'Swing Library',
    sub: 'View, compare, and analyze your captured swings',
    route: '/swinglab/library',
    tag: 'REVIEW',
  },
  {
    key: 'tempo',
    icon: 'musical-notes-outline',
    title: 'Smart Tempo',
    sub: 'Measure your real backswing:downswing ratio vs 3:1',
    route: '/swinglab/smart-tempo',
    tag: 'TEMPO',
  },
  {
    key: 'open-range',
    icon: 'golf-outline',
    title: 'Open Range',
    sub: 'Hit freely — Smart Motion tracks every ball and tallies the read',
    route: '/practice/open-range',
    tag: 'RANGE',
  },
  // 2026-07-07 (Tim — "build the indoor and hotel mode... I wanna try it tonight") —
  // phone-in-hand tempo practice for the road: no camera, no space, no ball. Gyro
  // reads tempo/transition/consistency at ~100Hz and feeds the same CNS tempo
  // picture as the range. Honest: rhythm only, no ball flight claimed.
  {
    key: 'hotel-mode',
    icon: 'moon-outline',
    title: 'Hotel Mode',
    sub: 'No club, no ball, no space — swing the phone, get your real tempo',
    route: '/swinglab/indoor',
    tag: 'ANYWHERE',
  },
  // 2026-07-07 (Tim — "a real motion sim game... Road to the Masters feel") — SwingSim:
  // the phone is the club, your REAL bag is the physics, your CNS miss shapes the
  // dispersion, real course aerials are the board. Every swing is a real tempo rep.
  {
    key: 'swingsim',
    icon: 'game-controller-outline',
    title: 'SwingSim',
    sub: 'Play a full sim round with your real bag — swing the phone, watch the tracer',
    route: '/swinglab/simround',
    tag: 'GAME',
  },
];

// 2026-06-17 (Tim) — Play Smarter: Coach Mode + Focus Session + Shot Shapes.
// On-Course Caddie removed (it just circled back to the Play tab).
const PLAY_SECTION: LauncherCardSpec[] = [
  {
    key: 'coach-mode',
    icon: 'school-outline',
    title: 'Coach Mode',
    sub: 'Analyze other players and build your coaching roster',
    route: '/swinglab/coach-mode',
    tag: 'COACH',
  },
  {
    key: 'focus-session',
    icon: 'locate-outline',
    title: 'Focus Session',
    sub: 'Interleaved practice that makes range work stick',
    route: '/practice/session',
    tag: 'FOCUS',
  },
  {
    key: 'shot-shapes',
    icon: 'git-network-outline',
    title: 'Shot Shapes',
    sub: 'Track your actual shot patterns and see trends',
    route: '/practice/shot-shapes',
    tag: 'SHAPES',
  },
];

// 2026-06-17 (Tim) — "Prepare Better": Fit Profile, Setup Check, SmartPlan, Pre-Round Warm Up.
// Setup Check is feature-flagged. All full-width LauncherCards.
const PREPARE_SECTION: LauncherCardSpec[] = [
  {
    key: 'range-import',
    icon: 'stats-chart-outline',
    title: 'Import Range Session',
    sub: 'Scan a TopTracer screenshot — carry distances go straight to Kevin',
    route: '/swinglab/range-import',
    tag: 'CALIBRATE',
  },
  {
    key: 'fit-profile',
    icon: 'construct-outline',
    title: 'Fit Profile',
    sub: 'Real game data builds your ideal bag setup',
    route: '/practice/fit-profile',
    tag: 'FITTING',
  },
  {
    // 2026-07-04 (clean-audit) — Ball Fit's only entry point lived inside the
    // deleted dead quick-tools FAB, orphaning the whole CNS ball-fitting vertical.
    // It's a greenlit roadmap feature — it lives here with its Fit Profile sibling.
    key: 'ball-fit',
    icon: 'golf-outline',
    title: 'Ball Fit',
    sub: 'Match your game data to the right ball',
    route: '/ball-fit',
    tag: 'FITTING',
  },
  ...(SETUP_CHECK_ENABLED ? [{
    key: 'setup-check',
    icon: 'body-outline' as const,
    title: 'Setup Check',
    sub: 'Address, alignment, and grip fundamentals before you play',
    route: '/swinglab/setup-check',
    tag: 'PREP',
  }] : []),
  {
    key: 'smartplan',
    icon: 'calendar-outline',
    title: 'SmartPlan',
    sub: 'Your personalized AI improvement plan',
    route: '/practice/smartplan',
    tag: 'PLAN',
  },
  {
    key: 'preround',
    icon: 'timer-outline',
    title: 'Pre-Round Warm Up',
    sub: 'End your warm-up session on a good swing every time',
    route: '/practice/preround',
    tag: 'WARM UP',
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

/**
 * 2026-06-24 (Tim) — linearly interpolate two hex colors in RGB.
 *   t in [0,1]: 0 → a, 1 → b. Returns a hex string. The spine of the
 *   continuous cool-spectrum cascade. Deterministic, allocation-free
 *   beyond the returned string.
 */
function lerpHex(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const pa = a.replace('#', '');
  const pb = b.replace('#', '');
  const ar = parseInt(pa.slice(0, 2), 16), ag = parseInt(pa.slice(2, 4), 16), ab = parseInt(pa.slice(4, 6), 16);
  const br = parseInt(pb.slice(0, 2), 16), bg = parseInt(pb.slice(2, 4), 16), bb = parseInt(pb.slice(4, 6), 16);
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  const hx = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(bl)}`;
}

/**
 * Per-card accent for a section: interpolate the section's spectrum SEGMENT
 * (startHex → endHex) by the card's index. count<=1 pins the start. Driven by
 * count so the gradient auto-adjusts when cards are added/removed, and the
 * segment endpoints chain section-to-section into one continuous cascade.
 */
function segmentColor(startHex: string, endHex: string, index: number, count: number): string {
  return lerpHex(startHex, endHex, count <= 1 ? 0 : index / (count - 1));
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
        {/* ANALYZE → solid GREEN #00C896 (single hero card, spectrum start, no graduation). */}
        <SmartMotionHero
          spec={HERO_CARD}
          accent={ACCENT_GREEN}
          colors={colors}
          onPress={() => router.push(HERO_CARD.route as never)}
        />

        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>
          {t('swinglab.sec_practice', { defaultValue: 'PRACTICE BETTER' })}
        </Text>
        {/* PRACTICE → TEAL → CYAN, graduated top→bottom. */}
        {PRACTICE_SECTION.map((card, i) => (
          <LauncherCard
            key={card.key}
            spec={card}
            accent={segmentColor(SECTION_SEGMENTS.practice[0], SECTION_SEGMENTS.practice[1], i, PRACTICE_SECTION.length)}
            colors={colors}
            onPress={() => router.push(card.route as never)}
          />
        ))}

        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>
          {t('swinglab.sec_play', { defaultValue: 'PLAY SMARTER' })}
        </Text>
        {/* PLAY → CYAN → SKY, graduated top→bottom (continues from PRACTICE's cyan end). */}
        {PLAY_SECTION.map((card, i) => (
          <LauncherCard
            key={card.key}
            spec={card}
            accent={segmentColor(SECTION_SEGMENTS.play[0], SECTION_SEGMENTS.play[1], i, PLAY_SECTION.length)}
            colors={colors}
            onPress={() => router.push(card.route as never)}
          />
        ))}

        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>
          {t('swinglab.sec_prepare', { defaultValue: 'PREPARE BETTER' })}
        </Text>
        {/* PREPARE → SKY → INDIGO, graduated top→bottom (continues from PLAY's sky end → indigo). */}
        {PREPARE_SECTION.map((card, i) => (
          <LauncherCard
            key={card.key}
            spec={card}
            accent={segmentColor(SECTION_SEGMENTS.prepare[0], SECTION_SEGMENTS.prepare[1], i, PREPARE_SECTION.length)}
            colors={colors}
            onPress={() => router.push(card.route as never)}
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
  /** Graduated section hue for this card (computed per section + index). */
  accent: string;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}

// Full-width horizontal card (accent spine + colored icon box + title/tag + sub + chevron).
// `accent` is the section's graduated hue for this card — not a per-card color.
function LauncherCard({ spec, accent, colors, onPress }: LauncherCardProps) {
  const { t } = useTranslation();
  const title = t('swinglab.card_' + spec.key + '_title', { defaultValue: spec.title });
  const sub = t('swinglab.card_' + spec.key + '_sub', { defaultValue: spec.sub });
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

function HeroFeature({ icon, label }: { icon: ImageSourcePropType; label: string }) {
  return (
    <View style={styles.heroFeat}>
      <Image source={icon} style={styles.heroFeatIcon} resizeMode="contain" />
      {/* Fixed light on the always-dark hero card (was theme color → washed out in light mode). */}
      <Text style={[styles.heroFeatLabel, { color: 'rgba(233,245,233,0.78)' }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// Smart Motion HERO — the marquee card: branded media + CORE badge + feature row.
// Single-card ANALYZE section → uses the brand green base directly (no graduation).
function SmartMotionHero({ spec, accent, colors, onPress }: LauncherCardProps) {
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
        </View>
        <View style={styles.heroText}>
          {/* 2026-06-30 (Tim) — the hero card has a FIXED dark gradient, so its text must
              stay LIGHT in both themes. Theme colors washed it out (dark-on-dark) in light
              mode. Hardcoded light values here on purpose. */}
          <Text style={[styles.heroTitle, { color: '#ffffff' }]}>{spec.title}</Text>
          <View style={[styles.tag, { alignSelf: 'flex-start', marginBottom: 4, backgroundColor: hexFade(accent, 0.16), borderColor: hexFade(accent, 0.5) }]}>
            <Text style={[styles.tagText, { color: accent }]}>{spec.tag}</Text>
          </View>
          <Text style={[styles.heroSub, { color: 'rgba(233,245,233,0.82)' }]} numberOfLines={2}>{spec.sub}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.55)" />
      </View>
      <View style={styles.heroFeatures}>
        <HeroFeature icon={ICON_FEAT_ANALYSIS} label="Swing Analysis" />
        <HeroFeature icon={ICON_FEAT_ACOUSTIC} label="Acoustic Detection" />
        <HeroFeature icon={ICON_FEAT_BODY} label="Body Mechanics" />
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
  cardTitle: { flex: 1, fontSize: 17, fontWeight: '800' },
  tag: { flexShrink: 0, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  tagText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  cardSub: { fontSize: 12, lineHeight: 17 },

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
    width: 76, height: 76, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  heroMediaIcon: { width: 50, height: 50 },

  heroText: { flex: 1, minWidth: 0 },
  heroTitle: { fontSize: 20, fontWeight: '800', marginBottom: 2 },
  heroSub: { fontSize: 12, lineHeight: 16 },
  heroFeatures: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, gap: 8 },
  heroFeat: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  heroFeatIcon: { width: 18, height: 18 },
  heroFeatLabel: { fontSize: 11, fontWeight: '600' },
});
