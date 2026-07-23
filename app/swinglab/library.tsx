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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Image,
  ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useCageStore, resolvePlayerName, playerMatchesFilter } from '../../store/cageStore';
import { useFamilyStore } from '../../store/familyStore';
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
  // 2026-06-24 — subscribe to the family roster so the swinger filter chips +
  // predicate re-resolve player_id→name when a golfer is added/renamed/archived
  // (resolvePlayerName reads familyStore under the hood; the subscription is
  // what forces the useMemo to recompute on roster change).
  const familyMembers = useFamilyStore(s => s.members);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [clubFilter, setClubFilter] = useState<string>('all');
  // 2026-05-26 — Fix AS: swinger filter ("show me only Lily's swings").
  // Lives in the primary chip strip — Tim's mental model is "find that
  // person's videos" first, then narrow by date/club. Default 'all'.
  const [swingerFilter, setSwingerFilter] = useState<string>('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Reading via getLibrary so the helper is the single source of sort/filter logic.
  // 2026-07-23 (QA) — MEMOIZE: getLibrary(filter) returns a fresh array every call, so calling it
  // unmemoized made `entries` a new reference each render → the file-existence probe effect re-ran
  // after every render → setFileStatus → re-render → loop (perpetual FS re-probe, battery/heat).
  // sessionHistory is the store dep that should trigger recompute; filter is a primitive.
  const sourceFilteredEntries = useMemo(() => getLibrary(filter), [filter, sessionHistory]);

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

  // 2026-05-26 — Available swingers, case-insensitive dedup.
  // 2026-06-24 — single-sourced on player_id (the field the golfer-edit chip
  // WRITES via setSessionPlayer), resolved through the SAME resolvePlayerName
  // helper the chip uses — so reassigning a swing's golfer immediately moves it
  // under the right swinger here. (Previously read upload.swinger, an unrelated
  // free-text field the chip never touches → reassignments were invisible.)
  // Sessions whose player_id resolves to the account holder fall under "Me".
  // Sort alphabetically with "Me" pinned first. familyMembers is a dep so the
  // list re-resolves when the roster changes.
  const availableSwingers = useMemo(() => {
    void familyMembers; // resolvePlayerName reads familyStore — recompute on roster change
    const map = new Map<string, string>(); // lowercase → display
    sourceFilteredEntries.forEach(e => {
      const raw = resolvePlayerName(e.session.player_id); // 'Me' when account-holder/unassigned
      const key = raw.toLowerCase();
      if (!map.has(key)) map.set(key, raw);
    });
    const names = Array.from(map.values()).sort((a, b) => {
      const al = a.toLowerCase(), bl = b.toLowerCase();
      if (al === 'me') return -1;       // Me pinned first
      if (bl === 'me') return 1;
      if (al === 'other') return 1;      // Other pinned last (2026-06-30)
      if (bl === 'other') return -1;
      return a.localeCompare(b);
    });
    return ['all', ...names];
  }, [sourceFilteredEntries, familyMembers]);

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
    void familyMembers; // playerMatchesFilter resolves via familyStore — recompute on roster change
    return sourceFilteredEntries.filter(e => {
      if (e.date_ms < cutoff) return false;
      if (clubFilter !== 'all' && e.session.club !== clubFilter) return false;
      // 2026-06-24 — match on the resolved player_id (same source the chip
      // writes), not the legacy upload.swinger field.
      if (!playerMatchesFilter(e.session, swingerFilter)) return false;
      return true;
    });
  }, [sourceFilteredEntries, dateFilter, clubFilter, swingerFilter, familyMembers]);

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
  // 2026-06-23 (RP-8) — when the probe re-anchors a stale clip uri (resolveClipUri)
  // to the live-container path, PERSIST the healed path once so the next render/open
  // doesn't redo the FS re-anchor work. Guarded by a ref Set keyed by shot id so each
  // shot heals at most once per mount (no write-during-scroll storm).
  const healedRef = useRef<Set<string>>(new Set());
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
              // 2026-06-23 (RP-8) — heal-persist: if the path genuinely changed
              // (stale UUID prefix re-anchored under the live container) AND the
              // file exists, write it back ONCE per shot so we stop re-anchoring
              // every render/open. resolveClipUri only returns a !== value when
              // the basename was found under the live Documents, so existence is
              // already implied. healedRef keyed by shot id prevents a write storm.
              const healShotId = entry.session.shots[0]?.id ?? null;
              if (resolved && resolved !== clipUri && healShotId && !healedRef.current.has(healShotId)) {
                healedRef.current.add(healShotId);
                try {
                  useCageStore.getState().setShotClipUri(entry.session.id, healShotId, resolved);
                } catch { /* non-fatal — re-anchor still works at read time next pass */ }
              }
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
  // 2026-06-23 (Tim declutter) — which row's "⋯" overflow menu is open.
  // The action sheet consolidates the former inline Compare + Delete
  // icons into a single control so the title/date have room to breathe.
  const [rowMenuSessionId, setRowMenuSessionId] = useState<string | null>(null);
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
        const result = engineMod.compareSwings({ current: compareCurrentPose, reference: referencePose, kind, club: compareSession?.club ?? ref.club ?? null });
        const headline = (result.overall_match == null
          ? `Not enough data to compare to ${ref.label} yet. ${result.takeaways[0] ?? ''}`
          : `${result.overall_match}% match to ${ref.label}. ${result.takeaways[0] ?? ''}`).trim();
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
                {/* 2026-06-23 (Tim declutter) — title gets its own line
                    with room to breathe; only the thumbnail, a single
                    "⋯" overflow control + the chevron compete for width.
                    Date + status live on the second line. Type badge sits
                    inline with the title row but after the flexible title
                    so it never squeezes the label. */}
                <View style={styles.rowMain}>
                  <View style={styles.rowTitleLine}>
                    <Text style={[styles.rowTitle, { color: colors.text_primary }]} numberOfLines={1}>
                      {entry.display_label}
                    </Text>
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
                  </View>
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
                  {/* 2026-06-23 (Tim declutter) — the inline trash +
                      compare-swap icons were consolidated into ONE "⋯"
                      overflow control. It opens a small action sheet
                      (rowMenuSessionId) whose items call the SAME
                      handlers the inline icons used to: Compare →
                      setCompareSessionId, Delete → onLongPress (which
                      keeps the delete-confirmation Alert). */}
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation?.();
                      setRowMenuSessionId(entry.session.id);
                    }}
                    style={styles.compareBtn}
                    accessibilityRole="button"
                    accessibilityLabel="More actions for this swing"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="ellipsis-horizontal" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* 2026-06-23 (Tim declutter) — per-row overflow action sheet.
          Replaces the two inline row icons. "Compare" only appears when
          the session has biomechanics (same gate the inline compare icon
          used). "Delete" calls onLongPress, preserving the delete
          confirmation Alert. Tapping a row's "⋯" sets rowMenuSessionId. */}
      {(() => {
        const menuEntry = rowMenuSessionId
          ? entries.find(e => e.session.id === rowMenuSessionId) ?? null
          : null;
        const canCompare = !!menuEntry?.session.biomechanics;
        const closeMenu = () => setRowMenuSessionId(null);
        return (
          <Modal
            visible={rowMenuSessionId != null}
            transparent
            animationType="fade"
            onRequestClose={closeMenu}
          >
            <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={closeMenu}>
              <TouchableOpacity activeOpacity={1}>
                <View style={[styles.menuSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.menuHandle} />
                  {menuEntry && (
                    <Text style={[styles.menuTitle, { color: colors.text_primary }]} numberOfLines={1}>
                      {menuEntry.display_label}
                    </Text>
                  )}
                  {canCompare && (
                    <TouchableOpacity
                      style={[styles.menuRow, { borderTopColor: colors.border }]}
                      onPress={() => {
                        const id = rowMenuSessionId;
                        closeMenu();
                        if (id) setCompareSessionId(id);
                      }}
                    >
                      <Ionicons name="git-compare-outline" size={20} color={colors.text_primary} />
                      <Text style={[styles.menuLabel, { color: colors.text_primary }]}>Compare</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.menuRow, { borderTopColor: colors.border }]}
                    onPress={() => {
                      const id = rowMenuSessionId;
                      closeMenu();
                      if (id) onLongPress(id);
                    }}
                  >
                    <Ionicons name="trash-outline" size={20} color="#ef4444" />
                    <Text style={[styles.menuLabel, { color: '#ef4444' }]}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuCancel} onPress={closeMenu}>
                    <Text style={[styles.menuCancelText, { color: colors.text_muted }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        );
      })()}

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
  chipText: { fontSize: 14, fontWeight: '600', lineHeight: 19, letterSpacing: 0.2, includeFontPadding: false },
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
  // 2026-06-23 (Tim declutter) — title + type badge share the first
  // line; the title flexes (shrinks) so the small badge never squeezes
  // it the way the old icon cluster did.
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: { flexShrink: 1, fontSize: 15, fontWeight: '800' },
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
  // 2026-06-23 (Tim declutter) — per-row "⋯" overflow action sheet.
  // Mirrors the SwingActionSheet bottom-sheet pattern (backdrop +
  // slide-up panel + action rows) so it feels native to the app.
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingBottom: 32,
  },
  menuHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#9ca3af',
    alignSelf: 'center',
    marginBottom: 12,
    opacity: 0.5,
  },
  menuTitle: { fontSize: 15, fontWeight: '900', marginBottom: 6 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  menuCancel: { paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  menuCancelText: { fontSize: 14, fontWeight: '700' },
});
