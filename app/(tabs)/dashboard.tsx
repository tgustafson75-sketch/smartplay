/**
 * Dashboard tab — v3 visual layout + Pro's AI cards preserved.
 *
 * Tonight's port (2026-05-13):
 *   - TOP-HALF mirrors v3 (cleaner, more scannable):
 *       BrandBlock → Title + Welcome → Profile card → Current Round
 *       → Weather → Shot Stats tiles → Recent Shots → Quick Actions.
 *   - BOTTOM-HALF preserves Pro's AI surfaces:
 *       Kevin's Read → Pattern Shift alert → Hero Reel → Milestones
 *       → Progress (Points + Tier).
 *
 * All data sources are Pro's existing ones (roundStore, relationshipStore,
 * playerProfileStore, pointsStore, useCurrentWeather). NO store changes.
 * NO migrations. Pure render-layer reorganization.
 *
 * Non-developer note: this file changed shape but every number and quote
 * still comes from the same store the old dashboard read from. If Kevin's
 * Read or the Hero Reel ever shows wrong data, the fix is in the
 * underlying store, not here.
 */

import React, { useMemo } from 'react';
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
import { Ionicons } from '@expo/vector-icons';

import { useRoundStore } from '../../store/roundStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { usePointsStore } from '../../store/pointsStore';
import { useTheme } from '../../contexts/ThemeContext';
import { detectPatternShift } from '../../services/patternDetection';
import { useCurrentWeather } from '../../hooks/useCurrentWeather';
import AppIcon from '../../components/AppIcon';
import { BrandHeaderRow } from '../../components/brand/BrandHeaderRow';

