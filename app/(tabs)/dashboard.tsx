import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoundStore } from '../../store/roundStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { usePointsStore } from '../../store/pointsStore';
import AppIcon from '../../components/AppIcon';
import { useRouter } from 'expo-router';
import { detectPatternShift } from '../../services/patternDetection';

export default function Dashboard() {
  const router = useRouter();
  const {
    isRoundActive,
    activeCourse,
    getTotalScore,
    getScoreVsPar,
    getHolesPlayed,
  } = useRoundStore();
  const roundHistory = useRoundStore(s => s.roundHistory);
  // Phase U Component 3 — surface a meaningful pattern drift when one exists.
  const patternShift = React.useMemo(
    () => detectPatternShift(roundHistory.map(r => ({ shots: r.shots }))),
    [roundHistory],
  );

  const {
    roundsTogether,
    sessionsTogether,
    heroMoments,
    breakthroughs,
    confidenceByClub,
    currentMentalState,
  } = useRelationshipStore();

  const {
    handicap,
    personalBest,
    goal,
    dominantMiss,
  } = usePlayerProfileStore();

  const {
    totalPoints,
    tier,
  } = usePointsStore();

  const totalScore = getTotalScore();
  const scoreVsPar = getScoreVsPar();
  const holesPlayed = getHolesPlayed();

  const topClubs = Object.entries(confidenceByClub)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  const scoreVsParDisplay =
    scoreVsPar === 0 ? 'E'
    : scoreVsPar > 0 ? '+' + scoreVsPar
    : String(scoreVsPar);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >

        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.title}>Dashboard</Text>
          {roundsTogether > 0 && (
            <Text style={styles.subtitle}>
              {roundsTogether + ' rounds with Kevin'}
            </Text>
          )}
        </View>

        {/* ACTIVE ROUND CARD */}
        {isRoundActive && (
          <View style={styles.activeCard}>
            <View style={styles.activeHeader}>
              <Text style={styles.activeLabel}>● ROUND IN PROGRESS</Text>
              <Text style={styles.activeCourse}>{activeCourse}</Text>
            </View>
            <View style={styles.activeStats}>
              <View style={styles.activeStat}>
                <Text style={styles.activeStatValue}>
                  {totalScore > 0 ? totalScore : '—'}
                </Text>
                <Text style={styles.activeStatLabel}>Score</Text>
              </View>
              <View style={styles.activeStat}>
                <Text style={[
                  styles.activeStatValue,
                  {
                    color: scoreVsPar < 0
                      ? '#00C896'
                      : scoreVsPar === 0
                      ? '#ffffff'
                      : '#fbbf24',
                  },
                ]}>
                  {holesPlayed > 0 ? scoreVsParDisplay : '—'}
                </Text>
                <Text style={styles.activeStatLabel}>Vs Par</Text>
              </View>
              <View style={styles.activeStat}>
                <Text style={styles.activeStatValue}>{holesPlayed}</Text>
                <Text style={styles.activeStatLabel}>Holes</Text>
              </View>
            </View>
          </View>
        )}

        {/* PLAYER CARD */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Player</Text>
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{handicap}</Text>
              <Text style={styles.statLabel}>Handicap</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: '#F5A623' }]}>
                {personalBest ?? '—'}
              </Text>
              <Text style={styles.statLabel}>Best Round</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: '#00C896' }]}>
                {roundsTogether}
              </Text>
              <Text style={styles.statLabel}>Rounds</Text>
            </View>
          </View>
          {goal ? (
            <View style={styles.goalRow}>
              <Text style={styles.goalLabel}>GOAL</Text>
              <Text style={styles.goalText}>{goal}</Text>
            </View>
          ) : null}
          {dominantMiss ? (
            <View style={styles.goalRow}>
              <Text style={styles.goalLabel}>MISS</Text>
              <Text style={styles.goalText}>{dominantMiss}</Text>
            </View>
          ) : null}
        </View>

        {/* POINTS CARD */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Progress</Text>
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: '#F5A623' }]}>
                {totalPoints}
              </Text>
              <Text style={styles.statLabel}>Points</Text>
            </View>
            <View style={[styles.stat, { flex: 2 }]}>
              <Text style={[styles.statValue, { fontSize: 16, color: '#00C896' }]}>
                {tier}
              </Text>
              <Text style={styles.statLabel}>Tier</Text>
            </View>
          </View>
        </View>

        {/* KEVIN'S RELATIONSHIP */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Kevin&apos;s Read</Text>

          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{sessionsTogether}</Text>
              <Text style={styles.statLabel}>Sessions</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: '#F5A623' }]}>
                {heroMoments.length}
              </Text>
              <Text style={styles.statLabel}>Hero Shots</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: '#00C896' }]}>
                {breakthroughs.length}
              </Text>
              <Text style={styles.statLabel}>Milestones</Text>
            </View>
          </View>

          <View style={styles.mentalRow}>
            <Text style={styles.mentalLabel}>MENTAL STATE</Text>
            <Text style={[
              styles.mentalValue,
              {
                color:
                  currentMentalState === 'confident' ? '#00C896'
                  : currentMentalState === 'spiraling' ? '#ef4444'
                  : currentMentalState === 'tight' ? '#fbbf24'
                  : '#9ca3af',
              },
            ]}>
              {currentMentalState.charAt(0).toUpperCase() +
                currentMentalState.slice(1)}
            </Text>
          </View>

          {topClubs.length > 0 && (
            <View style={styles.clubRow}>
              <Text style={styles.clubRowLabel}>TRUSTED CLUBS</Text>
              <View style={styles.clubPills}>
                {topClubs.map(([club, conf]) => (
                  <View key={club} style={styles.clubPill}>
                    <Text style={styles.clubPillText}>{club}</Text>
                    <Text style={styles.clubPillConf}>
                      {Math.round(conf * 100) + '%'}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* HERO REEL */}
        <View style={styles.card}>
          <View style={styles.heroHeader}>
            <Text style={styles.cardTitle}>Hero Reel</Text>
            {heroMoments.length > 0 && (
              <Text style={styles.heroCount}>
                {'★ ' + heroMoments.length + ' moments saved'}
              </Text>
            )}
          </View>

          {[...heroMoments]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 5)
            .map(moment => (
              <View key={moment.id} style={styles.heroItem}>
                <View style={styles.heroStarBadge}>
                  <Text style={styles.heroStarText}>★</Text>
                </View>
                <View style={styles.heroInfo}>
                  <Text style={styles.heroHole}>
                    {'Hole ' + moment.hole + ' · ' + moment.club}
                  </Text>
                  <Text style={styles.heroCourse}>
                    {moment.courseName || 'Practice'}
                  </Text>
                  <Text style={styles.heroKevin}>
                    {'"' + moment.kevinSaid + '"'}
                  </Text>
                </View>
                <Text style={styles.heroDate}>
                  {new Date(moment.timestamp).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            ))}

          {heroMoments.length === 0 && (
            <Text style={styles.heroEmpty}>
              {'Say "Kevin did you get that?" after a pure shot to save it to your hero reel.'}
            </Text>
          )}
        </View>

        {/* PHASE U — pattern shift alert (proactive surfacing) */}
        {patternShift && (
          <TouchableOpacity
            style={[styles.card, { borderColor: patternShift.severity === 'significant' ? '#fbbf24' : '#1e3a28', borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', gap: 12 }]}
            onPress={() => router.push('/(tabs)/swinglab' as never)}
            activeOpacity={0.85}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(251,191,36,0.12)', alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name="trending-up-outline" size={20} color="#fbbf24" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fbbf24', fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>PATTERN SHIFT</Text>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', marginTop: 4, lineHeight: 18 }}>{patternShift.alert_message}</Text>
            </View>
            <AppIcon name="chevron-forward" size={18} color="#6b7280" />
          </TouchableOpacity>
        )}

        {/* BREAKTHROUGHS */}
        {breakthroughs.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Milestones</Text>
            {[...breakthroughs]
              .slice(-3)
              .reverse()
              .map(bt => (
                <View key={bt.id} style={styles.btItem}>
                  <AppIcon name="trophy" size={18} color="#F5A623" />
                  <Text style={styles.btText}>{bt.description}</Text>
                </View>
              ))}
          </View>
        )}

        {/* EMPTY STATE */}
        {roundsTogether === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No rounds yet</Text>
            <Text style={styles.emptySub}>
              {'Start your first round with Kevin to see your stats here'}
            </Text>
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
  scroll: {
    paddingBottom: 32,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 2,
  },
  activeCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#0d2418',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#00C896',
    padding: 14,
  },
  activeHeader: {
    marginBottom: 10,
  },
  activeLabel: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  activeCourse: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  activeStats: {
    flexDirection: 'row',
  },
  activeStat: {
    flex: 1,
    alignItems: 'center',
  },
  activeStatValue: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
  },
  activeStatLabel: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 2,
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#0d1a0d',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 14,
  },
  cardTitle: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  statRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
  },
  statLabel: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 2,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
    marginTop: 8,
  },
  goalLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    width: 40,
  },
  goalText: {
    color: '#9ca3af',
    fontSize: 13,
    flex: 1,
  },
  mentalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
  },
  mentalLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  mentalValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  clubRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
  },
  clubRowLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  clubPills: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  clubPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#060f09',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e3a28',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  clubPillText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  clubPillConf: {
    color: '#00C896',
    fontSize: 11,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  heroCount: {
    color: '#F5A623',
    fontSize: 12,
    fontWeight: '700',
  },
  heroItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  heroStarBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1a1000',
    borderWidth: 1,
    borderColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStarText: {
    color: '#F5A623',
    fontSize: 14,
  },
  heroInfo: {
    flex: 1,
  },
  heroHole: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  heroCourse: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 1,
  },
  heroKevin: {
    color: '#6b7280',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 3,
  },
  heroDate: {
    color: '#6b7280',
    fontSize: 12,
  },
  heroEmpty: {
    color: '#374151',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
    lineHeight: 18,
  },
  btItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  btIcon: {
    fontSize: 16,
  },
  btText: {
    color: '#9ca3af',
    fontSize: 13,
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    color: '#6b7280',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySub: {
    color: '#374151',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
