import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { listFeelCaptureTuples, type FeelCaptureTuple } from '../services/feelCaptureService';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import {
  listSessions,
  deleteSession,
  createSyntheticSession,
} from '../services/cageStorage';
import type { CageSession, CageClip } from '../types/cage';
import { useCageStore } from '../store/cageStore';
import { getCurrentProfile, clearProfile } from '../services/vocabularyProfile';
import { listReviewSessions } from '../services/cageReview';
import type { VocabularyProfile } from '../types/vocabulary';
import type { ReviewSession } from '../types/cageReview';
import {
  getLibraryInfo,
  isLibraryGenerating,
  generateLibrary,
  clearLibrary,
  getClipForCategory,
} from '../services/fillerLibrary';
import { playLocalFile } from '../services/voiceService';
import { useSettingsStore } from '../store/settingsStore';
import type { FillerCategory } from '../types/filler';
import { useDebugRouteGate } from '../hooks/useDebugRouteGate';
import { getApiBaseUrl } from '../services/apiBase';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CageDebug() {
  const _gateAllowed = useDebugRouteGate();
  const router = useRouter();
  const { sessionId: focusSessionId } = useLocalSearchParams<{ sessionId?: string }>();

  const [sessions, setSessions] = useState<CageSession[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(focusSessionId ?? null);
  const [selectedClip, setSelectedClip] = useState<{ clip: CageClip; session: CageSession } | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Cage Review debug state ────────────────────────────────────────────────
  const { sessionHistory } = useCageStore();
  const [vocabProfile, setVocabProfile] = useState<VocabularyProfile | null>(null);
  const [reviewSessions, setReviewSessions] = useState<ReviewSession[]>([]);
  const [reviewDebugLoading, setReviewDebugLoading] = useState(false);

  // ── Filler debug state ─────────────────────────────────────────────────────
  const { language } = useSettingsStore();
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const apiUrl = getApiBaseUrl();
  const [fillerStatus, setFillerStatus] = useState<ReturnType<typeof getLibraryInfo>>(null);
  const [fillerGenerating, setFillerGenerating] = useState(false);
  const [fillerPlayingCategory, setFillerPlayingCategory] = useState<FillerCategory | null>(null);

  void useCageStore; // keep store referenced for viewer subscription
  // 2026-05-24 — AsyncStorage dump for hands-free verification (Batch 2
  // QA). Static snapshot read by tapping "Dump AsyncStorage" below;
  // renders the parsed JSON inline so persistence of round-store-v1,
  // practice-store, settings-store-v2, cage-store, truth_* keys, etc.
  // can be verified on-device without Flipper / react-native-debugger.
  const [storageDump, setStorageDump] = useState<Record<string, unknown> | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);

  const dumpStorage = useCallback(async () => {
    setStorageLoading(true);
    try {
      const keys = await AsyncStorage.getAllKeys();
      const entries = await AsyncStorage.multiGet(keys);
      const obj: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        if (v === null) { obj[k] = null; continue; }
        try { obj[k] = JSON.parse(v); }
        catch { obj[k] = v; /* preserve raw string when not JSON */ }
      }
      setStorageDump(obj);
    } catch (e) {
      setStorageDump({ __error: String(e) });
    } finally {
      setStorageLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fillerInfo = useMemo(() => getLibraryInfo(), [fillerStatus]);

  const refreshFillerStatus = useCallback(() => {
    setFillerStatus(getLibraryInfo());
    setFillerGenerating(isLibraryGenerating());
  }, []);

  useEffect(() => { refreshFillerStatus(); }, [refreshFillerStatus]);

  // Poll while background generation is in progress (fires from onboarding, not from this screen).
  useEffect(() => {
    if (!fillerGenerating) return;
    const id = setInterval(() => {
      if (!isLibraryGenerating()) {
        refreshFillerStatus(); // generation finished — update UI and stop polling
        clearInterval(id);
      } else {
        refreshFillerStatus(); // still running — keep display current
      }
    }, 1000);
    return () => clearInterval(id);
  }, [fillerGenerating, refreshFillerStatus]);

  const handleFillerGenerate = useCallback(async () => {
    setFillerGenerating(true);
    await generateLibrary(apiUrl, caddiePersonality, language).catch(() => {});
    refreshFillerStatus();
  }, [apiUrl, caddiePersonality, language, refreshFillerStatus]);

  const handleFillerClear = useCallback(async () => {
    await clearLibrary();
    refreshFillerStatus();
  }, [refreshFillerStatus]);

  const handleFillerPlay = useCallback(async (category: FillerCategory) => {
    const clip = getClipForCategory(category);
    if (!clip) { Alert.alert('No clip', 'Library not generated or category empty.'); return; }
    setFillerPlayingCategory(category);
    await playLocalFile(clip.audio_path).catch(() => {});
    setFillerPlayingCategory(null);
  }, []);

  const videoRef = useRef<Video>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const data = await listSessions();
    // Sort newest first
    setSessions([...data].sort((a, b) => b.started_at - a.started_at));
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleDelete = useCallback((sessionId: string) => {
    Alert.alert(
      'Delete Session',
      'This will permanently delete the master video and all clip data. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteSession(sessionId);
            if (selectedClip?.session.id === sessionId) setSelectedClip(null);
            if (expandedId === sessionId) setExpandedId(null);
            await reload();
          },
        },
      ],
    );
  }, [selectedClip, expandedId, reload]);

  const handleSyntheticTest = useCallback(async () => {
    const s = await createSyntheticSession();
    await reload();
    setExpandedId(s.id);
  }, [reload]);

  const handlePlayClip = useCallback(async (clip: CageClip, session: CageSession) => {
    if (!session.master_video_path) {
      Alert.alert('Synthetic session', 'No video file — this is a test session with reference data only.');
      return;
    }
    setSelectedClip({ clip, session });
  }, []);

  const handlePlaybackStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded || !selectedClip) return;
    const endMs = selectedClip.clip.end_time_seconds * 1000;
    if (status.positionMillis >= endMs) {
      videoRef.current?.pauseAsync();
    }
  }, [selectedClip]);

  // ── Review debug handlers ──────────────────────────────────────────────────

  const loadReviewDebugData = useCallback(async () => {
    const [profile, reviews] = await Promise.all([getCurrentProfile(), listReviewSessions()]);
    setVocabProfile(profile);
    setReviewSessions(reviews);
  }, []);

  const handleMockReview = useCallback(async () => {
    const session = sessionHistory[sessionHistory.length - 1];
    if (!session || session.shots.length === 0) return;
    setReviewDebugLoading(true);
    const apiUrl = getApiBaseUrl();
    const mockTranscripts = ['heel, came up short', 'pure, right at it', 'fat, didn\'t transfer', 'thin, rushed it', 'solid', 'pulled it left'];
    const { useCageStore: cageStoreHook } = await import('../store/cageStore');
    const updateShotLabels = cageStoreHook.getState().updateShotLabels;
    const shots = session.shots.slice(0, 6);
    for (let i = 0; i < shots.length; i++) {
      const transcript = mockTranscripts[i % mockTranscripts.length];
      try {
        const res = await fetch(apiUrl + '/api/cage-review', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'extract', transcript }),
        });
        const data = await res.json() as { labels?: Parameters<typeof updateShotLabels>[2] };
        if (data.labels) updateShotLabels(session.id, shots[i].id, data.labels, transcript);
      } catch { /* continue */ }
    }
    try {
      const vocabRes = await fetch(apiUrl + '/api/cage-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vocab', transcripts: mockTranscripts.slice(0, shots.length), total_reviewed: shots.length }),
      });
      const vocabData = await vocabRes.json() as { observed_terminology: VocabularyProfile['observed_terminology']; kevin_summary: string; total_clips_reviewed: number };
      const { saveGeneratedProfile } = await import('../services/vocabularyProfile');
      const profile = await saveGeneratedProfile(vocabData);
      setVocabProfile(profile);
    } catch { /* continue */ }
    setReviewDebugLoading(false);
  }, [sessionHistory]);

  const handleClearVocab = useCallback(async () => {
    await clearProfile();
    setVocabProfile(null);
  }, []);

  // Auto-seek to clip start when video loads
  const handleVideoLoad = useCallback(async () => {
    if (!selectedClip) return;
    await videoRef.current?.setPositionAsync(selectedClip.clip.start_time_seconds * 1000);
    await videoRef.current?.playAsync();
  }, [selectedClip]);

  // ─── Render ────────────────────────────────────────────────────────────────

  // 2026-05-17 — gate check AFTER all hooks (Rules of Hooks)
  if (!_gateAllowed) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cage Sessions</Text>
        <TouchableOpacity style={styles.apiDebugBtn} onPress={() => router.push('/api-debug' as never)}>
          <Text style={styles.apiDebugBtnText}>Course API</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.apiDebugBtn} onPress={() => router.push('/patterns-debug' as never)}>
          <Text style={styles.apiDebugBtnText}>Patterns</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.apiDebugBtn} onPress={() => router.push('/ghost-debug' as never)}>
          <Text style={styles.apiDebugBtnText}>Ghost</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.apiDebugBtn} onPress={() => router.push('/landmark-curate' as never)}>
          <Text style={styles.apiDebugBtnText}>Landmarks</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.synthBtn} onPress={handleSyntheticTest}>
          <Text style={styles.synthBtnText}>+ Synthetic test</Text>
        </TouchableOpacity>
      </View>

      {/* 2026-05-24 — AsyncStorage dump panel. Tap to snapshot all
          keys + JSON values for on-device verification of store
          persistence (round-store-v1, practice-store, settings-store-v2,
          cage-store, truth_* survey coords, etc.). */}
      <View style={styles.storageDumpRow}>
        <TouchableOpacity
          style={styles.storageDumpBtn}
          onPress={dumpStorage}
          disabled={storageLoading}
        >
          <Text style={styles.storageDumpBtnText}>
            {storageLoading ? 'Reading…' : 'Dump AsyncStorage'}
          </Text>
        </TouchableOpacity>
        {storageDump && (
          <TouchableOpacity
            style={styles.storageDumpClearBtn}
            onPress={() => setStorageDump(null)}
          >
            <Text style={styles.storageDumpBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      {storageDump && (
        <ScrollView style={styles.storageDumpBody}>
          <Text style={styles.storageDumpText}>
            {JSON.stringify(storageDump, null, 2)}
          </Text>
        </ScrollView>
      )}

      {/* 2026-05-24 — Feel Capture viewer. Lists labeled tuples
          {clip, transcript, analysis} for owner review. Captures
          happen automatically in the background when the Feel Capture
          toggle is on (Settings → Owner Tools) AND the active profile
          is owner-allowlisted. Read-only here — toggle/disable lives
          in Settings. */}
      <FeelCaptureViewer />

      {/* Inline video player */}
      {selectedClip && (
        <View style={styles.videoPanel}>
          <View style={styles.videoHeader}>
            <Text style={styles.videoHeaderText}>
              Clip @ {selectedClip.clip.detected_at_session_offset_seconds.toFixed(1)}s
              {'  '}
              <Text style={styles.videoMethod}>{selectedClip.clip.detection_method}</Text>
            </Text>
            <TouchableOpacity onPress={() => setSelectedClip(null)}>
              <Text style={styles.videoClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Video
            ref={videoRef}
            source={{ uri: selectedClip.session.master_video_path }}
            style={styles.videoPlayer}
            resizeMode={ResizeMode.CONTAIN}
            onLoad={handleVideoLoad}
            onPlaybackStatusUpdate={handlePlaybackStatus}
            useNativeControls
          />
          <Text style={styles.videoRange}>
            {selectedClip.clip.start_time_seconds.toFixed(1)}s → {selectedClip.clip.end_time_seconds.toFixed(1)}s
          </Text>
        </View>
      )}

      {/* Session list */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {loading && (
          <Text style={styles.emptyText}>Loading…</Text>
        )}

        {!loading && sessions.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No sessions yet.</Text>
            <Text style={styles.emptyHint}>
              Tap &quot;+ Synthetic test&quot; above to verify storage works without going to the cage.
            </Text>
          </View>
        )}

        {sessions.map((session) => {
          const isExpanded = expandedId === session.id;
          const autoCount = session.clips.filter((c) => c.detection_method === 'audio_transient').length;
          const manualCount = session.clips.filter((c) => c.detection_method === 'manual').length;
          const isSynthetic = session.notes?.startsWith('SYNTHETIC') ?? false;

          return (
            <View key={session.id} style={styles.sessionCard}>
              {/* Session header */}
              <TouchableOpacity
                style={styles.sessionHeader}
                onPress={() => setExpandedId(isExpanded ? null : session.id)}
                activeOpacity={0.8}
              >
                <View style={styles.sessionMeta}>
                  <View style={styles.sessionTitleRow}>
                    <Text style={styles.sessionDate}>{formatDate(session.started_at)}</Text>
                    {isSynthetic && (
                      <View style={styles.synthBadge}>
                        <Text style={styles.synthBadgeText}>SYNTHETIC</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.sessionStats}>
                    {formatDuration(session.duration_seconds)}
                    {'  ·  '}
                    {session.clips.length} swing{session.clips.length !== 1 ? 's' : ''}
                    {session.clips.length > 0 && (
                      <Text style={styles.sessionStatsSub}>
                        {'  ('}
                        {autoCount > 0 ? `${autoCount} auto` : ''}
                        {autoCount > 0 && manualCount > 0 ? ', ' : ''}
                        {manualCount > 0 ? `${manualCount} manual` : ''}
                        {')'}
                      </Text>
                    )}
                  </Text>
                </View>
                <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {/* Expanded: clips list */}
              {isExpanded && (
                <View style={styles.sessionBody}>
                  <View style={styles.divider} />

                  {session.clips.length === 0 ? (
                    <Text style={styles.noClipsText}>No swings logged in this session.</Text>
                  ) : (
                    session.clips.map((clip, idx) => {
                      const isPlaying =
                        selectedClip?.clip.id === clip.id;
                      return (
                        <View key={clip.id} style={styles.clipRow}>
                          <View style={styles.clipInfo}>
                            <Text style={styles.clipIdx}>#{idx + 1}</Text>
                            <View>
                              <Text style={styles.clipOffset}>
                                @ {clip.detected_at_session_offset_seconds.toFixed(1)}s
                              </Text>
                              <Text style={styles.clipMethod}>
                                {clip.detection_method === 'audio_transient' ? '🎵 auto' : '👆 manual'}
                                {'  '}
                                <Text style={styles.clipRange}>
                                  [{clip.start_time_seconds.toFixed(1)}–{clip.end_time_seconds.toFixed(1)}s]
                                </Text>
                              </Text>
                            </View>
                          </View>
                          <TouchableOpacity
                            style={[styles.playBtn, isPlaying && styles.playBtnActive]}
                            onPress={() => handlePlayClip(clip, session)}
                          >
                            <Text style={styles.playBtnText}>
                              {isPlaying ? '▶ Playing' : '▶ Play'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}

                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDelete(session.id)}
                  >
                    <Text style={styles.deleteBtnText}>Delete session</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {/* ── CAGE REVIEW SECTION ────────────────────────────── */}
        <View style={styles.reviewSection}>
          <View style={styles.reviewSectionHeader}>
            <Text style={styles.reviewSectionTitle}>CAGE REVIEW</Text>
            <TouchableOpacity onPress={loadReviewDebugData} style={styles.reviewRefreshBtn}>
              <Text style={styles.reviewRefreshText}>Refresh</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.reviewActionBtn, reviewDebugLoading && { opacity: 0.5 }]}
            onPress={handleMockReview}
            disabled={reviewDebugLoading || sessionHistory.length === 0}
          >
            <Text style={styles.reviewActionText}>
              {reviewDebugLoading ? 'Running mock review…' : 'Mock review (latest session)'}
            </Text>
          </TouchableOpacity>

          {sessionHistory.length > 0 && (
            <TouchableOpacity
              style={styles.reviewActionBtn}
              onPress={() => router.push({
                pathname: '/cage-review/start',
                params: { session_id: sessionHistory[sessionHistory.length - 1].id },
              } as never)}
            >
              <Text style={styles.reviewActionText}>Open review flow (latest session)</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.reviewDestructiveBtn} onPress={handleClearVocab}>
            <Text style={styles.reviewDestructiveText}>Reset vocabulary profile</Text>
          </TouchableOpacity>

          {vocabProfile && (
            <View style={styles.reviewCard}>
              <Text style={styles.reviewCardLabel}>VOCABULARY PROFILE</Text>
              <Text style={styles.reviewCardText}>{vocabProfile.kevin_summary}</Text>
              <Text style={styles.reviewCardMeta}>
                {vocabProfile.total_clips_reviewed} clips reviewed · {new Date(vocabProfile.generated_at).toLocaleDateString()}
              </Text>
            </View>
          )}

          {reviewSessions.length > 0 && (
            <View style={styles.reviewCard}>
              <Text style={styles.reviewCardLabel}>REVIEW SESSIONS ({reviewSessions.length})</Text>
              {reviewSessions.slice(-3).reverse().map(r => (
                <Text key={r.id} style={styles.reviewCardText}>
                  {r.mode} · {r.shots_reviewed.length} shots · {r.completed_at ? 'done' : 'in progress'}
                </Text>
              ))}
            </View>
          )}
        </View>

        {/* ── FILLER LIBRARY DEBUG ── */}
        <View style={styles.reviewSection}>
          <Text style={styles.reviewSectionHeader}>FILLER LIBRARY</Text>

          {fillerInfo ? (
            <View style={styles.reviewCard}>
              <Text style={styles.reviewCardLabel}>STATUS</Text>
              <Text style={styles.reviewCardText}>{fillerInfo.clipCount} clips cached</Text>
              <Text style={styles.reviewCardMeta}>
                hash: {fillerInfo.hash} · {new Date(fillerInfo.generatedAt).toLocaleDateString()}
              </Text>
            </View>
          ) : (
            <View style={styles.reviewCard}>
              <Text style={styles.reviewCardText}>Library not generated yet.</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.reviewActionBtn, fillerGenerating && { opacity: 0.5 }]}
            onPress={handleFillerGenerate}
            disabled={fillerGenerating}
          >
            <Text style={styles.reviewActionText}>
              {fillerGenerating ? 'Generating clips…' : fillerInfo ? 'Regenerate library' : 'Generate library'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.reviewDestructiveBtn} onPress={handleFillerClear}>
            <Text style={styles.reviewDestructiveText}>Clear library</Text>
          </TouchableOpacity>

          <Text style={[styles.reviewCardLabel, { marginTop: 12, marginBottom: 6 }]}>PLAY TEST CLIPS</Text>
          {(['tactical', 'conversational', 'social', 'ghost'] as FillerCategory[]).map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.reviewActionBtn, fillerPlayingCategory === cat && { opacity: 0.5 }]}
              onPress={() => handleFillerPlay(cat)}
              disabled={fillerPlayingCategory !== null}
            >
              <Text style={styles.reviewActionText}>
                {fillerPlayingCategory === cat ? `Playing ${cat}…` : `▶ ${cat}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  backBtn: {
    paddingRight: 12,
    paddingVertical: 4,
  },
  backBtnText: {
    color: '#00C896',
    fontSize: 17,
  },
  headerTitle: {
    flex: 1,
    color: '#e8f5e9',
    fontSize: 17,
    fontWeight: '700',
  },
  apiDebugBtn: {
    backgroundColor: '#0a1e12',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1e3a28',
    marginRight: 6,
  },
  apiDebugBtnText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
  },
  synthBtn: {
    backgroundColor: '#0d2b1c',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#00C89644',
  },
  synthBtnText: {
    color: '#00C896',
    fontSize: 12,
    fontWeight: '700',
  },

  // 2026-05-24 — AsyncStorage dump panel
  storageDumpRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0d1a0d',
    borderBottomColor: '#1e3a28',
    borderBottomWidth: 1,
  },
  storageDumpBtn: {
    flex: 1,
    backgroundColor: '#1a3a5c',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  storageDumpClearBtn: {
    backgroundColor: '#3a1a1a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storageDumpBtnText: {
    color: '#cfe8ff',
    fontSize: 12,
    fontWeight: '800',
  },
  storageDumpBody: {
    maxHeight: 360,
    backgroundColor: '#020503',
    borderBottomColor: '#1e3a28',
    borderBottomWidth: 1,
    padding: 10,
  },
  storageDumpText: {
    color: '#9ca3af',
    fontSize: 10,
    fontFamily: 'Courier',
  },

  // Video player
  videoPanel: {
    backgroundColor: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  videoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  videoHeaderText: {
    color: '#e8f5e9',
    fontSize: 13,
    fontWeight: '700',
  },
  videoMethod: {
    color: '#6b7280',
    fontWeight: '400',
  },
  videoClose: {
    color: '#6b7280',
    fontSize: 18,
    paddingHorizontal: 6,
  },
  videoPlayer: {
    width: '100%',
    height: 220,
    backgroundColor: '#000',
  },
  videoRange: {
    color: '#6b7280',
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 6,
  },

  // List
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },

  emptyBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
  },
  emptyHint: {
    color: '#4b5563',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: 20,
  },

  // Session card
  sessionCard: {
    backgroundColor: '#0a1e12',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    marginBottom: 10,
    overflow: 'hidden',
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
  },
  sessionMeta: {
    flex: 1,
    gap: 4,
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionDate: {
    color: '#e8f5e9',
    fontSize: 14,
    fontWeight: '700',
  },
  sessionStats: {
    color: '#a3b8a8',
    fontSize: 13,
  },
  sessionStatsSub: {
    color: '#6b7280',
    fontSize: 12,
  },
  synthBadge: {
    backgroundColor: '#1a1006',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#b4530944',
  },
  synthBadgeText: {
    color: '#fbbf24',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  chevron: {
    color: '#6b7280',
    fontSize: 10,
  },

  // Session body
  sessionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  divider: {
    height: 1,
    backgroundColor: '#1e3a28',
    marginBottom: 10,
  },
  noClipsText: {
    color: '#6b7280',
    fontSize: 13,
    paddingVertical: 8,
  },

  // Clip row
  clipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#0d2b1c',
    gap: 10,
  },
  clipInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clipIdx: {
    color: '#4b5563',
    fontSize: 12,
    width: 24,
    textAlign: 'right',
  },
  clipOffset: {
    color: '#e8f5e9',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  clipMethod: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 1,
  },
  clipRange: {
    color: '#4b5563',
    fontSize: 11,
  },
  playBtn: {
    backgroundColor: '#0d2b1c',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#00C89633',
  },
  playBtnActive: {
    backgroundColor: '#00C896',
    borderColor: '#00C896',
  },
  playBtnText: {
    color: '#00C896',
    fontSize: 12,
    fontWeight: '700',
  },

  // Delete
  deleteBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3b0d0d44',
    backgroundColor: '#1a0505',
  },
  deleteBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },

  bottomPad: {
    height: 40,
  },

  // ── Review debug styles ───────────────────
  reviewSection: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  reviewSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  reviewSectionTitle: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  reviewRefreshBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  reviewRefreshText: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '700',
  },
  reviewActionBtn: {
    backgroundColor: '#0d2418',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: 8,
  },
  reviewActionText: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '600',
  },
  reviewDestructiveBtn: {
    backgroundColor: '#1a0505',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3b0d0d44',
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  reviewDestructiveText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  reviewCard: {
    backgroundColor: '#0d2418',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  reviewCardLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  reviewCardText: {
    color: '#e5e7eb',
    fontSize: 13,
    lineHeight: 18,
  },
  reviewCardMeta: {
    color: '#4b5563',
    fontSize: 11,
    marginTop: 4,
  },
});

// 2026-05-24 — Feel Capture viewer (owner-only dataset reviewer).
function FeelCaptureViewer() {
  const tuples = useCageStore((s) => {
    void s.activeSession;
    void s.sessionHistory;
    return listFeelCaptureTuples(50);
  });
  if (tuples.length === 0) {
    return (
      <View style={feelStyles.empty}>
        <Text style={feelStyles.emptyTitle}>FEEL CAPTURE</Text>
        <Text style={feelStyles.emptyBody}>
          No paired tuples yet. Toggle Feel Capture in Settings → Owner Tools and capture a cage swing while narrating what you felt.
        </Text>
      </View>
    );
  }
  return (
    <View style={feelStyles.wrap}>
      <Text style={feelStyles.heading}>FEEL CAPTURE — {tuples.length} TUPLE{tuples.length === 1 ? '' : 'S'}</Text>
      <ScrollView style={feelStyles.list}>
        {tuples.map((t: FeelCaptureTuple) => (
          <View key={t.shotId} style={feelStyles.tuple}>
            <Text style={feelStyles.tupleMeta}>
              {new Date(t.date).toLocaleString()} · {t.club || 'unknown'} · {t.detected_issue ?? '—'} ({t.severity ?? '—'})
            </Text>
            <Text style={feelStyles.tupleLabel}>FEEL (you said)</Text>
            <Text style={feelStyles.feelBody}>{t.transcript}</Text>
            <Text style={feelStyles.tupleLabel}>READ (analysis)</Text>
            <Text style={feelStyles.readBody}>{t.observation ?? '(no observation)'}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const feelStyles = StyleSheet.create({
  wrap: {
    backgroundColor: '#0d1a0d',
    borderBottomColor: '#1e3a28',
    borderBottomWidth: 1,
    padding: 10,
  },
  heading: { color: '#cfe8ff', fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  list: { maxHeight: 320 },
  tuple: {
    backgroundColor: '#020503',
    borderColor: '#1e3a28',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  tupleMeta: { color: '#9ca3af', fontSize: 10, marginBottom: 6 },
  tupleLabel: { color: '#7dd3a8', fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 6 },
  feelBody: { color: '#e8f5e9', fontSize: 12, lineHeight: 17, fontStyle: 'italic', marginTop: 3 },
  readBody: { color: '#e8f5e9', fontSize: 12, lineHeight: 17, marginTop: 3 },
  empty: {
    backgroundColor: '#0d1a0d',
    borderBottomColor: '#1e3a28',
    borderBottomWidth: 1,
    padding: 14,
    alignItems: 'center',
  },
  emptyTitle: { color: '#9ca3af', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  emptyBody: { color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 6, lineHeight: 16 },
});
