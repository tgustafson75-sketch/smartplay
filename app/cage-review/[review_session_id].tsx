import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import {
  getReviewSession,
  updateReviewSession,
  endReviewSession,
  getShotsForReview,
  nextUnreviewedShot,
} from '../../services/cageReview';
import { saveGeneratedProfile } from '../../services/vocabularyProfile';
import { useCageStore } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { speak, configureAudioForSpeech, configureAudioForRecording } from '../../services/voiceService';
import type { ReviewSession } from '../../types/cageReview';
import type { CageShot } from '../../store/cageStore';

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.LOW,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

type ScreenState =
  | 'loading'
  | 'question'
  | 'recording'
  | 'transcribing'
  | 'extracting'
  | 'done';

export default function CageReviewInterview() {
  const { review_session_id } = useLocalSearchParams<{ review_session_id: string }>();
  const router = useRouter();
  const { sessionHistory, updateShotLabels } = useCageStore();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

  const [review, setReview] = useState<ReviewSession | null>(null);
  const [eligibleShots, setEligibleShots] = useState<CageShot[]>([]);
  const [currentShot, setCurrentShot] = useState<CageShot | null>(null);
  const [question, setQuestion] = useState<string>('');
  const [transcript, setTranscript] = useState<string>('');
  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const micPulse = useRef(new Animated.Value(1)).current;

  // ── Load review session on mount ──────────────────────────────────────────

  useEffect(() => {
    if (!review_session_id) return;
    getReviewSession(review_session_id).then(r => {
      if (!r) { setErrorMsg('Review session not found.'); setScreenState('done'); return; }
      const cageSession = sessionHistory.find(s => s.id === r.cage_session_id);
      if (!cageSession) { setErrorMsg('Session data not found.'); setScreenState('done'); return; }
      const shots = getShotsForReview(r.mode, cageSession.shots);
      setReview(r);
      setEligibleShots(shots);
      const next = nextUnreviewedShot(r, shots);
      if (!next) {
        finishReview(r);
        return;
      }
      setCurrentShot(next);
      loadQuestion(r, shots, next);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review_session_id]);

  // ── Mic pulse animation ───────────────────────────────────────────────────

  useEffect(() => {
    if (screenState === 'recording') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(micPulse, { toValue: 1.18, duration: 600, useNativeDriver: true }),
          Animated.timing(micPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [screenState, micPulse]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const shotPosition = (shot: CageShot, shots: CageShot[]): 'early' | 'middle' | 'late' => {
    const idx = shots.findIndex(s => s.id === shot.id);
    const pct = shots.length > 1 ? idx / (shots.length - 1) : 0;
    if (pct < 0.33) return 'early';
    if (pct < 0.67) return 'middle';
    return 'late';
  };

  const loadQuestion = useCallback(async (
    r: ReviewSession,
    shots: CageShot[],
    shot: CageShot,
  ) => {
    setScreenState('loading');
    setQuestion('');
    setTranscript('');
    try {
      const clipIndex = shots.findIndex(s => s.id === shot.id);
      const cageSession = sessionHistory.find(s => s.id === r.cage_session_id);
      const sessionDate = cageSession
        ? new Date(cageSession.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : 'unknown';

      const res = await fetch(apiUrl + '/api/cage-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'question',
          clip_index: clipIndex,
          total_clips: shots.length,
          session_date: sessionDate,
          detection_method: 'manual',
          position: shotPosition(shot, shots),
          prior_labels: shot.review_labels
            ? `${shot.review_labels.strike_location}, ${shot.review_labels.contact_quality}`
            : null,
          mode: r.mode,
          feel: shot.feel,
          shape: shot.shape,
          club: shot.club,
        }),
      });
      const data = await res.json() as { question?: string };
      const q = data.question ?? 'How was that one?';
      setQuestion(q);
      setScreenState('question');
      if (voiceEnabled) {
        await configureAudioForSpeech();
        speak(q, voiceGender, language, apiUrl).catch(() => {});
      }
    } catch {
      setQuestion('How was that one?');
      setScreenState('question');
    }
  }, [apiUrl, sessionHistory, voiceEnabled, voiceGender, language]);

  const startRecording = async () => {
    try {
      await configureAudioForRecording();
      const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
      recordingRef.current = recording;
      setScreenState('recording');
    } catch {
      setErrorMsg('Microphone not available. Type your response instead, or skip this shot.');
      setScreenState('question');
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    setScreenState('transcribing');
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) { setScreenState('question'); return; }

      const formData = new FormData();
      formData.append('audio', { uri, name: 'response.m4a', type: 'audio/m4a' } as unknown as Blob);
      formData.append('language', 'en');

      const res = await fetch(apiUrl + '/api/transcribe', { method: 'POST', body: formData });
      const data = await res.json() as { text?: string };
      const text = data.text?.trim() ?? '';
      setTranscript(text);
      setScreenState('question');
    } catch {
      recordingRef.current = null;
      setScreenState('question');
    }
  };

  const submitResponse = async (responseText: string) => {
    if (!review || !currentShot) return;
    setScreenState('extracting');
    try {
      const res = await fetch(apiUrl + '/api/cage-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extract', transcript: responseText }),
      });
      const data = await res.json() as { labels?: Record<string, unknown> };
      const rawLabels = (data.labels ?? {}) as Record<string, unknown>;
      const labels: Parameters<typeof updateShotLabels>[2] = {
        strike_location: (rawLabels.strike_location as Parameters<typeof updateShotLabels>[2]['strike_location']) ?? 'unknown',
        contact_quality: (rawLabels.contact_quality as Parameters<typeof updateShotLabels>[2]['contact_quality']) ?? 'unknown',
        self_diagnosis: (rawLabels.self_diagnosis as string | null) ?? null,
        intent: (rawLabels.intent as string | null) ?? null,
        mental_state: (rawLabels.mental_state as string | null) ?? null,
        notable_phrases: (rawLabels.notable_phrases as string[]) ?? [],
      };

      updateShotLabels(
        review.cage_session_id,
        currentShot.id,
        labels,
        responseText,
      );

      const updated: ReviewSession = {
        ...review,
        shots_reviewed: [...review.shots_reviewed, currentShot.id],
        vocabulary_observations: responseText.trim()
          ? [...review.vocabulary_observations, responseText]
          : review.vocabulary_observations,
      };
      await updateReviewSession(updated);
      setReview(updated);

      const next = nextUnreviewedShot(updated, eligibleShots);
      if (!next) {
        finishReview(updated);
        return;
      }
      setCurrentShot(next);
      loadQuestion(updated, eligibleShots, next);
    } catch {
      setScreenState('question');
    }
  };

  const handleSkip = async () => {
    if (!review || !currentShot) return;
    const updated: ReviewSession = {
      ...review,
      shots_reviewed: [...review.shots_reviewed, currentShot.id],
    };
    await updateReviewSession(updated);
    setReview(updated);

    const next = nextUnreviewedShot(updated, eligibleShots);
    if (!next) {
      finishReview(updated);
      return;
    }
    setCurrentShot(next);
    loadQuestion(updated, eligibleShots, next);
  };

  const finishReview = useCallback(async (r: ReviewSession) => {
    setScreenState('extracting');
    try {
      const completed = await endReviewSession(r.id);
      if (completed.vocabulary_observations.length > 0) {
        const res = await fetch(apiUrl + '/api/cage-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'vocab',
            transcripts: completed.vocabulary_observations,
            total_reviewed: completed.shots_reviewed.length,
          }),
        });
        const data = await res.json() as {
          observed_terminology: { strike_terms: string[]; contact_terms: string[]; diagnostic_terms: string[]; feel_terms: string[] };
          kevin_summary: string;
          total_clips_reviewed: number;
        };
        await saveGeneratedProfile(data);
      }
      router.replace({
        pathname: '/cage-review/summary',
        params: { review_session_id: r.id },
      } as never);
    } catch {
      router.replace('/cage' as never);
    }
  }, [apiUrl, router]);

  // ── Progress info ─────────────────────────────────────────────────────────

  const reviewedCount = review?.shots_reviewed.length ?? 0;
  const totalCount = eligibleShots.length;
  const progressPct = totalCount > 0 ? reviewedCount / totalCount : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  if (screenState === 'done' || errorMsg) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{errorMsg ?? 'Review complete'}</Text>
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/cage' as never)}>
            <Text style={styles.doneBtnText}>Back to Sessions</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* PROGRESS BAR */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${Math.round(progressPct * 100)}%` }]} />
      </View>

      <View style={styles.progressLabel}>
        <Text style={styles.progressText}>
          Shot {reviewedCount + 1} of {totalCount}
        </Text>
      </View>

      {/* SHOT CONTEXT */}
      {currentShot && (
        <View style={styles.shotContext}>
          <Text style={styles.shotClub}>{currentShot.club}</Text>
          {currentShot.feel && <Text style={styles.shotFeel}>{currentShot.feel}</Text>}
          {currentShot.shape && <Text style={styles.shotShape}>{currentShot.shape}</Text>}
        </View>
      )}

      {/* KEVIN QUESTION */}
      <View style={styles.questionArea}>
        {screenState === 'loading' ? (
          <View style={styles.thinkingRow}>
            <ActivityIndicator color="#00C896" size="small" />
            <Text style={styles.thinkingText}>Kevin is thinking…</Text>
          </View>
        ) : (
          <View style={styles.questionCard}>
            <Text style={styles.questionLabel}>KEVIN</Text>
            <Text style={styles.questionText}>{question}</Text>
          </View>
        )}
      </View>

      {/* TRANSCRIPT (if recorded) */}
      {transcript.trim().length > 0 && screenState === 'question' && (
        <View style={styles.transcriptCard}>
          <Text style={styles.transcriptLabel}>YOU SAID</Text>
          <Text style={styles.transcriptText}>{transcript}</Text>
        </View>
      )}

      {/* CONTROLS */}
      <View style={styles.controls}>
        {screenState === 'question' && (
          <>
            {transcript.trim().length > 0 ? (
              <TouchableOpacity style={styles.submitBtn} onPress={() => submitResponse(transcript)}>
                <Text style={styles.submitBtnText}>Submit</Text>
              </TouchableOpacity>
            ) : (
              <Animated.View style={{ transform: [{ scale: micPulse }] }}>
                <TouchableOpacity style={styles.micBtn} onPress={startRecording}>
                  <Text style={styles.micIcon}>🎙</Text>
                  <Text style={styles.micLabel}>Tap to respond</Text>
                </TouchableOpacity>
              </Animated.View>
            )}
            <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          </>
        )}

        {screenState === 'recording' && (
          <TouchableOpacity style={[styles.micBtn, styles.micBtnActive]} onPress={stopRecording}>
            <Text style={styles.micIcon}>⏹</Text>
            <Text style={styles.micLabel}>Tap to stop</Text>
          </TouchableOpacity>
        )}

        {(screenState === 'transcribing' || screenState === 'extracting') && (
          <View style={styles.thinkingRow}>
            <ActivityIndicator color="#00C896" size="small" />
            <Text style={styles.thinkingText}>
              {screenState === 'transcribing' ? 'Transcribing…' : 'Labeling shot…'}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  progressBar: { height: 3, backgroundColor: '#1e3a28', width: '100%' },
  progressFill: { height: 3, backgroundColor: '#00C896' },
  progressLabel: { alignItems: 'center', paddingVertical: 8 },
  progressText: { color: '#4b5563', fontSize: 11, fontWeight: '700' },
  shotContext: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingBottom: 10,
  },
  shotClub: { color: '#00C896', fontSize: 14, fontWeight: '800' },
  shotFeel: {
    color: '#6b7280', fontSize: 12,
    borderWidth: 1, borderColor: '#1e3a28', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  shotShape: {
    color: '#6b7280', fontSize: 12,
    borderWidth: 1, borderColor: '#1e3a28', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  questionArea: {
    flex: 1, justifyContent: 'center', paddingHorizontal: 24,
  },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  thinkingText: { color: '#6b7280', fontSize: 14 },
  questionCard: {
    backgroundColor: '#0d2418', borderLeftWidth: 3, borderLeftColor: '#00C896',
    borderRadius: 10, padding: 18,
  },
  questionLabel: { color: '#00C896', fontSize: 9, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  questionText: { color: '#ffffff', fontSize: 20, fontWeight: '600', lineHeight: 28 },
  transcriptCard: {
    marginHorizontal: 20, marginBottom: 12,
    backgroundColor: '#0a1a10', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', padding: 12,
  },
  transcriptLabel: { color: '#4b5563', fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  transcriptText: { color: '#e5e7eb', fontSize: 14, lineHeight: 20 },
  controls: {
    paddingHorizontal: 24, paddingBottom: 32, alignItems: 'center', gap: 12,
  },
  micBtn: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#0d2418', borderWidth: 2, borderColor: '#1e3a28',
    alignItems: 'center', justifyContent: 'center',
  },
  micBtnActive: { borderColor: '#ef4444', backgroundColor: '#2a0a0a' },
  micIcon: { fontSize: 28 },
  micLabel: { color: '#6b7280', fontSize: 10, fontWeight: '700', marginTop: 2 },
  submitBtn: {
    backgroundColor: '#00C896', borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 40,
  },
  submitBtnText: { color: '#060f09', fontSize: 16, fontWeight: '800' },
  skipBtn: { paddingVertical: 8, paddingHorizontal: 24 },
  skipText: { color: '#374151', fontSize: 14 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800', marginBottom: 20, textAlign: 'center' },
  doneBtn: {
    backgroundColor: '#0d2418', borderRadius: 12,
    borderWidth: 1, borderColor: '#1e3a28',
    paddingVertical: 12, paddingHorizontal: 28,
  },
  doneBtnText: { color: '#00C896', fontSize: 15, fontWeight: '700' },
});
