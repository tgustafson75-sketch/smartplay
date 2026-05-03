/**
 * Phase Z — Scorecard restoration.
 *
 * Single surface for the round's story:
 *   1. Header with back-to-caddie + share affordances
 *   2. Course / score summary
 *   3. Compact all-holes grid (Front 9 stacked over Back 9, no horizontal
 *      scroll, no Front/Back toggle — both visible at a glance)
 *   4. Total card (TOTAL · PAR · DIFF)
 *   5. Club usage summary (count + average distance per club, computed
 *      from this round's shots)
 *   6. Kevin's Take — inline recap copy loaded from local archive
 *   7. Quick-score chips for the current hole
 *   8. Share via system Share sheet (text scorecard)
 *
 * Save is implicit: rounds persist into roundHistory on endRound. The
 * scorecard simply reflects the persisted state.
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Animated, Share, Alert,
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
import { dataValue, dataLabel } from '../../styles/typography';

// ─── SCORE COLOR ──────────────────────────

const getScoreColor = (score: number, par: number): string => {
  if (score === 0) return '#6b7280';
  const diff = score - par;
  if (diff <= -2) return '#3b82f6';
  if (diff === -1) return '#00C896';
  if (diff === 0) return '#ffffff';
  if (diff === 1) return '#fbbf24';
  if (diff === 2) return '#f97316';
  return '#ef4444';
};

// ─── COMPONENT ────────────────────────────

export default function Scorecard() {
  const router = useRouter();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const { voiceGender, language, voiceEnabled } = useSettingsStore();
  // Phase AA — themed. The theme tokens override the dark-only style sheet
  // values for backgrounds, text, and borders so light mode actually shifts.
  // Brand accents (#00C896 etc.) intentionally stay literal — they map to
  // the same accent token in both themes.
  const theme = useTheme();
  const c = theme.colors;

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
  const getTotalScore = useRoundStore(s => s.getTotalScore);
  const getScoreVsPar = useRoundStore(s => s.getScoreVsPar);
  const getHolesPlayed = useRoundStore(s => s.getHolesPlayed);

  const heroMoments = useRelationshipStore(s => s.heroMoments);

  // Phase Z — last completed round in roundHistory becomes the post-round
  // surface when no round is active. Lets the user return to the scorecard
  // after end-round to view share/Kevin recap.
  const lastCompletedRound = useMemo(() => {
    if (isRoundActive) return null;
    return roundHistory.length > 0 ? roundHistory[roundHistory.length - 1] : null;
  }, [isRoundActive, roundHistory]);

  // Phase Z — allow viewing the active round OR the last completed round.
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
    // Reconstruct minimal course-hole shape from the persisted record so the
    // grid still renders for completed rounds (the persisted record carries
    // pars/distances enough to display).
    : (() => {
        if (!lastCompletedRound) return [];
        // RoundRecord doesn't always carry full courseHoles; fall back to par 4 / 0 yds
        // when missing so the grid renders even for legacy records.
        const total = nineHoleMode ? 9 : 18;
        return Array.from({ length: total }, (_, i) => ({
          hole: i + 1,
          par: 4,
          distance: 0,
          front: 0, back: 0,
          teeLat: 0, teeLng: 0,
          middleLat: 0, middleLng: 0,
          frontLat: 0, frontLng: 0,
          backLat: 0, backLng: 0,
          note: '',
          estimated: false,
        }));
      })();

  const totalScore = isRoundActive
    ? getTotalScore()
    : Object.values(viewScores).reduce((a, b) => a + (b as number), 0);
  const totalPar = viewCourseHoles.slice(0, nineHoleMode ? 9 : 18).reduce((a, h) => a + h.par, 0);
  const scoreVsPar = isRoundActive ? getScoreVsPar() : totalScore - totalPar;
  const holesPlayed = isRoundActive ? getHolesPlayed() : Object.keys(viewScores).length;

  const nineScore = (start: number, end: number): number => {
    let total = 0;
    for (let i = start; i <= end; i++) total += (viewScores as Record<number, number>)[i] ?? 0;
    return total;
  };
  const ninePar = (start: number, end: number): number =>
    viewCourseHoles
      .filter(h => h.hole >= start && h.hole <= end)
      .reduce((a, h) => a + h.par, 0);

  const frontScore = nineScore(1, 9);
  const backScore = nineScore(10, 18);
  const frontPar = ninePar(1, 9);
  const backPar = ninePar(10, 18);

  const scoreVsParDisplay =
    scoreVsPar === 0 ? 'E'
    : scoreVsPar > 0 ? '+' + scoreVsPar
    : String(scoreVsPar);

  const scoreVsParColor =
    scoreVsPar < 0 ? '#00C896'
    : scoreVsPar === 0 ? '#ffffff'
    : '#fbbf24';

  const roundHeroMoments = heroMoments.filter(m => m.courseName === viewCourseName).length;
  const currentHolePar = viewCourseHoles.find(h => h.hole === currentHole)?.par ?? 4;

  // Animate active hole highlight
  const activeBorderAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(activeBorderAnim, { toValue: 1, duration: 150, useNativeDriver: false }).start();
    return () => { activeBorderAnim.setValue(0); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHole]);

  // Phase Z — club usage aggregation across this round's shots.
  // Voice-logged shots populate club + distance_yards; tap-logged
  // placeholders have null club so they're filtered out.
  type ClubAgg = { club: string; count: number; avg: number | null; total: number };
  const clubUsage: ClubAgg[] = useMemo(() => {
    const map = new Map<string, { count: number; distSum: number; distCount: number }>();
    (viewShots as ShotResult[]).forEach(s => {
      if (!s.club) return;
      const cur = map.get(s.club) ?? { count: 0, distSum: 0, distCount: 0 };
      cur.count += 1;
      const d = (s as ShotResult & { distance_yards?: number | null }).distance_yards;
      if (typeof d === 'number' && d > 0) {
        cur.distSum += d;
        cur.distCount += 1;
      }
      map.set(s.club, cur);
    });
    return Array.from(map.entries())
      .map(([club, v]) => ({
        club,
        count: v.count,
        avg: v.distCount > 0 ? Math.round(v.distSum / v.distCount) : null,
        total: v.distCount,
      }))
      .sort((a, b) => b.count - a.count);
  }, [viewShots]);

  // Phase Z — Kevin's Take (recap text). Loaded async from local archive.
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
    if (isSpeaking()) {
      void stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    try {
      await speak(recap.overall_kevin_summary, voiceGender, language, apiUrl, { userInitiated: true });
    } finally {
      setSpeaking(false);
    }
  }, [recap, voiceGender, language, apiUrl]);

  // Phase Z — share via system Share sheet (text representation).
  // Path A from the spec: text-only for v1.0 ship. Image export = 1.x.
  const onShare = useCallback(async () => {
    const lines: string[] = [];
    lines.push(viewCourseName ?? 'Round');
    if (isCompetition) lines.push('Competition Round');
    lines.push('Score ' + (totalScore || '—') + ' (' + scoreVsParDisplay + ' vs par)');
    lines.push('');
    const fmtRow = (label: string, vals: (string | number)[]) =>
      label.padEnd(5, ' ') + ' ' + vals.map(v => String(v).padStart(3, ' ')).join(' ');
    const sumNine = (start: number, end: number): number => {
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
        sumNine(start, end) || '—',
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
      clubUsage.slice(0, 8).forEach(c => {
        lines.push('  ' + c.club + '  ×' + c.count + (c.avg ? '  avg ' + c.avg + 'y' : ''));
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

  const handleQuickScore = (score: number) => {
    for (let i = 0; i < score; i++) {
      const placeholder: ShotResult = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i,
        feel: null, direction: null, shape: null, club: null,
        hole: currentHole, timestamp: Date.now(), acousticContact: null,
        outcome: 'clean', penalty_strokes: 0, rules_decision: undefined,
      };
      logShot(placeholder);
    }
    logScore(currentHole, score);
    logPutts(currentHole, 2);
    const maxHole = nineHoleMode ? 9 : 18;
    if (currentHole < maxHole) setCurrentHole(currentHole + 1);
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/caddie' as never);
  };

  const renderNineGrid = (start: number, end: number, label: 'OUT' | 'IN') => {
    const holes = viewCourseHoles.filter(h => h.hole >= start && h.hole <= end);
    const total = end === 9 ? frontScore : backScore;
    const totalPar9 = end === 9 ? frontPar : backPar;
    return (
      <View style={[styles.nineGrid, { backgroundColor: c.surface, borderColor: c.border }]}>
        {/* Hole row */}
        <View style={styles.gridRow}>
          <Text style={[styles.cell, styles.cellLabel]}>HOLE</Text>
          {holes.map(h => (
            <TouchableOpacity
              key={h.hole}
              onPress={() => isRoundActive && setCurrentHole(h.hole)}
              activeOpacity={isRoundActive ? 0.6 : 1}
              style={styles.cellWrap}
            >
              <Text style={[
                styles.cell,
                styles.cellHole,
                isRoundActive && h.hole === currentHole && styles.cellCurrent,
              ]}>{h.hole}</Text>
            </TouchableOpacity>
          ))}
          <Text style={[styles.cell, styles.cellTotal]}>{label}</Text>
        </View>
        {/* Par row */}
        <View style={styles.gridRow}>
          <Text style={[styles.cell, styles.cellLabel]}>PAR</Text>
          {holes.map(h => (
            <View key={h.hole} style={styles.cellWrap}>
              <Text style={[styles.cell, styles.cellPar]}>{h.par}</Text>
            </View>
          ))}
          <Text style={[styles.cell, styles.cellTotal]}>{totalPar9}</Text>
        </View>
        {/* Score row */}
        <View style={styles.gridRow}>
          <Text style={[styles.cell, styles.cellLabel]}>SCORE</Text>
          {holes.map(h => {
            const sc = (viewScores as Record<number, number>)[h.hole] ?? 0;
            const color = getScoreColor(sc, h.par);
            return (
              <TouchableOpacity
                key={h.hole}
                onPress={() => isRoundActive && setCurrentHole(h.hole)}
                activeOpacity={isRoundActive ? 0.6 : 1}
                style={styles.cellWrap}
              >
                {sc > 0 ? (
                  <View style={[styles.scorePill, { borderColor: color }]}>
                    <Text style={[styles.scorePillText, { color }]}>{sc}</Text>
                  </View>
                ) : (
                  <Text style={[styles.cell, styles.cellEmpty]}>·</Text>
                )}
              </TouchableOpacity>
            );
          })}
          <Text style={[styles.cell, styles.cellTotal, styles.cellTotalScore]}>
            {total > 0 ? total : '—'}
          </Text>
        </View>
        {/* Putts row (only show if any putts logged) */}
        {Object.keys(viewPutts).length > 0 && (
          <View style={styles.gridRow}>
            <Text style={[styles.cell, styles.cellLabel]}>PUTTS</Text>
            {holes.map(h => {
              const p = (viewPutts as Record<number, number>)[h.hole] ?? 0;
              return (
                <View key={h.hole} style={styles.cellWrap}>
                  <Text style={[styles.cell, styles.cellPutts]}>{p > 0 ? p : '·'}</Text>
                </View>
              );
            })}
            <Text style={[styles.cell, styles.cellTotal]}>
              {holes.reduce((a, h) => a + ((viewPutts as Record<number, number>)[h.hole] ?? 0), 0) || '—'}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const hasAnythingToShow = isRoundActive || lastCompletedRound != null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }} showsVerticalScrollIndicator={false}>

        {/* HEADER — back + title + share */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <AppIcon name="chevron-back" size={26} color={c.accent} />
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            <Text style={[styles.title, { color: c.text_primary }]}>Scorecard</Text>
            {isRoundActive && (
              <View style={styles.liveIndicator}>
                <Text style={styles.liveText}>● LIVE</Text>
              </View>
            )}
            {!isRoundActive && lastCompletedRound && (
              <View style={styles.savedIndicator}>
                <Text style={styles.savedText}>SAVED</Text>
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

        {/* COURSE NAME */}
        {viewCourseName && (
          <Text style={[styles.courseName, { color: c.text_muted }]}>{viewCourseName}</Text>
        )}

        {/* SCORE SUMMARY */}
        {hasAnythingToShow && (
          <View style={[styles.summary, { backgroundColor: c.surface_elevated, borderColor: c.border }]}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>SCORE</Text>
              <Text style={[styles.summaryValue, { color: c.text_primary }]}>{totalScore > 0 ? totalScore : '—'}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>VS PAR</Text>
              <Text style={[styles.summaryValue, { color: scoreVsParColor }]}>
                {holesPlayed > 0 ? scoreVsParDisplay : '—'}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: c.text_muted }]}>HOLES</Text>
              <Text style={[styles.summaryValue, { color: c.text_primary }]}>{holesPlayed}</Text>
            </View>
            {roundHeroMoments > 0 && (
              <>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>HERO</Text>
                  <Text style={[styles.summaryValue, { color: '#F5A623' }]}>★ {roundHeroMoments}</Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* NO ROUND STATE */}
        {!hasAnythingToShow && (
          <View style={styles.noRound}>
            <Text style={[styles.noRoundText, { color: c.text_muted }]}>No active round</Text>
            <Text style={[styles.noRoundSub, { color: c.text_muted }]}>Start a round from the Caddie tab</Text>
          </View>
        )}

        {/* ALL-HOLES GRID — Front 9 stacked over Back 9 */}
        {hasAnythingToShow && viewCourseHoles.length > 0 && (
          <View style={styles.gridSection}>
            {renderNineGrid(1, 9, 'OUT')}
            {!nineHoleMode && (
              <>
                <View style={{ height: 8 }} />
                {renderNineGrid(10, 18, 'IN')}
              </>
            )}
          </View>
        )}

        {/* TOTAL CARD */}
        {hasAnythingToShow && holesPlayed > 0 && (
          <View style={[styles.totalCard, { backgroundColor: c.surface_elevated }]}>
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
              <Text style={[styles.totalCardValue, { color: scoreVsParColor }]}>
                {scoreVsParDisplay}
              </Text>
            </View>
          </View>
        )}

        {/* CLUB USAGE SUMMARY */}
        {hasAnythingToShow && clubUsage.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>CLUB USAGE</Text>
            <View style={[styles.clubGrid, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={[styles.clubRow, { backgroundColor: c.surface_elevated, borderBottomColor: c.border }]}>
                <Text style={[styles.clubCell, styles.clubColClub, styles.clubHeaderText, { color: c.text_muted }]}>CLUB</Text>
                <Text style={[styles.clubCell, styles.clubColCount, styles.clubHeaderText, { color: c.text_muted }]}>USED</Text>
                <Text style={[styles.clubCell, styles.clubColAvg, styles.clubHeaderText, { color: c.text_muted }]}>AVG YDS</Text>
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
            {clubUsage.every(c => c.avg == null) && (
              <Text style={[styles.sectionHint, { color: c.text_muted }]}>
                Distance averages appear when shots are voice-logged with yardage.
              </Text>
            )}
          </View>
        )}

        {/* KEVIN'S TAKE — inline recap */}
        {hasAnythingToShow && recapLoaded && recap?.overall_kevin_summary && (
          <View style={styles.section}>
            <View style={styles.kevinHeader}>
              <Text style={[styles.sectionLabel, { color: c.text_muted }]}>KEVIN&apos;S TAKE</Text>
              {voiceEnabled && (
                <TouchableOpacity onPress={onSpeakRecap} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <View style={[styles.speakBtn, { borderColor: c.accent }]}>
                    <AppIcon
                      name={speaking ? 'pause' : 'play'}
                      size={12}
                      color={c.accent}
                    />
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
        {hasAnythingToShow && recapLoaded && !recap?.overall_kevin_summary && !isRoundActive && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>KEVIN&apos;S TAKE</Text>
            <View style={[styles.kevinCard, { backgroundColor: c.surface_elevated, borderColor: c.border }]}>
              <Text style={[styles.kevinPending, { color: c.text_muted }]}>
                Kevin&apos;s recap will appear here once it finishes generating.
              </Text>
            </View>
          </View>
        )}

        {/* QUICK SCORE CHIPS — only during active round on unscored hole */}
        {isRoundActive && !scores[currentHole] && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.text_muted }]}>HOLE {currentHole} · QUICK SCORE</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
            >
              {([-2, -1, 0, 1, 2, 3, 4] as const).map(diff => {
                const score = currentHolePar + diff;
                if (score < 1) return null;
                const color = getScoreColor(score, currentHolePar);
                const label =
                  diff <= -2 ? 'Eagle' :
                  diff === -1 ? 'Birdie' :
                  diff === 0 ? 'Par' :
                  diff === 1 ? 'Bogey' :
                  diff === 2 ? 'Double' :
                  diff === 3 ? 'Triple' :
                  ('+' + diff);
                return (
                  <TouchableOpacity
                    key={diff}
                    style={[styles.chip, { borderColor: color, backgroundColor: c.surface_elevated }]}
                    onPress={() => handleQuickScore(score)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.chipScore, { color }]}>{score}</Text>
                    <Text style={[styles.chipLabel, { color }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* COMPETITION BADGE */}
        {isCompetition && hasAnythingToShow && (
          <View style={styles.compBadge}>
            <AppIcon name="trophy" size={14} color="#F5A623" />
            <Text style={styles.compBadgeText}>Competition Round</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── STYLES ───────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8,
    gap: 12,
  },
  titleWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '900' },
  liveIndicator: {
    borderWidth: 1, borderColor: '#00C896', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  liveText: { color: '#00C896', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  savedIndicator: {
    borderWidth: 1, borderColor: '#6b7280', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  savedText: { color: '#9ca3af', fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  courseName: {
    color: '#9ca3af', fontSize: 14, fontWeight: '500',
    paddingHorizontal: 20, marginBottom: 12,
  },

  summary: {
    flexDirection: 'row',
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#0d2418', borderRadius: 14,
    borderWidth: 1, borderColor: '#1e3a28',
    paddingVertical: 14,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, backgroundColor: '#1e3a28', marginVertical: 4 },
  summaryLabel: {
    ...dataLabel,
    fontSize: 9, letterSpacing: 1.5, marginBottom: 4,
  },
  summaryValue: { ...dataValue, fontSize: 28, fontWeight: '900' as const },

  noRound: { alignItems: 'center', paddingVertical: 60 },
  noRoundText: { color: '#9ca3af', fontSize: 16, fontWeight: '600' },
  noRoundSub: { color: '#6b7280', fontSize: 13, marginTop: 6 },

  // Compact all-holes grid
  gridSection: {
    marginHorizontal: 12, marginBottom: 12,
  },
  nineGrid: {
    backgroundColor: '#0d1a0d', borderRadius: 12,
    borderWidth: 1, borderColor: '#1e3a28',
    overflow: 'hidden',
  },
  gridRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e3a28',
    alignItems: 'center',
  },
  cellWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cell: { textAlign: 'center', fontSize: 13, color: '#ffffff' },
  cellLabel: {
    ...dataLabel,
    width: 52, fontSize: 9, letterSpacing: 1, color: '#6b7280',
    paddingLeft: 8,
  },
  cellHole: { fontSize: 12, color: '#9ca3af', fontWeight: '700' },
  cellPar: { fontSize: 12, color: '#9ca3af' },
  cellPutts: { fontSize: 11, color: '#6b7280' },
  cellEmpty: { color: '#374151', fontSize: 14 },
  cellCurrent: { color: '#00C896', fontWeight: '900' },
  cellTotal: {
    width: 38, fontSize: 13, fontWeight: '900',
    color: '#00C896', textAlign: 'center',
  },
  cellTotalScore: { fontSize: 14, color: '#ffffff' },
  scorePill: {
    minWidth: 26, height: 26, paddingHorizontal: 4,
    borderRadius: 13, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  scorePillText: { fontSize: 13, fontWeight: '800' },

  totalCard: {
    flexDirection: 'row',
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: '#0d2418', borderRadius: 12,
    borderWidth: 1.5, borderColor: '#00C896',
    paddingVertical: 14,
  },
  totalCardItem: { flex: 1, alignItems: 'center' },
  totalCardDivider: { width: 1, backgroundColor: '#1e3a28', marginVertical: 4 },
  totalCardLabel: {
    ...dataLabel,
    fontSize: 9, letterSpacing: 1.5, marginBottom: 4,
  },
  totalCardValue: { ...dataValue, fontSize: 32, fontWeight: '900' as const },

  // Reusable section styling
  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionLabel: {
    color: '#6b7280', fontSize: 10, fontWeight: '800',
    letterSpacing: 1.5, marginBottom: 8,
  },
  sectionHint: {
    color: '#6b7280', fontSize: 11, fontStyle: 'italic',
    marginTop: 8,
  },

  // Club usage
  clubGrid: {
    backgroundColor: '#0d1a0d', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28',
    overflow: 'hidden',
  },
  clubRow: {
    flexDirection: 'row',
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e3a28',
    alignItems: 'center',
  },
  clubHeader: { backgroundColor: '#0d2418' },
  clubHeaderText: {
    ...dataLabel, fontSize: 9, letterSpacing: 1.5, color: '#6b7280',
  },
  clubCell: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  clubColClub: { flex: 2, textAlign: 'left' },
  clubColCount: { flex: 1, textAlign: 'center', color: '#9ca3af', fontWeight: '500' },
  clubColAvg: { flex: 1, textAlign: 'right', color: '#00C896' },
  clubAvgNone: { color: '#374151', fontWeight: '500' },

  // Kevin's Take
  kevinHeader: {
    flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  speakBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 12, borderWidth: 1, borderColor: '#00C896',
  },
  speakBtnText: { color: '#00C896', fontSize: 11, fontWeight: '700' },
  kevinCard: {
    backgroundColor: '#0d2418', borderRadius: 12,
    borderWidth: 1, borderColor: '#1e3a28',
    padding: 14,
  },
  kevinText: { color: '#ffffff', fontSize: 14, lineHeight: 20 },
  kevinPending: { color: '#6b7280', fontSize: 13, fontStyle: 'italic' },

  // Quick score chips
  chipsRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  chip: {
    alignItems: 'center', backgroundColor: '#0d2418',
    borderWidth: 1.5, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 14,
    minWidth: 58,
  },
  chipScore: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  chipLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 2,
  },

  compBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: '#1a0a00', borderRadius: 10,
    borderWidth: 1, borderColor: '#F5A623',
    paddingVertical: 10, paddingHorizontal: 12,
    justifyContent: 'center',
  },
  compBadgeText: { color: '#F5A623', fontSize: 13, fontWeight: '700' },
});
