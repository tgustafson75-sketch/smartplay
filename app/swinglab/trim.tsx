/**
 * 2026-05-25 — Path C: trim screen for long uploaded swing clips.
 *
 * Flow:
 *   Upload picks a long clip (>6s) → ingest with deferAnalysis:true →
 *   navigate here with ?session_id=... → user scrubs the video + taps
 *   Set Start / Set End at the playhead to mark the swing window →
 *   "Analyze this window" writes clipStartSeconds/clipEndSeconds onto
 *   the shot + fires runPhaseKOnSession → routes to the swing detail
 *   screen with the analysis in flight.
 *
 *   Skip path: "Analyze whole clip" fires analysis WITHOUT trim
 *   boundaries; extractKeyFrames falls back to tiered sampling
 *   (commit e37953c). For users who don't want to trim or for short
 *   clips that landed here by mistake.
 *
 * Pre-positions the window at last 4s as a "smart enough" default for
 * instructor-style videos that have a preroll and finish with the
 * student's swing. User adjusts via Set Start / Set End at any
 * playhead position. Real audio-spike or motion-peak auto-marker is
 * post-beta (needs ffmpeg pipeline).
 *
 * Owner-only? NO — this is part of the user upload flow. Renders for
 * everyone who uploads a >6s clip.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Video, ResizeMode, type AVPlaybackStatus, type AVPlaybackStatusSuccess } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useCageStore } from '../../store/cageStore';
import { runPhaseKOnSession } from '../../services/videoUpload';
import { useDeviceLayout, WIDE_CONTENT_MAX_WIDTH } from '../../hooks/useDeviceLayout';

// Heuristic default window: last 4 seconds. Right ~70% of the time for
// instructor-style clips (talking head preroll, swing at the end).
const DEFAULT_WINDOW_SEC = 4;

export default function TrimScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { isWide } = useDeviceLayout();
  const { session_id } = useLocalSearchParams<{ session_id: string }>();

  const session = useCageStore(s => s.sessionHistory.find(x => x.id === session_id));
  const shot = session?.shots[0] ?? null;
  const clipUri = shot?.clipUri ?? null;

  const videoRef = useRef<Video>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [windowDefaulted, setWindowDefaulted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pre-position window at last DEFAULT_WINDOW_SEC seconds once duration lands.
  useEffect(() => {
    if (windowDefaulted || duration <= 0) return;
    const defaultStart = Math.max(0, duration - DEFAULT_WINDOW_SEC);
    setStartSec(defaultStart);
    setEndSec(duration);
    setWindowDefaulted(true);
  }, [duration, windowDefaulted]);

  const onPlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    const s = status as AVPlaybackStatusSuccess;
    if (s.positionMillis != null) setPosition(s.positionMillis / 1000);
    if (s.durationMillis != null) setDuration(s.durationMillis / 1000);
  };

  const setStart = () => {
    // Clamp: start must be < end (leave at least 0.5s window)
    const clamped = Math.min(position, Math.max(0, endSec - 0.5));
    setStartSec(clamped);
  };
  const setEnd = () => {
    const clamped = Math.max(position, Math.min(duration, startSec + 0.5));
    setEndSec(clamped);
  };

  const fireAnalysis = (withBoundaries: boolean) => {
    if (!session_id || !shot) return;
    setSubmitting(true);
    if (withBoundaries) {
      useCageStore.getState().setShotClipBoundaries(session_id, shot.id, startSec, endSec);
    } else {
      useCageStore.getState().setShotClipBoundaries(session_id, shot.id, null, null);
    }
    useCageStore.getState().setSessionAnalysisStatus(session_id, 'pending');
    // Fire-and-forget; detail screen renders the analyzing card.
    void runPhaseKOnSession(session_id);
    router.replace(`/swinglab/swing/${session_id}` as never);
  };

  // Defensive: bad session_id or missing clip → bounce to library so
  // the user isn't trapped on a broken screen.
  if (!session_id || !clipUri) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.errorBox}>
          <Text style={[styles.errorText, { color: colors.text_primary }]}>
            Couldn&apos;t load that swing.
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.accent, marginTop: 12 }]}
            onPress={() => router.replace('/swinglab/library' as never)}
          >
            <Text style={styles.primaryBtnText}>Back to library</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const windowSec = Math.max(0, endSec - startSec);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.replace('/swinglab/library' as never)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.back, { color: colors.accent }]}>‹ Library</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Mark the Swing</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={isWide ? { width: '100%', maxWidth: WIDE_CONTENT_MAX_WIDTH, alignSelf: 'center' } : undefined}>
        <View style={styles.videoFrame}>
          <Video
            ref={videoRef}
            source={{ uri: clipUri }}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.CONTAIN}
            useNativeControls
            shouldPlay={false}
            isMuted={false}
            onPlaybackStatusUpdate={onPlaybackStatusUpdate}
          />
        </View>

        <View style={[styles.windowCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.windowHeader, { color: colors.text_muted }]}>SWING WINDOW</Text>
          <View style={styles.windowRow}>
            <Text style={[styles.windowLabel, { color: colors.text_primary }]}>
              {startSec.toFixed(1)}s
            </Text>
            <Ionicons name="arrow-forward" size={14} color={colors.text_muted} />
            <Text style={[styles.windowLabel, { color: colors.text_primary }]}>
              {endSec.toFixed(1)}s
            </Text>
            <Text style={[styles.windowDuration, { color: colors.accent }]}>
              ({windowSec.toFixed(1)}s)
            </Text>
          </View>
          <Text style={[styles.windowHint, { color: colors.text_muted }]}>
            Scrub the video to the start of your swing, tap &quot;Set Start.&quot; Scrub to the end of your follow-through, tap &quot;Set End.&quot; Or use the default window below.
          </Text>
        </View>

        <View style={styles.markerRow}>
          <TouchableOpacity
            style={[styles.markerBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={setStart}
            disabled={submitting}
          >
            <Ionicons name="play-skip-back" size={16} color={colors.accent} />
            <Text style={[styles.markerText, { color: colors.text_primary }]}>
              Set Start ({position.toFixed(1)}s)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.markerBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={setEnd}
            disabled={submitting}
          >
            <Ionicons name="play-skip-forward" size={16} color={colors.accent} />
            <Text style={[styles.markerText, { color: colors.text_primary }]}>
              Set End ({position.toFixed(1)}s)
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.accent }, submitting && { opacity: 0.5 }]}
          onPress={() => fireAnalysis(true)}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.primaryBtnText}>Analyze This Window ({windowSec.toFixed(1)}s)</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border }, submitting && { opacity: 0.5 }]}
          onPress={() => fireAnalysis(false)}
          disabled={submitting}
        >
          <Text style={[styles.secondaryBtnText, { color: colors.text_muted }]}>
            Skip — Analyze Whole Clip
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  back: { fontSize: 16, width: 60 },
  title: { fontSize: 17, fontWeight: '700' },
  videoFrame: {
    width: '100%', aspectRatio: 9 / 16,
    maxHeight: 480,
    alignSelf: 'center',
    backgroundColor: '#000', position: 'relative',
  },
  windowCard: {
    marginHorizontal: 16, marginTop: 12,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  windowHeader: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  windowLabel: { fontSize: 16, fontWeight: '700' },
  windowDuration: { fontSize: 13, fontWeight: '600', marginLeft: 'auto' },
  windowHint: { fontSize: 12, marginTop: 8, lineHeight: 16 },
  markerRow: {
    flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 12,
  },
  markerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1,
  },
  markerText: { fontSize: 12, fontWeight: '600' },
  primaryBtn: {
    marginHorizontal: 16, marginTop: 16, paddingVertical: 14, borderRadius: 10, alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: {
    marginHorizontal: 16, marginTop: 10, paddingVertical: 10, borderRadius: 10,
    alignItems: 'center', borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 12, fontWeight: '600' },
  errorBox: { padding: 24, alignItems: 'center' },
  errorText: { fontSize: 16 },
});
