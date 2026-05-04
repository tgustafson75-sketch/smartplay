/**
 * Phase BR — Tutorial library list.
 *
 * Shows the player's saved tutorials. Tap to open detail. "Add" button
 * routes to /swinglab/tutorial-upload. Active tutorials carry an "ACTIVE"
 * badge — these are the ones currently feeding Kevin's caddie context.
 */

import React from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useTutorialStore, type TutorialEntry, MAX_ACTIVE_TUTORIALS } from '../../store/tutorialStore';
import { clubLabel } from '../../services/clubRecognition';

export default function TutorialsLibrary() {
  const router = useRouter();
  const { colors } = useTheme();
  const tutorials = useTutorialStore(s => s.tutorials);
  const activeCount = tutorials.filter(t => t.is_active).length;

  const renderItem = ({ item }: { item: TutorialEntry }) => (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => router.push(`/swinglab/tutorial/${item.id}` as never)}
    >
      <View style={styles.rowHead}>
        <Text style={[styles.rowTitle, { color: colors.text_primary }]} numberOfLines={1}>
          {item.title}
        </Text>
        {item.is_active && (
          <View style={[styles.activeBadge, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}>
            <Text style={[styles.activeBadgeText, { color: colors.accent }]}>ACTIVE</Text>
          </View>
        )}
      </View>
      <Text style={[styles.rowFocus, { color: colors.text_secondary }]} numberOfLines={2}>
        {item.teaching_focus}
      </Text>
      <View style={styles.rowMeta}>
        {item.instructor && (
          <Text style={[styles.rowMetaText, { color: colors.text_muted }]} numberOfLines={1}>
            {item.instructor}
          </Text>
        )}
        {item.target_clubs.length > 0 && (
          <Text style={[styles.rowMetaText, { color: colors.text_muted }]} numberOfLines={1}>
            {item.target_clubs.slice(0, 4).map(c => clubLabel(c)).join(' · ')}
            {item.target_clubs.length > 4 ? ' · …' : ''}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.back, { color: colors.accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Tutorials</Text>
        <TouchableOpacity onPress={() => router.push('/swinglab/tutorial-upload' as never)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.add, { color: colors.accent }]}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.bannerText, { color: colors.text_secondary }]}>
          Active tutorials inform Kevin during your rounds. Up to {MAX_ACTIVE_TUTORIALS} can be active at once.
        </Text>
        <Text style={[styles.bannerCount, { color: colors.accent }]}>
          {activeCount} / {MAX_ACTIVE_TUTORIALS} active
        </Text>
      </View>

      {tutorials.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={[styles.emptyTitle, { color: colors.text_primary }]}>No tutorials yet.</Text>
          <Text style={[styles.emptyBody, { color: colors.text_muted }]}>
            Add a coaching lesson — title plus a few notes about what the coach is teaching.
            Kevin will reference active tutorials during your rounds.
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
            onPress={() => router.push('/swinglab/tutorial-upload' as never)}
          >
            <Text style={styles.primaryBtnText}>Add First Tutorial</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={tutorials}
          keyExtractor={t => t.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  back: { fontSize: 16, fontWeight: '600', minWidth: 60 },
  add: { fontSize: 16, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '900' },
  banner: {
    marginHorizontal: 16, marginVertical: 8, paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  bannerText: { fontSize: 12, flex: 1, marginRight: 12 },
  bannerCount: { fontSize: 12, fontWeight: '800' },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40 },
  row: {
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  rowHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4,
  },
  rowTitle: { fontSize: 16, fontWeight: '800', flex: 1, marginRight: 8 },
  activeBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1,
  },
  activeBadgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  rowFocus: { fontSize: 13, lineHeight: 18, marginBottom: 6 },
  rowMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowMetaText: { fontSize: 11, fontWeight: '600' },
  emptyCard: { padding: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '800', marginBottom: 8 },
  emptyBody: { fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 18 },
  primaryBtn: {
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
