import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoundStore } from '../../store/roundStore';
import { useRelationshipStore } from '../../store/relationshipStore';
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
  const {
    isRoundActive,
    activeCourse,
    courseHoles,
    scores,
    putts,
    currentHole,
    nineHoleMode,
    isCompetition,
    setCurrentHole,
    logScore,
    logPutts,
    getTotalScore,
    getScoreVsPar,
    getHolesPlayed,
  } = useRoundStore();

  const { heroMoments } = useRelationshipStore();

  const [showNine, setShowNine] = useState<'front' | 'back'>('front');

  const totalScore = getTotalScore();
  const scoreVsPar = getScoreVsPar();
  const holesPlayed = getHolesPlayed();

  const totalPar = courseHoles
    .slice(0, nineHoleMode ? 9 : 18)
    .reduce((a, h) => a + h.par, 0);

  const displayHoles = nineHoleMode
    ? courseHoles.slice(0, 9)
    : showNine === 'front'
    ? courseHoles.slice(0, 9)
    : courseHoles.slice(9, 18);

  const nineScore = (start: number, end: number): number => {
    let total = 0;
    for (let i = start; i <= end; i++) total += scores[i] ?? 0;
    return total;
  };

  const ninePar = (start: number, end: number): number =>
    courseHoles
      .filter(h => h.hole >= start && h.hole <= end)
      .reduce((a, h) => a + h.par, 0);

  const frontScore = nineScore(1, 9);
  const backScore  = nineScore(10, 18);
  const frontPar   = ninePar(1, 9);
  const backPar    = ninePar(10, 18);

  const scoreVsParDisplay =
    scoreVsPar === 0 ? 'E'
    : scoreVsPar > 0 ? '+' + scoreVsPar
    : String(scoreVsPar);

  const scoreVsParColor =
    scoreVsPar < 0 ? '#00C896'
    : scoreVsPar === 0 ? '#ffffff'
    : '#fbbf24';

  const roundHeroMoments = heroMoments.filter(
    m => m.courseName === activeCourse
  ).length;

  const currentHolePar = courseHoles.find(h => h.hole === currentHole)?.par ?? 4;

  // Animate active hole border color
  const activeBorderAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(activeBorderAnim, {
      toValue: 1,
      duration: 150,
      useNativeDriver: false,
    }).start();
    return () => { activeBorderAnim.setValue(0); };
  }, [currentHole]);
  const activeBorderColor = activeBorderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#1e3a28', '#00C896'],
  });

  const handleQuickScore = (score: number) => {
    logScore(currentHole, score);
    logPutts(currentHole, 2);
    const maxHole = nineHoleMode ? 9 : 18;
    if (currentHole < maxHole) {
      setCurrentHole(currentHole + 1);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.title}>Scorecard</Text>
          {isRoundActive && (
            <View style={styles.liveIndicator}>
              <Text style={styles.liveText}>● LIVE</Text>
            </View>
          )}
        </View>

        {/* COURSE NAME */}
        {activeCourse && (
          <Text style={styles.courseName}>{activeCourse}</Text>
        )}

        {/* SCORE SUMMARY */}
        {isRoundActive && (
          <View style={styles.summary}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>SCORE</Text>
              <Text style={styles.summaryValue}>
                {totalScore > 0 ? totalScore : '—'}
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>VS PAR</Text>
              <Text style={[styles.summaryValue, { color: scoreVsParColor }]}>
                {holesPlayed > 0 ? scoreVsParDisplay : '—'}
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>HOLES</Text>
              <Text style={styles.summaryValue}>{holesPlayed}</Text>
            </View>
            {roundHeroMoments > 0 && (
              <>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>HERO</Text>
                  <Text style={[styles.summaryValue, { color: '#F5A623' }]}>
                    {'★ ' + roundHeroMoments}
                  </Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* NO ROUND STATE */}
        {!isRoundActive && (
          <View style={styles.noRound}>
            <Text style={styles.noRoundText}>No active round</Text>
            <Text style={styles.noRoundSub}>Start a round from the Caddie tab</Text>
          </View>
        )}

        {/* 9-HOLE TOGGLE */}
        {isRoundActive && !nineHoleMode && (
          <View style={styles.nineToggle}>
            {(['front', 'back'] as const).map(side => (
              <TouchableOpacity
                key={side}
                style={[styles.nineBtn, showNine === side && styles.nineBtnActive]}
                onPress={() => setShowNine(side)}
              >
                <Text style={[
                  styles.nineBtnText,
                  showNine === side && styles.nineBtnTextActive,
                ]}>
                  {side === 'front' ? 'Front 9' : 'Back 9'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* SCORECARD GRID */}
        {isRoundActive && courseHoles.length > 0 && (
          <View style={styles.grid}>

            {/* Column headers */}
            <View style={styles.gridRow}>
              <Text style={[styles.gridHeader, styles.gridHoleCol]}>HOLE</Text>
              <Text style={[styles.gridHeader, styles.gridParCol]}>PAR</Text>
              <Text style={[styles.gridHeader, styles.gridYardCol]}>YDS</Text>
              <Text style={[styles.gridHeader, styles.gridScoreCol]}>SCORE</Text>
              <Text style={[styles.gridHeader, styles.gridPuttCol]}>PUTTS</Text>
            </View>

            {/* Hole rows */}
            {displayHoles.map(h => {
              const score = scores[h.hole] ?? 0;
              const holePutts = putts[h.hole] ?? 0;
              const isCurrent = h.hole === currentHole;
              const hasScore = score > 0;
              const scoreColor = getScoreColor(score, h.par);

              if (isCurrent) {
                return (
                  <Animated.View
                    key={h.hole}
                    style={[
                      styles.gridRow,
                      styles.gridRowCurrent,
                      { borderLeftWidth: 2, borderLeftColor: activeBorderColor },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.gridRowInner}
                      onPress={() => setCurrentHole(h.hole)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.gridCell, styles.gridHoleCol, { color: '#00C896', fontWeight: '700' }]}>
                        {h.hole}
                      </Text>
                      <Text style={[styles.gridCell, styles.gridParCol]}>{h.par}</Text>
                      <Text style={[styles.gridCell, styles.gridYardCol, styles.yardCell]}>
                        {h.distance}
                      </Text>
                      <View style={[styles.gridScoreCol, styles.scoreCellWrapper]}>
                        {hasScore ? (
                          <View style={[styles.scoreCircle, { borderColor: scoreColor }]}>
                            <Text style={[styles.scoreCircleText, { color: scoreColor }]}>
                              {score}
                            </Text>
                          </View>
                        ) : (
                          <Text style={styles.noScoreText}>·</Text>
                        )}
                      </View>
                      <Text style={[styles.gridCell, styles.gridPuttCol, styles.puttCell]}>
                        {holePutts > 0 ? holePutts : '—'}
                      </Text>
                    </TouchableOpacity>
                  </Animated.View>
                );
              }

              return (
                <TouchableOpacity
                  key={h.hole}
                  style={styles.gridRow}
                  onPress={() => setCurrentHole(h.hole)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.gridCell, styles.gridHoleCol]}>{h.hole}</Text>
                  <Text style={[styles.gridCell, styles.gridParCol]}>{h.par}</Text>
                  <Text style={[styles.gridCell, styles.gridYardCol, styles.yardCell]}>
                    {h.distance}
                  </Text>
                  <View style={[styles.gridScoreCol, styles.scoreCellWrapper]}>
                    {hasScore ? (
                      <View style={[styles.scoreCircle, { borderColor: scoreColor }]}>
                        <Text style={[styles.scoreCircleText, { color: scoreColor }]}>
                          {score}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.noScoreText}>—</Text>
                    )}
                  </View>
                  <Text style={[styles.gridCell, styles.gridPuttCol, styles.puttCell]}>
                    {holePutts > 0 ? holePutts : '—'}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {/* Nine total row */}
            {!nineHoleMode && (
              <View style={[styles.gridRow, styles.totalRow]}>
                <Text style={[styles.gridCell, styles.gridHoleCol, styles.totalLabel]}>
                  {showNine === 'front' ? 'OUT' : 'IN'}
                </Text>
                <Text style={[styles.gridCell, styles.gridParCol, styles.totalLabel]}>
                  {showNine === 'front' ? frontPar : backPar}
                </Text>
                <Text style={[styles.gridCell, styles.gridYardCol]} />
                <Text style={[styles.gridCell, styles.gridScoreCol, styles.totalLabel]}>
                  {showNine === 'front'
                    ? (frontScore > 0 ? frontScore : '—')
                    : (backScore > 0 ? backScore : '—')}
                </Text>
                <Text style={[styles.gridCell, styles.gridPuttCol]} />
              </View>
            )}

          </View>
        )}

        {/* TOTAL ROW */}
        {isRoundActive && holesPlayed > 0 && (
          <View style={styles.totalCard}>
            <View style={styles.totalCardItem}>
              <Text style={styles.totalCardLabel}>TOTAL</Text>
              <Text style={styles.totalCardValue}>{totalScore}</Text>
            </View>
            <View style={styles.totalCardDivider} />
            <View style={styles.totalCardItem}>
              <Text style={styles.totalCardLabel}>PAR</Text>
              <Text style={styles.totalCardValue}>{totalPar}</Text>
            </View>
            <View style={styles.totalCardDivider} />
            <View style={styles.totalCardItem}>
              <Text style={styles.totalCardLabel}>DIFF</Text>
              <Text style={[styles.totalCardValue, { color: scoreVsParColor }]}>
                {scoreVsParDisplay}
              </Text>
            </View>
          </View>
        )}

        {/* QUICK SCORE CHIPS */}
        {isRoundActive && !scores[currentHole] && (
          <View style={styles.quickChipsSection}>
            <Text style={styles.quickChipsLabel}>
              {'Hole ' + currentHole + ' · Quick Score'}
            </Text>
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
                    style={[styles.chip, { borderColor: color }]}
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
        {isCompetition && (
          <View style={styles.compBadge}>
            <Text style={styles.compBadgeText}>🏆 Competition Round</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── STYLES ───────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
  },
  liveIndicator: {
    borderWidth: 1,
    borderColor: '#00C896',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  liveText: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  courseName: {
    color: '#6b7280',
    fontSize: 13,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  summary: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#0d2418',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
    paddingVertical: 14,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: '#1e3a28',
    marginVertical: 4,
  },
  summaryLabel: {
    ...dataLabel,
    fontSize: 9,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  summaryValue: {
    ...dataValue,
    fontSize: 28,
    fontWeight: '900' as const,
  },
  noRound: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  noRoundText: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '600',
  },
  noRoundSub: {
    color: '#374151',
    fontSize: 13,
    marginTop: 6,
  },
  nineToggle: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 6,
  },
  nineBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e3a28',
    backgroundColor: '#060f09',
  },
  nineBtnActive: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  nineBtnText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
  nineBtnTextActive: {
    color: '#00C896',
  },
  grid: {
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e3a28',
    marginBottom: 8,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
    backgroundColor: '#0d1a0d',
  },
  gridRowInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  gridRowCurrent: {
    backgroundColor: '#0d2418',
  },
  gridHeader: {
    ...dataLabel,
    textAlign: 'center',
    fontSize: 9,
  },
  gridCell: {
    ...dataValue,
    fontSize: 15,
    textAlign: 'center',
  },
  yardCell: {
    fontSize: 12,
    color: '#9ca3af',
    letterSpacing: 0,
  },
  puttCell: {
    color: '#6b7280',
    fontSize: 13,
  },
  gridHoleCol:  { flex: 1.2 },
  gridParCol:   { flex: 0.8 },
  gridYardCol:  { flex: 1.2 },
  gridScoreCol: { flex: 1.2 },
  gridPuttCol:  { flex: 0.8 },
  scoreCellWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreCircleText: {
    fontSize: 14,
    fontWeight: '800',
  },
  noScoreText: {
    color: '#374151',
    fontSize: 16,
  },
  totalRow: {
    backgroundColor: '#0d2418',
  },
  totalLabel: {
    color: '#00C896',
    fontWeight: '800',
  },
  totalCard: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#0d2418',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#00C896',
    paddingVertical: 14,
  },
  totalCardItem: {
    flex: 1,
    alignItems: 'center',
  },
  totalCardDivider: {
    width: 1,
    backgroundColor: '#1e3a28',
    marginVertical: 4,
  },
  totalCardLabel: {
    ...dataLabel,
    fontSize: 9,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  totalCardValue: {
    ...dataValue,
    fontSize: 32,
    fontWeight: '900' as const,
  },
  quickChipsSection: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  quickChipsLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 8,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: '#0d2418',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minWidth: 58,
  },
  chipScore: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  chipLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  compBadge: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#1a0a00',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F5A623',
    paddingVertical: 10,
    alignItems: 'center',
  },
  compBadgeText: {
    color: '#F5A623',
    fontSize: 13,
    fontWeight: '700',
  },
});
