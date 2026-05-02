import React, { useEffect } from 'react';
import { activateMediaSession, deactivateMediaSession } from '../../services/mediaKeyBridge';
import { setActiveSurface } from '../../services/activeSurfaceRegistry';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { usePointsStore } from '../../store/pointsStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import KevinCoachBox from '../../components/swinglab/KevinCoachBox';
import { getDialog } from '../../services/dialogEngine';

const CHALLENGES = [
  {
    id: 'ctp',
    icon: '🎯',
    title: 'Closest to Pin',
    sub: 'Pick a distance. Best of 5 shots.',
    points: '50 pts',
    color: '#00C896',
    route: '/arena/ctp',
  },
  {
    id: 'skills',
    icon: '⭐',
    title: 'Skills Challenge',
    sub: 'Hit targets at multiple distances.',
    points: '75 pts',
    color: '#F5A623',
    route: '/arena/skills',
  },
  {
    id: 'sim',
    icon: '🏌️',
    title: 'Sim Round',
    sub: 'Play a simulated round hole by hole.',
    points: '100 pts',
    color: '#3b82f6',
    route: '/arena/sim-round',
  },
  {
    id: 'scramble',
    icon: '🤝',
    title: 'Scramble',
    sub: 'Best ball format. Play with a partner.',
    points: '60 pts',
    color: '#a855f7',
    route: '/arena/scramble',
  },
];

export default function ArenaIndex() {
  const router = useRouter();
  const { totalPoints, tier } = usePointsStore();
  const { roundsTogether } = useRelationshipStore();

  // Phase O.5 — Arena is an earbud-tap-active surface
  // Phase R — also register as Psychologist-mode surface for opener routing
  useEffect(() => {
    void activateMediaSession();
    setActiveSurface('arena');
    return () => {
      void deactivateMediaSession();
      setActiveSurface(null);
    };
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Arena</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* POINTS BANNER */}
        <View style={styles.pointsBanner}>
          <View style={styles.pointsItem}>
            <Text style={styles.pointsValue}>{totalPoints}</Text>
            <Text style={styles.pointsLabel}>Points</Text>
          </View>
          <View style={styles.pointsDivider} />
          <View style={styles.pointsItem}>
            <Text style={[styles.pointsValue, { fontSize: 16, color: '#00C896' }]}>{tier}</Text>
            <Text style={styles.pointsLabel}>Tier</Text>
          </View>
          <View style={styles.pointsDivider} />
          <View style={styles.pointsItem}>
            <Text style={styles.pointsValue}>{roundsTogether}</Text>
            <Text style={styles.pointsLabel}>Rounds</Text>
          </View>
        </View>

        {/* Phase I — Kevin's Psychologist-leaning intro on Arena (gameplay
             register, not coaching register). */}
        <KevinCoachBox
          body={getDialog('coach', 'arena_intro')}
          accent="psychologist"
        />

        {/* CHALLENGES */}
        <Text style={styles.sectionLabel}>Choose a Challenge</Text>

        {CHALLENGES.map(challenge => (
          <TouchableOpacity
            key={challenge.id}
            style={styles.challengeCard}
            onPress={() => router.push(challenge.route as never)}
            activeOpacity={0.85}
          >
            <View style={[styles.challengeIcon, { backgroundColor: challenge.color + '20' }]}>
              <Text style={styles.challengeEmoji}>{challenge.icon}</Text>
            </View>
            <View style={styles.challengeInfo}>
              <Text style={styles.challengeTitle}>{challenge.title}</Text>
              <Text style={styles.challengeSub}>{challenge.sub}</Text>
            </View>
            <View style={[styles.pointsBadge, { borderColor: challenge.color }]}>
              <Text style={[styles.pointsBadgeText, { color: challenge.color }]}>
                {challenge.points}
              </Text>
            </View>
          </TouchableOpacity>
        ))}

        <View style={{ height: 32 }} />
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
  pointsBanner: {
    flexDirection: 'row',
    backgroundColor: '#0d1a0d',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
    paddingVertical: 14,
    marginBottom: 20,
  },
  pointsItem: {
    flex: 1,
    alignItems: 'center',
  },
  pointsDivider: {
    width: 1,
    backgroundColor: '#1e3a28',
    marginVertical: 4,
  },
  pointsValue: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
  },
  pointsLabel: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 2,
  },
  sectionLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  challengeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1a0d',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  challengeIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeEmoji: {
    fontSize: 24,
  },
  challengeInfo: {
    flex: 1,
  },
  challengeTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  challengeSub: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 3,
    lineHeight: 16,
  },
  pointsBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  pointsBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
