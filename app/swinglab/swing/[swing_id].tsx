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
  ActivityIndicator, Animated, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Video, ResizeMode, type AVPlaybackStatus, type AVPlaybackStatusSuccess } from 'expo-av';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { useCageStore, type AnalysisStatus, type CageShot } from '../../../store/cageStore';
import { useTrustLevelStore } from '../../../store/trustLevelStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { speak, stopSpeaking, configureAudioForSpeech } from '../../../services/voiceService';
import { runPhaseKOnSession } from '../../../services/videoUpload';
import { uploadLog } from '../../../services/uploadDiagnostic';
import PrimaryIssueCard from '../../../components/swinglab/PrimaryIssueCard';
import DrillCard from '../../../components/swinglab/DrillCard';
import SwingActionSheet from '../../../components/swinglab/SwingActionSheet';

type AudioSource = 'coach' | 'kevin';

// Phase BW — short mm:ss formatter for the per-swing list rows.
function formatMmSs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

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

  // Phase BZ-v1 — per-shot action sheet + compare mode state.
  const [actionShotId, setActionShotId] = useState<string | null>(null);
  const [leftCompareShotId, setLeftCompareShotId] = useState<string | null>(null);
  const [rightCompareShotId, setRightCompareShotId] = useState<string | null>(null);
  const isComparing = leftCompareShotId != null && rightCompareShotId != null;
  const isPickingCompareTarget = leftCompareShotId != null && rightCompareShotId == null;
  const actionShot = actionShotId
    ? session?.shots.find(s => s.id === actionShotId) ?? null
    : null;
  const leftShot = leftCompareShotId
    ? session?.shots.find(s => s.id === leftCompareShotId) ?? null
    : null;
  const rightShot = rightCompareShotId
    ? session?.shots.find(s => s.id === rightCompareShotId) ?? null
    : null;

  const videoRef = useRef<Video>(null);
  const leftCompareVideoRef = useRef<Video>(null);
  const rightCompareVideoRef = useRef<Video>(null);
  // Phase V.7+ — default to Kevin analysis. The has_audio probe in
  // videoUpload.probeVideo is unreliable (it returns true for any video with
  // a decoded duration, including silent gym clips), so previously every
  // upload landed on the coach-audio toggle and Tim heard silence instead
  // of Kevin. The user can still flip to Coach Audio if a real coach track
  // is present.
  const [audioSource, setAudioSource] = useState<AudioSource>(
    trustLevel === 1 && session?.upload?.has_audio ? 'coach' : 'kevin'
  );
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(session?.upload?.duration_sec ?? null);

  // Toggle audio source: muting video for kevin mode, unmuting for coach.
  // Phase V.7 — skip the auto-speak on the *initial* mount; the dedicated
  // first-completion effect below already narrates once. Without this guard,
  // mounting with default audioSource='kevin' fired both effects and the
  // second speak() cancelled the first mid-sentence.
  const initialAudioMountRef = useRef(true);
  useEffect(() => {
    void videoRef.current?.setIsMutedAsync(audioSource === 'kevin');
    if (initialAudioMountRef.current) {
      initialAudioMountRef.current = false;
      return;
    }
    if (audioSource === 'kevin') {
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

  // Phase BQ — emit [upload:ui-render] on every analysis_status transition
  // so the empirical trace shows whether the UI ever sees the result the
  // pipeline stored. Includes the full status so a "stuck on
  // analyzing_pose" failure is visible in logs instead of inferred.
  const lastRenderStatus = useRef<AnalysisStatus | null>(null);
  useEffect(() => {
    if (!swing_id) return;
    if (lastRenderStatus.current === analysisStatus) return;
    lastRenderStatus.current = analysisStatus;
    uploadLog('ui-render', {
      analysis_status: analysisStatus,
      has_primary_issue: !!session?.primary_issue,
      has_drill: !!session?.drill_recommendation,
      analysis_error: session?.analysis_error ?? null,
    }, swing_id);
  }, [analysisStatus, swing_id, session?.primary_issue, session?.drill_recommendation, session?.analysis_error]);

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

  // Phase BZ-v1 — when in compare-picker mode, tapping a row picks the
  // right-pane swing instead of scrubbing the main video. Otherwise
  // scrubs as before.
  const handleRowTap = async (s: CageShot) => {
    if (isPickingCompareTarget) {
      if (s.id === leftCompareShotId) return; // can't compare with itself
      setRightCompareShotId(s.id);
      return;
    }
    await scrubTo(s.clipStartSeconds ?? 0);
  };

  const handleStartCompare = (shotId: string) => {
    setLeftCompareShotId(shotId);
    setRightCompareShotId(null);
  };

  const exitCompare = () => {
    setLeftCompareShotId(null);
    setRightCompareShotId(null);
  };

  // Phase BZ-v1 — synced playback for the comparison view. Play/pause
  // applied to both video panes together so the user sees the swings
  // in lockstep.
  const playBoth = async () => {
    await Promise.all([
      leftCompareVideoRef.current?.playAsync(),
      rightCompareVideoRef.current?.playAsync(),
    ]);
  };
  const pauseBoth = async () => {
    await Promise.all([
      leftCompareVideoRef.current?.pauseAsync(),
      rightCompareVideoRef.current?.pauseAsync(),
    ]);
  };
  const restartBoth = async () => {
    const lStart = leftShot?.clipStartSeconds ?? 0;
    const rStart = rightShot?.clipStartSeconds ?? 0;
    await Promise.all([
      leftCompareVideoRef.current?.setPositionAsync(lStart * 1000),
      rightCompareVideoRef.current?.setPositionAsync(rStart * 1000),
    ]);
    await playBoth();
  };

  const handleSessionShare = async () => {
    if (!shot?.clipUri) {
      Alert.alert('Nothing to share', 'This session has no video file.');
      return;
    }
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(shot.clipUri, {
        mimeType: 'video/mp4',
        dialogTitle: 'Share session',
      });
    } catch (e) {
      console.log('[swing-detail] session share failed', e);
    }
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
    // Phase V.7 — flip status to 'pending' BEFORE clearing spokenForRef so the
    // auto-narrate effect can't fire with stale 'ok' status and re-speak the
    // old primary_issue between the ref clear and the first runPhaseK status
    // transition. Also stop any in-flight TTS from a prior auto-narration.
    uploadLog('reanalyze-start', { from_status: analysisStatus }, swing_id);
    void stopSpeaking().catch(() => {});
    useCageStore.getState().setSessionAnalysisStatus(swing_id, 'pending');
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
          <TouchableOpacity
            onPress={handleSessionShare}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ width: 60, alignItems: 'flex-end' }}
          >
            <Ionicons name="share-outline" size={22} color={colors.accent} />
          </TouchableOpacity>
        </View>

        {/* Phase BZ-v1 — comparison banner during compare-picker mode */}
        {isPickingCompareTarget && leftShot && (
          <View style={[styles.compareBanner, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}>
            <Ionicons name="git-compare-outline" size={18} color={colors.accent} />
            <Text style={[styles.compareBannerText, { color: colors.accent }]} numberOfLines={2}>
              Pick a swing below to compare with swing {String((session.shots.findIndex(x => x.id === leftShot.id) + 1)).padStart(2, '0')}.
            </Text>
            <TouchableOpacity onPress={exitCompare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.compareBannerCancel, { color: colors.accent }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Phase BZ-v1 — comparison view: two videos side-by-side */}
        {isComparing && leftShot && rightShot && (
          <View style={[styles.compareCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.compareHeader}>
              <Text style={[styles.compareLabel, { color: colors.text_muted }]}>COMPARE</Text>
              <TouchableOpacity onPress={exitCompare}>
                <Text style={[styles.compareExit, { color: colors.accent }]}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.compareRow}>
              <View style={styles.comparePane}>
                <Text style={[styles.compareCaption, { color: colors.text_muted }]} numberOfLines={1}>
                  Swing {String((session.shots.findIndex(x => x.id === leftShot.id) + 1)).padStart(2, '0')}
                  {leftShot.perShotAnalysis?.detected_issue && leftShot.perShotAnalysis.detected_issue !== 'none'
                    ? ` · ${leftShot.perShotAnalysis.detected_issue.replace(/_/g, ' ')}`
                    : ''}
                </Text>
                <Video
                  ref={leftCompareVideoRef}
                  source={{ uri: leftShot.clipUri ?? '' }}
                  style={styles.compareVideo}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={false}
                  isMuted
                  positionMillis={(leftShot.clipStartSeconds ?? 0) * 1000}
                />
              </View>
              <View style={styles.comparePane}>
                <Text style={[styles.compareCaption, { color: colors.text_muted }]} numberOfLines={1}>
                  Swing {String((session.shots.findIndex(x => x.id === rightShot.id) + 1)).padStart(2, '0')}
                  {rightShot.perShotAnalysis?.detected_issue && rightShot.perShotAnalysis.detected_issue !== 'none'
                    ? ` · ${rightShot.perShotAnalysis.detected_issue.replace(/_/g, ' ')}`
                    : ''}
                </Text>
                <Video
                  ref={rightCompareVideoRef}
                  source={{ uri: rightShot.clipUri ?? '' }}
                  style={styles.compareVideo}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={false}
                  isMuted
                  positionMillis={(rightShot.clipStartSeconds ?? 0) * 1000}
                />
              </View>
            </View>
            <View style={styles.compareControls}>
              <TouchableOpacity onPress={playBoth} style={[styles.compareCtrl, { backgroundColor: colors.accent }]}>
                <Ionicons name="play" size={16} color="#fff" />
                <Text style={styles.compareCtrlText}>Play both</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={pauseBoth} style={[styles.compareCtrl, { borderColor: colors.border, borderWidth: 1.5 }]}>
                <Ionicons name="pause" size={16} color={colors.text_primary} />
                <Text style={[styles.compareCtrlText, { color: colors.text_primary }]}>Pause</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={restartBoth} style={[styles.compareCtrl, { borderColor: colors.border, borderWidth: 1.5 }]}>
                <Ionicons name="refresh" size={16} color={colors.text_primary} />
                <Text style={[styles.compareCtrlText, { color: colors.text_primary }]}>Restart</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!isComparing && (
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
        )}

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
                  style={[styles.failedBtn, { borderColor: colors.accent, opacity: reanalyzing ? 0.5 : 1 }]}
                  onPress={onReanalyze}
                  disabled={reanalyzing}
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

          {/* Phase BW — per-swing list for multi-swing live cage sessions.
              Renders when the session has more than one shot AND any shot
              has per-shot Phase K analysis attached. Each row jumps the
              video to the swing's start when tapped. Single-shot uploads
              (legacy + post-BW upload flow) skip this section so the UI
              stays simple. */}
          {session.shots.length > 1 &&
           session.shots.some(s => s.perShotAnalysis || s.clipStartSeconds != null) && (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>
                {isPickingCompareTarget
                  ? `PICK A SWING TO COMPARE`
                  : `${session.shots.length} SWINGS · TAP TO JUMP`}
              </Text>
              {session.shots.map((s, idx) => {
                const start = s.clipStartSeconds ?? 0;
                const a = s.perShotAnalysis;
                const issueLabel = a?.detected_issue && a.detected_issue !== 'none'
                  ? a.detected_issue.replace(/_/g, ' ')
                  : a
                    ? 'no clear issue'
                    : '—';
                const conf = a?.confidence ?? null;
                const isLeftPick = s.id === leftCompareShotId;
                const goodRepIcon: keyof typeof Ionicons.glyphMap | null =
                  s.isGoodRep === true ? 'star' :
                  s.isGoodRep === false ? 'close-circle-outline' : null;
                const noteIcon: keyof typeof Ionicons.glyphMap | null =
                  s.userNotes && s.userNotes.length > 0 ? 'document-text' : null;
                return (
                  <View key={s.id} style={[styles.shotRow, { borderColor: colors.border, opacity: isPickingCompareTarget && isLeftPick ? 0.4 : 1 }]}>
                    <TouchableOpacity
                      onPress={() => void handleRowTap(s)}
                      style={styles.shotRowTap}
                      disabled={isPickingCompareTarget && isLeftPick}
                    >
                      <Text style={[styles.shotIdx, { color: colors.accent }]}>
                        {String(idx + 1).padStart(2, '0')}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <View style={styles.shotIssueRow}>
                          <Text style={[styles.shotIssue, { color: colors.text_primary }]} numberOfLines={1}>
                            {issueLabel}
                          </Text>
                          {goodRepIcon && (
                            <Ionicons name={goodRepIcon} size={14} color={s.isGoodRep ? '#f59e0b' : colors.text_muted} />
                          )}
                          {noteIcon && (
                            <Ionicons name={noteIcon} size={13} color={colors.accent} />
                          )}
                        </View>
                        <Text style={[styles.shotMeta, { color: colors.text_muted }]} numberOfLines={1}>
                          {`${formatMmSs(start)}`}
                          {conf ? ` · ${conf} conf` : ''}
                          {s.detectionMethod ? ` · ${s.detectionMethod === 'audio_transient' ? 'auto' : 'manual'}` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setActionShotId(s.id)}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      style={styles.shotActionBtn}
                    >
                      <Ionicons name="ellipsis-vertical" size={18} color={colors.text_muted} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* Phase BZ-v1 — single-shot Manage button. Multi-shot sessions
              expose Manage via the per-row "•••". Single-shot uploads need
              a dedicated affordance so users can still tag, note, share,
              and delete without a per-row list. */}
          {session.shots.length === 1 && shot && (
            <TouchableOpacity
              style={[styles.reanalyzeBtn, { borderColor: colors.border, marginTop: 8 }]}
              onPress={() => setActionShotId(shot.id)}
            >
              <Text style={[styles.reanalyzeText, { color: colors.text_muted }]}>Manage swing</Text>
            </TouchableOpacity>
          )}

          {analysisStatus === 'ok' && (
            <Animated.View style={{ opacity: cardsFade }}>
              <PrimaryIssueCard issue={session.primary_issue ?? null} totalShots={session.shots.length} />
              <DrillCard recommendation={session.drill_recommendation ?? null} />
              {/* Pose-derived biomechanics — only renders when the
                  pose API was configured AND returned at least one
                  usable frame. Pure additive surface; nothing
                  regresses when null. */}
              {session.biomechanics && (
                <View style={[styles.biomechCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.biomechLabel, { color: colors.accent }]}>BIOMECHANICS</Text>
                  <Text style={[styles.biomechSub, { color: colors.text_muted }]}>
                    Measured from {session.biomechanics.frames.length} swing keyframes
                  </Text>
                  {session.biomechanics.verdicts.hipTurn && (
                    <Text style={[styles.biomechRow, { color: colors.text_primary }]}>• {session.biomechanics.verdicts.hipTurn}</Text>
                  )}
                  {session.biomechanics.verdicts.shoulderTurn && (
                    <Text style={[styles.biomechRow, { color: colors.text_primary }]}>• {session.biomechanics.verdicts.shoulderTurn}</Text>
                  )}
                  {session.biomechanics.verdicts.weightShift && (
                    <Text style={[styles.biomechRow, { color: colors.text_primary }]}>• {session.biomechanics.verdicts.weightShift}</Text>
                  )}
                  {session.biomechanics.verdicts.posture && (
                    <Text style={[styles.biomechRow, { color: colors.text_primary }]}>• {session.biomechanics.verdicts.posture}</Text>
                  )}
                </View>
              )}
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

        {/* Phase BZ-v1 — selected-shot user note display. Surfaces the
            note prominently so the user sees their own annotation without
            opening the action sheet. */}
        {actionShot?.userNotes && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text_muted }]}>NOTE</Text>
            <Text style={[styles.detailLine, { color: colors.text_primary }]}>{actionShot.userNotes}</Text>
          </View>
        )}
      </ScrollView>

      <SwingActionSheet
        visible={actionShotId != null}
        shot={actionShot}
        sessionId={session.id}
        onClose={() => setActionShotId(null)}
        onStartCompare={handleStartCompare}
        multiShotSessionAvailable={session.shots.length > 1}
      />
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
  // Phase BW — per-swing list rows
  shotRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  shotIdx: {
    fontSize: 13, fontWeight: '900', minWidth: 24,
  },
  shotIssue: { fontSize: 14, fontWeight: '600', textTransform: 'capitalize', flexShrink: 1 },
  shotIssueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shotMeta: { fontSize: 11, marginTop: 2 },
  shotChev: { fontSize: 22, fontWeight: '300', width: 14, textAlign: 'right' },
  shotRowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 4 },
  shotActionBtn: { padding: 6 },
  // Phase BZ-v1 — comparison view styles
  compareBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  compareBannerText: { fontSize: 13, fontWeight: '600', flex: 1 },
  compareBannerCancel: { fontSize: 13, fontWeight: '800' },
  compareCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  compareHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  compareLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  compareExit: { fontSize: 13, fontWeight: '800' },
  compareRow: { flexDirection: 'row', gap: 6 },
  comparePane: { flex: 1, gap: 4 },
  compareCaption: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  compareVideo: { width: '100%', aspectRatio: 9 / 16, maxHeight: 360, backgroundColor: '#000' },
  compareControls: { flexDirection: 'row', gap: 8, marginTop: 10, justifyContent: 'center' },
  compareCtrl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  compareCtrlText: { fontSize: 13, fontWeight: '800', color: '#fff' },
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
  biomechCard: {
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    padding: 14, borderRadius: 12, borderWidth: 1,
    gap: 6,
  },
  biomechLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  biomechSub: { fontSize: 11, fontStyle: 'italic', marginBottom: 4 },
  biomechRow: { fontSize: 13, lineHeight: 19 },
});
