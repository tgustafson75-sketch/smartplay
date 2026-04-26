import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCageStore } from '../../store/cageStore';
import { analyzeSession } from '../../services/patternEngine';

export default function CageHistory() {
  const router = useRouter();
  const { sessionHistory } = useCageStore();

  const [expanded, setExpanded] = useState<string | null>(null);

  const sessions = sessionHistory.slice().reverse().slice(0, 10);

  if (sessions.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Session History</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No sessions yet.</Text>
          <Text style={styles.emptySub}>
            Complete a cage session to see your history here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>History</Text>
          <View style={{ width: 60 }} />
        </View>

        {sessions.map((session) => {
          const pattern = analyzeSession(session.shots, session.club);
          const isExpanded = expanded === session.id;
          const date = new Date(session.date);
          const dateStr = date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });

          return (
            <TouchableOpacity
              key={session.id}
              style={styles.sessionCard}
              onPress={() => setExpanded(isExpanded ? null : session.id)}
              activeOpacity={0.85}
            >
              {/* SESSION HEADER */}
              <View style={styles.sessionHeader}>
                <View style={styles.sessionLeft}>
                  <Text style={styles.sessionClub}>{session.club}</Text>
                  <Text style={styles.sessionDate}>{dateStr}</Text>
                </View>

                <View style={styles.sessionRight}>
                  <Text style={[
                    styles.sessionFlush,
                    {
                      color:
                        pattern.flushRate >= 70 ? '#00C896' :
                        pattern.flushRate >= 50 ? '#fbbf24' : '#ef4444',
                    },
                  ]}>
                    {pattern.flushRate + '%'}
                  </Text>
                  <Text style={styles.sessionShots}>
                    {session.shots.length + ' shots'}
                  </Text>
                </View>

                <Text style={styles.chevron}>{isExpanded ? '▾' : '▸'}</Text>
              </View>

              {/* MINI DOT STRIP */}
              <View style={styles.miniDots}>
                {session.shots.slice(0, 20).map((shot, i) => {
                  const color =
                    shot.feel === 'flush' || shot.feel === 'solid' ? '#00C896' :
                    shot.feel === 'fat'  ? '#f97316' :
                    shot.feel === 'thin' ? '#fbbf24' : '#ef4444';
                  return (
                    <View
                      key={i}
                      style={[styles.miniDot, { backgroundColor: color }]}
                    />
                  );
                })}
                {session.shots.length > 20 && (
                  <Text style={styles.moreDots}>+{session.shots.length - 20}</Text>
                )}
              </View>

              {/* EXPANDED DETAIL */}
              {isExpanded && (
                <View style={styles.detail}>
                  <View style={styles.detailStats}>
                    {[
                      { label: 'Solid', value: pattern.flushRate + '%', color: '#00C896' },
                      { label: 'Fat',   value: pattern.fatRate + '%',   color: '#f97316' },
                      { label: 'Thin',  value: pattern.thinRate + '%',  color: '#fbbf24' },
                    ].map(stat => (
                      <View key={stat.label} style={styles.detailStat}>
                        <Text style={[styles.detailValue, { color: stat.color }]}>
                          {stat.value}
                        </Text>
                        <Text style={styles.detailLabel}>{stat.label}</Text>
                      </View>
                    ))}
                    {pattern.dominantMiss && (
                      <View style={styles.detailStat}>
                        <Text style={[styles.detailValue, { fontSize: 13 }]}>
                          {pattern.dominantMiss.charAt(0).toUpperCase() +
                           pattern.dominantMiss.slice(1)}
                        </Text>
                        <Text style={styles.detailLabel}>Miss</Text>
                      </View>
                    )}
                  </View>

                  {session.summary && (
                    <View style={styles.kevinSummary}>
                      <Text style={styles.kevinLabel}>KEVIN</Text>
                      <Text style={styles.kevinText}>{session.summary}</Text>
                    </View>
                  )}

                  {session.rootCause && (
                    <View style={styles.rootCause}>
                      <Text style={styles.rootCauseLabel}>FOCUS AREA</Text>
                      <Text style={styles.rootCauseText}>{session.rootCause}</Text>
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        })}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backText: {
    color: '#00C896',
    fontSize: 16,
    fontWeight: '600',
    width: 60,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
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
  sessionCard: {
    backgroundColor: '#0d1a0d',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 14,
    marginBottom: 10,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  sessionLeft: {
    flex: 1,
  },
  sessionClub: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  sessionDate: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  sessionRight: {
    alignItems: 'flex-end',
  },
  sessionFlush: {
    fontSize: 22,
    fontWeight: '900',
  },
  sessionShots: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 1,
  },
  chevron: {
    color: '#6b7280',
    fontSize: 18,
    width: 20,
    textAlign: 'center',
  },
  miniDots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    alignItems: 'center',
  },
  miniDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  moreDots: {
    color: '#6b7280',
    fontSize: 11,
    marginLeft: 2,
  },
  detail: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
    gap: 10,
  },
  detailStats: {
    flexDirection: 'row',
    gap: 8,
  },
  detailStat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#060f09',
    borderRadius: 8,
    paddingVertical: 8,
  },
  detailValue: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  detailLabel: {
    color: '#6b7280',
    fontSize: 10,
    marginTop: 2,
  },
  kevinSummary: {
    backgroundColor: '#060f09',
    borderLeftWidth: 2,
    borderLeftColor: '#00C896',
    borderRadius: 6,
    padding: 10,
  },
  kevinLabel: {
    color: '#00C896',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 4,
  },
  kevinText: {
    color: '#ffffff',
    fontSize: 13,
    lineHeight: 19,
  },
  rootCause: {
    backgroundColor: '#1a0800',
    borderRadius: 6,
    padding: 8,
  },
  rootCauseLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 3,
  },
  rootCauseText: {
    color: '#fbbf24',
    fontSize: 13,
  },
});
