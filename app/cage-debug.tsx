import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import {
  listSessions,
  deleteSession,
  createSyntheticSession,
} from '../services/cageStorage';
import type { CageSession, CageClip } from '../types/cage';

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
  const router = useRouter();
  const { sessionId: focusSessionId } = useLocalSearchParams<{ sessionId?: string }>();

  const [sessions, setSessions] = useState<CageSession[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(focusSessionId ?? null);
  const [selectedClip, setSelectedClip] = useState<{ clip: CageClip; session: CageSession } | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Auto-seek to clip start when video loads
  const handleVideoLoad = useCallback(async () => {
    if (!selectedClip) return;
    await videoRef.current?.setPositionAsync(selectedClip.clip.start_time_seconds * 1000);
    await videoRef.current?.playAsync();
  }, [selectedClip]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cage Sessions</Text>
        <TouchableOpacity style={styles.synthBtn} onPress={handleSyntheticTest}>
          <Text style={styles.synthBtnText}>+ Synthetic test</Text>
        </TouchableOpacity>
      </View>

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
              Tap "+ Synthetic test" above to verify storage works without going to the cage.
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
});
