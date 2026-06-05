import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { useCageStore } from '../../../store/cageStore';
import { useFamilyStore } from '../../../store/familyStore';

type SwingRow = {
  id: string;
  date: number;
  title: string;
  faultLabel: string | null;
  coachNote: string | null;
  thumbnail: string | null;
};

export default function PlayerLibraryScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ player_id?: string }>();
  const playerId = typeof params.player_id === 'string' ? params.player_id : '';

  const hasHydrated = useCageStore(s => s.hasHydrated);
  const sessions = useCageStore(s => s.sessionHistory);
  const members = useFamilyStore(s => s.members);
  const member = useMemo(() => members.find(m => m.id === playerId) ?? null, [members, playerId]);

  const swings = useMemo<SwingRow[]>(() => {
    if (!playerId) return [];
    return sessions
      .filter(s => s.player_id === playerId)
      .sort((a, b) => b.date - a.date)
      .map(s => ({
        id: s.id,
        date: s.date,
        title: `${s.club} · ${new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
        faultLabel: s.primary_issue?.name ?? null,
        coachNote: s.coach_note ?? null,
        thumbnail: s.primary_issue?.visual_reference_path ?? s.fault_frame_uri ?? null,
      }));
  }, [sessions, playerId]);

  const playerName = member?.firstName ?? 'Player';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>{playerName} Library</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!hasHydrated ? (
          <Text style={[styles.emptyText, { color: colors.text_muted }]}>Loading swings…</Text>
        ) : swings.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.text_muted }]}>No swings tagged to this player yet.</Text>
        ) : (
          swings.map(s => (
            <TouchableOpacity
              key={s.id}
              onPress={() => router.push(`/swinglab/swing/${s.id}` as never)}
              style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel={`Open swing ${s.title}`}
            >
              <View style={[styles.thumb, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}> 
                {s.thumbnail ? (
                  <Image source={{ uri: s.thumbnail }} style={styles.thumbImage} resizeMode="cover" />
                ) : (
                  <Ionicons name="golf-outline" size={22} color={colors.text_muted} />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowTitle, { color: colors.text_primary }]} numberOfLines={1}>{s.title}</Text>
                {s.faultLabel ? (
                  <Text style={[styles.meta, { color: colors.accent }]} numberOfLines={1}>{s.faultLabel}</Text>
                ) : null}
                {s.coachNote ? (
                  <Text style={[styles.meta, { color: colors.text_muted }]} numberOfLines={1}>📝 {s.coachNote}</Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  scroll: {
    padding: 12,
    paddingBottom: 24,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    fontStyle: 'italic',
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  thumb: {
    width: 54,
    height: 54,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  meta: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
});
