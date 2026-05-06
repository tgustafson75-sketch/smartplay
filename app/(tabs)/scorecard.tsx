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
import { useRoundStore } from '../../store/roundStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useTheme } from '../../contexts/ThemeContext';
import { loadRecap } from '../../services/planStorage';
import { speak, stopSpeaking, isSpeaking } from '../../services/voiceService';
import AppIcon from '../../components/AppIcon';
import type { ShotResult } from '../../store/roundStore';
import type { RoundRecap } from '../../types/plan';

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
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
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
  const courseHoles = useRoundStore(s => s.courseHoles);
  const scores = useRoundStore(s => s.scores);
  const putts = useRoundStore(s => s.putts);
  const shots = useRoundStore(s => s.shots);
  const currentHole = useRoundStore(s => s.currentHole);
  const nineHoleMode = useRoundStore(s => s.nineHoleMode);
  const isCompetition = useRoundStore(s => s.isCompetition);
  const currentRoundId = useRoundStore(s => s.currentRoundId);
  const roundHistory = useRoundStore(s => s.roundHistory);
  const setCurrentHole = useRoundStore(s => s.setCurrentHole);
  const logScore = useRoundStore(s => s.logScore);
  const logPutts = useRoundStore(s => s.logPutts);
  const logShot = useRoundStore(s => s.logShot);
  const heroMoments = useRelationshipStore(s => s.heroMoments);

  const lastCompletedRound = useMemo(() => {
    if (isRoundActive) return null;
    return roundHistory.length > 0 ? roundHistory[roundHistory.length - 1] : null;
  }, [isRoundActive, roundHistory]);

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

  const viewCourseHoles = isRoundActive
    ? courseHoles
    : (() => {
        if (!lastCompletedRound) return [];
        const total = nineHoleMode ? 9 : 18;
        return Array.from({ length: total }, (_, i) => ({
          hole: i + 1, par: 4, distance: 0,
          front: 0, back: 0,
          teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
          frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
          note: '', estimated: false,
        }));
      })();

  const totalScore = Object.values(viewScores).reduce((a, b) => a + (b as number), 0);
  const totalPar = viewCourseHoles.slice(0, nineHoleMode ? 9 : 18).reduce((a, h) => a + h.par, 0);
  const scoreVsPar = totalScore - totalPar;
  const holesPlayed = Object.keys(viewScores).length;

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
  type ClubAgg = { club: string; count: number; avg: number | null };
  const aggregateClubs = useCallback((shots: ShotResult[]): ClubAgg[] => {
    const map = new Map<string, { count: number; distSum: number; distCount: number }>();
    shots.forEach(s => {
      if (!s.club) return;
      const cur = map.get(s.club) ?? { count: 0, distSum: 0, distCount: 0 };
      cur.count += 1;
      const d = (s as ShotResult & { distance_yards?: number | null }).distance_yards;
      if (typeof d === 'number' && d > 0) { cur.distSum += d; cur.distCount += 1; }
      map.set(s.club, cur);
    });
    return Array.from(map.entries())
      .map(([club, v]) => ({
        club, count: v.count,
        avg: v.distCount > 0 ? Math.round(v.distSum / v.distCount) : null,
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

  // Kevin's recap
  const [recap, setRecap] = useState<RoundRecap | null>(null);
  const [recapLoaded, setRecapLoaded] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!viewingRoundId) { setRecap(null); setRecapLoaded(true); return; }
    setRecapLoaded(false);
    void (async () => {
      try {
        const r = await loadRecap(viewingRoundId);
        if (!cancelled) { setRecap(r); setRecapLoaded(true); }
      } catch {
        if (!cancelled) { setRecap(null); setRecapLoaded(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [viewingRoundId]);

  const onSpeakRecap = useCallback(async () => {
    if (!recap?.overall_kevin_summary) return;
    if (isSpeaking()) { void stopSpeaking(); setSpeaking(false); return; }
    setSpeaking(true);
    try {
      await speak(recap.overall_kevin_summary, voiceGender, language, apiUrl, { userInitiated: true });
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
    if (!nineHoleMode) {
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
    lines.push('— SmartPlay Caddie');
    try {
      await Share.share({
        title: (viewCourseName ?? 'Round') + ' scorecard',
        message: lines.join('\n'),
      });
    } catch (e) {
      Alert.alert('Share', 'Could not open share sheet.');
      console.log('[scorecard] share error', e);
    }
  }, [viewCourseName, isCompetition, totalScore, scoreVsParDisplay, nineHoleMode, viewCourseHoles, viewScores, clubUsage, recap]);

  const handleQuickScore = (hole: number, score: number) => {
    for (let i = 0; i < score; i++) {
      const placeholder: ShotResult = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i,
        feel: null, direction: null, shape: null, club: null,
        hole, timestamp: Date.now(), acousticContact: null,
        outcome: 'clean', penalty_strokes: 0, rules_decision: undefined,
      };
      logShot(placeholder);
    }
    logScore(hole, score);
    logPutts(hole, 2);
    const maxHole = nineHoleMode ? 9 : 18;
    if (hole < maxHole) setCurrentHole(hole + 1);
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/caddie' as never);
  };

  const renderHoleRow = (h: typeof viewCourseHoles[number]) => {
    const score = (viewScores as Record<number, number>)[h.hole] ?? 0;
    const holePutts = (viewPutts as Record<number, number>)[h.hole] ?? 0;
    const isCurrent = h.hole === currentHole && isRoundActive;
    const hasScore = score > 0;
    const diff = hasScore ? score - h.par : 0;
    const fill = hasScore ? SCORE_FILL(diff) : 'transparent';

    return (
      <TouchableOpacity
        key={h.hole}
        onPress={() => isRoundActive && setCurrentHole(h.hole)}
        activeOpacity={isRoundActive ? 0.7 : 1}
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
              Par {h.par}{h.distance > 0 ? ` · ${h.distance} yds` : ''}
            </Text>
            {holePutts > 0 && (
              <Text style={[styles.holeSub, { color: c.text_muted }]}>{holePutts} putts</Text>
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
          ) : isCurrent ? (
            <Text style={[styles.tapToScore, { color: c.accent }]}>Tap to score ↓</Text>
          ) : (
            <Text style={[styles.scoreEmpty, { color: c.text_muted }]}>—</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderTotalsRow = (label: 'OUT' | 'IN', total: number, par: number) => (
    <View style={[styles.totalsRow, { backgroundColor: c.surface_elevated, borderBottomColor: c.border }]}>
      <Text style={[styles.totalsLabel, { color: c.accent }]}>{label}</Text>
      <Text style={[styles.totalsMid, { color: c.text_muted }]}>Par {par}</Text>
      <Text style={[styles.totalsScore, { color: total > 0 ? c.text_primary : c.text_muted }]}>
        {total > 0 ? total : '—'}
      </Text>
    </View>
  );

  // Sticky bottom chip panel — renders ONCE at the bottom of the
  // ScrollView footer when the current hole has no score. Replaces the
  // prior inline-per-row attempt that confusingly made chips appear
  // under multiple holes when the user tapped around. One panel, one
  // hole label, no surprises.
  const stickyChipHole = isRoundActive && !scores[currentHole] ? currentHole : null;
  const stickyChipPar = stickyChipHole != null ? (viewCourseHoles.find(h => h.hole === stickyChipHole)?.par ?? 4) : 4;

  const hasAnythingToShow = isRoundActive || lastCompletedRound != null;
  const front9 = viewCourseHoles.filter(h => h.hole <= 9);
  const back9 = viewCourseHoles.filter(h => h.hole >= 10 && h.hole <= 18);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >

        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <AppIcon name="chevron-back" size={26} color={c.accent} />
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            <Text style={[styles.title, { color: c.text_primary }]}>Scorecard</Text>
            {isRoundActive && (
              <View style={[styles.chip, { borderColor: c.accent }]}>
                <Text style={[styles.chipText, { color: c.accent }]}>● LIVE</Text>
              </View>
            )}
            {!isRoundActive && lastCompletedRound && (
              <View style={[styles.chip, { borderColor: c.text_muted }]}>
                <Text style={[styles.chipText, { color: c.text_muted }]}>SAVED</Text>
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

        {/* COURSE */}
        {viewCourseName && (
          <Text style={[styles.courseName, { color: c.text_secondary }]}>{viewCourseName}</Text>
        )}

        {/* SUMMARY */}
        {hasAnythingToShow && (
          <View style={[styles.summary, { backgroundColor: c.surface, borderColor: c.border, paddingVertical: summaryPadV }]}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>SCORE</Text>
              <Text style={[styles.summaryValue, { color: c.text_primary, fontSize: summaryValueSize }]}>
                {totalScore > 0 ? totalScore : '—'}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>VS PAR</Text>
              <Text style={[styles.summaryValue, { color: scoreVsParColor, fontSize: summaryValueSize }]}>
                {holesPlayed > 0 ? scoreVsParDisplay : '—'}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>HOLES</Text>
              <Text style={[styles.summaryValue, { color: c.text_primary, fontSize: summaryValueSize }]}>{holesPlayed}</Text>
            </View>
            {roundHeroMoments > 0 && (
              <>
                <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryLabel, { color: c.text_muted }]}>HERO</Text>
                  <Text style={[styles.summaryValue, { color: '#F5A623', fontSize: summaryValueSize }]}>★ {roundHeroMoments}</Text>
                </View>
              </>
            )}
          </View>
        )}

        {!hasAnythingToShow && (
          <View style={styles.noRound}>
            <Text style={[styles.noRoundText, { color: c.text_muted }]}>No active round</Text>
            <Text style={[styles.noRoundSub, { color: c.text_muted }]}>Start a round from the Caddie tab</Text>
          </View>
        )}

        {/* PER-HOLE ROWS — Front 9. Quick-score chips moved to a single
            sticky panel below this list (rendered after Back 9) instead
            of interleaved per-row, which made them appear to pop around. */}
        {hasAnythingToShow && front9.length > 0 && (
          <View style={[styles.section, styles.holeListWrap]}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>FRONT 9</Text>
            <View style={[styles.holeList, { backgroundColor: c.surface, borderColor: c.border }]}>
              {front9.map(renderHoleRow)}
              {renderTotalsRow('OUT', frontScore, frontPar)}
            </View>
          </View>
        )}

        {/* PER-HOLE ROWS — Back 9. */}
        {hasAnythingToShow && !nineHoleMode && back9.length > 0 && (
          <View style={[styles.section, styles.holeListWrap]}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>BACK 9</Text>
            <View style={[styles.holeList, { backgroundColor: c.surface, borderColor: c.border }]}>
              {back9.map(renderHoleRow)}
              {renderTotalsRow('IN', backScore, backPar)}
            </View>
          </View>
        )}

        {/* Single sticky chip panel — only shows when round is active AND
            current hole has no score yet. Renders ONCE under the totals,
            with a clear "HOLE X" label so the user knows what they're
            scoring. No inline-per-row rendering, no popping around. */}
        {stickyChipHole != null && (
          <View style={[styles.stickyChipPanel, { backgroundColor: c.surface_elevated, borderColor: c.accent }]}>
            <Text style={[styles.sectionLabel, { color: c.accent, marginBottom: 8 }]}>
              HOLE {stickyChipHole} · TAP A SCORE
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {([-2, -1, 0, 1, 2, 3, 4] as const).map(diff => {
                const score = stickyChipPar + diff;
                if (score < 1) return null;
                const fill = SCORE_FILL(diff);
                const label =
                  diff <= -2 ? 'Eagle' :
                  diff === -1 ? 'Birdie' :
                  diff === 0 ? 'Par' :
                  diff === 1 ? 'Bogey' :
                  diff === 2 ? 'Double' :
                  diff === 3 ? 'Triple' : ('+' + diff);
                return (
                  <TouchableOpacity
                    key={diff}
                    style={[styles.scoreChip, { backgroundColor: fill, borderColor: fill }]}
                    onPress={() => handleQuickScore(stickyChipHole, score)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.scoreChipScore}>{score}</Text>
                    <Text style={styles.scoreChipLabel}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* TOTAL CARD */}
        {hasAnythingToShow && holesPlayed > 0 && (
          <View style={[styles.totalCard, { backgroundColor: c.surface_elevated, borderColor: c.accent }]}>
            <View style={styles.totalCardItem}>
              <Text style={[styles.totalCardLabel, { color: c.text_muted }]}>TOTAL</Text>
              <Text style={[styles.totalCardValue, { color: c.text_primary }]}>{totalScore}</Text>
            </View>
            <View style={[styles.totalCardDivider, { backgroundColor: c.border }]} />
            <View style={styles.totalCardItem}>
              <Text style={[styles.totalCardLabel, { color: c.text_muted }]}>PAR</Text>
              <Text style={[styles.totalCardValue, { color: c.text_primary }]}>{totalPar}</Text>
            </View>
            <View style={[styles.totalCardDivider, { backgroundColor: c.border }]} />
            <View style={styles.totalCardItem}>
              <Text style={[styles.totalCardLabel, { color: c.text_muted }]}>DIFF</Text>
              <Text style={[styles.totalCardValue, { color: scoreVsParColor }]}>{scoreVsParDisplay}</Text>
            </View>
          </View>
        )}

        {/* CLUB USAGE */}
        {hasAnythingToShow && clubUsage.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>CLUB USAGE — THIS ROUND</Text>
            <View style={[styles.clubGrid, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={[styles.clubRow, styles.clubHeader, { backgroundColor: c.surface_elevated, borderBottomColor: c.border }]}>
                <Text style={[styles.clubCell, styles.clubColClub, { color: c.text_muted }]}>CLUB</Text>
                <Text style={[styles.clubCell, styles.clubColCount, { color: c.text_muted }]}>USED</Text>
                <Text style={[styles.clubCell, styles.clubColAvg, { color: c.text_muted }]}>AVG YDS</Text>
              </View>
              {clubUsage.map(item => (
                <View key={item.club} style={[styles.clubRow, { borderBottomColor: c.border }]}>
                  <Text style={[styles.clubCell, styles.clubColClub, { color: c.text_primary }]}>{item.club}</Text>
                  <Text style={[styles.clubCell, styles.clubColCount, { color: c.text_secondary }]}>×{item.count}</Text>
                  <Text style={[styles.clubCell, styles.clubColAvg, { color: item.avg != null ? c.accent : c.text_muted }]}>
                    {item.avg != null ? item.avg : '—'}
                  </Text>
                </View>
              ))}
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
              CLUB USAGE — ACROSS ALL ROUNDS ({roundHistory.length})
            </Text>
            <View style={[styles.clubGrid, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={[styles.clubRow, styles.clubHeader, { backgroundColor: c.surface_elevated, borderBottomColor: c.border }]}>
                <Text style={[styles.clubCell, styles.clubColClub, { color: c.text_muted }]}>CLUB</Text>
                <Text style={[styles.clubCell, styles.clubColCount, { color: c.text_muted }]}>USED</Text>
                <Text style={[styles.clubCell, styles.clubColAvg, { color: c.text_muted }]}>AVG YDS</Text>
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
              Helps you pack the right bag · feeds the caddie&apos;s usage patterns.
            </Text>
          </View>
        )}

        {/* KEVIN'S TAKE */}
        {hasAnythingToShow && recapLoaded && recap?.overall_kevin_summary && (
          <View style={styles.section}>
            <View style={styles.kevinHeader}>
              <Text style={[styles.sectionLabel, { color: c.text_muted }]}>KEVIN&apos;S TAKE</Text>
              {voiceEnabled && (
                <TouchableOpacity onPress={onSpeakRecap} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <View style={[styles.speakBtn, { borderColor: c.accent }]}>
                    <AppIcon name={speaking ? 'pause' : 'play'} size={12} color={c.accent} />
                    <Text style={[styles.speakBtnText, { color: c.accent }]}>{speaking ? 'Stop' : 'Listen'}</Text>
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
            <Text style={styles.compBadgeText}>Competition Round</Text>
          </View>
        )}

      </ScrollView>
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
  stickyChipPanel: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
    padding: 14, borderRadius: 12, borderWidth: 1,
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