export default function Dashboard() {
  const router = useRouter();
  const { colors } = useTheme();

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

  // ─── Relationship + profile + points ─────────────────────────────
  const {
    roundsTogether,
    sessionsTogether,
    heroMoments,
    breakthroughs,
    confidenceByClub,
    currentMentalState,
  } = useRelationshipStore(
    useShallow((s) => ({
      roundsTogether: s.roundsTogether,
      sessionsTogether: s.sessionsTogether,
      heroMoments: s.heroMoments,
      breakthroughs: s.breakthroughs,
      confidenceByClub: s.confidenceByClub,
      currentMentalState: s.currentMentalState,
    })),
  );

  const {
    firstName,
    name,
    handicap,
    handicap_index,
    personalBest,
    goal,
    dominantMiss,
  } = usePlayerProfileStore(
    useShallow((s) => ({
      firstName: s.firstName,
      name: s.name,
      handicap: s.handicap,
      handicap_index: s.handicap_index,
      personalBest: s.personalBest,
      goal: s.goal,
      dominantMiss: s.dominantMiss,
    })),
  );

  const { totalPoints, tier } = usePointsStore(
    useShallow((s) => ({ totalPoints: s.totalPoints, tier: s.tier })),
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
  // Pro's ShotResult doesn't have an explicit 'fairway' outcome — the closest
  // proxy is `outcome === 'clean'` (i.e. not a penalty). Until Pro adds
  // explicit fairway tracking, "Fairway %" displays the clean-shot rate.
  // distance_yards comes from the conversational logging path; older shots
  // without it are skipped from the average.
  const shotStats = useMemo(() => {
    const allHistoricalShots = roundHistory.flatMap((r) => r.shots);
    const fullPool = [...allHistoricalShots, ...allShots];
    const shotsLogged = fullPool.length;
    if (shotsLogged === 0) {
      return { shotsLogged: 0, fairwayPct: 0, avgYds: 0 };
    }
    const cleanCount = fullPool.filter((s) => s.outcome === 'clean' || s.outcome == null).length;
    const fairwayPct = Math.round((cleanCount / shotsLogged) * 100);
    const withYds = fullPool.filter((s): s is typeof s & { distance_yards: number } =>
      typeof s.distance_yards === 'number' && s.distance_yards > 0,
    );
    const avgYds = withYds.length === 0
      ? 0
      : Math.round(withYds.reduce((sum, s) => sum + s.distance_yards, 0) / withYds.length);
    return { shotsLogged, fairwayPct, avgYds };
  }, [roundHistory, allShots]);

  // Recent shots — last 5, newest first. Drawn from the active round
  // when one exists, otherwise the most recent historical round.
  const recentShots = useMemo(() => {
    if (allShots.length > 0) return [...allShots].slice(-5).reverse();
    const last = roundHistory[roundHistory.length - 1];
    if (!last) return [];
    return [...last.shots].slice(-5).reverse();
  }, [allShots, roundHistory]);

  const topClubs = Object.entries(confidenceByClub)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  // Welcome string falls back gracefully if the user never set a name.
  const welcomeName = firstName || name?.split(' ')[0] || 'Player';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* ─── 1. BRAND HEADER ──────────────────────────────────────── */}
        <BrandHeaderRow />

        {/* ─── 2. TITLE + WELCOME ────────────────────────────────────── */}
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: colors.text_primary }]}>Dashboard</Text>
          <Text style={[styles.welcome, { color: colors.text_muted }]}>
            Welcome back, {welcomeName}
          </Text>
        </View>

        {/* ─── 3. PROFILE CARD ───────────────────────────────────────── */}
        <View style={[styles.profileCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
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
            <Text style={[styles.selfieTitle, { color: colors.text_primary }]}>Try a new look</Text>
            <Text style={[styles.selfieSub, { color: colors.text_muted }]} numberOfLines={1}>
              Selfie + AI — see yourself as your caddie
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
        </TouchableOpacity>

        {/* ─── 4. CURRENT ROUND ──────────────────────────────────────── */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>CURRENT ROUND</Text>
        {isRoundActive ? (
          <View style={[styles.activeCard, { backgroundColor: colors.surface_elevated, borderColor: colors.accent }]}>
            <View style={styles.activeHeader}>
              <Text style={[styles.activeLabel, { color: colors.accent }]}>● ROUND IN PROGRESS</Text>
              <Text style={[styles.activeCourse, { color: colors.text_primary }]}>{activeCourse}</Text>
            </View>
            <View style={styles.activeStats}>
              <View style={styles.activeStat}>
                <Text style={[styles.activeStatValue, { color: colors.text_primary }]}>
                  {totalScore > 0 ? totalScore : '—'}
                </Text>
                <Text style={[styles.activeStatLabel, { color: colors.text_muted }]}>Score</Text>
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
                <Text style={[styles.activeStatLabel, { color: colors.text_muted }]}>Vs Par</Text>
              </View>
              <View style={styles.activeStat}>
                <Text style={[styles.activeStatValue, { color: colors.text_primary }]}>{holesPlayed}</Text>
                <Text style={[styles.activeStatLabel, { color: colors.text_muted }]}>Holes</Text>
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
              <Text style={[styles.noRoundTitle, { color: colors.text_primary }]}>No round in progress</Text>
              <Text style={[styles.noRoundSub, { color: colors.text_muted }]}>Pick a course on the Play tab to start →</Text>
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

        {/* ─── 6. SHOT STATS — 3 tiles ──────────────────────────────── */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>SHOT STATS</Text>
        <View style={styles.statsRow}>
          <StatTile colors={colors} value={String(shotStats.shotsLogged)} label="SHOTS LOGGED" />
          <StatTile colors={colors} value={`${shotStats.fairwayPct}%`} label="FAIRWAY %" />
          <StatTile colors={colors} value={String(shotStats.avgYds)} label="AVG YDS" />
        </View>

        {/* ─── 7. RECENT SHOTS ───────────────────────────────────────── */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>RECENT SHOTS</Text>
        {recentShots.length === 0 ? (
          <Text style={[styles.emptyLine, { color: colors.text_muted }]}>
            No shots logged yet — log a shot from the Caddie tab.
          </Text>
        ) : (
          <View style={[styles.recentList, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
            {recentShots.map((shot, idx) => (
              <View
                key={shot.id ?? `${shot.timestamp}-${idx}`}
                style={[styles.recentItem, idx > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
              >
                <Text style={[styles.recentLeft, { color: colors.text_primary }]}>
                  Hole {shot.hole}{shot.club ? ` · ${shot.club}` : ''}
                </Text>
                <Text style={[styles.recentRight, { color: colors.text_muted }]}>
                  {shot.distance_yards != null ? `${shot.distance_yards}y` : ''}
                  {shot.outcome_text ? ` · ${shot.outcome_text}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ─── 8. QUICK ACTIONS — 3 icon buttons ────────────────────── */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>QUICK ACTIONS</Text>
        <View style={styles.quickRow}>
          <QuickAction colors={colors} icon="locate-outline" label="SmartFinder" onPress={() => router.push('/smartfinder' as never)} />
          <QuickAction colors={colors} icon="eye-outline" label="SmartVision" onPress={() => router.push('/smartvision' as never)} />
          <QuickAction colors={colors} icon="settings-outline" label="Settings" onPress={() => router.push('/settings' as never)} />
        </View>

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
              <Text style={styles.alertLabel}>PATTERN SHIFT</Text>
              <Text style={[styles.alertMsg, { color: colors.text_primary }]}>{patternShift.alert_message}</Text>
            </View>
            <AppIcon name="chevron-forward" size={18} color={colors.text_muted} />
          </TouchableOpacity>
        )}

        {/* KEVIN'S READ */}
        <View style={[styles.aiCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
          <Text style={[styles.aiCardTitle, { color: colors.text_primary }]}>Kevin&apos;s Read</Text>
          <View style={styles.aiStatRow}>
            <View style={styles.aiStat}>
              <Text style={[styles.aiStatValue, { color: colors.text_primary }]}>{sessionsTogether}</Text>
              <Text style={[styles.aiStatLabel, { color: colors.text_muted }]}>Sessions</Text>
            </View>
            <View style={styles.aiStat}>
              <Text style={[styles.aiStatValue, { color: '#F5A623' }]}>{heroMoments.length}</Text>
              <Text style={[styles.aiStatLabel, { color: colors.text_muted }]}>Hero Shots</Text>
            </View>
            <View style={styles.aiStat}>
              <Text style={[styles.aiStatValue, { color: colors.accent }]}>{breakthroughs.length}</Text>
              <Text style={[styles.aiStatLabel, { color: colors.text_muted }]}>Milestones</Text>
            </View>
          </View>
          <View style={[styles.mentalRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.mentalLabel, { color: colors.text_muted }]}>MENTAL STATE</Text>
            <Text style={[
              styles.mentalValue,
              {
                color:
                  currentMentalState === 'confident' ? colors.accent
                  : currentMentalState === 'spiraling' ? colors.error
                  : currentMentalState === 'tight' ? '#fbbf24'
                  : colors.text_muted,
              },
            ]}>
              {currentMentalState.charAt(0).toUpperCase() + currentMentalState.slice(1)}
            </Text>
          </View>
          {topClubs.length > 0 && (
            <View style={[styles.clubRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.clubRowLabel, { color: colors.text_muted }]}>TRUSTED CLUBS</Text>
              <View style={styles.clubPills}>
                {topClubs.map(([club, conf]) => (
                  <View key={club} style={[styles.clubPill, { borderColor: colors.accent, backgroundColor: colors.accent_muted }]}>
                    <Text style={[styles.clubPillText, { color: colors.text_primary }]}>{club}</Text>
                    <Text style={[styles.clubPillConf, { color: colors.accent }]}>
                      {Math.round(conf * 100)}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          {dominantMiss && (
            <View style={[styles.clubRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.clubRowLabel, { color: colors.text_muted }]}>DOMINANT MISS</Text>
              <Text style={[styles.aiInline, { color: colors.text_primary }]}>{dominantMiss}</Text>
            </View>
          )}
        </View>

        {/* HERO REEL */}
        <View style={[styles.aiCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
          <View style={styles.heroHeader}>
            <Text style={[styles.aiCardTitle, { color: colors.text_primary }]}>Hero Reel</Text>
            {heroMoments.length > 0 && (
              <Text style={[styles.heroCount, { color: colors.text_muted }]}>★ {heroMoments.length} saved</Text>
            )}
          </View>
          {[...heroMoments]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 5)
            .map((moment) => (
              <View key={moment.id} style={styles.heroItem}>
                <View style={[styles.heroStarBadge, { backgroundColor: '#F5A623' }]}>
                  <Text style={styles.heroStarText}>★</Text>
                </View>
                <View style={styles.heroInfo}>
                  <Text style={[styles.heroHole, { color: colors.text_primary }]}>
                    Hole {moment.hole} · {moment.club}
                  </Text>
                  <Text style={[styles.heroCourse, { color: colors.text_muted }]}>
                    {moment.courseName || 'Practice'}
                  </Text>
                  <Text style={[styles.heroKevin, { color: colors.accent }]}>
                    &quot;{moment.kevinSaid}&quot;
                  </Text>
                </View>
                <Text style={[styles.heroDate, { color: colors.text_muted }]}>
                  {new Date(moment.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
              </View>
            ))}
          {heroMoments.length === 0 && (
            <Text style={[styles.heroEmpty, { color: colors.text_muted }]}>
              Say &quot;Kevin did you get that?&quot; after a pure shot to save it.
            </Text>
          )}
        </View>

        {/* MILESTONES (last 3) */}
        {breakthroughs.length > 0 && (
          <View style={[styles.aiCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
            <Text style={[styles.aiCardTitle, { color: colors.text_primary }]}>Milestones</Text>
            {[...breakthroughs].slice(-3).reverse().map((bt) => (
              <View key={bt.id} style={styles.btItem}>
                <AppIcon name="trophy" size={18} color="#F5A623" />
                <Text style={[styles.btText, { color: colors.text_primary }]}>{bt.description}</Text>
              </View>
            ))}
          </View>
        )}

        {/* PROGRESS — Points + Tier */}
        <View style={[styles.aiCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
          <Text style={[styles.aiCardTitle, { color: colors.text_primary }]}>Progress</Text>
          <View style={styles.aiStatRow}>
            <View style={styles.aiStat}>
              <Text style={[styles.aiStatValue, { color: '#F5A623' }]}>{totalPoints}</Text>
              <Text style={[styles.aiStatLabel, { color: colors.text_muted }]}>Points</Text>
            </View>
            <View style={[styles.aiStat, { flex: 2 }]}>
              <Text style={[styles.aiStatValue, { fontSize: 16, color: colors.accent }]}>{tier}</Text>
              <Text style={[styles.aiStatLabel, { color: colors.text_muted }]}>Tier</Text>
            </View>
            <View style={styles.aiStat}>
              <Text style={[styles.aiStatValue, { color: colors.text_primary }]}>{personalBest ?? '—'}</Text>
              <Text style={[styles.aiStatLabel, { color: colors.text_muted }]}>Best Round</Text>
            </View>
          </View>
        </View>

        {/* EMPTY STATE — no rounds yet */}
        {roundsTogether === 0 && (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: colors.text_primary }]}>No rounds yet</Text>
            <Text style={[styles.emptySub, { color: colors.text_muted }]}>
              Start your first round with Kevin to see your stats here.
            </Text>
          </View>
        )}
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

function QuickAction({
  colors,
  icon,
  label,
  onPress,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.quickBtn, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={24} color={colors.accent} />
      <Text style={[styles.quickLabel, { color: colors.text_primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

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
