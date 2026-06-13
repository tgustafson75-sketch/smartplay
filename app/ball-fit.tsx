/**
 * 2026-06-13 — Ball Fit: the caddie brain answers "which ball fits me?"
 *
 * Pulls the player's real signals from the CNS stores (handicap, learned driver
 * carry, miss, wedge usage, goal) and hands them to composeBallFit — the brain
 * composes the read, this screen just displays it. Answer-first: the profile +
 * one-line why, examples, the honest tradeoff, and the "try a sleeve, not a
 * monitor fit" caveat.
 *
 * Simplified Sophistication: one card, the answer on top. The depth (the
 * scoring) lives in services/cnsBallFitting. Pure JS, OTA-able.
 * See memory: ball-fitting-recommendation, caddie-brain-lens, simplified-sophistication.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useClubStatsStore } from '../store/clubStatsStore';
import { composeBallFit, type BallProfile } from '../services/cnsBallFitting';

const PROFILE_LABEL: Record<BallProfile, string> = {
  tour: 'Tour',
  distance: 'Distance',
  'soft-feel': 'Soft Feel',
  value: 'Value',
};

export default function BallFitScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const handicap = usePlayerProfileStore((s) => s.handicap_index ?? s.handicap);
  const missType = usePlayerProfileStore((s) => s.missType);
  const experience = usePlayerProfileStore((s) => s.experienceContext);
  const goal = usePlayerProfileStore((s) => s.goal);
  const longestDrive = usePlayerProfileStore((s) => s.longestDrive);
  const clubStats = useClubStatsStore((s) => s.stats);

  const fit = useMemo(() => {
    const driver = clubStats?.Driver;
    // Prefer a learned, multi-sample driver carry; fall back to longestDrive only
    // if we have nothing measured (it overstates, so it's the last resort).
    const driverCarry =
      driver && driver.samples > 0 ? driver.avgYards : (longestDrive ?? null);
    const wedge =
      (clubStats?.PW?.samples ?? 0) + (clubStats?.GW?.samples ?? 0) +
      (clubStats?.SW?.samples ?? 0) + (clubStats?.LW?.samples ?? 0);
    return composeBallFit({
      handicap,
      driverCarryYards: driverCarry,
      experience,
      missType,
      shortGameWedgeSamples: wedge,
      goal,
    });
  }, [handicap, missType, experience, goal, longestDrive, clubStats]);

  const confColor =
    fit.confidence === 'high' ? colors.accent : fit.confidence === 'medium' ? colors.text_secondary : colors.text_muted;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Ball Fit</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {/* Answer-first card */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.profileRow}>
            <Text style={[styles.profileTag, { color: '#0a1410', backgroundColor: colors.accent }]}>
              {PROFILE_LABEL[fit.profile]}
            </Text>
            <Text style={[styles.conf, { color: confColor }]}>{fit.confidence} confidence</Text>
          </View>
          <Text style={[styles.headline, { color: colors.text_primary }]}>{fit.headline}</Text>

          {fit.why.map((w, i) => (
            <View key={i} style={styles.whyRow}>
              <Ionicons name="checkmark-circle" size={15} color={colors.accent} style={{ marginTop: 2 }} />
              <Text style={[styles.why, { color: colors.text_secondary }]}>{w}</Text>
            </View>
          ))}
        </View>

        {/* Representative balls */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>BALLS IN THIS CATEGORY</Text>
          {fit.examples.map((e) => (
            <Text key={e} style={[styles.example, { color: colors.text_primary }]}>• {e}</Text>
          ))}
          <Text style={[styles.tradeoff, { color: colors.text_secondary }]}>{fit.tradeoff}</Text>
        </View>

        <Text style={[styles.caveat, { color: colors.text_muted }]}>{fit.caveat}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '900' },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 8 },
  profileRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileTag: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  conf: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  headline: { fontSize: 18, fontWeight: '800', lineHeight: 24 },
  whyRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  why: { flex: 1, fontSize: 13, lineHeight: 18 },
  sectionLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  example: { fontSize: 14, fontWeight: '600' },
  tradeoff: { fontSize: 12, lineHeight: 17, marginTop: 4, fontStyle: 'italic' },
  caveat: { fontSize: 11, lineHeight: 16 },
});
