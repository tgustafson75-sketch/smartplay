/**
 * 2026-05-25 — Fix X: dedicated full-round Shot Log surface.
 *
 * Tim asked for an in-round view of every shot with icons + numbers
 * ("v1 of the app months ago would show shot by shot and worked well
 * for analysis using icons with and numbers"). The ShotTimeline
 * component now renders the rows; this route is the discoverable home
 * for it. Reachable via the ••• Tools menu → Shot Log.
 *
 * Active round → shows current round's shots. No active round → shows
 * the most recent historical round's shots. Empty state when neither
 * has any.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useRoundStore } from '../store/roundStore';
import ShotTimeline from '../components/caddie/ShotTimeline';

export default function ShotLogScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const shotCount = useRoundStore(s => s.shots.length);
  const isRoundActive = useRoundStore(s => s.isRoundActive);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Shot Log</Text>
        <View style={{ width: 26 }} />
      </View>

      {shotCount === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="golf-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.emptyTitle, { color: colors.text_primary }]}>No shots logged yet</Text>
          <Text style={[styles.emptyBody, { color: colors.text_muted }]}>
            {isRoundActive
              ? 'Say "log this shot — 7 iron, 165, straight" to capture one. Shots land here as you go.'
              : 'Start a round from the Play tab and log shots by voice or scorecard.'}
          </Text>
        </View>
      ) : (
        <ShotTimeline maxRows={100} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  title: { fontSize: 16, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  emptyBody: { fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 320 },
});
