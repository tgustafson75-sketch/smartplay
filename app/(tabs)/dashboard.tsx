/**
 * Dashboard tab — 2026-06-04 layout.
 *
 * TOP-HALF:
 *   BrandBlock → Title + Welcome → Profile card → Current Round →
 *   Weather → Shot Stats tiles → Recent Shots.
 *
 * BOTTOM-HALF:
 *   Pattern Shift alert → Kevin's Read (AI prevailing tendencies,
 *   cached on playerProfileStore.kevinRead) → Highlights (Best Round,
 *   Longest Drive, Longest Putt, Saved Highlights) → Milestones.
 *
 * Removed 2026-06-04:
 *   - Quick Actions row (SmartFinder / SmartVision / Settings) — the
 *     ⋯ pill upper-right already exposes them.
 *   - Hero Reel feed (counted in Highlights instead).
 *   - Progress card (Points + Tier).
 *
 * Data sources: roundStore, relationshipStore, playerProfileStore,
 * useCurrentWeather, services/kevinReadService.
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useRoundStore } from '../../store/roundStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import ShotTimeline from '../../components/caddie/ShotTimeline';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useFamilyStore } from '../../store/familyStore';
import { useSettingsStore } from '../../store/settingsStore';
// 2026-06-04 — Progress card (Points + Tier) removed from dashboard
// alongside the Highlights Card rework. pointsStore import dropped.
import { generateKevinRead } from '../../services/kevinReadService';
import { useTheme } from '../../contexts/ThemeContext';
import { detectPatternShift } from '../../services/patternDetection';
import { useCurrentWeather } from '../../hooks/useCurrentWeather';
import { useDeviceLayout, WIDE_CONTENT_MAX_WIDTH } from '../../hooks/useDeviceLayout';
import AppIcon from '../../components/AppIcon';
import { BrandHeaderRow } from '../../components/brand/BrandHeaderRow';

export default function Dashboard() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  // 2026-05-24 — beta-minimal responsive: centered max-width on wide
  // surfaces (fold-open, tablet, landscape). Narrow form factors render
  // unchanged.
  const { isWide } = useDeviceLayout();

  // ─── Round data (useShallow keeps re-renders scoped) ──────────────
  const {
    isRoundActive,
    activeCourse,
    getTotalScore,
    getScoreVsPar,
    getHolesPlayed,
  } = useRoundStore(
    useShallow((s) => ({
      isRoundActive: s.isRoundActive,
      activeCourse: s.activeCourse,
      getTotalScore: s.getTotalScore,
      getScoreVsPar: s.getScoreVsPar,
      getHolesPlayed: s.getHolesPlayed,
    })),
  );
  const roundHistory = useRoundStore((s) => s.roundHistory);
  const allShots = useRoundStore((s) => s.shots);

  // Phase U — pattern shift surfacing.
  const patternShift = useMemo(
    () => detectPatternShift(roundHistory.map((r) => ({ shots: r.shots }))),
    [roundHistory],
  );

  // ─── Relationship + profile ──────────────────────────────────────
  // 2026-06-04 — sessionsTogether, currentMentalState, confidenceByClub
  // dropped from selectors (Kevin's Read inline block replaced by the
  // AI-driven card below; topClubs / dominant-miss surface gone).
  // heroMoments + breakthroughs retained — heroMoments feeds the
  // Highlights card count; breakthroughs feeds the standalone
  // Milestones card.
  const {
    roundsTogether,
    heroMoments,
    breakthroughs,
  } = useRelationshipStore(
    useShallow((s) => ({
      roundsTogether: s.roundsTogether,
      heroMoments: s.heroMoments,
      breakthroughs: s.breakthroughs,
    })),
  );

  const {
    firstName,
    name,
    handicap,
    handicap_index,
    personalBest,
    goal,
    dominantMiss: _dominantMiss,
    longestDrive,
    longestPutt,
    kevinRead,
  } = usePlayerProfileStore(
    useShallow((s) => ({
      firstName: s.firstName,
      name: s.name,
      handicap: s.handicap,
      handicap_index: s.handicap_index,
      personalBest: s.personalBest,
      goal: s.goal,
      dominantMiss: s.dominantMiss,
      longestDrive: s.longestDrive,
      longestPutt: s.longestPutt,
      kevinRead: s.kevinRead,
    })),
  );
  const familyMembers = useFamilyStore(s => s.members);
  const activeFamilyMemberId = useFamilyStore(s => s.active_member_id);
  // 2026-06-04 — Coach Mode toggle. When false, the shared-group card +
  // Coach Mode CTA below are hidden even if the user has a roster set
  // up. Toggle lives in the Caddie tab's expandable green-arrow row.
  const coachModeEnabled = useSettingsStore(s => s.coachModeEnabled);
  const activeFamilyRoster = useMemo(
    () => familyMembers.filter(m => !m.archived),
    [familyMembers],
  );
  const activeFamilyMember = useMemo(
    () => activeFamilyRoster.find(m => m.id === activeFamilyMemberId) ?? null,
    [activeFamilyRoster, activeFamilyMemberId],
  );

  // ─── Live weather (current round only — hook returns null otherwise) ──
  const { weather } = useCurrentWeather();

  // ─── Derived ─────────────────────────────────────────────────────
  const totalScore = getTotalScore();
  const scoreVsPar = getScoreVsPar();
  const holesPlayed = getHolesPlayed();
  const scoreVsParDisplay =
    scoreVsPar === 0 ? 'E'
    : scoreVsPar > 0 ? `+${scoreVsPar}`
    : String(scoreVsPar);

  // Aggregate Shot Stats from ALL historical shots.
  // 2026-05-25 — Fix Y: scope FAIRWAY % and AVG YDS to TEE SHOTS only
  // (shot_in_hole_index === 1). Previously the calc counted every shot
  // including wedges/putts/recovery, producing nonsense like "100%
  // fairway, 240 avg yds" across a round of varied shots. Tee-shot
  // scoping is the most honest beta read without a per-hole par lookup
  // (the par-3 caveat means a few iron tee shots count as "fairway
  // tries" — acceptable until we add par-aware filtering).
  const shotStats = useMemo(() => {
    const allHistoricalShots = roundHistory.flatMap((r) => r.shots);
    // 2026-06-11 (audit) — exclude quick-score placeholder shots (id "qs-…").
    // handleQuickScore mints synthetic 'clean' shots so a bare score tap logs a
    // stroke count; counting them here inflated lifetime fairway% and shot count
    // with fabricated tee shots. scorecard.tsx already filters these for its own
    // stats — the dashboard was never given the same guard.
    const fullPool = [...allHistoricalShots, ...allShots].filter(s => !s.id?.startsWith('qs-'));
    const shotsLogged = fullPool.length;
    if (shotsLogged === 0) {
      return { shotsLogged: 0, fairwayPct: 0, avgYds: 0, teeShots: 0 };
    }
    const teeShots = fullPool.filter(s => s.shot_in_hole_index === 1);
    const teeShotCount = teeShots.length;
    // 2026-06-09 (honesty) — only count tee shots with a KNOWN outcome. Treating
    // untracked (outcome == null) shots as "clean" inflated fairway % with
    // missing data. Percentage is now over tracked tee shots only.
    const trackedTeeShots = teeShots.filter(s => s.outcome != null);
    const cleanTeeCount = trackedTeeShots.filter(s => s.outcome === 'clean').length;
    const fairwayPct = trackedTeeShots.length === 0 ? 0 : Math.round((cleanTeeCount / trackedTeeShots.length) * 100);
    const teeWithYds = teeShots.filter((s): s is typeof s & { distance_yards: number } =>
      typeof s.distance_yards === 'number' && s.distance_yards > 0,
    );
    const avgYds = teeWithYds.length === 0
      ? 0
      : Math.round(teeWithYds.reduce((sum, s) => sum + s.distance_yards, 0) / teeWithYds.length);
    return { shotsLogged, fairwayPct, avgYds, teeShots: teeShotCount };
  }, [roundHistory, allShots]);

  // Recent shots — last 5, newest first. Drawn from the active round
  // when one exists, otherwise the most recent historical round.
  const recentShots = useMemo(() => {
    if (allShots.length > 0) return [...allShots].slice(-5).reverse();
    const last = roundHistory[roundHistory.length - 1];
    if (!last) return [];
    return [...last.shots].slice(-5).reverse();
  }, [allShots, roundHistory]);

  // 2026-06-04 — topClubs derivation removed (Kevin's Read inline block
  // that consumed it is replaced by the AI-driven card below).

  // 2026-06-04 — Highlights Card derived stats.
  const derivedLongestDrive = useMemo(() => {
    const fromHistory = roundHistory
      .flatMap(r => r.shots)
      .filter(s => s.club === 'Driver')
      .map(s => s.carry_distance ?? s.distance_yards ?? 0)
      .reduce((max, y) => (y > max ? y : max), 0);
    const fromProfile = longestDrive ?? 0;
    const best = Math.max(fromHistory, fromProfile);
    return best > 0 ? best : null;
  }, [roundHistory, longestDrive]);

  const bestRound = useMemo(() => {
    const completed = roundHistory
      .filter(r => r.totalScore > 0 && r.holesPlayed >= 9)
      .map(r => r.totalScore);
    const fromHistory = completed.length > 0 ? Math.min(...completed) : null;
    if (fromHistory != null && personalBest != null) return Math.min(fromHistory, personalBest);
    return fromHistory ?? personalBest ?? null;
  }, [roundHistory, personalBest]);

  // 2026-06-04 — Kevin's Read regeneration. The card shows the cached
  // text immediately (instant render); tapping fires a fresh API call
  // and the cached text stays visible until the new one lands. No
  // spinner blocks the card per spec.
  const [refreshingKevinRead, setRefreshingKevinRead] = useState(false);
  const refreshKevinRead = useCallback(async () => {
    if (refreshingKevinRead) return;
    setRefreshingKevinRead(true);
    try { await generateKevinRead(); }
    finally { setRefreshingKevinRead(false); }
  }, [refreshingKevinRead]);

  const KEVIN_READ_DEFAULT = 'Swing easy, hit it far. Play one shot at a time.';
  const kevinReadText = kevinRead?.text ?? KEVIN_READ_DEFAULT;
  const kevinReadFooter = useMemo(() => {
    if (!kevinRead?.generatedAt) return 'Tap to generate';
    const completedSince = roundHistory.filter(r => r.endedAt > kevinRead.generatedAt).length;
    if (completedSince === 0) return 'Up to date';
    return `${completedSince} round${completedSince === 1 ? '' : 's'} ago`;
  }, [kevinRead, roundHistory]);

  // Welcome string falls back gracefully if the user never set a name.
  const welcomeName = firstName || name?.split(' ')[0] || 'Player';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, isWide && { alignItems: 'center' }]}
      >
       <View style={isWide ? { width: '100%', maxWidth: WIDE_CONTENT_MAX_WIDTH } : undefined}>
        {/* ─── 1. BRAND HEADER ──────────────────────────────────────── */}
        <BrandHeaderRow />

        {/* ─── 2. TITLE + WELCOME ────────────────────────────────────── */}
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: colors.text_primary }]}>{t('dashboard.title')}</Text>
          <Text style={[styles.welcome, { color: colors.text_muted }]}>
            Welcome back, {welcomeName}
          </Text>
        </View>

        {/* ─── 3. PROFILE CARD ───────────────────────────────────────── */}
        <View style={[styles.profileCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
          {/* 2026-06-11 — tap the identity area to open the Profile screen
              (handicap, GHIN, import history). Gear still goes to Settings. */}
          <TouchableOpacity
            onPress={() => router.push('/profile' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}
          >
            <View style={[styles.avatar, { borderColor: colors.accent, backgroundColor: colors.accent_muted }]}>
              <Text style={[styles.avatarLetter, { color: colors.accent }]}>
                {welcomeName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileText}>
              <Text style={[styles.profileName, { color: colors.text_primary }]} numberOfLines={1}>
                {welcomeName}
              </Text>
              <Text style={[styles.profileMeta, { color: colors.text_muted }]} numberOfLines={1}>
                Handicap {handicap_index != null ? handicap_index.toFixed(1) : (handicap || '—')} · Goal {goal || '—'}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/settings' as never)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            style={[styles.gearBtn, { borderColor: colors.accent }]}
          >
            <Ionicons name="settings-outline" size={18} color={colors.accent} />
          </TouchableOpacity>
        </View>

        {coachModeEnabled && activeFamilyRoster.length > 0 && (
          <View style={[styles.sharedCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
            <View style={styles.sharedHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sharedLabel, { color: colors.text_muted }]}>{t('dashboard.shared_group')}</Text>
                <Text style={[styles.sharedTitle, { color: colors.text_primary }]} numberOfLines={1}>
                  {activeFamilyRoster.length} golfer{activeFamilyRoster.length === 1 ? '' : 's'}
                </Text>
                <Text style={[styles.sharedMeta, { color: colors.text_muted }]} numberOfLines={1}>
                  {activeFamilyMember ? `Active: ${activeFamilyMember.firstName}` : 'Tap a golfer to review swings'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push('/swinglab/coach-mode' as never)}
                style={[styles.sharedAction, { backgroundColor: colors.accent, borderColor: colors.accent }]}
                accessibilityRole="button"
                accessibilityLabel="Open Coach Mode"
              >
                <Text style={styles.sharedActionText}>Coach Mode</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sharedChips}>
              {activeFamilyRoster.map(member => {
                const selected = member.id === activeFamilyMemberId;
                return (
                  <TouchableOpacity
                    key={member.id}
                    onPress={() => router.push(`/swinglab/player-library/${member.id}` as never)}
                    style={[
                      styles.sharedChip,
                      {
                        backgroundColor: selected ? colors.accent_muted : colors.background,
                        borderColor: selected ? colors.accent : colors.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${member.firstName} player library`}
                  >
                    <Text style={[styles.sharedChipName, { color: colors.text_primary }]} numberOfLines={1}>
                      {member.firstName}
                    </Text>
                    <Text style={[styles.sharedChipMeta, { color: colors.text_muted }]} numberOfLines={1}>
                      {member.age != null ? `${member.age}y` : 'shared'}
                      {member.approximate_handicap != null ? ` · HCP ${member.approximate_handicap}` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ─── Selfie + AI portrait — ports v3's "Try a new look" card.
             Routes to Pro's /profile/custom-caddie which handles selfie
             capture → AI image edit → save as profile pic and/or caddie
             portrait. Tim 2026-05-14: "Dashboard is supposed to have the
             ability for user to take selfie and have ai reprocess as their
             profile pic and even the caddie." ───────────────────────── */}
        <TouchableOpacity
          onPress={() => router.push('/profile/custom-caddie' as never)}
          style={[styles.selfieCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Try a new look — selfie + AI portrait"
        >
          <View style={[styles.selfieIcon, { backgroundColor: colors.accent_muted }]}>
            <Ionicons name="sparkles-outline" size={20} color={colors.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.selfieTitle, { color: colors.text_primary }]}>{t('dashboard.try_new_look')}</Text>
            <Text style={[styles.selfieSub, { color: colors.text_muted }]} numberOfLines={1}>
              Selfie + AI — see yourself as your caddie
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
        </TouchableOpacity>

        {/* ─── 4. CURRENT ROUND ──────────────────────────────────────── */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>{t('dashboard.current_round')}</Text>
        {isRoundActive ? (
          <View style={[styles.activeCard, { backgroundColor: colors.surface_elevated, borderColor: colors.accent }]}>
            <View style={styles.activeHeader}>
              <Text style={[styles.activeLabel, { color: colors.accent }]}>{t('dashboard.round_in_progress')}</Text>
              <Text style={[styles.activeCourse, { color: colors.text_primary }]}>{activeCourse}</Text>
            </View>
            <View style={styles.activeStats}>
              <View style={styles.activeStat}>
                <Text style={[styles.activeStatValue, { color: colors.text_primary }]}>
                  {totalScore > 0 ? totalScore : '—'}
                </Text>
                <Text style={[styles.activeStatLabel, { color: colors.text_muted }]}>{t('dashboard.score')}</Text>
              </View>
              <View style={styles.activeStat}>
                <Text style={[
                  styles.activeStatValue,
                  {
                    color:
                      scoreVsPar < 0 ? colors.accent
                      : scoreVsPar === 0 ? colors.text_primary
                      : '#fbbf24',
                  },
                ]}>
                  {holesPlayed > 0 ? scoreVsParDisplay : '—'}
                </Text>
                <Text style={[styles.activeStatLabel, { color: colors.text_muted }]}>{t('dashboard.vs_par')}</Text>
              </View>
              <View style={styles.activeStat}>
                <Text style={[styles.activeStatValue, { color: colors.text_primary }]}>{holesPlayed}</Text>
                <Text style={[styles.activeStatLabel, { color: colors.text_muted }]}>{t('dashboard.holes')}</Text>
              </View>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.noRoundCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
            onPress={() => router.push('/(tabs)/play' as never)}
            accessibilityRole="button"
            accessibilityLabel="Pick a course on the Play tab"
            activeOpacity={0.85}
          >
            <Ionicons name="flag-outline" size={26} color={colors.accent} />
            <View style={styles.noRoundText}>
              <Text style={[styles.noRoundTitle, { color: colors.text_primary }]}>{t('dashboard.no_round')}</Text>
              <Text style={[styles.noRoundSub, { color: colors.text_muted }]}>{t('dashboard.no_round_sub')}</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* ─── 5. WEATHER CARD (round-active only — hook returns null otherwise) ─── */}
        {weather && (
          <View style={[styles.weatherCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
            <View style={styles.weatherLeft}>
              <Text style={[styles.weatherCourse, { color: colors.text_primary }]} numberOfLines={1}>
                {activeCourse ?? 'Current location'}
              </Text>
              <Text style={[styles.weatherDesc, { color: colors.text_muted }]} numberOfLines={1}>
                {weather.conditions ?? '—'}{weather.description ? ` · ${weather.description}` : ''}
              </Text>
            </View>
            <View style={styles.weatherCenter}>
              <Text style={[styles.weatherTemp, { color: colors.accent }]}>
                {weather.temp_f != null ? Math.round(weather.temp_f) : '—'}°
              </Text>
              <Text style={[styles.weatherTempUnit, { color: colors.text_muted }]}>F</Text>
            </View>
            <View style={styles.weatherRight}>
              {/* Wind arrow rotates to meteorological-FROM direction. */}
              {weather.wind_direction_deg != null && (
                <View style={{ transform: [{ rotate: `${weather.wind_direction_deg}deg` }] }}>
                  <Ionicons name="arrow-up" size={28} color={colors.text_muted} />
                </View>
              )}
              <Text style={[styles.weatherWind, { color: colors.text_muted }]}>
                {Math.round(weather.wind_speed_mph)} mph
              </Text>
            </View>
          </View>
        )}

        {/* ─── 6. SHOT STATS — 3 tiles ────────────────────────────────
            2026-05-25 — Fix Y: re-scoped to TEE SHOTS only. Labels
            updated to match: FAIRWAY % is now FAIRWAY HIT %
            (cleanTeeCount/teeShotCount), AVG YDS is now TEE AVG (avg
            distance of tee shots). Tee-shot count surfaces too so a
            single-shot round doesn't look like "100% fairway" with
            no context. When teeShots=0, show dashes instead of 0/0%. */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>{t('dashboard.shot_stats')}</Text>
        <View style={styles.statsRow}>
          <StatTile colors={colors} value={String(shotStats.shotsLogged)} label={t('dashboard.shots_logged')} />
          <StatTile
            colors={colors}
            value={shotStats.teeShots === 0 ? '—' : `${shotStats.fairwayPct}%`}
            label={t('dashboard.fairway_pct')}
          />
          <StatTile
            colors={colors}
            value={shotStats.teeShots === 0 || shotStats.avgYds === 0 ? '—' : String(shotStats.avgYds)}
            label={t('dashboard.tee_avg')}
          />
        </View>

        {/* ─── 7. RECENT SHOTS ─────────────────────────────────────────
            2026-05-25 — Fix X: swapped the plain text list for the new
            ShotTimeline component (icons + outcome chips + distance).
            Same data, richer rendering. Caddie-tab placement comes
            next iteration; for now Dashboard gets the upgrade plus a
            full-round Shot Log entry in the ••• Tools menu. */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>{t('dashboard.recent_shots')}</Text>
        {recentShots.length === 0 ? (
          <Text style={[styles.emptyLine, { color: colors.text_muted }]}>
            No shots logged yet — log a shot from the Caddie tab.
          </Text>
        ) : (
          <ShotTimeline maxRows={5} />
        )}

        {/* 2026-06-04 — Quick Actions row removed. SmartFinder / SmartVision
            / Settings are reachable via the ⋯ pill (GlobalToolsMenu) in the
            top-right of every screen, so duplicating them here was clutter. */}

        {/* ═══════════════════════════════════════════════════════════
            BELOW THE FOLD: Pro's AI surfaces (preserved)
            ═══════════════════════════════════════════════════════════ */}

        {/* PATTERN SHIFT — surface FIRST when active because it's actionable. */}
        {patternShift && (
          <TouchableOpacity
            style={[
              styles.aiCard,
              {
                backgroundColor: colors.surface_elevated,
                borderColor: patternShift.severity === 'significant' ? '#fbbf24' : colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              },
            ]}
            onPress={() => router.push('/(tabs)/swinglab' as never)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Pattern shift detected. ${patternShift.alert_message}`}
          >
            <View style={styles.alertIcon}>
              <AppIcon name="trending-up-outline" size={20} color="#fbbf24" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertLabel}>{t('dashboard.pattern_shift')}</Text>
              <Text style={[styles.alertMsg, { color: colors.text_primary }]}>{patternShift.alert_message}</Text>
            </View>
            <AppIcon name="chevron-forward" size={18} color={colors.text_muted} />
          </TouchableOpacity>
        )}

        {/* KEVIN'S READ — AI prevailing-tendency assessment.
            2026-06-04 — Replaces the old inline stats block (sessions /
            hero shots / milestones / mental state / trusted clubs /
            dominant miss). Tap the card to regenerate; cached text stays
            visible during the request so the card never spinner-blocks. */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={refreshKevinRead}
          style={[styles.aiCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={`Kevin's Read. ${refreshingKevinRead ? 'Refreshing.' : 'Tap to refresh.'}`}
        >
          <View style={styles.kevinReadHeader}>
            <Text style={[styles.aiCardTitle, { color: colors.text_primary }]}>{t('dashboard.kevins_read')}</Text>
            {refreshingKevinRead ? (
              <Text style={[styles.kevinReadFooter, { color: colors.accent }]}>{t('dashboard.refreshing')}</Text>
            ) : null}
          </View>
          <Text style={[styles.kevinReadText, { color: colors.text_primary }]}>{kevinReadText}</Text>
          <Text style={[styles.kevinReadFooter, { color: colors.text_muted }]}>
            {kevinReadFooter} · tap to refresh
          </Text>
        </TouchableOpacity>

        {/* HIGHLIGHTS — 2×2 grid replacing Hero Reel + Progress.
            2026-06-04 — Best Round, Longest Drive, Longest Putt, Saved
            Highlights. "—" renders when a stat is null (never show 0
            for drive/putt; 0 is meaningless, — is honest). */}
        <View style={[styles.aiCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
          <Text style={[styles.aiCardTitle, { color: colors.text_primary }]}>{t('dashboard.highlights')}</Text>
          <View style={styles.highlightsGrid}>
            <View style={styles.highlightCell}>
              <Text style={[styles.highlightLabel, { color: colors.text_muted }]}>{t('dashboard.best_round')}</Text>
              <Text style={[styles.highlightValue, { color: colors.text_primary }]}>{bestRound ?? '—'}</Text>
            </View>
            <View style={styles.highlightCell}>
              <Text style={[styles.highlightLabel, { color: colors.text_muted }]}>{t('dashboard.longest_drive')}</Text>
              <Text style={[styles.highlightValue, { color: colors.text_primary }]}>
                {derivedLongestDrive != null ? `${derivedLongestDrive}y` : '—'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.highlightCell}
              activeOpacity={0.7}
              onPress={() => {
                if (longestPutt == null) router.push('/settings' as never);
              }}
              accessibilityRole="button"
              accessibilityLabel={longestPutt == null ? 'Set longest putt in Settings' : `Longest putt ${longestPutt} yards`}
            >
              <Text style={[styles.highlightLabel, { color: colors.text_muted }]}>{t('dashboard.longest_putt')}</Text>
              <Text style={[styles.highlightValue, { color: colors.text_primary }]}>
                {longestPutt != null ? `${longestPutt}y` : '—'}
              </Text>
            </TouchableOpacity>
            <View style={styles.highlightCell}>
              <Text style={[styles.highlightLabel, { color: colors.text_muted }]}>{t('dashboard.saved_highlights')}</Text>
              <Text style={[styles.highlightValue, { color: '#F5A623' }]}>
                {heroMoments.length > 0 ? `★ ${heroMoments.length}` : '—'}
              </Text>
            </View>
          </View>
        </View>

        {/* MILESTONES (last 3) */}
        {breakthroughs.length > 0 && (
          <View style={[styles.aiCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
            <Text style={[styles.aiCardTitle, { color: colors.text_primary }]}>{t('dashboard.milestones')}</Text>
            {[...breakthroughs].slice(-3).reverse().map((bt) => (
              <View key={bt.id} style={styles.btItem}>
                <AppIcon name="trophy" size={18} color="#F5A623" />
                <Text style={[styles.btText, { color: colors.text_primary }]}>{bt.description}</Text>
              </View>
            ))}
          </View>
        )}

        {/* EMPTY STATE — no rounds yet */}
        {roundsTogether === 0 && (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: colors.text_primary }]}>{t('dashboard.no_rounds')}</Text>
            <Text style={[styles.emptySub, { color: colors.text_muted }]}>
              {t('dashboard.no_rounds_sub')}
            </Text>
          </View>
        )}
       </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Small inline components ─────────────────────────────────────────

function StatTile({
  colors,
  value,
  label,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  value: string;
  label: string;
}) {
  return (
    <View style={[styles.statTile, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
      <Text style={[styles.statTileValue, { color: colors.accent }]}>{value}</Text>
      <Text style={[styles.statTileLabel, { color: colors.text_muted }]}>{label}</Text>
    </View>
  );
}

// 2026-06-04 — QuickAction component removed alongside the Quick Actions
// row (SmartFinder / SmartVision / Settings are reachable via the ⋯ pill).

// ─── STYLES ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    paddingBottom: 48,
    flexGrow: 1,
  },
  // Brand block (header)
  brandWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 12,
  },
  brandBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  brandTitleBlock: {
    flex: 1,
  },
  brandWordmarkRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  brandName1: { fontSize: 18, fontWeight: '800', letterSpacing: 2.5 },
  brandName2: { fontSize: 18, fontWeight: '800', letterSpacing: 2.5 },
  brandTagline: { fontSize: 10, fontWeight: '500', letterSpacing: 1.4, marginTop: 2 },
  // Title + welcome
  titleBlock: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: { fontSize: 28, fontWeight: '900' },
  welcome: { fontSize: 14, marginTop: 4 },
  // Profile card
  profileCard: {
    marginHorizontal: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 20, fontWeight: '800' },
  profileText: { flex: 1, minWidth: 0 },
  profileName: { fontSize: 17, fontWeight: '800' },
  profileMeta: { fontSize: 13, marginTop: 2 },
  gearBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Shared group card
  sharedCard: {
    marginHorizontal: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  sharedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sharedLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3, marginBottom: 2 },
  sharedTitle: { fontSize: 16, fontWeight: '800' },
  sharedMeta: { fontSize: 12, marginTop: 2 },
  sharedAction: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  sharedActionText: { color: '#04140c', fontSize: 12, fontWeight: '800' },
  sharedChips: {
    gap: 10,
    paddingTop: 12,
  },
  sharedChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 110,
  },
  sharedChipName: { fontSize: 13, fontWeight: '800' },
  sharedChipMeta: { fontSize: 11, marginTop: 2 },
  // Selfie + AI portrait card — ported from v3.
  selfieCard: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selfieIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfieTitle: { fontSize: 15, fontWeight: '700' },
  selfieSub: { fontSize: 12, marginTop: 2 },
  // Section header
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
  },
  // Active round card
  activeCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
  },
  activeHeader: { marginBottom: 10 },
  activeLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 2 },
  activeCourse: { fontSize: 16, fontWeight: '700' },
  activeStats: { flexDirection: 'row' },
  activeStat: { flex: 1, alignItems: 'center' },
  activeStatValue: { fontSize: 28, fontWeight: '900' },
  activeStatLabel: { fontSize: 11, marginTop: 2 },
  // No-round CTA
  noRoundCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  noRoundText: { flex: 1 },
  noRoundTitle: { fontSize: 15, fontWeight: '700' },
  noRoundSub: { fontSize: 12, marginTop: 2 },
  // Weather
  weatherCard: {
    marginHorizontal: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  weatherLeft: { flex: 1, minWidth: 0 },
  weatherCourse: { fontSize: 15, fontWeight: '700' },
  weatherDesc: { fontSize: 12, marginTop: 2 },
  weatherCenter: { alignItems: 'flex-end', marginHorizontal: 12 },
  weatherTemp: { fontSize: 32, fontWeight: '900', lineHeight: 36 },
  weatherTempUnit: { fontSize: 11, marginTop: -2 },
  weatherRight: { alignItems: 'center', gap: 2, minWidth: 64 },
  weatherWind: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  // Stat tiles
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 6,
  },
  statTile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 4,
  },
  statTileValue: { fontSize: 28, fontWeight: '900' },
  statTileLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  // Recent shots
  emptyLine: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontStyle: 'italic',
    fontSize: 13,
  },
  recentList: {
    marginHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  recentItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  recentLeft: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  recentRight: { fontSize: 12, flexShrink: 1, textAlign: 'right' },
  // Quick actions
  quickRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 12,
  },
  quickBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 6,
  },
  quickLabel: { fontSize: 13, fontWeight: '700' },
  // AI cards (Pro's preserved sections below the fold)
  aiCard: {
    marginHorizontal: 12,
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  aiCardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 10 },
  // 2026-06-04 — Kevin's Read AI card.
  kevinReadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  kevinReadText: { fontSize: 14, lineHeight: 21, fontWeight: '500' },
  kevinReadFooter: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, marginTop: 8 },
  // 2026-06-04 — Highlights 2×2 grid.
  highlightsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  highlightCell: {
    width: '50%',
    paddingVertical: 10,
  },
  highlightLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, marginBottom: 4 },
  highlightValue: { fontSize: 24, fontWeight: '900' },
  aiStatRow: { flexDirection: 'row' },
  aiStat: { flex: 1, alignItems: 'center' },
  aiStatValue: { fontSize: 22, fontWeight: '900' },
  aiStatLabel: { fontSize: 11, marginTop: 2 },
  alertIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(251,191,36,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertLabel: { color: '#fbbf24', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  alertMsg: { fontSize: 13, fontWeight: '600', marginTop: 4, lineHeight: 18 },
  mentalRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mentalLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  mentalValue: { fontSize: 14, fontWeight: '700' },
  clubRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 6,
  },
  clubRowLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  clubPills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  clubPill: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  clubPillText: { fontSize: 12, fontWeight: '700' },
  clubPillConf: { fontSize: 12, fontWeight: '800' },
  aiInline: { fontSize: 13, fontWeight: '600' },
  // Hero reel
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  heroCount: { fontSize: 11, fontWeight: '700' },
  heroItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  heroStarBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStarText: { color: '#060f09', fontSize: 14, fontWeight: '900' },
  heroInfo: { flex: 1, minWidth: 0 },
  heroHole: { fontSize: 13, fontWeight: '700' },
  heroCourse: { fontSize: 11, marginTop: 1 },
  heroKevin: { fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  heroDate: { fontSize: 11 },
  heroEmpty: { fontSize: 12, fontStyle: 'italic', paddingVertical: 4 },
  // Milestones
  btItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  btText: { fontSize: 13, flex: 1 },
  // Empty state
  emptyState: { padding: 32, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  emptySub: { fontSize: 13, textAlign: 'center' },
});
