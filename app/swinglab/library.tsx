/**
 * Phase R — My Swing Library.
 *
 * Unified browse across cage sessions and uploaded videos. Filter chips,
 * tap-to-detail, long-press to delete. Empty state pivots to Upload CTA.
 */

import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useCageStore } from '../../store/cageStore';
import { getLibrary, type LibraryFilter } from '../../services/swingLibrary';

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'uploads', label: 'Uploads' },
  { id: 'cage', label: 'Cage' },
];

export default function SwingLibrary() {
  const router = useRouter();
  const { colors } = useTheme();
  const sessionHistory = useCageStore(s => s.sessionHistory);
  const deleteSession = useCageStore(s => s.deleteSession);
  const [filter, setFilter] = useState<LibraryFilter>('all');

  // Reading via getLibrary so the helper is the single source of sort/filter logic
  const _ = sessionHistory; // re-render trigger when sessions change
  const entries = getLibrary(filter);

  const onLongPress = (id: string) => {
    Alert.alert('Delete swing?', 'This removes it from your library. The original video on your phone is unaffected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteSession(id) },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.back, { color: colors.accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>My Swing Library</Text>
        <TouchableOpacity onPress={() => router.push('/swinglab/upload' as never)}>
          <Text style={[styles.add, { color: colors.accent }]}>+ Upload</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterStrip}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.id}
            onPress={() => setFilter(f.id)}
            style={[
              styles.chip,
              { borderColor: colors.border, backgroundColor: colors.surface },
              filter === f.id && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
            ]}
          >
            <Text style={[
              styles.chipText,
              { color: colors.text_muted },
              filter === f.id && { color: colors.accent, fontWeight: '700' },
            ]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {entries.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyTitle, { color: colors.text_primary }]}>No swings yet</Text>
          <Text style={[styles.emptyBody, { color: colors.text_muted }]}>
            Upload a video from your phone or run a Cage Session to start your swing library.
          </Text>
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: colors.accent }]}
            onPress={() => router.push('/swinglab/upload' as never)}
          >
            <Text style={styles.ctaText}>Upload a swing</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {entries.map(entry => {
            const dateStr = new Date(entry.date_ms).toLocaleDateString();
            return (
              <TouchableOpacity
                key={entry.session.id}
                style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => router.push(`/swinglab/swing/${entry.session.id}` as never)}
                onLongPress={() => onLongPress(entry.session.id)}
                delayLongPress={500}
              >
                <View style={styles.rowMain}>
                  <Text style={[styles.rowTitle, { color: colors.text_primary }]} numberOfLines={1}>
                    {entry.display_label}
                  </Text>
                  <Text style={[styles.rowMeta, { color: colors.text_muted }]}>
                    {dateStr} · {entry.swing_count} swing{entry.swing_count === 1 ? '' : 's'}
                    {entry.primary_issue_name ? ` · ${entry.primary_issue_name}` : ''}
                  </Text>
                </View>
                <View style={[
                  styles.sourceBadge,
                  { backgroundColor: entry.source === 'uploaded_video' ? colors.accent_muted : colors.surface_elevated, borderColor: colors.border },
                ]}>
                  <Text style={[styles.sourceText, { color: entry.source === 'uploaded_video' ? colors.accent : colors.text_muted }]}>
                    {entry.source === 'uploaded_video' ? 'UPLOAD' : 'CAGE'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
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
  back: { fontSize: 16, fontWeight: '600' },
  add: { fontSize: 15, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '900' },
  filterStrip: { paddingHorizontal: 12, paddingBottom: 8, maxHeight: 50 },
  chip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, marginHorizontal: 4 },
  chipText: { fontSize: 13, fontWeight: '600' },
  list: { paddingHorizontal: 12, paddingBottom: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, borderRadius: 12, borderWidth: 1, marginVertical: 4,
  },
  rowMain: { flex: 1, paddingRight: 10 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowMeta: { fontSize: 12, marginTop: 4 },
  sourceBadge: {
    paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1,
  },
  sourceText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  emptyWrap: { padding: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '800', marginTop: 20 },
  emptyBody: { fontSize: 14, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  cta: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
