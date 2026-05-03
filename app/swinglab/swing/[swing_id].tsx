/**
 * Phase R — Uploaded swing detail surface.
 *
 * Loads a session by id, plays the swing video, lets the user toggle
 * between embedded coach audio (if present) and Kevin's analysis voice.
 * Shows PrimaryIssueCard + DrillCard with timestamp anchors that scrub
 * the video to the detected moment.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Video, ResizeMode, type AVPlaybackStatus, type AVPlaybackStatusSuccess } from 'expo-av';
import { useTheme } from '../../../contexts/ThemeContext';
import { useCageStore, type AnalysisStatus } from '../../../store/cageStore';
import { useTrustLevelStore } from '../../../store/trustLevelStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { speak, stopSpeaking, configureAudioForSpeech } from '../../../services/voiceService';
import { runPhaseKOnSession } from '../../../services/videoUpload';
import PrimaryIssueCard from '../../../components/swinglab/PrimaryIssueCard';
import DrillCard from '../../../components/swinglab/DrillCard';

type AudioSource = 'coach' | 'kevin';

// Phase V — copy the user sees while Phase K is running. Maps the analysis
// lifecycle stages to honest, plain-language status.
const STATUS_COPY: Record<AnalysisStatus, string> = {
  pending:           'Kevin is reviewing your swing…',
  analyzing_frames:  'Extracting frames…',
  analyzing_pose:    'Watching the swing…',
  analyzing_pattern: 'Identifying patterns…',
  ok:                'Analysis complete.',
  failed:            "I had trouble watching this one.",
};

export default function SwingDetail() {
  const router = useRouter();
  const { colors } = useTheme();
  const { swing_id } = useLocalSearchParams<{ swing_id: string }>();
  const trustLevel = useTrustLevelStore(s => s.level);
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  // Phase V — subscribe via the store selector so the surface re-renders
  // when Phase K transitions analysis_status / populates primary_issue.
  // The previous static getSession() call returned a snapshot and never
  // updated past the initial mount.
  const session = useCageStore(s =>
    swing_id ? s.sessionHistory.find(x => x.id === swing_id) ?? null : null,
  );
  const shot = session?.shots[0];

  const videoRef = useRef<Video>(null);
  const [audioSource, setAudioSource] = useState<AudioSource>(
    // Phase R — default per trust level: L1 prefers coach audio when present;
    // L2-L4 default to coach audio when present, otherwise Kevin analysis.
    (session?.upload?.has_audio && trustLevel === 1) ? 'coach' :
    session?.upload?.has_audio ? 'coach' : 'kevin'
  );
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(session?.upload?.duration_sec ?? null);

  // Toggle audio source: muting video for kevin mode, unmuting for coach
  useEffect(() => {
    void videoRef.current?.setIsMutedAsync(audioSource === 'kevin');
    if (audioSource === 'kevin') {
      // Speak the analysis once when switching into kevin mode
      const issue = session?.primary_issue;
      if (issue && apiUrl) {
        const text = `${issue.name}. ${issue.mechanical_breakdown} ${issue.feel_cue}`;
        void (async () => {
          await configureAudioForSpeech();
          await speak(text, voiceGender, language, apiUrl);
        })();
      }
    } else {
      void stopSpeaking();
    }
    return () => { void stopSpeaking(); };
  }, [audioSource, session?.primary_issue, apiUrl, voiceGender, language]);

  // Phase V — automatic Kevin voice when analysis FIRST completes for this
  // session. Fires once per swing_id transition into 'ok' so the player
  // gets the coach-delivered result without toggling. Skipped at Quiet
  // (banner-only) trust and when voiceEnabled=false. Also drives a subtle
  // entry animation for the analysis cards.
  const cardsFade = useRef(new Animated.Value(0)).current;
  const spokenForRef = useRef<string | null>(null);
  const analysisStatus: AnalysisStatus = session?.analysis_status ?? 'pending';
  useEffect(() => {
    if (analysisStatus === 'ok') {
      Animated.timing(cardsFade, { toValue: 1, duration: 420, useNativeDriver: true }).start();
    }
    if (analysisStatus !== 'ok') return;
    if (!session?.primary_issue || !swing_id) return;
    if (spokenForRef.current === swing_id) return;
    spokenForRef.current = swing_id;
    if (!voiceEnabled || trustLevel === 1) return;
    const issue = session.primary_issue;
    const text = `Okay, I watched it. Your primary issue is ${issue.name.toLowerCase()}. ${issue.mechanical_breakdown} ${issue.feel_cue}`;
    void (async () => {
      await configureAudioForSpeech();
      await speak(text, voiceGender, language, apiUrl);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisStatus, swing_id, session?.primary_issue?.issue_id]);

  const onPlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    const s = status as AVPlaybackStatusSuccess;
    if (s.positionMillis != null) setPosition(s.positionMillis / 1000);
    if (s.durationMillis != null) setDuration(s.durationMillis / 1000);
  };

  const scrubTo = async (sec: number) => {
    await videoRef.current?.setPositionAsync(sec * 1000);
    await videoRef.current?.playAsync();
  };

  if (!session || !shot?.clipUri) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <Text style={{ color: colors.text_primary }}>Swing not found.</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
            <Text style={{ color: colors.accent }}>‹ Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const hasAudio = session.upload?.has_audio === true;
  const issueTimestamps = shot.detected_issue_timestamps_sec ?? [];

  // Phase V.7 — Re-run Phase K on this session with the post-V.6 pipeline.
  // Status transitions inside runPhaseKOnSession drive the existing analyzing
  // card automatically. Reset spokenForRef so Kevin re-narrates on completion.
  const reanalyzing =
    analysisStatus === 'analyzing_frames' ||
    analysisStatus === 'analyzing_pose' ||
    analysisStatus === 'analyzing_pattern' ||
    analysisStatus === 'pending';
  const onReanalyze = () => {
    if (!swing_id || reanalyzing) return;
    spokenForRef.current = null;
    void runPhaseKOnSession(swing_id);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.back, { color: colors.accent }]}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]} numberOfLines={1}>
            {session.upload?.notes ?? `${session.club} swing`}
          </Text>
          <View style={{ width: 60 }} />
        </View>

        <View style={styles.videoWrap}>
          <Video
            ref={videoRef}
            source={{ uri: shot.clipUri }}
            style={styles.video}
            resizeMode={ResizeMode.CONTAIN}
            useNativeControls
            shouldPlay={false}
            isMuted={audioSource === 'kevin'}
            onPlaybackStatusUpdate={onPlaybackStatusUpdate}
          />
        </View>

        {/* Audio source toggle */}
        {hasAudio && (
          <View style={[styles.toggleRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <TouchableOpacity
              style={[styles.toggleBtn, audioSource === 'coach' && { backgroundColor: colors.accent }]}
              onPress={() => setAudioSource('coach')}
            >
              <Text style={[styles.toggleText, audioSource === 'coach' && { color: '#fff' }]}>Coach Audio</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, audioSource === 'kevin' && { backgroundColor: colors.accent }]}
              onPress={() => setAudioSource('kevin')}
            >
              <Text style={[styles.toggleText, audioSource === 'kevin' && { color: '#fff' }]}>Kevin Analysis</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Issue timestamp anchors */}
        {issueTimestamps.length > 0 && session.primary_issue && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text_muted }]}>DETECTED MOMENTS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              {issueTimestamps.map((ts, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => void scrubTo(ts)}
                  style={[styles.tsPill, { borderColor: colors.accent, backgroundColor: colors.accent_muted }]}
                >
                  <Text style={[styles.tsText, { color: colors.accent }]}>0:{Math.floor(ts).toString().padStart(2, '0')}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={[styles.tsHint, { color: colors.text_muted }]}>Tap a timestamp to jump to that moment.</Text>
          </View>
        )}

        {/* Phase V — analysis processing / failure / done */}
        <View style={{ marginTop: 16 }}>
          {analysisStatus !== 'ok' && analysisStatus !== 'failed' && (
            <View style={[styles.analyzingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <ActivityIndicator color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.analyzingText, { color: colors.text_primary }]}>
                  {STATUS_COPY[analysisStatus]}
                </Text>
                <Text style={[styles.analyzingSub, { color: colors.text_muted }]}>
                  About 60 seconds. You can stay on this screen.
                </Text>
              </View>
            </View>
          )}

          {analysisStatus === 'failed' && (
            <View style={[styles.failedCard, { backgroundColor: colors.surface, borderColor: '#ef4444' }]}>
              <Text style={[styles.failedTitle, { color: '#ef4444' }]}>Couldn&apos;t analyze this one</Text>
              <Text style={[styles.failedBody, { color: colors.text_primary }]}>
                {session.analysis_error ?? "I had trouble watching this one — could be lighting, angle, or video quality."}
              </Text>
              <View style={styles.failedBtnRow}>
                <TouchableOpacity
                  style={[styles.failedBtn, { borderColor: colors.accent }]}
                  onPress={onReanalyze}
                >
                  <Text style={[styles.failedBtnText, { color: colors.accent }]}>Try again with new analysis</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.failedBtn, { borderColor: colors.border }]}
                  onPress={() => router.replace('/swinglab/upload' as never)}
                >
                  <Text style={[styles.failedBtnText, { color: colors.text_muted }]}>Upload another</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {analysisStatus === 'ok' && (
            <Animated.View style={{ opacity: cardsFade }}>
              <PrimaryIssueCard issue={session.primary_issue ?? null} totalShots={session.shots.length} />
              <DrillCard recommendation={session.drill_recommendation ?? null} />
              <TouchableOpacity
                style={[styles.reanalyzeBtn, { borderColor: colors.border }]}
                onPress={onReanalyze}
                disabled={reanalyzing}
              >
                <Text style={[styles.reanalyzeText, { color: colors.text_muted }]}>Re-analyze with latest</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>

        {/* Metadata */}
        {session.upload && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text_muted }]}>DETAILS</Text>
            <Text style={[styles.detailLine, { color: colors.text_primary }]}>Club: {session.club}</Text>
            {session.upload.swinger ? (
              <Text style={[styles.detailLine, { color: colors.text_primary }]}>Swinger: {session.upload.swinger}</Text>
            ) : null}
            {session.upload.tag ? (
              <Text style={[styles.detailLine, { color: colors.text_primary }]}>Tag: {session.upload.tag}</Text>
            ) : null}
            {duration != null ? (
              <Text style={[styles.detailLine, { color: colors.text_muted }]}>Duration: {duration.toFixed(1)}s · Position: {position.toFixed(1)}s</Text>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingBottom: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  back: { fontSize: 16, fontWeight: '600', width: 60 },
  title: { fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  videoWrap: { width: '100%', aspectRatio: 9 / 16, maxHeight: 460, backgroundColor: '#000' },
  video: { width: '100%', height: '100%' },
  toggleRow: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 12, padding: 4,
    borderRadius: 999, borderWidth: 1,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 999 },
  toggleText: { fontSize: 13, fontWeight: '700', color: '#9ca3af' },
  card: {
    marginHorizontal: 16, marginTop: 12, padding: 14,
    borderRadius: 14, borderWidth: 1,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  tsPill: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, marginRight: 8,
  },
  tsText: { fontSize: 13, fontWeight: '700' },
  tsHint: { fontSize: 11, marginTop: 8 },
  detailLine: { fontSize: 14, marginTop: 6 },
  analyzingCard: {
    marginHorizontal: 16, padding: 16, borderRadius: 14, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  analyzingText: { fontSize: 14, fontWeight: '700' },
  analyzingSub: { fontSize: 12, marginTop: 4 },
  failedCard: {
    marginHorizontal: 16, padding: 16, borderRadius: 14, borderWidth: 1,
    gap: 8,
  },
  failedTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  failedBody: { fontSize: 14, lineHeight: 20 },
  failedBtnRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 },
  failedBtn: {
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1.5,
  },
  failedBtnText: { fontSize: 13, fontWeight: '800' },
  reanalyzeBtn: {
    marginHorizontal: 16, marginTop: 12,
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1,
    alignSelf: 'flex-start',
  },
  reanalyzeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
});
