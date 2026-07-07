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

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useCustomCaddieMediaStore } from '../../store/customCaddieMediaStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useRoundStore } from '../../store/roundStore';
import { usePracticePointsStore } from '../../store/practicePointsStore';
import { usePointsStore } from '../../store/pointsStore';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { computePracticeImpact } from '../../services/practice/practiceImpact';
import { useClubStatsStore, CLUB_ORDER } from '../../store/clubStatsStore';
import { computePointsPerformance } from '../../services/practice/pointsPerformance';
import { computeWorkoutPerformance } from '../../services/practice/workoutPerformance';
import { useCageStore } from '../../store/cageStore';
import { usePointsBaselineStore } from '../../store/pointsBaselineStore';
import { useWorkoutStore } from '../../store/workoutStore';
import TrendChart from '../../components/charts/TrendChart';
import { getDrillEntry } from '../../data/drillCatalog';
import { loadRecap } from '../../services/planStorage';
import { useRelationshipStore } from '../../store/relationshipStore';
import ShotTimeline from '../../components/caddie/ShotTimeline';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useFamilyStore } from '../../store/familyStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getCaddieName } from '../../lib/persona';
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
  const { width: screenW } = useWindowDimensions();
  // Chart width = screen minus card h-margins (12+12) and card h-padding (14+14).
  const chartW = Math.max(180, screenW - 52);

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
  // 2026-07-06 (elite audit P1) — sim rounds are persisted (tagged simulated)
  // but must NEVER feed real stats: trend, streak, impact graphs, pattern
  // shift, lifetime shots, longest drive, best round. One filtered view used
  // by every aggregation below; the recent-rounds LIST still shows them (they
  // are honest records of a sim session, not stats).
  const realRounds = useMemo(() => roundHistory.filter((r) => !r.simulated), [roundHistory]);
  const deleteRound = useRoundStore((s) => s.deleteRound);
  const allShots = useRoundStore((s) => s.shots);
  // Conservative practice points (per-drill), surfaced here. The data is the
  // practice side of the future practice→on-course-improvement ledger.
  const practiceTotal = usePracticePointsStore((s) => s.total);
  const practiceByDrill = usePracticePointsStore((s) => s.byDrill);
  const topDrills = useMemo(
    () => Object.entries(practiceByDrill).sort((a, b) => b[1].points - a[1].points).slice(0, 4),
    [practiceByDrill],
  );
  // 2026-06-14 (Tim — practice history) — recent practice sessions for the dashboard
  // list (tap → /practice/[sessionId] for the per-club striation + tempo trend).
  const practiceHistory = usePracticeSessionStore((s) => s.history);
  const recentSessions = useMemo(() => practiceHistory.slice(0, 6), [practiceHistory]);

  // 2026-06-15 (Tim — My Bag back on the dashboard) — the clubs with a REAL carry
  // (tracked OR stated), longest→shortest. Feeds the dashboard bag card; tap → the
  // editable Fit Profile. Recompute when tracked stats or the stated bag change.
  const clubManual = useClubStatsStore((s) => s.manual);
  // 2026-06-16 (Tim) — the dashboard profile icon. A custom-caddie portrait can be
  // applied here as just your picture, separate from activating the custom caddie.
  const profilePortraitB64 = useCustomCaddieMediaStore((s) => s.profilePortraitB64);
  // 2026-06-16 (Tim — mockup SHOT STATS 4th tile) — honest score trend = avg
  // score-vs-par over the last few rounds. Null (→ "—") until there's history.
  const scoreTrend = useMemo(() => {
    const recent = realRounds.filter((r) => typeof r.scoreVsPar === 'number').slice(-5);
    if (recent.length === 0) return null;
    return recent.reduce((a, r) => a + (r.scoreVsPar ?? 0), 0) / recent.length;
  }, [realRounds]);
  // 2026-06-30 (Tim — audit) — visible TIER/LEVEL + points. Every caddie chat, swing
  // and practice awards points and climbs a tier, but it was rendered NOWHERE after the
  // Progress card was removed. Surface a compact header chip so it's finally visible.
  const totalPoints = usePointsStore(s => s.totalPoints);
  const playerTier = usePointsStore(s => s.tier);
  // 2026-06-16 (Tim — "streaks as a metric in the app") — the player's OWN day streak:
  // consecutive calendar days with ANY activity (a round OR a practice session),
  // anchored at today/yesterday else 0. Honest, from real dates. (See [[streak-metric]].)
  const dayStreak = useMemo(() => {
    const DAY = 86400000;
    const times: number[] = [];
    for (const r of realRounds) { const tt = r.endedAt ?? r.startedAt; if (typeof tt === 'number') times.push(tt); }
    for (const p of practiceHistory) { if (typeof p.startedAt === 'number') times.push(p.startedAt); }
    if (times.length === 0) return 0;
    const days = Array.from(new Set(times.map((tm) => { const d = new Date(tm); d.setHours(0, 0, 0, 0); return d.getTime(); }))).sort((a, b) => b - a);
    const today = new Date(); today.setHours(0, 0, 0, 0); const t0 = today.getTime();
    if (days[0] !== t0 && days[0] !== t0 - DAY) return 0;
    let streak = 1;
    for (let i = 1; i < days.length; i++) { if (days[i] === days[i - 1] - DAY) streak++; else break; }
    return streak;
  }, [realRounds, practiceHistory]);
  const clubStats = useClubStatsStore((s) => s.stats);
  const bagClubs = useMemo(() => {
    const st = useClubStatsStore.getState();
    return CLUB_ORDER
      .filter((c) => c !== 'Putter' && st.hasDistance(c))
      .map((c) => ({ club: c, yards: Math.round(st.distanceFor(c)), measured: st.hasSamples(c) }))
      .sort((a, b) => b.yards - a.yards);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubManual, clubStats]);
  // 2026-06-14 (Tim — phase 3) — the honest practice→course connection: practice
  // volume per week vs score-vs-par per round. Association, never causation.
  const practiceImpact = useMemo(
    () => computePracticeImpact({
      sessions: practiceHistory.map((s) => ({ startedAt: s.startedAt, balls: s.swingCount ?? s.swings.length })),
      rounds: realRounds.map((r) => ({ endedAt: r.endedAt, scoreVsPar: r.scoreVsPar })),
      nowMs: Date.now(),
    }),
    [practiceHistory, realRounds],
  );

  // 2026-06-15 (Tim — estimated points from the swing library + the point/performance
  // graph) — every library capture is practice that never earned points; estimate
  // them (conservative, labeled) and pair points/week vs score-vs-par. Honest first
  // version: association, never causation. [[points-practice-correlation]]
  const libraryHistory = useCageStore((s) => s.sessionHistory);
  // 2026-06-15 (Tim) — run LIVE from a clean baseline so the graph builds up as new
  // practice lands; re-estimate the historical start later (setBaseline). Set once.
  const pointsBaselineMs = usePointsBaselineStore((s) => s.baselineMs);
  useEffect(() => { usePointsBaselineStore.getState().ensureBaseline(Date.now()); }, []);
  const pointsPerf = useMemo(
    () => computePointsPerformance({
      sessions: (libraryHistory ?? [])
        .filter((s) => (s.shots?.length ?? 0) > 0)
        .map((s) => ({ startedAt: s.date, swings: s.shots.length })),
      rounds: realRounds.map((r) => ({ endedAt: r.endedAt, scoreVsPar: r.scoreVsPar })),
      nowMs: Date.now(),
      sinceMs: pointsBaselineMs ?? undefined, // clean-start baseline (live build)
    }),
    [libraryHistory, realRounds, pointsBaselineMs],
  );

  // 2026-07-07 (Tim — SmartPump third rail) — imported golf-workout volume per week
  // vs. score-vs-par per round. Third correlation rail alongside practice + points.
  // Honest: association, never causation; quiet until enough on both sides.
  const workoutHistory = useWorkoutStore((s) => s.history);
  const workoutPerf = useMemo(
    () => computeWorkoutPerformance({
      workouts: (workoutHistory ?? []).map((w) => ({ date: w.date, durationMin: w.durationMin })),
      rounds: realRounds.map((r) => ({ endedAt: r.endedAt, scoreVsPar: r.scoreVsPar })),
      nowMs: Date.now(),
    }),
    [workoutHistory, realRounds],
  );

  // 2026-06-13 (Tim) — one-time backfill of a deterministic caddie summary onto past
  // IN-APP rounds that predate the recap feature (Golfshot imports excluded).
  // Idempotent; no-op once every in-app round has a summary.
  useEffect(() => { useRoundStore.getState().backfillRoundSummaries(); }, []);

  // 2026-06-13 (Tim) — carry the caddie's round summary to the dashboard. The recap
  // (overall_kevin_summary) is stored per-round in planStorage; load it for the
  // visible Recent Rounds rows so each shows the caddie's read, not just the score.
  const [recapSummaries, setRecapSummaries] = useState<Record<string, string>>({});
  // 2026-06-30 (Tim — dashboard "Maximum update depth" crash after ending a round) — depend
  // on a STABLE id-key, not the roundHistory ARRAY REF. If roundHistory's reference churns
  // (same rounds, new array) this effect used to re-fire every render → setState → re-render
  // → loop. A joined id-string is value-compared, so a ref-only change no longer re-fires it.
  const recentRoundIdsKey = useMemo(
    () => [...roundHistory].reverse().slice(0, 6).map((r) => r.id).join(','),
    [roundHistory],
  );
  useEffect(() => {
    let cancelled = false;
    const ids = recentRoundIdsKey ? recentRoundIdsKey.split(',') : [];
    void Promise.all(ids.map(async (id) => {
      try { const rec = await loadRecap(id); return [id, rec?.overall_kevin_summary ?? ''] as const; }
      catch { return [id, ''] as const; }
    })).then((pairs) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [id, s] of pairs) if (s) map[id] = s;
      setRecapSummaries(map);
    });
    return () => { cancelled = true; };
  }, [recentRoundIdsKey]);

  // Phase U — pattern shift surfacing.
  const patternShift = useMemo(
    () => detectPatternShift(realRounds.map((r) => ({ shots: r.shots }))),
    [realRounds],
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
  // 2026-06-12 — the AI-read card title must reflect the ACTIVE caddie, not always
  // "Kevin" (Tank/Serena users saw Kevin's name). Keep the localized label for the
  // default kevin case; use the caddie's name otherwise.
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const caddieReadLabel = caddiePersonality === 'kevin'
    ? t('dashboard.kevins_read')
    : `${getCaddieName(caddiePersonality)}'s Read`;
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
    const allHistoricalShots = realRounds.flatMap((r) => r.shots);
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
  }, [realRounds, allShots]);

  // Recent shots — last 5, newest first. Drawn from the active round
  // when one exists, otherwise the most recent historical round.
  const recentShots = useMemo(() => {
    if (allShots.length > 0) return [...allShots].slice(-5).reverse();
    const last = realRounds[realRounds.length - 1];
    if (!last) return [];
    return [...last.shots].slice(-5).reverse();
  }, [allShots, realRounds]);

  // 2026-06-04 — topClubs derivation removed (Kevin's Read inline block
  // that consumed it is replaced by the AI-driven card below).

  // 2026-06-04 — Highlights Card derived stats.
  const derivedLongestDrive = useMemo(() => {
    // 2026-06-30 (Tim — long drive showed ~7000y = the whole-course total, from a failed
    // capture leaking the course yardage into a shot). No human drive exceeds ~500y, so
    // anything above that is a corrupt capture — drop it. This also self-resets a bad value.
    const MAX_REAL_DRIVE = 500;
    const fromHistory = realRounds
      .flatMap(r => r.shots)
      .filter(s => s.club === 'Driver')
      .map(s => s.carry_distance ?? s.distance_yards ?? 0)
      .filter(y => y > 0 && y <= MAX_REAL_DRIVE)
      .reduce((max, y) => (y > max ? y : max), 0);
    const fromProfile = (longestDrive != null && longestDrive <= MAX_REAL_DRIVE) ? longestDrive : 0;
    const best = Math.max(fromHistory, fromProfile);
    return best > 0 ? best : null;
  }, [realRounds, longestDrive]);

  const bestRound = useMemo(() => {
    const completed = realRounds
      .filter(r => r.totalScore > 0 && r.holesPlayed >= 9)
      .map(r => r.totalScore);
    const fromHistory = completed.length > 0 ? Math.min(...completed) : null;
    if (fromHistory != null && personalBest != null) return Math.min(fromHistory, personalBest);
    return fromHistory ?? personalBest ?? null;
  }, [realRounds, personalBest]);

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
    const completedSince = realRounds.filter(r => r.endedAt > kevinRead.generatedAt).length;
    if (completedSince === 0) return 'Up to date';
    return `${completedSince} round${completedSince === 1 ? '' : 's'} ago`;
  }, [kevinRead, realRounds]);

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
          <View style={styles.welcomeRow}>
            <Text style={[styles.welcome, { color: colors.text_muted }]}>
              Welcome back, {welcomeName}
            </Text>
            {dayStreak > 0 && (
              <View style={styles.streakPill}>
                <Ionicons name="flame" size={13} color={colors.accent_amber} />
                <Text style={styles.streakPillText}>{dayStreak} day{dayStreak === 1 ? '' : 's'}</Text>
              </View>
            )}
            {totalPoints > 0 && (
              <View style={styles.tierPill}>
                <Ionicons name="trophy" size={12} color={colors.accent} />
                <Text style={styles.tierPillText}>{playerTier.replace(/ Golfer$/, '')} · {totalPoints}</Text>
              </View>
            )}
          </View>
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
            <View style={[styles.avatar, { borderColor: colors.accent, backgroundColor: colors.accent_muted, overflow: 'hidden' }]}>
              {profilePortraitB64 ? (
                <Image source={{ uri: `data:image/png;base64,${profilePortraitB64}` }} style={styles.avatarImg} resizeMode="cover" />
              ) : (
                <Text style={[styles.avatarLetter, { color: colors.accent }]}>
                  {welcomeName.charAt(0).toUpperCase()}
                </Text>
              )}
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

        {/* 2026-06-30 (Tim) — Messages card = the future home of the social layer (foursome
            feed, share, message). Opens the minimal Tank↔Tim thread today. Simple nav card,
            no store subscription. */}
        <TouchableOpacity
          style={[styles.sharedCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 12 }]}
          onPress={() => router.push('/messages' as never)}
          accessibilityRole="button"
          accessibilityLabel="Open Messages"
        >
          <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent_muted }}>
            <AppIcon name="chatbubbles-outline" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sharedTitle, { color: colors.text_primary }]}>Messages</Text>
            <Text style={[styles.sharedMeta, { color: colors.text_muted }]} numberOfLines={1}>
              Message your golfers — foursome, coach, friends
            </Text>
          </View>
          <AppIcon name="chevron-forward" size={18} color={colors.text_muted} />
        </TouchableOpacity>

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
                      scoreVsPar < 0 ? colors.accent_lime
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
            2026-05-25 — Fix Y: re-scoped to TEE SHOTS only. AVG YDS is
            now TEE AVG (avg distance of tee shots). Tee-shot count
            surfaces too so a single-shot round doesn't look like "100%"
            with no context. When teeShots=0, show dashes instead of 0/0%.
            2026-06-24 — honesty relabel: the % is cleanTeeCount/trackedTee
            (tee shots with NO penalty logged). That is NOT a fairway-hit
            signal — `outcome === 'clean'` only means "no penalty," so a
            tee shot into the rough still counts as clean. We have no real
            fairway-in-regulation data (HoleStats.fairwayHit is never
            populated), so the tile is labelled CLEAN TEE % (dashboard
            i18n key fairway_pct) — what the data actually supports — not
            a fabricated FAIRWAY HIT %. */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>{t('dashboard.shot_stats')}</Text>
        <View style={styles.statsRow}>
          <StatTile colors={colors} icon="golf-outline" value={String(shotStats.shotsLogged)} label={t('dashboard.shots_logged')} />
          <StatTile
            colors={colors}
            icon="locate-outline"
            value={shotStats.teeShots === 0 ? '—' : `${shotStats.fairwayPct}%`}
            label={t('dashboard.fairway_pct')}
          />
          <StatTile
            colors={colors}
            icon="flag-outline"
            value={shotStats.teeShots === 0 || shotStats.avgYds === 0 ? '—' : String(shotStats.avgYds)}
            label={t('dashboard.tee_avg')}
          />
          <StatTile
            colors={colors}
            icon="trending-up-outline"
            value={scoreTrend == null ? '—' : `${scoreTrend >= 0 ? '+' : ''}${scoreTrend.toFixed(1)}`}
            label={t('dashboard.score_trend', { defaultValue: 'SCORE TREND' })}
          />
        </View>

        {/* ─── PRACTICE POINTS (Tim) — conservative, per-drill. Only shows once
            you've banked some, so the dashboard isn't cluttered for new users. */}
        {practiceTotal > 0 && (
          <View style={[styles.practiceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.practiceHeader}>
              <Text style={[styles.practiceLabel, { color: colors.text_muted }]}>PRACTICE POINTS</Text>
              <Text style={[styles.practiceTotal, { color: colors.accent_lime }]}>{practiceTotal}</Text>
            </View>
            {topDrills.map(([id, rec]) => (
              <View key={id} style={styles.practiceRow}>
                <Text style={[styles.practiceDrill, { color: colors.text_primary }]} numberOfLines={1}>
                  {/* drills resolve via the catalog; focus/open-range keys use the
                      stored label (2026-06-14 unified award). */}
                  {getDrillEntry(id)?.title ?? rec.label ?? id}
                </Text>
                <Text style={[styles.practiceDrillPts, { color: colors.text_muted }]}>
                  {rec.points} pts · {rec.sessions}×
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ─── MY BAG (Tim) — clubs + carry distances (tracked or stated), tap to
            edit. Powers the Fit Profile + the caddie's club calls. Empty = a CTA to
            set it up (the fastest way to give the caddie real yardages). */}
        <TouchableOpacity
          style={[styles.practiceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.push('/practice/fit-profile' as never)}
          accessibilityRole="button"
          accessibilityLabel="Open My Bag and Fit Profile"
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={[styles.practiceLabel, { color: colors.text_muted }]}>MY BAG</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.text_muted} />
          </View>
          {bagClubs.length > 0 ? (
            <View>
              {Array.from({ length: Math.ceil(bagClubs.length / 3) }, (_, rowIdx) => (
                <View key={rowIdx} style={{ flexDirection: 'row', marginBottom: 4 }}>
                  {bagClubs.slice(rowIdx * 3, rowIdx * 3 + 3).map((c) => (
                    <View key={c.club} style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={[styles.bagPillClub, { color: c.measured ? colors.accent_lime : colors.text_primary }]}>{c.club}</Text>
                      <Text style={[styles.bagPillYds, { color: colors.text_muted }]}> {c.yards}y</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.impactHeadline, { color: colors.text_primary }]}>
              Set up your bag — tap to enter your carry distances. Powers your fit profile and the caddie&apos;s club calls.
            </Text>
          )}
        </TouchableOpacity>

        {/* ─── PRACTICE HISTORY (Tim) — sessions by date → tap for the per-club
            striation + tempo trend. The visible half of the practice ledger. */}
        {recentSessions.length > 0 && (
          <View style={[styles.practiceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.practiceLabel, { color: colors.text_muted, marginBottom: 8 }]}>PRACTICE HISTORY</Text>
            {recentSessions.map((s) => {
              const label = s.label ?? (s.focus ? s.focus.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : s.kind === 'open_range' ? 'Open Range' : 'Practice');
              const balls = s.swingCount ?? s.swings.length;
              const d = (() => { try { return new Date(s.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } })();
              return (
                <TouchableOpacity
                  key={s.id}
                  style={styles.practiceRow}
                  onPress={() => router.push(`/practice/${s.id}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open practice session ${label}`}
                >
                  <Text style={[styles.practiceDrill, { color: colors.text_primary }]} numberOfLines={1}>{label}</Text>
                  <Text style={[styles.practiceDrillPts, { color: colors.text_muted }]}>
                    {d} · {balls} {balls === 1 ? 'ball' : 'balls'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ─── PRACTICE → PERFORMANCE (Tim, phase 3) — the honest connection:
            practice volume vs scoring trend. Shows once there's any of both. */}
        {practiceHistory.length > 0 && roundHistory.length > 0 && (
          <View style={[styles.practiceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.practiceLabel, { color: colors.text_muted, marginBottom: 8 }]}>PRACTICE → PERFORMANCE</Text>
            {/* 2026-06-24 — mutually-exclusive: until there's enough on BOTH
                sides (computePracticeImpact.hasEnough = ≥3 sessions & ≥4 rounds),
                show ONLY the "once there's enough" building copy — no chart on top
                of a not-enough-data message. Once hasEnough, the headline is a real
                insight and the sparklines render. */}
            <Text
              style={[
                styles.impactHeadline,
                { color: practiceImpact.hasEnough ? colors.text_primary : colors.text_muted },
              ]}
            >
              {practiceImpact.headline}
            </Text>
            {practiceImpact.hasEnough && (
              <>
                <TrendChart
                  data={practiceImpact.practiceSeries}
                  width={chartW}
                  height={64}
                  color={colors.accent}
                  label="PRACTICE / WK"
                  higherIsBetter
                  emptyText="—"
                />
                <TrendChart
                  data={practiceImpact.scoreSeries}
                  width={chartW}
                  height={64}
                  color={colors.accent}
                  label="SCORE VS PAR"
                  higherIsBetter={false}
                  emptyText="—"
                />
              </>
            )}
          </View>
        )}

        {/* ─── SWING LIBRARY · POINTS → PERFORMANCE (Tim, 2026-06-15) — estimated
            points from every library capture, paired with scoring. First version of
            the point/performance graph. */}
        {libraryHistory.length > 0 && (
          <View style={[styles.practiceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={[styles.practiceLabel, { color: colors.text_muted }]}>LIBRARY POINTS → PERFORMANCE</Text>
              <Text style={[styles.practiceLabel, { color: colors.accent }]}>~{pointsPerf.totalEstimatedPoints} EST</Text>
            </View>
            <Text style={[styles.impactHeadline, { color: colors.text_primary }]}>{pointsPerf.headline}</Text>
            {pointsPerf.hasEnough && (
              <>
                <TrendChart
                  data={pointsPerf.pointsSeries}
                  width={chartW}
                  height={64}
                  color={colors.accent}
                  label="POINTS / WK"
                  higherIsBetter
                  emptyText="—"
                />
                <TrendChart
                  data={pointsPerf.scoreSeries}
                  width={chartW}
                  height={64}
                  color={colors.accent}
                  label="SCORE VS PAR"
                  higherIsBetter={false}
                  emptyText="—"
                />
              </>
            )}
            <Text style={[styles.practiceLabel, { color: colors.text_muted, marginTop: 8, letterSpacing: 0 }]}>
              {pointsBaselineMs
                ? `Running live since ${new Date(pointsBaselineMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${pointsPerf.sessionsCounted} ${pointsPerf.sessionsCounted === 1 ? 'session' : 'sessions'} so far. Watch it build — we'll re-estimate your earlier history later.`
                : 'Building live as you practice. We\'ll re-estimate your earlier history later.'}
            </Text>
          </View>
        )}

        {/* ─── WORKOUT · TRAINING → PERFORMANCE (Tim, 2026-07-07 — SmartPump third rail) —
            imported golf-workout volume per week paired with scoring. Honest: association,
            never causation; only charts once there's enough on both sides. */}
        {workoutHistory.length > 0 && (
          <View style={[styles.practiceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={[styles.practiceLabel, { color: colors.text_muted }]}>TRAINING → PERFORMANCE</Text>
              <Text style={[styles.practiceLabel, { color: colors.accent }]}>
                {workoutPerf.totalWorkouts} {workoutPerf.totalWorkouts === 1 ? 'WORKOUT' : 'WORKOUTS'}
              </Text>
            </View>
            <Text style={[styles.impactHeadline, { color: colors.text_primary }]}>{workoutPerf.headline}</Text>
            {workoutPerf.hasEnough && (
              <>
                <TrendChart
                  data={workoutPerf.workoutSeries}
                  width={chartW}
                  height={64}
                  color={colors.accent}
                  label={workoutPerf.metric === 'minutes' ? 'TRAIN MIN / WK' : 'WORKOUTS / WK'}
                  higherIsBetter
                  emptyText="—"
                />
                <TrendChart
                  data={workoutPerf.scoreSeries}
                  width={chartW}
                  height={64}
                  color={colors.accent}
                  label="SCORE VS PAR"
                  higherIsBetter={false}
                  emptyText="—"
                />
              </>
            )}
            <Text style={[styles.practiceLabel, { color: colors.text_muted, marginTop: 8, letterSpacing: 0 }]}>
              From your SmartPump golf workouts{workoutPerf.metric === 'minutes' ? ` · ${Math.round(workoutPerf.totalMinutes / 60)}h total` : ''}. Import updates in Settings → Backup & Data.
            </Text>
          </View>
        )}

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

        {/* 2026-06-13 (Tim) — ROUND HISTORY. Completed rounds were persisted to
            roundHistory but never surfaced as a browsable list — "didn't appear to
            go anywhere." Golfshot-style: date · course · score · vs-par, tap → recap. */}
        {roundHistory.length > 0 && (
          <>
            <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>RECENT ROUNDS</Text>
            <View style={styles.roundHistoryList}>
              {[...roundHistory].reverse().slice(0, 6).map((r) => {
                const d = new Date(r.endedAt || r.startedAt);
                const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                const vsPar = r.scoreVsPar === 0 ? 'E' : r.scoreVsPar > 0 ? `+${r.scoreVsPar}` : `${r.scoreVsPar}`;
                const vsParColor = r.scoreVsPar > 0 ? '#E5484D' : r.scoreVsPar < 0 ? colors.accent_lime : colors.text_muted;
                return (
                  <TouchableOpacity
                    key={r.id}
                    onPress={() => router.push(`/recap/${r.id}` as never)}
                    style={[styles.roundRow, { borderColor: colors.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Round at ${r.courseName ?? 'course'} on ${dateStr}, ${r.totalScore} strokes`}
                  >
                    <View style={styles.roundRowLeft}>
                      <Text style={[styles.roundCourse, { color: colors.text_primary }]} numberOfLines={1}>
                        {r.courseName ?? 'Round'}
                      </Text>
                      <Text style={[styles.roundMeta, { color: colors.text_muted }]}>
                        {dateStr} · {r.holesPlayed} holes{r.isCompetition ? ' · competition' : ''}
                      </Text>
                      {(recapSummaries[r.id] || r.summary) ? (
                        <Text style={[styles.roundSummary, { color: colors.text_secondary }]} numberOfLines={2}>
                          {recapSummaries[r.id] || r.summary}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.roundScoreCol}>
                      <Text style={[styles.roundScore, { color: colors.text_primary }]}>{r.totalScore || '—'}</Text>
                      <Text style={[styles.roundVsPar, { color: vsParColor }]}>{vsPar}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => Alert.alert(
                        'Delete round?',
                        `${r.courseName ?? 'Round'} · ${dateStr}`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => deleteRound(r.id) },
                        ],
                      )}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={styles.roundDeleteBtn}
                    >
                      <Ionicons name="trash-outline" size={16} color="#6b7280" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
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
          accessibilityLabel={`${caddieReadLabel}. ${refreshingKevinRead ? 'Refreshing.' : 'Tap to refresh.'}`}
        >
          <View style={styles.kevinReadHeader}>
            <Text style={[styles.aiCardTitle, { color: colors.text_primary }]}>{caddieReadLabel}</Text>
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
            {/* 2026-07-04 (elite-clean audit, menu finding #9) — tap used to no-op
                once a value existed (and the empty-state tap dumped the user at
                generic Settings with no hint). It's a manual-entry stat: tap ALWAYS
                opens Settings to edit it, with a toast pointing at the field. */}
            <TouchableOpacity
              style={styles.highlightCell}
              activeOpacity={0.7}
              onPress={() => {
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  (require('../../store/toastStore') as typeof import('../../store/toastStore'))
                    .useToastStore.getState().show('Longest Putt is under Settings → Profile');
                } catch { /* toast is best-effort */ }
                router.push('/settings' as never);
              }}
              accessibilityRole="button"
              accessibilityLabel={longestPutt == null ? 'Set longest putt in Settings' : `Longest putt ${longestPutt} yards — tap to edit`}
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
              {/* 2026-07-04 (elite-clean audit) — persona-aware: was hardcoded "Kevin"
                  even when Tank/Serena/custom is the active caddie. */}
              {t('dashboard.no_rounds_sub', { caddie: getCaddieName(caddiePersonality) })}
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
  icon,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  value: string;
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  return (
    <View style={[styles.statTile, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
      {icon ? <Ionicons name={icon} size={18} color={colors.accent} style={{ marginBottom: 2 }} /> : null}
      <Text style={[styles.statTileValue, { color: colors.accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{value}</Text>
      <Text style={[styles.statTileLabel, { color: colors.text_muted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</Text>
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
  title: { fontSize: 20, fontWeight: '800' },
  welcome: { fontSize: 14, marginTop: 4 },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  streakPill: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(245,166,35,0.14)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)' },
  streakPillText: { color: '#f5a623', fontSize: 12, fontWeight: '800' },
  tierPill: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(0,200,150,0.14)', borderWidth: 1, borderColor: 'rgba(0,200,150,0.4)' },
  tierPillText: { color: '#00C896', fontSize: 12, fontWeight: '800' },
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
  avatarImg: { width: '100%', height: '100%' },
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
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  sharedActionText: { color: '#04140c', fontSize: 11, fontWeight: '800' },
  sharedChips: {
    gap: 10,
    paddingTop: 12,
    // 2026-06-23 (Tim — chips clip "Lu… sh…" at the edge) — trailing pad so a
    // partially-scrolled chip reads as a clean peek, not a hard cut.
    paddingRight: 16,
  },
  sharedChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    // 2026-06-23 — narrower min so the common 3-golfer group fits a small screen
    // without horizontal scroll (names are short; numberOfLines guards long ones).
    minWidth: 92,
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
  practiceCard: {
    marginHorizontal: 12, marginTop: 8, marginBottom: 6,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  practiceHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  practiceLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  bagPill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  bagPillClub: { fontSize: 12, fontWeight: '800' },
  bagPillYds: { fontSize: 12, fontWeight: '600' },
  practiceTotal: { fontSize: 26, fontWeight: '900' },
  practiceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  practiceDrill: { fontSize: 13, fontWeight: '700', flex: 1, marginRight: 10 },
  practiceDrillPts: { fontSize: 12, fontWeight: '600' },
  impactHeadline: { fontSize: 13, lineHeight: 19, fontWeight: '600', marginBottom: 10 },
  impactCharts: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  impactCol: { flex: 1 },
  roundHistoryList: { paddingHorizontal: 12, gap: 8 },
  roundRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
  },
  roundRowLeft: { flex: 1, marginRight: 12 },
  roundCourse: { fontSize: 15, fontWeight: '800' },
  roundMeta: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  roundSummary: { fontSize: 12, fontWeight: '500', marginTop: 5, lineHeight: 16, fontStyle: 'italic' },
  roundScoreCol: { alignItems: 'flex-end' },
  roundScore: { fontSize: 20, fontWeight: '900' },
  roundVsPar: { fontSize: 13, fontWeight: '800', marginTop: 1 },
  roundDeleteBtn: { paddingLeft: 8, justifyContent: 'center', opacity: 0.5 },
  statTile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 3,
  },
  statTileValue: { fontSize: 22, fontWeight: '900' },
  statTileLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
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
