/**
 * Swing Library — unified browse across cage sessions + uploaded videos.
 *
 * 2026-05-16 UI cleanup pass:
 *   - Header: chevron icon (was bare "‹ Back" text) + upload icon button
 *     (was "+ Upload" text link). Title centered + bolder.
 *   - Single filter chip strip (was THREE stacked horizontal scrolls).
 *     Date + Club filters are now collapsed behind a "Filters" chip
 *     that toggles them in/out — chrome stays minimal until needed.
 *   - List rows now show a 56×56 thumbnail (the persisted fault frame
 *     from Phase K analysis when available; placeholder icon otherwise).
 *     Better visual hierarchy: title prominent, meta + source badge
 *     less weight. Long-press still deletes.
 *   - Empty states: cleaner copy + correct CTA per context.
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useCageStore } from '../../store/cageStore';
import { useToastStore } from '../../store/toastStore';
import { getLibrary, type LibraryFilter } from '../../services/swingLibrary';
import CompareReferencePickerSheet from '../../components/swinglab/CompareReferencePickerSheet';
import type { PoseEstimate } from '../../services/poseEstimator';
import type { SimilarMatch } from '../../services/swingDatabase';

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'uploads', label: 'Uploads' },
  { id: 'cage', label: 'Cage' },
];

type DateFilter = 'all' | '7d' | '30d';
const DATE_FILTERS: { id: DateFilter; label: string }[] = [
  { id: 'all', label: 'Any time' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export default function SwingLibrary() {
  const router = useRouter();
  const { colors } = useTheme();
  const sessionHistory = useCageStore(s => s.sessionHistory);
  const deleteSession = useCageStore(s => s.deleteSession);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [clubFilter, setClubFilter] = useState<string>('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Reading via getLibrary so the helper is the single source of sort/filter logic
  const _ = sessionHistory; void _; // re-render trigger when sessions change
  const sourceFilteredEntries = getLibrary(filter);

  const availableClubs = useMemo(() => {
    const set = new Set<string>();
    sourceFilteredEntries.forEach(e => {
      const c = e.session.club?.trim();
      if (c && c !== 'unknown' && c !== '') set.add(c);
    });
    return ['all', ...Array.from(set).sort()];
  }, [sourceFilteredEntries]);

  if (clubFilter !== 'all' && !availableClubs.includes(clubFilter)) {
    setClubFilter('all');
  }

  const entries = useMemo(() => {
    const now = Date.now();
    const cutoff =
      dateFilter === '7d' ? now - 7 * DAY_MS :
      dateFilter === '30d' ? now - 30 * DAY_MS :
      0;
    return sourceFilteredEntries.filter(e => {
      if (e.date_ms < cutoff) return false;
      if (clubFilter !== 'all' && e.session.club !== clubFilter) return false;
      return true;
    });
  }, [sourceFilteredEntries, dateFilter, clubFilter]);

  const advancedFiltersActive = dateFilter !== 'all' || clubFilter !== 'all';
  const filtersActive = filter !== 'all' || advancedFiltersActive;

  // 2026-05-23 — Library Compare action. When the user taps Compare on
  // a row, we open the same CompareReferencePickerSheet used in the
  // swing detail screen. On match selection we run the full
  // swingComparisonEngine pass and route the user into the swing
  // detail surface with a toast summary.
  const [compareSessionId, setCompareSessionId] = useState<string | null>(null);
  const compareSession = compareSessionId
    ? sessionHistory.find(s => s.id === compareSessionId) ?? null
    : null;
  const compareCurrentPose: PoseEstimate | null = compareSession?.biomechanics
    ? {
        source: 'video',
        confidence: 75,
        frames: compareSession.biomechanics.frames ?? [],
        biomechanics: compareSession.biomechanics,
        swingVerdict: null,
        reason: 'library compare-to action',
        age_band: 'adult',
        mirrored: false,
        joint_confidence: { hip: 0.8, shoulder: 0.8, knee: 0.6, wrist: 0.6, ankle: 0.6, head: 0.7 },
        partial_view: false,
      }
    : null;

  const handleLibraryCompareSelect = (match: SimilarMatch) => {
    if (!compareSession || !compareCurrentPose) return;
    void (async () => {
      try {
        const [dbMod, engineMod] = await Promise.all([
          import('../../services/swingDatabase'),
          import('../../services/swingComparisonEngine'),
        ]);
        await dbMod.touchReference(match.reference.id);
        const ref = match.reference;
        const referencePose: PoseEstimate = {
          source: 'video',
          confidence: 80,
          frames: ref.frames ?? [],
          biomechanics: ref.biomechanics ?? null,
          swingVerdict: null,
          reason: `reference: ${ref.label}`,
          age_band: ref.body?.age_band ?? 'adult',
          mirrored: ref.body?.handedness === 'left',
          joint_confidence: { hip: 0.9, shoulder: 0.9, knee: 0.7, wrist: 0.7, ankle: 0.7, head: 0.7 },
          partial_view: false,
        };
        const kind =
          ref.source === 'self_upload' ? 'self_vs_self' :
          ref.source === 'archetype'   ? 'self_vs_avatar' :
                                         'self_vs_pro';
        const result = engineMod.compareSwings({ current: compareCurrentPose, reference: referencePose, kind });
        const headline = `${result.overall_match}% match to ${ref.label}. ${result.takeaways[0] ?? ''}`.trim();
        useToastStore.getState().show(headline);
        // Push to the swing detail screen so the user can dig into
        // metrics, hotspots, voice replay, etc.
        router.push(`/swinglab/swing/${compareSession.id}` as never);
      } catch (e) {
        console.log('[library] compare-to failed:', e);
        useToastStore.getState().show('Compare failed — try again.');
      }
    })();
  };

  const onLongPress = (id: string) => {
    Alert.alert(
      'Delete swing?',
      'This removes it from your library. The original video on your phone is unaffected.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteSession(id) },
      ],
    );
  };

  const clearAllFilters = () => {
    setFilter('all');
    setDateFilter('all');
    setClubFilter('all');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* HEADER — chevron / centered title / upload icon button */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.headerIcon}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Swing Library</Text>
        <TouchableOpacity
          onPress={() => router.push('/swinglab/upload' as never)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.headerIcon}
          accessibilityRole="button"
          accessibilityLabel="Upload a swing"
        >
          <Ionicons name="cloud-upload-outline" size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {/* FILTER STRIP — Source chips + Filters toggle. Date/Club live
          behind the Filters chip to keep the default state quiet. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterStripContent}
        style={styles.filterStrip}
      >
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.id}
            onPress={() => setFilter(f.id)}
            style={[
              styles.chip,
              { borderColor: colors.border, backgroundColor: colors.surface },
              filter === f.id && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Filter: ${f.label}`}
          >
            <Text style={[
              styles.chipText,
              { color: colors.text_muted },
              filter === f.id && { color: colors.accent, fontWeight: '800' },
            ]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
        {/* Divider */}
        <View style={[styles.chipDivider, { backgroundColor: colors.border }]} />
        <TouchableOpacity
          onPress={() => setShowAdvancedFilters(v => !v)}
          style={[
            styles.chip,
            { borderColor: colors.border, backgroundColor: colors.surface },
            (showAdvancedFilters || advancedFiltersActive) && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Toggle advanced filters"
        >
          <Ionicons
            name="options-outline"
            size={14}
            color={(showAdvancedFilters || advancedFiltersActive) ? colors.accent : colors.text_muted}
            style={{ marginRight: 4 }}
          />
          <Text style={[
            styles.chipText,
            { color: colors.text_muted },
            (showAdvancedFilters || advancedFiltersActive) && { color: colors.accent, fontWeight: '800' },
          ]}>
            Filters{advancedFiltersActive ? ' •' : ''}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ADVANCED FILTERS — date + club, only when toggled. */}
      {showAdvancedFilters && (
        <View style={styles.advancedFilters}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterStripContent}>
            {DATE_FILTERS.map(f => (
              <TouchableOpacity
                key={`date-${f.id}`}
                onPress={() => setDateFilter(f.id)}
                style={[
                  styles.chipSmall,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                  dateFilter === f.id && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                ]}
              >
                <Text style={[
                  styles.chipSmallText,
                  { color: colors.text_muted },
                  dateFilter === f.id && { color: colors.accent, fontWeight: '800' },
                ]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {availableClubs.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterStripContent}>
              {availableClubs.map(c => (
                <TouchableOpacity
                  key={`club-${c}`}
                  onPress={() => setClubFilter(c)}
                  style={[
                    styles.chipSmall,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                    clubFilter === c && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                  ]}
                >
                  <Text style={[
                    styles.chipSmallText,
                    { color: colors.text_muted },
                    clubFilter === c && { color: colors.accent, fontWeight: '800' },
                  ]}>{c === 'all' ? 'Any club' : c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {entries.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons
              name={filtersActive ? 'funnel-outline' : 'film-outline'}
              size={32}
              color={colors.text_muted}
            />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text_primary }]}>
            {filtersActive ? 'No swings match' : 'No swings yet'}
          </Text>
          <Text style={[styles.emptyBody, { color: colors.text_muted }]}>
            {filtersActive
              ? 'Try clearing filters or widening the time range.'
              : 'Record one in SmartMotion or upload a video to start building your library.'}
          </Text>
          {filtersActive ? (
            <TouchableOpacity
              style={[styles.cta, { backgroundColor: colors.accent }]}
              onPress={clearAllFilters}
            >
              <Text style={styles.ctaText}>Clear filters</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.cta, { backgroundColor: colors.accent }]}
              onPress={() => router.push('/swinglab/smartmotion' as never)}
            >
              <Ionicons name="videocam" size={18} color="#0d1a0d" style={{ marginRight: 8 }} />
              <Text style={styles.ctaText}>Record a swing</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {entries.map(entry => {
            const dateStr = new Date(entry.date_ms).toLocaleDateString(undefined, {
              month: 'short', day: 'numeric',
            });
            const isUpload = entry.source === 'uploaded_video';
            return (
              <TouchableOpacity
                key={entry.session.id}
                style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => router.push(`/swinglab/swing/${entry.session.id}` as never)}
                onLongPress={() => onLongPress(entry.session.id)}
                delayLongPress={500}
                accessibilityRole="button"
                accessibilityLabel={`${entry.display_label}, ${dateStr}, ${entry.swing_count} swings`}
              >
                {/* Thumbnail — fault frame from Phase K analysis when
                    available; icon placeholder otherwise. */}
                <View style={[styles.thumb, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
                  {entry.thumbnail_uri ? (
                    <Image source={{ uri: entry.thumbnail_uri }} style={styles.thumbImage} resizeMode="cover" />
                  ) : (
                    <Ionicons
                      name={isUpload ? 'film-outline' : 'golf-outline'}
                      size={24}
                      color={colors.text_muted}
                    />
                  )}
                </View>
                <View style={styles.rowMain}>
                  <Text style={[styles.rowTitle, { color: colors.text_primary }]} numberOfLines={1}>
                    {entry.display_label}
                  </Text>
                  <Text style={[styles.rowMeta, { color: colors.text_muted }]} numberOfLines={1}>
                    {dateStr} · {entry.swing_count} swing{entry.swing_count === 1 ? '' : 's'}
                  </Text>
                  {entry.primary_issue_name && (
                    <Text style={[styles.rowIssue, { color: colors.accent }]} numberOfLines={1}>
                      {entry.primary_issue_name}
                    </Text>
                  )}
                </View>
                <View style={styles.rowTrailing}>
                  {entry.session.biomechanics ? (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setCompareSessionId(entry.session.id);
                      }}
                      style={styles.compareBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Compare this swing to a reference"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="git-compare-outline" size={18} color={colors.accent} />
                    </TouchableOpacity>
                  ) : null}
                  <View style={[
                    styles.sourceBadge,
                    {
                      backgroundColor: isUpload ? colors.accent_muted : colors.surface_elevated,
                      borderColor: colors.border,
                    },
                  ]}>
                    <Text style={[
                      styles.sourceText,
                      { color: isUpload ? colors.accent : colors.text_muted },
                    ]}>
                      {isUpload ? 'UPLOAD' : 'CAGE'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* 2026-05-23 — Library Compare picker. Renders the same sheet
          used in the swing detail screen; the picker handles the
          search + ranked list + add-reference fallback itself. */}
      <CompareReferencePickerSheet
        visible={compareSessionId != null}
        current={compareCurrentPose}
        clubFilter={compareSession?.club ?? null}
        onClose={() => setCompareSessionId(null)}
        onSelect={handleLibraryCompareSelect}
        onAddReference={() => {
          setCompareSessionId(null);
          router.push('/swinglab/upload' as never);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  headerIcon: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  filterStrip: {
    maxHeight: 50,
  },
  filterStripContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  chipDivider: { width: 1, height: 20, marginHorizontal: 4 },
  chipSmall: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipSmallText: { fontSize: 12, fontWeight: '600' },
  advancedFilters: {
    gap: 4,
    paddingBottom: 4,
  },
  list: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 40,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: { fontSize: 15, fontWeight: '800' },
  rowMeta: { fontSize: 12, fontWeight: '600' },
  rowIssue: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  rowTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // 2026-05-23 — Compare icon button on rows with biomechanics.
  compareBtn: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceBadge: {
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 6,
    borderWidth: 1,
  },
  sourceText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  emptyWrap: {
    padding: 32,
    paddingTop: 60,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  emptyBody: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 21,
    maxWidth: 280,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  ctaText: {
    color: '#0d1a0d',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.3,
  },
});
