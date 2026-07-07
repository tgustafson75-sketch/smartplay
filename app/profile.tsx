/**
 * 2026-06-11 — Player Profile screen.
 *
 * The home for who the golfer is + their handicap, and the on-ramp for bringing
 * history in from other apps (an adoption selling point — a player switching
 * from Golfshot/GHIN can seed their index in minutes). Reached by tapping the
 * profile card on the Dashboard.
 *
 * Surfaces (read from playerProfileStore): avatar, name, handicap index, GHIN,
 * rounds tracked + differentials in the window. Actions: import a whole round
 * history (bulk list), import a single scorecard, recalculate the index from
 * history, and edit the detailed fields (which still live in Settings, so we
 * don't fork the edit form).
 */

import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRoundStore, eligibleHandicapRounds } from '../store/roundStore';

export default function ProfileScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const name = usePlayerProfileStore(s => s.name);
  const handicapIndex = usePlayerProfileStore(s => s.handicap_index);
  const handicap = usePlayerProfileStore(s => s.handicap);
  const ghin = usePlayerProfileStore(s => s.ghin_number);
  const goal = usePlayerProfileStore(s => s.goal);
  const diffCount = usePlayerProfileStore(s => s.recent_differentials.length);
  const roundsTracked = useRoundStore(s => s.roundHistory.length);

  const displayName = name?.trim() || 'Golfer';
  const indexLabel = handicapIndex != null ? handicapIndex.toFixed(1) : (handicap ? `~${handicap}` : '—');

  const onRecalculate = useCallback(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const calcMod = require('../services/handicapCalculator') as typeof import('../services/handicapCalculator');
      const rounds = useRoundStore.getState().roundHistory;
      // 2026-07-06 (audit P0) — canonical filter also excludes sim rounds.
      const eligible = eligibleHandicapRounds(rounds);
      if (eligible.length < 3) {
        Alert.alert('Need more rounds', `Recalculation needs at least 3 complete 9- or 18-hole rounds. You have ${eligible.length}. Import your round history to seed it.`);
        return;
      }
      const differentials = calcMod.rebuildDifferentialsFromHistory(eligible);
      usePlayerProfileStore.setState({ recent_differentials: differentials });
      const result = calcMod.estimateNewIndex(differentials);
      if (result.newIndex != null) {
        usePlayerProfileStore.getState().setHandicapIndex(result.newIndex);
        Alert.alert('Handicap Updated', `New Index: ${result.newIndex.toFixed(1)}\n\n${result.estimateNote}`);
      } else {
        Alert.alert('Could not compute', result.estimateNote);
      }
    } catch (e) {
      Alert.alert('Recalculation failed', e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.headerIcon}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Profile</Text>
        <TouchableOpacity onPress={() => router.push('/settings' as never)} hitSlop={10} style={styles.headerIcon} accessibilityLabel="Edit profile details">
          <Ionicons name="create-outline" size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Identity + handicap headline */}
        <View style={[styles.heroCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
          <View style={[styles.avatar, { borderColor: colors.accent, backgroundColor: colors.accent_muted }]}>
            <Text style={[styles.avatarLetter, { color: colors.accent }]}>{displayName.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={[styles.name, { color: colors.text_primary }]} numberOfLines={1}>{displayName}</Text>
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.accent }]}>{indexLabel}</Text>
              <Text style={[styles.statLabel, { color: colors.text_muted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>HANDICAP INDEX</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.text_primary }]}>{roundsTracked}</Text>
              <Text style={[styles.statLabel, { color: colors.text_muted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>ROUNDS</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.text_primary }]}>{diffCount}</Text>
              <Text style={[styles.statLabel, { color: colors.text_muted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>DIFFERENTIALS</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.metaText, { color: colors.text_muted }]}>GHIN {ghin || '—'}</Text>
            <Text style={[styles.metaText, { color: colors.text_muted }]}>Goal {goal || '—'}</Text>
          </View>
        </View>

        {/* Import on-ramp */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>BRING IN YOUR HISTORY</Text>
        <TouchableOpacity
          style={[styles.actionCard, { backgroundColor: colors.surface, borderColor: colors.accent }]}
          onPress={() => router.push('/import-rounds-list' as never)}
        >
          <Ionicons name="list-outline" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionTitle, { color: colors.text_primary }]}>Import round history</Text>
            <Text style={[styles.actionSub, { color: colors.text_muted }]}>Screenshot your rounds list from Golfshot, 18Birdies, or GHIN — import them all at once and seed your index.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.push('/import-round' as never)}
        >
          <Ionicons name="document-text-outline" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionTitle, { color: colors.text_primary }]}>Import one scorecard</Text>
            <Text style={[styles.actionSub, { color: colors.text_muted }]}>A single round, hole-by-hole — a scorecard photo or app screenshot.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
        </TouchableOpacity>

        {/* Handicap tools */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>HANDICAP</Text>
        <TouchableOpacity
          style={[styles.actionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={onRecalculate}
        >
          <Ionicons name="calculator-outline" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionTitle, { color: colors.text_primary }]}>Recalculate from history</Text>
            <Text style={[styles.actionSub, { color: colors.text_muted }]}>Rebuild your index (best 8 of last 20 differentials) from every complete round on record.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.push('/settings' as never)}
        >
          <Ionicons name="create-outline" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionTitle, { color: colors.text_primary }]}>Edit profile details</Text>
            <Text style={[styles.actionSub, { color: colors.text_muted }]}>Name, GHIN number, handicap index, goal, and more.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  scroll: { paddingBottom: 60 },
  heroCard: { marginHorizontal: 16, marginTop: 12, borderRadius: 16, borderWidth: 1, padding: 20, alignItems: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 32, fontWeight: '900' },
  name: { fontSize: 22, fontWeight: '900', marginTop: 12 },
  statRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18, alignSelf: 'stretch', justifyContent: 'space-around' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 26, fontWeight: '900' },
  statLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginTop: 2 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36 },
  metaRow: { flexDirection: 'row', gap: 20, marginTop: 16 },
  metaText: { fontSize: 12, fontWeight: '600' },
  sectionHeader: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 22, marginBottom: 8, marginHorizontal: 20 },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginTop: 10, borderRadius: 14, borderWidth: 1, padding: 16 },
  actionTitle: { fontSize: 15, fontWeight: '800' },
  actionSub: { fontSize: 12, lineHeight: 17, marginTop: 3 },
});
