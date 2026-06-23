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

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useCageStore } from '../../store/cageStore';
import { useToastStore } from '../../store/toastStore';
import { getLibrary, type LibraryFilter } from '../../services/swingLibrary';
import CompareReferencePickerSheet from '../../components/swinglab/CompareReferencePickerSheet';
import YouTubeReferenceModal from '../../components/swinglab/YouTubeReferenceModal';
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
  // 2026-05-23 — hydration guard. AsyncStorage rehydration is async,
  // so sessionHistory starts as [] before the persist middleware
  // hydrates. Without this, the cold-launch path renders the "No
  // swings yet" empty state for a frame even when swings ARE in
  // storage — which Tim hit on the new build and assumed his library
  // had been wiped. Wait for hasHydrated before deciding "empty."
  const hasHydrated = useCageStore(s => s.hasHydrated);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [clubFilter, setClubFilter] = useState<string>('all');
  // 2026-05-26 — Fix AS: swinger filter ("show me only Lily's swings").
  // Lives in the primary chip strip — Tim's mental model is "find that
  // person's videos" first, then narrow by date/club. Default 'all'.
  const [swingerFilter, setSwingerFilter] = useState<string>('all');
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

  useEffect(() => {
    if (clubFilter !== 'all' && !availableClubs.includes(clubFilter)) {
      setClubFilter('all');
    }
  }, [availableClubs, clubFilter]);

  // 2026-05-26 — Available swingers, case-insensitive dedup. Cage
  // sessions without an explicit swinger fall under "Me" (matches the
  // upload screen default). Sort alphabetically with "Me" pinned first.
  const availableSwingers = useMemo(() => {
    const map = new Map<string, string>(); // lowercase → display
    sourceFilteredEntries.forEach(e => {
      const raw = (e.session.upload?.swinger ?? 'Me').trim() || 'Me';
      const key = raw.toLowerCase();
      if (!map.has(key)) map.set(key, raw);
    });
    const names = Array.from(map.values()).sort((a, b) => {
      if (a.toLowerCase() === 'me') return -1;
      if (b.toLowerCase() === 'me') return 1;
      return a.localeCompare(b);
    });
    return ['all', ...names];
  }, [sourceFilteredEntries]);

  useEffect(() => {
    if (swingerFilter !== 'all' && !availableSwingers.some(n => n.toLowerCase() === swingerFilter.toLowerCase())) {
      setSwingerFilter('all');
    }
  }, [availableSwingers, swingerFilter]);

  const entries = useMemo(() => {
    const now = Date.now();
    const cutoff =
      dateFilter === '7d' ? now - 7 * DAY_MS :
      dateFilter === '30d' ? now - 30 * DAY_MS :
      0;
    return sourceFilteredEntries.filter(e => {
      if (e.date_ms < cutoff) return false;
      if (clubFilter !== 'all' && e.session.club !== clubFilter) return false;
      if (swingerFilter !== 'all') {
        const sw = (e.session.upload?.swinger ?? 'Me').trim() || 'Me';
        if (sw.toLowerCase() !== swingerFilter.toLowerCase()) return false;
      }
      return true;
    });
  }, [sourceFilteredEntries, dateFilter, clubFilter, swingerFilter]);

  const advancedFiltersActive = dateFilter !== 'all' || clubFilter !== 'all' || swingerFilter !== 'all';
  const filtersActive = filter !== 'all' || advancedFiltersActive || swingerFilter !== 'all';

  // 2026-05-27 — Fix EN: defensive file-existence probe per row.
  //
  // Problem: persisted file:// URIs (first-shot clipUri, thumbnail_uri)
  // can outlive the file behind them — OTA-triggered sandbox reshuffles,
  // OS cache eviction, document-dir cleanup. Before this fix the
  // library list rendered such rows looking fine until the user tapped
  // in and got an empty/broken video player, or the thumbnail showed a
  // blank tile. External testers hit this harder than insiders ("my
  // videos disappeared" panic).
  //
  // One-time probe on mount + when `entries` changes. Stores result
  // in a Map keyed by session id. Rendering reads the cache — no
  // per-frame FS work. Rows are NOT hidden when missing; metadata is
  // still useful and the user can delete via trash icon. A small
  // "unavailable" badge surfaces on rows whose video file is gone so
  // they know why tapping in won't play.
  const [fileStatus, setFileStatus] = useState<Map<string, { video: boolean; thumb: boolean }>>(new Map());
  useEffect(() => {
    if (!hasHydrated) return;
    if (entries.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const FS = await import('expo-file-system/legacy');
        const next = new Map<string, { video: boolean; thumb: boolean }>();
        let missingCount = 0;
        for (const entry of entries) {
          const clipUri = entry.session.shots[0]?.clipUri ?? null;
          const thumbUri = entry.thumbnail_uri;
          let videoOk = clipUri == null;
          let thumbOk = thumbUri == null;
          // 2026-06-23 (audit) — hoist the RE-ANCHORED clip path so the thumbnail
          // backfill below uses the live-container URI, not the stale clipUri (a
          // re-anchored card otherwise stayed imageless).
          let playableUri = clipUri;
          if (clipUri && clipUri.startsWith('file://')) {
            // re-anchor under the CURRENT container before judging a clip "missing":
            // a stale absolute UUID prefix from a prior install makes getInfoAsync lie.
            try {
              const { resolveClipUri } = await import('../../services/videoUpload');
              const resolved = await resolveClipUri(clipUri);
              videoOk = resolved != null;
              if (resolved) playableUri = resolved;
            } catch { videoOk = false; }
          } else if (clipUri && !clipUri.startsWith('file://')) {
            videoOk = true;
          }
          if (thumbUri && thumbUri.startsWith('file://')) {
            try {
              const info = await FS.getInfoAsync(thumbUri);
              thumbOk = !!info.exists;
            } catch { thumbOk = false; }
          } else if (thumbUri && !thumbUri.startsWith('file://')) {
            thumbOk = true;
          }
          // 2026-06-12 (Tim) — backfill a thumbnail for any card missing one (e.g. a
          // SmartMotion video swing with no analysis fault-frame). Generate ONE
          // representative frame, copy to documentDirectory so it survives cache
          // clears, and persist it on the session. Runs once per session — next pass
          // the entry already carries thumbnail_uri, so it won't regenerate.
          if (!thumbOk && videoOk && playableUri) {
            try {
              const VT = await import('expo-video-thumbnails');
              // 2026-06-12 — robust for LARGE 60fps clips (Tim's are ~180MB): the first
              // frame (time 0) is the cheapest/most reliable to decode; only fall back to
              // a mid-clip frame if t=0 fails. Lower quality keeps the decode fast.
              let tmp: string | null = null;
              for (const time of [0, 600]) {
                try {
                  const r = await VT.getThumbnailAsync(playableUri, { time, quality: 0.6 });
                  tmp = r.uri; break;
                } catch { /* try next time offset */ }
              }
              if (tmp) {
                let finalUri = tmp;
                const dest = `${FS.documentDirectory}swing-thumb-${entry.session.id}.jpg`;
                try { await FS.copyAsync({ from: tmp, to: dest }); finalUri = dest; } catch { /* keep tmp */ }
                useCageStore.getState().setSessionThumbnail(entry.session.id, finalUri);
                thumbOk = true;
              }
            } catch { /* generation failed — card shows the placeholder, no crash */ }
          }
          next.set(entry.session.id, { video: videoOk, thumb: thumbOk });
          if (!videoOk) {
            missingCount++;
            console.log('[library] missing video file for session', entry.session.id, 'uri=', clipUri);
          }
        }
        if (cancelled) return;
        setFileStatus(next);
        if (missingCount > 0) {
          console.log('[library] file-existence probe done —', missingCount, 'of', entries.length, 'sessions have missing video files');
        }
      } catch (e) {
        console.log('[library] file-existence probe failed (non-fatal):', e);
      }
    })();
    return () => { cancelled = true; };
  }, [entries, hasHydrated]);

  // 2026-05-23 — Library Compare action. When the user taps Compare on
  // a row, we open the same CompareReferencePickerSheet used in the
  // swing detail screen. On match selection we run the full
  // swingComparisonEngine pass and route the user into the swing
  // detail surface with a toast summary.
  const [compareSessionId, setCompareSessionId] = useState<string | null>(null);
  // 2026-05-23 — YouTube reference modal state. Replaces the
  // iOS-only Alert.prompt hack with a real cross-platform modal.
  const [ytModalOpen, setYtModalOpen] = useState(false);
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
    setSwingerFilter('all');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
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
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* 2026-05-23 — YouTube reference. Cross-platform modal
              replacing the iOS-only Alert.prompt hack: URL input
              with debounced preview, thumbnail + title + author
              fetched from YouTube's public oEmbed endpoint (no API
              key), editable label/proName/club fields, confirm
              button. Stores the link + thumbnail only — no video
              download. */}
          <TouchableOpacity
            onPress={() => setYtModalOpen(true)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Add a YouTube reference swing"
          >
            <Ionicons name="logo-youtube" size={22} color={colors.accent} />
          </TouchableOpacity>
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
            <Text
              numberOfLines={1}
              style={[
                styles.chipText,
                { color: colors.text_muted },
                filter === f.id && { color: colors.accent, fontWeight: '800' },
              ]}
            >{f.label}</Text>
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
          <Text
            numberOfLines={1}
            style={[
              styles.chipText,
              { color: colors.text_muted },
              (showAdvancedFilters || advancedFiltersActive) && { color: colors.accent, fontWeight: '800' },
            ]}
          >
            Filters{advancedFiltersActive ? ' •' : ''}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 2026-05-26 — Fix AS: per-swinger filter strip. Only renders
          when the library has 2+ distinct swingers (otherwise it's
          visual noise — solo users see no extra chrome). Lives in the
          primary band, not behind the Filters toggle, because
          "show me Lily's swings" is the canonical multi-user query. */}
      {availableSwingers.length > 2 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterStripContent}
          style={styles.filterStrip}
        >
          {availableSwingers.map(name => {
            const selected = swingerFilter.toLowerCase() === name.toLowerCase();
            const label = name === 'all' ? 'Everyone' : name;
            return (
              <TouchableOpacity
                key={`swinger-${name}`}
                onPress={() => setSwingerFilter(name)}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                  selected && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Filter by swinger: ${label}`}
              >
                <Ionicons
                  name={name === 'all' ? 'people-outline' : 'person-outline'}
                  size={13}
                  color={selected ? colors.accent : colors.text_muted}
                  style={{ marginRight: 4 }}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.chipText,
                    { color: colors.text_muted },
                    selected && { color: colors.accent, fontWeight: '800' },
                  ]}
                >{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

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

      {!hasHydrated ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={[styles.emptyBody, { color: colors.text_muted, marginTop: 12 }]}>
            Loading library…
          </Text>
        </View>
      ) : entries.length === 0 ? (
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
                {/* 2026-05-27 — Fix EN: read cached file-existence
                    status. When the thumbnail file is gone we fall
                    back to the icon (broken Image tile would render
                    a blank square otherwise). When the underlying
                    video file is gone we render a small "unavailable"
                    badge below the metadata so the user knows why
                    tapping in won't play (rather than getting a
                    broken video player). */}
                {(() => {
                  const status = fileStatus.get(entry.session.id);
                  const thumbAvailable = !status || status.thumb;
                  return (
                    <View style={[styles.thumb, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
                      {entry.thumbnail_uri && thumbAvailable ? (
                        <Image source={{ uri: entry.thumbnail_uri }} style={styles.thumbImage} resizeMode="cover" />
                      ) : (
                        <Ionicons
                          name={isUpload ? 'film-outline' : 'golf-outline'}
                          size={24}
                          color={colors.text_muted}
                        />
                      )}
                    </View>
                  );
                })()}
                <View style={styles.rowMain}>
                  <Text style={[styles.rowTitle, { color: colors.text_primary }]} numberOfLines={1}>
                    {entry.display_label}
                  </Text>
                  <Text style={[styles.rowMeta, { color: colors.text_muted }]} numberOfLines={1}>
                    {dateStr} · {entry.swing_count} swing{entry.swing_count === 1 ? '' : 's'}
                  </Text>
                  {(() => {
                    const status = fileStatus.get(entry.session.id);
                    if (status && !status.video) {
                      return (
                        <Text style={[styles.rowIssue, { color: '#ef4444' }]} numberOfLines={1}>
                          Video file unavailable on this device
                        </Text>
                      );
                    }
                    return null;
                  })()}
                  {entry.primary_issue_name && (
                    <Text style={[styles.rowIssue, { color: colors.accent }]} numberOfLines={1}>
                      {entry.primary_issue_name}
                    </Text>
                  )}
                  {/* 2026-06-02 — Fix GN: needs-retry badge. Surfaces
                      when analysis ended in failure OR is stuck in a
                      non-terminal state (failed boot mid-analysis,
                      etc.). Tap the row to open swing detail where
                      the re-analyze action lives. */}
                  {(() => {
                    const status = entry.session.analysis_status;
                    if (status === 'failed') {
                      return (
                        <Text style={[styles.rowIssue, { color: '#f59e0b' }]} numberOfLines={1}>
                          Needs retry — tap to re-analyze
                        </Text>
                      );
                    }
                    return null;
                  })()}
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
                  {/* 2026-05-25 — Visible trash icon. Long-press still
                      works (existing behavior), but the icon makes
                      delete discoverable per Tim's "need to delete
                      videos" ask. e.stopPropagation prevents the row
                      tap (which navigates to the swing detail) from
                      firing alongside. */}
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation?.();
                      onLongPress(entry.session.id);
                    }}
                    style={styles.compareBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Delete this swing from library"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.text_muted} />
                  </TouchableOpacity>
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

      {/* 2026-05-23 — YouTube reference ingestion modal. Cross-platform
          (replaces Alert.prompt). Debounced preview + oEmbed title
          fetch + editable label/proName/club + alreadyExists guard. */}
      <YouTubeReferenceModal
        visible={ytModalOpen}
        onClose={() => setYtModalOpen(false)}
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
  // 2026-05-26 — Fix AW: filter strip layout. Removed maxHeight: 50
  // that was vertically clipping the chips on Z Fold open (taller line-
  // height on the wider DPI pushed total chip height past 50px,
  // chopping off the top/bottom of label text — Tim's "smushed" repro).
  // No fixed height; chips own their own vertical sizing and the
  // ScrollView wraps content naturally. flexShrink: 0 on each chip
  // guarantees the horizontal ScrollView never compresses them on
  // wide viewports.
  filterStrip: {
    flexGrow: 0,
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
    // 2026-05-26 — Fix CP: Tim's screenshot shows the filter pills
    // rendering with clipped/smushed text on light theme + Samsung
    // One UI. Tighter padding (7v) + no explicit lineHeight let the
    // font render with no vertical breathing room, then theme bg
    // contrast amplified the impression of "smashed buttons". Bumped
    // vertical padding 7→10 and gave chipText an explicit lineHeight.
    // minHeight guards against future rounding edge-cases too.
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    minHeight: 36,
  },
  chipText: { fontSize: 13, fontWeight: '600', lineHeight: 18, includeFontPadding: false },
  chipDivider: { width: 1, height: 20, marginHorizontal: 4 },
  chipSmall: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
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
