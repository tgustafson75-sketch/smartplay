import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import type { DrillRecommendation } from '../../store/cageStore';

/**
 * Phase J — Drill recommendation card paired with PrimaryIssueCard.
 *
 * Placeholder mode (recommendation === null): "Drill suggestions will appear
 * after swing analysis is available." Honest about state.
 *
 * Populated mode: drill name + Kevin's Coach-voice reason + "Open Drill" CTA
 * routing to the SwingLab tab. The drill_id matches the existing DRILLS
 * library; today the Open Drill action navigates to /swinglab and the user
 * scrolls to the drill — Phase K can wire deep-linking by drill id when ready.
 */

type Props = {
  recommendation: DrillRecommendation | null;
};

export default function DrillCard({ recommendation }: Props) {
  const router = useRouter();

  if (!recommendation) {
    return (
      <View style={[styles.card, styles.cardPlaceholder]}>
        <Text style={styles.placeholderHeader}>DRILL RECOMMENDATION</Text>
        <Text style={styles.placeholderBody}>
          Drill suggestions will appear here once swing analysis is available.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.header}>RECOMMENDED DRILL</Text>
      <Text style={styles.title}>{recommendation.drill_name}</Text>
      <Text style={styles.reason}>{recommendation.reason}</Text>
      <TouchableOpacity
        onPress={() => router.push('/(tabs)/swinglab' as never)}
        style={styles.cta}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Open ${recommendation.drill_name} drill`}
      >
        <Text style={styles.ctaText}>Open Drill →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0d2418',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#00C896',
    padding: 14,
    marginBottom: 14,
  },
  cardPlaceholder: {
    borderStyle: 'dashed',
    borderColor: '#1e3a28',
  },
  placeholderHeader: {
    color: '#6b7280', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 8,
  },
  placeholderBody: { color: '#9ca3af', fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  header: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 6 },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '800', marginBottom: 8 },
  reason: { color: '#e8f5e9', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  cta: {
    alignSelf: 'flex-start',
    backgroundColor: '#003d20',
    borderWidth: 1,
    borderColor: '#00C896',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ctaText: { color: '#00C896', fontSize: 13, fontWeight: '800' },
});
