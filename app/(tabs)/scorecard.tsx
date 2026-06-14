/**
 * Phase Z (revised) — Scorecard, legacy vertical format.
 *
 * Per-hole rows running vertically. Each row: hole number / par / yards on
 * the left, score-pill + putts on the right, tap a hole to set it as
 * current and reveal quick-score chips inline. Front 9 then Back 9 with
 * OUT / IN totals; final TOTAL card. Below: club usage, Kevin's recap,
 * share. Lighter palette than the v1 dark grid; legible in sunlight.
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Animated, Share, Alert, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useRoundStore } from '../../store/roundStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useClubStatsStore } from '../../store/clubStatsStore';
import { useCageStore } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useTheme } from '../../contexts/ThemeContext';
import { loadRecap } from '../../services/planStorage';
import { recommendBagForCourse } from '../../services/bagRecommendation';
import { speakChunked, warmVoice, stopSpeaking, isSpeaking } from '../../services/voiceService';
import AppIcon from '../../components/AppIcon';
import { BrandHeaderRow } from '../../components/brand/BrandHeaderRow';
import { QuickTutorial } from '../../components/QuickTutorial';
import { SCREEN_HELP } from '../../services/screenHelp';
import type { ShotResult } from '../../store/roundStore';
import type { RoundRecap } from '../../types/plan';
import { getApiBaseUrl } from '../../services/apiBase';

const SCORE_FILL = (diff: number): string => {
  if (diff <= -2) return '#3b82f6'; // eagle blue
  if (diff === -1) return '#22c55e'; // birdie green
  if (diff === 0) return '#94a3b8';  // par slate
  if (diff === 1) return '#f59e0b';  // bogey amber
  if (diff === 2) return '#f97316';  // double orange
  return '#ef4444';                  // worse: red
};

export default function Scorecard() {
  const router = useRouter();
  const { t } = useTranslation();
  const apiUrl = getApiBaseUrl();
  const { voiceGender, language, voiceEnabled } = useSettingsStore();
  const theme = useTheme();
  const c = theme.colors;
  // Phase AE follow-up — Tim flagged the data bar (score summary) being too
  // tall on Fold open. Tighten paddingVertical and value fontSize on wide
  // aspects so the summary doesn't dominate the landscape layout.
  const { width: W } = useWindowDimensions();
  const isWide = W >= 540;
  const summaryPadV = isWide ? 8 : 14;
  const summaryValueSize = isWide ? 22 : 28;

  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const activeCourse = useRoundStore(s => s.activeCourse);
  const activeCourseId = useRoundStore(s => s.activeCourseId);
  const courseHoles = useRoundStore(s => s.courseHoles);
  const scores = useRoundStore(s => s.scores);
  const putts = useRoundStore(s => s.putts);
  const shots = useRoundStore(s => s.shots);
  const currentHole = useRoundStore(s => s.currentHole);
  const nineHoleMode = useRoundStore(s => s.nineHoleMode);
  const isCompetition = useRoundStore(s => s.isCompetition);
  const currentRoundId = useRoundStore(s => s.currentRoundId);
  const roundHistory = useRoundStore(s => s.roundHistory);
  const logScore = useRoundStore(s => s.logScore);
  const logShot = useRoundStore(s => s.logShot);
  const clearQuickScorePlaceholders = useRoundStore(s => s.clearQuickScorePlaceholders);
  const heroMoments = useRelationshipStore(s => s.heroMoments);

  // 2026-06-13 (Tim) — the scorecard no longer LINGERS on the last completed round.
  // On End Round the round is saved to history (dashboard Recent Rounds → recap) and
  // the scorecard CLEARS to an empty state. It shows ONLY the active round now;
  // past rounds live in history. (Kept as a typed null so the view derivations +
  // saved-chip below compile unchanged.)
  const lastCompletedRound = useMemo<(typeof roundHistory)[number] | null>(() => null, []);

  const viewingRoundId = isRoundActive ? currentRoundId : lastCompletedRound?.id ?? null;
  const viewScores = useMemo(
    () => (isRoundActive ? scores : (lastCompletedRound?.scores ?? {})),
    [isRoundActive, scores, lastCompletedRound],
  );
  const viewPutts = useMemo(
    () => (isRoundActive ? putts : (lastCompletedRound?.putts ?? {})),
    [isRoundActive, putts, lastCompletedRound],
  );
  const viewShots = useMemo(
    () => (isRoundActive ? shots : (lastCompletedRound?.shots ?? [])),
    [isRoundActive, shots, lastCompletedRound],
  );
  const viewCourseName = isRoundActive ? activeCourse : (lastCompletedRound?.courseName ?? null);

  // 2026-06-13 (Tim) — highlight swings: Smart Motion swings captured on-course and
  // starred for THIS round (roundId stamped at capture). Surfaced on the scorecard,
  // tap → the swing's full review.
  const cageSessions = useCageStore(s => s.sessionHistory);
  const highlightSwings = useMemo(
    () => (viewingRoundId ? cageSessions.filter(x => x.starred && x.roundId === viewingRoundId) : []),
    [cageSessions, viewingRoundId],
  );

  // 2026-06-06 — Phase 6.2 fix: effective nine-hole mode reads from the
  // ROUND BEING VIEWED, not the live store. After endRound, store
  // nineHoleMode resets to false, so a viewed 9-hole completed round
  // previously rendered with back-9 visible + 18 placeholder rows
  // ("eighteen holes just duplicated" per Tim). lastCompletedRound
  // already carries its own nineHoleMode flag — use it when viewing
  // history.
  const effectiveNineHoleMode = isRoundActive
    ? nineHoleMode
    : (lastCompletedRound?.nineHoleMode ?? false);

  const viewCourseHoles = isRoundActive
    ? courseHoles
    : (() => {
        if (!lastCompletedRound) return [];
        const total = effectiveNineHoleMode ? 9 : 18;
        return Array.from({ length: total }, (_, i) => ({
          hole: i + 1, par: 4, distance: 0,
          front: 0, back: 0,
          teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
          frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
          note: '', estimated: false,
        }));
      })();

  const totalScore = Object.values(viewScores).reduce((a, b) => a + (b as number), 0);
  // 2026-06-06 — Phase 6.4 fix: course-shape vs partial-round semantics.
  // Previously totalPar summed par for ALL holes in the round (9 or 18)
  // regardless of how many the player had scored. On a 3-hole partial
  // mid-round view of an 18-hole round, totalPar=72, totalScore=12,
  // scoreVsPar=-60 — misleading "60 under" reading. Sum par for HOLES
  // SCORED only (and only first 9 in nine-hole mode for safety).
  const scoredHoleNums = new Set(Object.keys(viewScores).map(n => Number(n)));
  const totalPar = viewCourseHoles
    .filter(h => (effectiveNineHoleMode ? h.hole <= 9 : h.hole <= 18) && scoredHoleNums.has(h.hole))
    .reduce((a, h) => a + h.par, 0);
  const scoreVsPar = totalScore - totalPar;
  const holesPlayed = Object.keys(viewScores).length;

  // 2026-05-25 — Fix AM: scorecard breakdown stats. Putts, fairways
  // hit %, greens in regulation %. Uses viewShots (per-shot detail)
  // + viewCourseHoles (par lookup) + viewScores + viewPutts.
  //
  // Definitions:
  //   - Total putts: sum of viewPutts
  //   - Avg putts/hole: totalPutts / holesPlayed
  //   - Fairway hits: tee shots (shot_in_hole_index === 1) on par
  //     4/5 with outcome 'clean' or null. Par 3 tee shots aren't
  //     counted toward fairway tries (no fairway to hit). Same
  //     scoping as the dashboard Fix Y stat.
  //   - GIR proxy: (hole score - hole putts) ≤ (par - 2). When the
  //     player reached the green in regulation, the remaining strokes
  //     should be ≤ 2 putts. Honest proxy without an explicit
  //     "on green" capture — labels as "GIR%" since that's what the
  //     scorecard convention is.
  const stats = useMemo(() => {
    let totalPutts = 0;
    for (const v of Object.values(viewPutts)) totalPutts += (v as number) ?? 0;

    let teeShotCount = 0;
    let fairwayHits = 0;
    for (const s of viewShots) {
      // Audit M5 — skip synthetic quick-score placeholders (`qs-<hole>-`);
      // they have no real outcome and would inflate fairway% on
      // chip-scored rounds.
      if (typeof s.id === 'string' && s.id.startsWith('qs-')) continue;
      if (s.shot_in_hole_index !== 1) continue;
      const holeData = viewCourseHoles.find(h => h.hole === s.hole);
      if (!holeData || holeData.par < 4) continue;
      teeShotCount++;
      if (s.outcome === 'clean' || s.outcome == null) fairwayHits++;
    }
    const fairwayPct = teeShotCount === 0 ? null : Math.round((fairwayHits / teeShotCount) * 100);

    let girHoles = 0;
    let girEligible = 0;
    for (const [holeStr, score] of Object.entries(viewScores)) {
      const hole = parseInt(holeStr, 10);
      const holeData = viewCourseHoles.find(h => h.hole === hole);
      if (!holeData) continue;
      const putts = (viewPutts as Record<number, number>)[hole];
      if (putts == null) continue; // can't compute GIR without putts
      girEligible++;
      const strokesToGreen = (score as number) - putts;
      if (strokesToGreen <= holeData.par - 2) girHoles++;
    }
    const girPct = girEligible === 0 ? null : Math.round((girHoles / girEligible) * 100);

    const avgPutts = holesPlayed === 0 ? null : (totalPutts / holesPlayed);

    return { totalPutts, avgPutts, fairwayPct, girPct };
  }, [viewShots, viewPutts, viewScores, viewCourseHoles, holesPlayed]);

  const sumNine = (start: number, end: number): number => {
    let total = 0;
    for (let i = start; i <= end; i++) total += (viewScores as Record<number, number>)[i] ?? 0;
    return total;
  };
  const ninePar = (start: number, end: number): number =>
    viewCourseHoles.filter(h => h.hole >= start && h.hole <= end).reduce((a, h) => a + h.par, 0);

  const frontScore = sumNine(1, 9);
  const backScore = sumNine(10, 18);
  const frontPar = ninePar(1, 9);
  const backPar = ninePar(10, 18);

  const scoreVsParDisplay =
    scoreVsPar === 0 ? 'E'
    : scoreVsPar > 0 ? '+' + scoreVsPar
    : String(scoreVsPar);
  const scoreVsParColor =
    scoreVsPar < 0 ? '#22c55e'
    : scoreVsPar === 0 ? c.text_primary
    : '#f59e0b';

  const roundHeroMoments = heroMoments.filter(m => m.courseName === viewCourseName).length;
  // currentHolePar — kept derived in case other surfaces reference it;
  // the inline chip block computes par per-row to support back-9 hole-by-
  // hole scoring without re-deriving.
  const _currentHolePar = viewCourseHoles.find(h => h.hole === currentHole)?.par ?? 4;
  void _currentHolePar;

  // Animate active hole highlight
  const activeBorderAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(activeBorderAnim, { toValue: 1, duration: 150, useNativeDriver: false }).start();
    return () => { activeBorderAnim.setValue(0); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHole]);

  // Club usage aggregation — pure helper, memoized so dep arrays are
  // stable and the lint rule is satisfied without disable directives.
  type ClubAgg = { club: string; count: number; avg: number | null; estimated: boolean };
  const aggregateClubs = useCallback((shots: ShotResult[]): ClubAgg[] => {
    // 2026-06-13 (Tim) — COMPLETE the club-usage view. Previously a shot with no
    // tagged club was skipped, so any shot where the club wasn't changed/stated
    // never showed — an incomplete picture. Now a clubless shot is attributed by
    // INFERRING the club from its distance (carry / to-rest). Display-only: this
    // does NOT write back to the shot or the real bag model (which stays
    // confirmed-clubs-only for honest recommendations) — it just gives the usage
    // table the full picture. Inferred shots are flagged `estimated` so the UI can
    // mark them honestly. Shots with neither a club nor a distance are still
    // skipped (no signal to attribute).
    const clubStats = useClubStatsStore.getState();
    const map = new Map<string, { count: number; distSum: number; distCount: number; estCount: number }>();
    shots.forEach(s => {
      const d = (s as ShotResult & { distance_yards?: number | null }).distance_yards
        ?? (s as ShotResult & { carry_distance?: number | null }).carry_distance ?? null;
      let club = s.club;
      let inferred = false;
      if (!club) {
        if (typeof d === 'number' && d > 0) { club = clubStats.inferClub(d); inferred = true; }
        else return; // no club + no distance → nothing to attribute
      }
      const cur = map.get(club) ?? { count: 0, distSum: 0, distCount: 0, estCount: 0 };
      cur.count += 1;
      if (inferred) cur.estCount += 1;
      if (typeof d === 'number' && d > 0) { cur.distSum += d; cur.distCount += 1; }
      map.set(club, cur);
    });
    return Array.from(map.entries())
      .map(([club, v]) => ({
        club, count: v.count,
        avg: v.distCount > 0 ? Math.round(v.distSum / v.distCount) : null,
        estimated: v.estCount > 0 && v.estCount === v.count, // every shot for this club was inferred
      }))
      .sort((a, b) => b.count - a.count);
  }, []);
  const clubUsage: ClubAgg[] = useMemo(() => aggregateClubs(viewShots as ShotResult[]), [viewShots, aggregateClubs]);
  // Lifetime aggregation across every completed round's shots — used by
  // the "Across all rounds" companion card. Helps the player pick the
  // right bag for the next session and feeds the caddie's club-pattern
  // memory (patternInsights consumes the same data downstream).
  const lifetimeClubUsage: ClubAgg[] = useMemo(() => {
    const allShots: ShotResult[] = [];
    roundHistory.forEach(r => { if (Array.isArray(r.shots)) allShots.push(...r.shots); });
    return aggregateClubs(allShots);
  }, [roundHistory, aggregateClubs]);

  // 2026-06-13 (Tim) — Part A of the course-specific bag optimizer: which clubs you
  // actually use AT THIS COURSE, across your past in-app rounds here (Golfshot
  // imports excluded — they carry no shots). The spine for the future
  // recommend-a-bag-for-this-course brain function. "Forming" until 2+ rounds.
  const courseRounds = useMemo(
    () => (activeCourseId
      ? roundHistory.filter(r => r.courseId === activeCourseId && !r.id.startsWith('imported_'))
      : []),
    [roundHistory, activeCourseId],
  );
  const courseClubUsage: ClubAgg[] = useMemo(
    () => aggregateClubs(courseRounds.flatMap(r => (Array.isArray(r.shots) ? r.shots : [])) as ShotResult[]),
    [courseRounds, aggregateClubs],
  );
  // 2026-06-13 (Tim) — Part B1: the caddie-brain recommendation built ON the
  // per-course usage. It answers the moat question for a course you've PLAYED:
  // which clubs sit idle here (swap candidates) and where are the distance GAPS
  // you keep facing with no club that fits ("30y gap → put your hybrid back in").
  // Composition lives in the brain (services/bagRecommendation); this is display.
  const bagRec = useMemo(
    () => (activeCourseId ? recommendBagForCourse(activeCourseId) : null),
    // courseRounds is the data the rec reads (via the store), so recompute with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCourseId, courseRounds],
  );

  // Kevin's recap
  const [recap, setRecap] = useState<RoundRecap | null>(null);
  const [recapLoaded, setRecapLoaded] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  // 2026-06-12 (Tim) — which hole's inline scoring chips are open. Tapping a row toggles
  // it; the chips render directly UNDER that row (not in one bottom panel you had to
  // scroll to), and ANY hole can be opened — including a missed/skipped hole with no
  // score yet. Does NOT move the round's current-hole pointer (preserves the Phase 5 fix).
  const [expandedHole, setExpandedHole] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!viewingRoundId) { setRecap(null); setRecapLoaded(true); return; }
    setRecapLoaded(false);
    void (async () => {
      try {
        const r = await loadRecap(viewingRoundId);
        if (!cancelled) {
          setRecap(r);
          setRecapLoaded(true);
          // Prewarm the TTS function the moment a readable recap lands, so
          // tapping "read" starts near-instantly instead of paying cold-start.
          if (r?.overall_kevin_summary) warmVoice(apiUrl);
        }
      } catch {
        if (!cancelled) { setRecap(null); setRecapLoaded(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [viewingRoundId, apiUrl]);

  const onSpeakRecap = useCallback(async () => {
    if (!recap?.overall_kevin_summary) return;
    if (isSpeaking()) { void stopSpeaking(); setSpeaking(false); return; }
    setSpeaking(true);
    try {
      await speakChunked(recap.overall_kevin_summary, voiceGender, language, apiUrl, { userInitiated: true });
    } finally { setSpeaking(false); }
  }, [recap, voiceGender, language, apiUrl]);

  // Share
  const onShare = useCallback(async () => {
    const lines: string[] = [];
    lines.push(viewCourseName ?? 'Round');
    if (isCompetition) lines.push('Competition Round');
    lines.push('Score ' + (totalScore || '—') + ' (' + scoreVsParDisplay + ' vs par)');
    lines.push('');
    const fmtRow = (label: string, vals: (string | number)[]) =>
      label.padEnd(5, ' ') + ' ' + vals.map(v => String(v).padStart(3, ' ')).join(' ');
    const localSumNine = (start: number, end: number): number => {
      let total = 0;
      for (let i = start; i <= end; i++) total += (viewScores as Record<number, number>)[i] ?? 0;
      return total;
    };
    const drawNine = (start: number, end: number, label: 'OUT' | 'IN'): string[] => {
      const holes = viewCourseHoles.filter(h => h.hole >= start && h.hole <= end);
      const out: string[] = [];
      out.push(fmtRow('HOLE', [...holes.map(h => h.hole), label]));
      out.push(fmtRow('PAR', [...holes.map(h => h.par), holes.reduce((a, h) => a + h.par, 0)]));
      out.push(fmtRow('SCR', [
        ...holes.map(h => (viewScores as Record<number, number>)[h.hole] ?? '—'),
        localSumNine(start, end) || '—',
      ]));
      return out;
    };
    if (!effectiveNineHoleMode) {
      lines.push(...drawNine(1, 9, 'OUT'));
      lines.push('');
      lines.push(...drawNine(10, 18, 'IN'));
      lines.push('');
      lines.push('TOTAL ' + totalScore);
    } else {
      lines.push(...drawNine(1, 9, 'OUT'));
    }
    if (clubUsage.length > 0) {
      lines.push('');
      lines.push('CLUBS');
      clubUsage.slice(0, 8).forEach(c2 => {
        lines.push('  ' + c2.club + '  ×' + c2.count + (c2.avg ? '  avg ' + c2.avg + 'y' : ''));
      });
    }
    if (recap?.overall_kevin_summary) {
      lines.push('');
      lines.push('Kevin: ' + recap.overall_kevin_summary);
    }
    lines.push('');
    lines.push('— SmartPlay Caddie Pro');
    try {
      await Share.share({
        title: (viewCourseName ?? 'Round') + ' scorecard',
        message: lines.join('\n'),
      });
    } catch (e) {
      Alert.alert(t('scorecard.share'), t('scorecard.share_failed'));
      console.log('[scorecard] share error', e);
    }
  }, [t, viewCourseName, isCompetition, totalScore, scoreVsParDisplay, effectiveNineHoleMode, viewCourseHoles, viewScores, clubUsage, recap]);

  const handleQuickScore = (hole: number, score: number) => {
    // Audit fix (2026-06-07): clear any prior quick-score placeholders for
    // this hole first so re-scoring doesn't accumulate phantom shots
    // (which corrupted recap / GIR / fairway / club-usage stats). The
    // `qs-<hole>-` id prefix marks these as synthetic so real
    // tracked/voice/auto shots are never touched.
    clearQuickScorePlaceholders(hole);
    for (let i = 0; i < score; i++) {
      const placeholder: ShotResult = {
        id: `qs-${hole}-${i}`,
        feel: null, direction: null, shape: null, club: null,
        hole, timestamp: Date.now(), acousticContact: null,
        outcome: 'clean', penalty_strokes: 0, rules_decision: undefined,
      };
      logShot(placeholder);
    }
    logScore(hole, score);
    setExpandedHole(null); // collapse the inline chips once a score is picked
    // 2026-06-11 (audit) — do NOT fabricate putts on a bare score tap. The old
    // hardcoded 2-putt write fed the GIR proxy (strokesToGreen = score minus
    // putts) and avg-putts/hole with fiction, and persisted into roundHistory.
    // Leaving putts unset makes the GIR/putt stats skip the hole (honest)
    // instead of counting a made-up two-putt. Real putts come from the cockpit /
    // voice / tracked paths, which pass actual values.
    // Fix T (2026-05-23) — scoring is now decoupled from hole advance.
    // Player moves the hole via cockpit/data-strip arrow, scorecard row
    // tap, or voice ("next hole"). Tapping a quick-score number only
    // records the score for that hole.
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/caddie' as never);
  };

  // Inline quick-score chips for a single hole — rendered directly under its row when
  // expanded. Works for any hole (score it, or re-score / fix a missed one).
  const renderInlineChips = (hole: number, par: number) => (
    <View style={[styles.inlineChipPanel, { backgroundColor: c.surface_elevated, borderColor: c.accent }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {([-2, -1, 0, 1, 2, 3, 4] as const).map(diff => {
          const s = par + diff;
          if (s < 1) return null;
          const fill = SCORE_FILL(diff);
          const label =
            diff <= -2 ? t('scorecard.eagle') :
            diff === -1 ? t('scorecard.birdie') :
            diff === 0 ? t('scorecard.par_label') :
            diff === 1 ? t('scorecard.bogey') :
            diff === 2 ? t('scorecard.double') :
            diff === 3 ? t('scorecard.triple') : ('+' + diff);
          return (
            <TouchableOpacity
              key={diff}
              style={[styles.scoreChip, { backgroundColor: fill, borderColor: fill }]}
              onPress={() => handleQuickScore(hole, s)}
              activeOpacity={0.8}
            >
              <Text style={styles.scoreChipScore}>{s}</Text>
              <Text style={styles.scoreChipLabel}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  const renderHoleRow = (h: typeof viewCourseHoles[number]) => {
    const score = (viewScores as Record<number, number>)[h.hole] ?? 0;
    const holePutts = (viewPutts as Record<number, number>)[h.hole] ?? 0;
    const isCurrent = h.hole === currentHole && isRoundActive;
    const hasScore = score > 0;
    const diff = hasScore ? score - h.par : 0;
    const fill = hasScore ? SCORE_FILL(diff) : 'transparent';
    // The current hole's chips auto-open when it has no score (score it in one tap);
    // tapping any other row overrides. Only interactive during an active round.
    const autoExpand = isRoundActive && !(viewScores as Record<number, number>)[currentHole] ? currentHole : null;
    const isExpanded = isRoundActive && (expandedHole ?? autoExpand) === h.hole;

    // Phase 5 (2026-06-06): a row tap must NOT change the round's current-hole pointer or
    // fire the hole-transition speak (that felt like "scoring drove the hole change"). It
    // now only toggles this hole's inline scoring chips (local UI state). The +/- steppers
    // stopPropagation and call logScore directly. Navigate via cockpit/data-strip/voice.
    return (
      <React.Fragment key={h.hole}>
      <TouchableOpacity
        onPress={isRoundActive ? () => setExpandedHole(isExpanded ? null : h.hole) : undefined}
        activeOpacity={isRoundActive ? 0.85 : 1}
        style={[
          styles.holeRow,
          { backgroundColor: c.surface, borderBottomColor: c.border },
          isCurrent && { backgroundColor: c.surface_elevated, borderLeftWidth: 3, borderLeftColor: c.accent },
        ]}
      >
        <View style={styles.holeLeft}>
          <Text style={[styles.holeNum, { color: isCurrent ? c.accent : c.text_primary }]}>
            {h.hole}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.holeMeta, { color: c.text_secondary }]}>
              {t('scorecard.hole_par', { par: h.par })}{h.distance > 0 ? t('scorecard.hole_dist', { dist: h.distance }) : ''}
            </Text>
            {holePutts > 0 && (
              <Text style={[styles.holeSub, { color: c.text_muted }]}>{t('scorecard.n_putts', { count: holePutts })}</Text>
            )}
          </View>
        </View>
        <View style={styles.holeRight}>
          {hasScore ? (
            // Phase AY — inline +/- edit on logged scores. Tap minus to
            // decrement (floor 1), plus to increment. Edits use logScore
            // directly so they propagate everywhere a score is read.
            // Only enabled during an active round (post-round records
            // are read-only — we'd corrupt history otherwise).
            <View style={styles.scoreEditRow}>
              {isRoundActive && (
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation?.(); if (score > 1) logScore(h.hole, score - 1); }}
                  style={styles.scoreStep}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                  disabled={score <= 1}
                >
                  <Text style={[styles.scoreStepText, { color: score <= 1 ? c.text_muted : c.text_primary, opacity: score <= 1 ? 0.4 : 1 }]}>−</Text>
                </TouchableOpacity>
              )}
              <View style={[styles.scorePill, { backgroundColor: fill }]}>
                <Text style={styles.scorePillText}>{score}</Text>
              </View>
              {isRoundActive && (
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation?.(); logScore(h.hole, score + 1); }}
                  style={styles.scoreStep}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                >
                  <Text style={[styles.scoreStepText, { color: c.text_primary }]}>+</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : isRoundActive ? (
            // Any unscored hole invites a tap during the round — including a missed/
            // skipped one (current hole in accent, others muted).
            <Text style={[styles.tapToScore, { color: isCurrent ? c.accent : c.text_muted }]}>{t('scorecard.tap_to_score')}</Text>
          ) : (
            <Text style={[styles.scoreEmpty, { color: c.text_muted }]}>—</Text>
          )}
        </View>
      </TouchableOpacity>
      {isExpanded && renderInlineChips(h.hole, h.par)}
      </React.Fragment>
    );
  };

  const renderTotalsRow = (label: 'OUT' | 'IN', total: number, par: number) => (
    <View style={[styles.totalsRow, { backgroundColor: c.surface_elevated, borderBottomColor: c.border }]}>
      <Text style={[styles.totalsLabel, { color: c.accent }]}>{label}</Text>
      <Text style={[styles.totalsMid, { color: c.text_muted }]}>{t('scorecard.par_n', { par })}</Text>
      <Text style={[styles.totalsScore, { color: total > 0 ? c.text_primary : c.text_muted }]}>
        {total > 0 ? total : '—'}
      </Text>
    </View>
  );

  // 2026-06-12 (Tim) — the sticky bottom chip panel (which forced a scroll to the bottom
  // to score, and only worked for the current hole) is replaced by per-row inline chips
  // that open directly under the tapped hole (renderInlineChips above) and work for ANY
  // hole, including a missed one. No more scroll-to-bottom, no more "can't score that hole".

  const hasAnythingToShow = isRoundActive || lastCompletedRound != null;
  const front9 = viewCourseHoles.filter(h => h.hole <= 9);
  const back9 = viewCourseHoles.filter(h => h.hole >= 10 && h.hole <= 18);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >

        {/* Shared v3 brand row — same in all tabs. */}
        <BrandHeaderRow />

        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <AppIcon name="chevron-back" size={26} color={c.accent} />
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            <Text style={[styles.title, { color: c.text_primary }]}>{t('scorecard.title')}</Text>
            {isRoundActive && (
              <View style={[styles.chip, { borderColor: c.accent }]}>
                <Text style={[styles.chipText, { color: c.accent }]}>{t('scorecard.live')}</Text>
              </View>
            )}
            {!isRoundActive && lastCompletedRound && (
              <View style={[styles.chip, { borderColor: c.text_muted }]}>
                <Text style={[styles.chipText, { color: c.text_muted }]}>{t('scorecard.saved')}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            onPress={onShare}
            disabled={!hasAnythingToShow}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <AppIcon
              name="share-social-outline"
              size={22}
              color={hasAnythingToShow ? c.accent : c.text_muted}
            />
          </TouchableOpacity>
        </View>

        {/* 2026-06-13 (Tim) — cleared empty state. With no active round the
            scorecard shows this instead of lingering on the last round; finished
            rounds live in dashboard Recent Rounds → recap. */}
        {!isRoundActive && (
          <View style={[styles.emptyRound, { borderColor: c.border, backgroundColor: c.surface }]}>
            <AppIcon name="golf-outline" size={34} color={c.text_muted} />
            <Text style={[styles.emptyRoundTitle, { color: c.text_primary }]}>No round in progress</Text>
            <Text style={[styles.emptyRoundBody, { color: c.text_muted }]}>
              Your finished rounds are saved. See <Text style={{ fontWeight: '800', color: c.accent }}>Recent Rounds</Text> on the dashboard to review any of them.
            </Text>
          </View>
        )}

        {/* COURSE */}
        {viewCourseName && (
          <Text style={[styles.courseName, { color: c.text_secondary }]}>{viewCourseName}</Text>
        )}

        {/* SUMMARY */}
        {hasAnythingToShow && (
          <View style={[styles.summary, { backgroundColor: c.surface, borderColor: c.border, paddingVertical: summaryPadV }]}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>{t('scorecard.score')}</Text>
              <Text style={[styles.summaryValue, { color: c.text_primary, fontSize: summaryValueSize }]}>
                {totalScore > 0 ? totalScore : '—'}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>{t('scorecard.vs_par')}</Text>
              <Text style={[styles.summaryValue, { color: scoreVsParColor, fontSize: summaryValueSize }]}>
                {holesPlayed > 0 ? scoreVsParDisplay : '—'}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>{t('scorecard.holes')}</Text>
              <Text style={[styles.summaryValue, { color: c.text_primary, fontSize: summaryValueSize }]}>{holesPlayed}</Text>
            </View>
            {roundHeroMoments > 0 && (
              <>
                <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryLabel, { color: c.text_muted }]}>{t('scorecard.hero')}</Text>
                  <Text style={[styles.summaryValue, { color: '#F5A623', fontSize: summaryValueSize }]}>★ {roundHeroMoments}</Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* 2026-05-25 — Fix AM: second summary row with the breakdown
            stats Tim flagged tonight (putts, fairways hit %, GIR%).
            Rendered only when at least one hole is played so the empty
            state above the round doesn't show a row of '—' tiles.
            Honest fallbacks: stat is '—' when the input data isn't
            present (e.g. fairwayPct=null when no tee shots logged). */}
        {holesPlayed > 0 && (
          <View style={[styles.summary, { backgroundColor: c.surface, borderColor: c.border, paddingVertical: summaryPadV, marginTop: 8 }]}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>{t('scorecard.putts')}</Text>
              <Text style={[styles.summaryValue, { color: c.text_primary, fontSize: summaryValueSize }]}>
                {stats.totalPutts > 0 ? stats.totalPutts : '—'}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>{t('scorecard.avg_putts')}</Text>
              <Text style={[styles.summaryValue, { color: c.text_primary, fontSize: summaryValueSize }]}>
                {stats.avgPutts != null ? stats.avgPutts.toFixed(1) : '—'}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>{t('scorecard.fairway_pct')}</Text>
              <Text style={[styles.summaryValue, { color: c.text_primary, fontSize: summaryValueSize }]}>
                {stats.fairwayPct != null ? `${stats.fairwayPct}%` : '—'}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>{t('scorecard.gir_pct')}</Text>
              <Text style={[styles.summaryValue, { color: c.text_primary, fontSize: summaryValueSize }]}>
                {stats.girPct != null ? `${stats.girPct}%` : '—'}
              </Text>
            </View>
          </View>
        )}

        {!hasAnythingToShow && (
          <View style={styles.noRound}>
            <Text style={[styles.noRoundText, { color: c.text_muted }]}>{t('scorecard.no_round')}</Text>
            <Text style={[styles.noRoundSub, { color: c.text_muted }]}>{t('scorecard.no_round_sub')}</Text>
          </View>
        )}

        {/* PER-HOLE ROWS — Front 9. Quick-score chips moved to a single
            sticky panel below this list (rendered after Back 9) instead
            of interleaved per-row, which made them appear to pop around. */}
        {hasAnythingToShow && front9.length > 0 && (
          <View style={[styles.section, styles.holeListWrap]}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>{t('scorecard.front9')}</Text>
            <View style={[styles.holeList, { backgroundColor: c.surface, borderColor: c.border }]}>
              {front9.map(renderHoleRow)}
              {renderTotalsRow('OUT', frontScore, frontPar)}
            </View>
          </View>
        )}

        {/* PER-HOLE ROWS — Back 9. */}
        {hasAnythingToShow && !effectiveNineHoleMode && back9.length > 0 && (
          <View style={[styles.section, styles.holeListWrap]}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>{t('scorecard.back9')}</Text>
            <View style={[styles.holeList, { backgroundColor: c.surface, borderColor: c.border }]}>
              {back9.map(renderHoleRow)}
              {renderTotalsRow('IN', backScore, backPar)}
            </View>
          </View>
        )}


        {/* TOTAL CARD */}
        {hasAnythingToShow && holesPlayed > 0 && (
          <View style={[styles.totalCard, { backgroundColor: c.surface_elevated, borderColor: c.accent }]}>
            <View style={styles.totalCardItem}>
              <Text style={[styles.totalCardLabel, { color: c.text_muted }]}>{t('scorecard.total')}</Text>
              <Text style={[styles.totalCardValue, { color: c.text_primary }]}>{totalScore}</Text>
            </View>
            <View style={[styles.totalCardDivider, { backgroundColor: c.border }]} />
            <View style={styles.totalCardItem}>
              <Text style={[styles.totalCardLabel, { color: c.text_muted }]}>{t('scorecard.par')}</Text>
              <Text style={[styles.totalCardValue, { color: c.text_primary }]}>{totalPar}</Text>
            </View>
            <View style={[styles.totalCardDivider, { backgroundColor: c.border }]} />
            <View style={styles.totalCardItem}>
              <Text style={[styles.totalCardLabel, { color: c.text_muted }]}>{t('scorecard.diff')}</Text>
              <Text style={[styles.totalCardValue, { color: scoreVsParColor }]}>{scoreVsParDisplay}</Text>
            </View>
          </View>
        )}

        {/* 2026-06-13 (Tim) — HIGHLIGHT SWINGS: on-course Smart Motion swings the
            player starred this round. Tap → the full swing review. */}
        {highlightSwings.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>★ {t('scorecard.highlight_swings', { defaultValue: 'Highlight Swings' })}</Text>
            <View style={[styles.clubGrid, { backgroundColor: c.surface, borderColor: c.border }]}>
              {highlightSwings.map(sw => (
                <TouchableOpacity
                  key={sw.id}
                  onPress={() => router.push(`/swinglab/swing/${sw.id}` as never)}
                  style={[styles.highlightRow, { borderBottomColor: c.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Highlight swing${sw.roundHole ? `, hole ${sw.roundHole}` : ''} — open review`}
                >
                  <AppIcon name="star" size={16} color="#F5A623" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.highlightClub, { color: c.text_primary }]} numberOfLines={1}>
                      {sw.club || 'Swing'}{sw.roundHole ? ` · hole ${sw.roundHole}` : ''}
                    </Text>
                    {sw.primary_issue?.name ? (
                      <Text style={[styles.highlightSub, { color: c.text_muted }]} numberOfLines={1}>{sw.primary_issue.name}</Text>
                    ) : null}
                  </View>
                  <AppIcon name="chevron-forward" size={18} color={c.text_muted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* CLUB USAGE */}
        {hasAnythingToShow && clubUsage.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>{t('scorecard.club_usage')}</Text>
            <View style={[styles.clubGrid, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={[styles.clubRow, styles.clubHeader, { backgroundColor: c.surface_elevated, borderBottomColor: c.border }]}>
                <Text style={[styles.clubCell, styles.clubColClub, { color: c.text_muted }]}>{t('scorecard.col_club')}</Text>
                <Text style={[styles.clubCell, styles.clubColCount, { color: c.text_muted }]}>{t('scorecard.col_used')}</Text>
                <Text style={[styles.clubCell, styles.clubColAvg, { color: c.text_muted }]}>{t('scorecard.col_avg_yds')}</Text>
              </View>
              {clubUsage.map(item => (
                <View key={item.club} style={[styles.clubRow, { borderBottomColor: c.border }]}>
                  <Text style={[styles.clubCell, styles.clubColClub, { color: c.text_primary }]}>
                    {item.club}{item.estimated ? <Text style={{ color: c.text_muted, fontWeight: '600' }}> ~est</Text> : null}
                  </Text>
                  <Text style={[styles.clubCell, styles.clubColCount, { color: c.text_secondary }]}>×{item.count}</Text>
                  <Text style={[styles.clubCell, styles.clubColAvg, { color: item.avg != null ? c.accent : c.text_muted }]}>
                    {item.avg != null ? item.avg : '—'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 2026-06-13 (Tim) — Part A, course-specific bag: which clubs you actually
            use AT THIS COURSE across your past in-app rounds here. The Menifee
            insight ("7 clubs cover this course") + the spine for the future
            recommend-a-bag-for-this-course brain function. */}
        {isRoundActive && activeCourse && courseClubUsage.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>YOUR BAG · {activeCourse.toUpperCase()}</Text>
            <View style={[styles.clubGrid, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[styles.courseBagNote, { color: c.text_muted }]}>
                {courseClubUsage.length} club{courseClubUsage.length === 1 ? '' : 's'} see action here
                {courseRounds.length > 0 ? ` over ${courseRounds.length} round${courseRounds.length === 1 ? '' : 's'}` : ''}
                {courseRounds.length < 2 ? ' · pattern still forming' : ''}
              </Text>
              {courseClubUsage.map(item => (
                <View key={item.club} style={[styles.clubRow, { borderBottomColor: c.border }]}>
                  <Text style={[styles.clubCell, styles.clubColClub, { color: c.text_primary }]}>
                    {item.club}{item.estimated ? <Text style={{ color: c.text_muted, fontWeight: '600' }}> ~est</Text> : null}
                  </Text>
                  <Text style={[styles.clubCell, styles.clubColCount, { color: c.text_secondary }]}>×{item.count}</Text>
                  <Text style={[styles.clubCell, styles.clubColAvg, { color: item.avg != null ? c.accent : c.text_muted }]}>
                    {item.avg != null ? item.avg : '—'}
                  </Text>
                </View>
              ))}
              {/* Part B1 — the caddie's read on this bag: idle clubs + distance
                  gaps to fill. Confident lines only once enough rounds exist;
                  while forming we keep it to the usage above (no shaky advice). */}
              {bagRec && !bagRec.forming && (bagRec.idle.length > 0 || bagRec.gaps.length > 0) && (
                <View style={[styles.bagRecBox, { borderTopColor: c.border }]}>
                  <Text style={[styles.bagRecHeadline, { color: c.text_primary }]}>{bagRec.headline}</Text>
                  {bagRec.rationale.map((line, i) => (
                    <Text key={i} style={[styles.bagRecLine, { color: c.text_secondary }]}>• {line}</Text>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Lifetime club usage — across every round in roundHistory.
            Helps the player pick the right bag for the next session
            and feeds the caddie's club-pattern memory (the same shots
            data is what patternInsights consumes downstream). Only
            renders when there's at least one completed round AND its
            club distribution is meaningfully different from the current
            round (or there's no current round at all). */}
        {lifetimeClubUsage.length > 0 && (clubUsage.length === 0 || roundHistory.length >= 2) && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>
              {t('scorecard.club_usage_all', { n: roundHistory.length })}
            </Text>
            <View style={[styles.clubGrid, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={[styles.clubRow, styles.clubHeader, { backgroundColor: c.surface_elevated, borderBottomColor: c.border }]}>
                <Text style={[styles.clubCell, styles.clubColClub, { color: c.text_muted }]}>{t('scorecard.col_club')}</Text>
                <Text style={[styles.clubCell, styles.clubColCount, { color: c.text_muted }]}>{t('scorecard.col_used')}</Text>
                <Text style={[styles.clubCell, styles.clubColAvg, { color: c.text_muted }]}>{t('scorecard.col_avg_yds')}</Text>
              </View>
              {lifetimeClubUsage.map(item => (
                <View key={item.club} style={[styles.clubRow, { borderBottomColor: c.border }]}>
                  <Text style={[styles.clubCell, styles.clubColClub, { color: c.text_primary }]}>{item.club}</Text>
                  <Text style={[styles.clubCell, styles.clubColCount, { color: c.text_secondary }]}>×{item.count}</Text>
                  <Text style={[styles.clubCell, styles.clubColAvg, { color: item.avg != null ? c.accent : c.text_muted }]}>
                    {item.avg != null ? item.avg : '—'}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={[styles.clubFooter, { color: c.text_muted }]}>
              {t('scorecard.club_footer')}
            </Text>
          </View>
        )}

        {/* KEVIN'S TAKE */}
        {hasAnythingToShow && recapLoaded && recap?.overall_kevin_summary && (
          <View style={styles.section}>
            <View style={styles.kevinHeader}>
              <Text style={[styles.sectionLabel, { color: c.text_muted }]}>{t('scorecard.kevins_take')}</Text>
              {voiceEnabled && (
                <TouchableOpacity onPress={onSpeakRecap} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <View style={[styles.speakBtn, { borderColor: c.accent }]}>
                    <AppIcon name={speaking ? 'pause' : 'play'} size={12} color={c.accent} />
                    <Text style={[styles.speakBtnText, { color: c.accent }]}>{speaking ? t('scorecard.stop') : t('scorecard.listen')}</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.kevinCard, { backgroundColor: c.surface_elevated, borderColor: c.border }]}>
              <Text style={[styles.kevinText, { color: c.text_primary }]}>{recap.overall_kevin_summary}</Text>
            </View>
          </View>
        )}

        {/* COMPETITION BADGE */}
        {isCompetition && hasAnythingToShow && (
          <View style={[styles.compBadge, { backgroundColor: c.surface, borderColor: '#F5A623' }]}>
            <AppIcon name="trophy" size={14} color="#F5A623" />
            <Text style={styles.compBadgeText}>{t('scorecard.competition_round')}</Text>
          </View>
        )}

      </ScrollView>
      {/* 2026-06-13 (Tim) — the ONE scorecard exception: a first-time highlight of how
          scoring works here (text + caddie narration). One-time, then it's out of the way. */}
      <QuickTutorial
        slug="scorecard_scoring"
        title={SCREEN_HELP.scorecard.title}
        iconName={SCREEN_HELP.scorecard.icon as never}
        lines={SCREEN_HELP.scorecard.lines}
        spokenText={SCREEN_HELP.scorecard.spoken}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 12,
  },
  titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 22, fontWeight: '900' },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  courseName: { fontSize: 14, fontWeight: '500', paddingHorizontal: 20, marginBottom: 12 },
  emptyRound: {
    marginHorizontal: 20, marginTop: 24, alignItems: 'center',
    borderWidth: 1, borderRadius: 16, paddingHorizontal: 22, paddingVertical: 28, gap: 10,
  },
  emptyRoundTitle: { fontSize: 17, fontWeight: '800' },
  emptyRoundBody: { fontSize: 13, fontWeight: '500', textAlign: 'center', lineHeight: 19 },
  highlightRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  highlightClub: { fontSize: 14, fontWeight: '800' },
  highlightSub: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  courseBagNote: { fontSize: 12, fontWeight: '600', paddingHorizontal: 14, paddingVertical: 9, fontStyle: 'italic' },
  bagRecBox: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, marginTop: 2 },
  bagRecHeadline: { fontSize: 13, fontWeight: '800', marginBottom: 6 },
  bagRecLine: { fontSize: 12, fontWeight: '500', lineHeight: 17, marginBottom: 3 },

  summary: {
    flexDirection: 'row',
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: 14, borderWidth: 1, paddingVertical: 14,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, marginVertical: 4 },
  summaryLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  summaryValue: { fontSize: 28, fontWeight: '900' },

  noRound: { alignItems: 'center', paddingVertical: 60 },
  noRoundText: { fontSize: 16, fontWeight: '600' },
  noRoundSub: { fontSize: 13, marginTop: 6 },

  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },
  holeListWrap: { marginBottom: 8 },
  holeList: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },

  // Per-hole row
  holeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  holeLeft: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  holeNum: { fontSize: 22, fontWeight: '900', width: 30, textAlign: 'left' },
  holeMeta: { fontSize: 13, fontWeight: '600' },
  holeSub: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  holeRight: { alignItems: 'flex-end', justifyContent: 'center', minWidth: 70 },

  scorePill: {
    minWidth: 40, height: 36, paddingHorizontal: 8,
    borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  scorePillText: {
    color: '#ffffff', fontSize: 17, fontWeight: '900',
  },
  scoreEditRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  scoreStep: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  scoreStepText: { fontSize: 18, fontWeight: '900', lineHeight: 20 },
  scoreEmpty: { fontSize: 18, fontWeight: '700' },
  tapToScore: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  totalsRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 14,
    borderBottomWidth: 0,
  },
  totalsLabel: { width: 50, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  totalsMid: { flex: 1, fontSize: 12, fontWeight: '600' },
  totalsScore: { fontSize: 18, fontWeight: '900', minWidth: 70, textAlign: 'right' },

  totalCard: {
    flexDirection: 'row',
    marginHorizontal: 16, marginBottom: 16,
    borderRadius: 12, borderWidth: 1.5,
    paddingVertical: 14,
  },
  totalCardItem: { flex: 1, alignItems: 'center' },
  totalCardDivider: { width: 1, marginVertical: 4 },
  totalCardLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  totalCardValue: { fontSize: 32, fontWeight: '900' },

  // Quick score chips (filled, high contrast)
  chipsRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  // Inline scoring chips, rendered flush under the tapped hole row (inside the hole list).
  // A left accent bar + bottom divider tie it to the row above.
  inlineChipPanel: {
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: 1, borderLeftWidth: 3,
  },
  scoreChip: {
    alignItems: 'center',
    borderWidth: 1.5, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 16,
    minWidth: 64,
  },
  scoreChipScore: { fontSize: 22, fontWeight: '900', color: '#ffffff', letterSpacing: -0.5 },
  scoreChipLabel: { fontSize: 10, fontWeight: '800', color: '#ffffff', letterSpacing: 0.5, marginTop: 2 },

  // Club usage
  clubGrid: { borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  clubRow: {
    flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'center',
  },
  clubHeader: {},
  clubCell: { fontSize: 14, fontWeight: '600' },
  clubColClub: { flex: 2, textAlign: 'left' },
  clubColCount: { flex: 1, textAlign: 'center', fontWeight: '500' },
  clubColAvg: { flex: 1, textAlign: 'right' },
  clubFooter: { fontSize: 11, marginTop: 8, fontStyle: 'italic', paddingHorizontal: 4 },

  // Kevin's Take
  kevinHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  speakBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 12, borderWidth: 1,
  },
  speakBtnText: { fontSize: 11, fontWeight: '700' },
  kevinCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  kevinText: { fontSize: 14, lineHeight: 20 },

  compBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 16, marginBottom: 16,
    borderRadius: 10, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 12,
    justifyContent: 'center',
  },
  compBadgeText: { color: '#F5A623', fontSize: 13, fontWeight: '700' },
});
