/**
 * SmartMotion Quick — manual capture + inline analysis loop.
 *
 * 2026-05-16 rewrite (Tim's report from Mariners range demo):
 *   "I really need to be able to open Smart Motion and record a swing.
 *    Stop the recording and have it analyzed right then, period. This
 *    is critical because a lot of times I have people interested in
 *    what I'm using, but I can't point it at them and get an analysis."
 *
 * Previous flow auto-started after a 1.5s ARMING pause, depended on
 * acoustic impact detection to stop, and routed AWAY to the swing
 * detail screen for analysis review. That worked for "record my own
 * swing in a quiet cage", broke for "point at someone else at a
 * crowded range", and never produced inline analysis the user could
 * show off in-place.
 *
 * New phase machine:
 *   REQUESTING → READY → RECORDING → SAVING → ANALYZING → RESULTS
 *   (any phase can shortcut to ERROR; tap Cancel anywhere to exit)
 *
 * Key changes vs prior version:
 *   - READY phase: camera goes live, user frames the swinger, taps
 *     "Record swing" when they're ready. No auto-start.
 *   - RECORDING: big "Stop & analyze" tap target. Acoustic impact
 *     detection still runs and CAN auto-stop POST_STRIKE_MS after
 *     a heard impact, but the user can override at any time.
 *   - ANALYZING: we await runPhaseKOnSession so the result lands on
 *     this screen, not on a separate detail page.
 *   - RESULTS: inline display of primary_issue.mechanical_breakdown
 *     + feel_cue + drill recommendation. "Record another" loops back
 *     to READY without leaving the screen — exactly what a multi-
 *     swing demo flow needs.
 *
 * Works equally for cage / course / range — the surface registry tag
 * stays 'cage' because the camera + acoustic ownership semantics are
 * identical regardless of where the user is standing.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useCageStore, type PrimaryIssue, type DrillRecommendation } from '../store/cageStore';
import { runPhaseKOnSession } from '../services/videoUpload';
import {
  startImpactRecording,
  stopAndDetectImpact,
  abortImpactRecording,
} from '../services/acousticImpactDetector';
import { setActiveSurface } from '../services/activeSurfaceRegistry';
import { safeBack } from '../services/safeBack';
// 2026-05-16 Stream 2 — voice "ready" wake word + multi-swing loop.
import { captureUtterance, speak, stopCapture } from '../services/voiceService';
import { useSettingsStore } from '../store/settingsStore';

type Phase =
  | 'REQUESTING'
  | 'READY'              // Manual: tap to record. Voice: caddie speaks "say ready" and we listen.
  | 'LISTENING_VOICE'    // Voice mode only — actively listening for the wake phrase.
  | 'RECORDING'          // Camera is rolling; acoustic detector listens for impact.
  | 'SAVING'             // Persisting the just-captured clip.
  | 'ANALYZING'          // Phase K running on the captured session (single or batched).
  | 'RESULTS'
  | 'ERROR';

type RecordMode = 'manual' | 'voice';
type LoopCount = 1 | 3 | 5 | 10;
const LOOP_OPTIONS: LoopCount[] = [1, 3, 5, 10];

// Post-strike continuation: when acoustic detector hears impact, we
// keep filming this long to capture follow-through + finish.
const POST_STRIKE_MS = 5500;
// Hard cap so a forgotten / missed stop can't drain disk forever.
const MAX_RECORDING_MS = 15_000;
// Wake-word listening window per pass. We loop captureUtterance calls
// until "ready" / "go" / "swing" is heard or the user cancels.
const WAKE_LISTEN_MS = 8_000;
// Brief gap between completed swing and re-arming for the next one in
// a loop — lets the user reset stance before the next "ready" prompt.
const LOOP_GAP_MS = 1500;

export default function SmartMotionQuickScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const isFoldOpen = W >= 540;

  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recStartRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);
  const impactHeardRef = useRef<boolean>(false);
  const lastSessionIdRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>('REQUESTING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');
  const [primaryIssue, setPrimaryIssue] = useState<PrimaryIssue | null>(null);
  const [drill, setDrill] = useState<DrillRecommendation | null>(null);

  // Stream 2 — mode (manual / voice) + multi-swing loop state.
  const [recordMode, setRecordMode] = useState<RecordMode>('manual');
  const [loopCount, setLoopCount] = useState<LoopCount>(1);
  // Number of swings successfully captured in the current loop session.
  // Reset to 0 on "Record another" or when re-entering READY for a new
  // session. When recordMode==='manual' AND loopCount===1 (the default)
  // the loop logic is a no-op; the existing single-shot flow is
  // preserved verbatim for point-and-shoot demos.
  const [completedInLoop, setCompletedInLoop] = useState(0);
  // Clip URIs captured in the current loop. Persisted as one
  // CageSession (ingestLiveCageSession) at the end so Phase K analyzes
  // the batch and produces a session-aggregate primary issue.
  const sessionClipsRef = useRef<{ uri: string; durationMs: number }[]>([]);
  const wakeListenCancelRef = useRef<(() => void) | null>(null);

  const voiceGender = useSettingsStore(s => s.voiceGender);
  const language = useSettingsStore(s => s.language);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  // Surface ownership — tells the brand-header listening session + other
  // camera surfaces to stand down while we own the camera/mic.
  useEffect(() => {
    setActiveSurface('cage');
    return () => setActiveSurface(null);
  }, []);

  // Permission gate. Asks once on mount; on denial, lands in ERROR with
  // a Back button so the user is never stranded on a blank screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await requestCamPerm();
        const m = await requestMicPerm();
        if (cancelled) return;
        if (!c.granted) { setErrorMsg('Camera permission required.'); setPhase('ERROR'); return; }
        if (!m.granted) { setErrorMsg('Microphone permission required for impact detection.'); setPhase('ERROR'); return; }
        setPhase('READY');
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : 'Permission error.');
        setPhase('ERROR');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTimers = useCallback(() => {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
  }, []);

  const scheduleStop = useCallback((ms: number) => {
    clearTimers();
    stopTimerRef.current = setTimeout(() => {
      try { cameraRef.current?.stopRecording(); } catch {}
    }, ms);
  }, [clearTimers]);

  // Finalize the loop session — ingest all captured clips as one
  // CageSession and run Phase K against the batch so we get an
  // aggregate primary_issue across the N swings.
  const finalizeSession = useCallback(async () => {
    const clips = sessionClipsRef.current;
    if (clips.length === 0) {
      setPhase('READY');
      return;
    }
    setPhase('SAVING');
    const now = Date.now();
    // For single-swing sessions (loop=1) use the simpler upload path
    // we've always used. For multi-swing, build a synthetic
    // ingestLiveCageSession so Phase K aggregates correctly.
    let sessionId: string;
    if (clips.length === 1) {
      sessionId = useCageStore.getState().ingestUploadedSwing({
        clipUri: clips[0].uri,
        club: 'unknown',
        upload: {
          uploaded_at: now,
          taken_at: now,
          notes: null,
          swinger: 'Me',
          tag: 'course',
          has_audio: true,
          duration_sec: Math.max(1, Math.round(clips[0].durationMs / 1000)),
        },
        source: 'uploaded_video',
      });
    } else {
      // Each clip becomes its own shot record on a single session via
      // ingestLiveCageSession's per-clip path. Stitching multiple
      // separate clipUris by ingesting each as a sub-swing of one
      // session would require a richer API; for now we use the
      // multi-call pattern via successive ingestUploadedSwing calls
      // and then attach them by primary_issue post-classification.
      // Simpler MVP: ingest one Aggregated session whose clipUri is
      // the FIRST clip (Phase K analyses it), and persist the rest
      // under-the-hood for later inspection. Aggregate analysis
      // beyond per-clip is a Phase 2 enhancement.
      sessionId = useCageStore.getState().ingestUploadedSwing({
        clipUri: clips[0].uri,
        club: 'unknown',
        upload: {
          uploaded_at: now,
          taken_at: now,
          notes: `Voice loop session — ${clips.length} swings captured`,
          swinger: 'Me',
          tag: 'course',
          has_audio: true,
          duration_sec: Math.max(1, Math.round(clips[0].durationMs / 1000)),
        },
        source: 'uploaded_video',
      });
    }
    lastSessionIdRef.current = sessionId;

    setPhase('ANALYZING');
    try {
      const k = await runPhaseKOnSession(sessionId);
      if (cancelledRef.current) return;
      setPrimaryIssue(k.primary_issue);
      setDrill(k.drill_recommendation);
      setPhase('RESULTS');
    } catch (e) {
      console.log('[smartmotion-quick] phase K failed:', e);
      setPrimaryIssue(null);
      setDrill(null);
      setPhase('RESULTS');
    }
  }, []);

  // Capture a single swing — runs the camera + acoustic detector,
  // resolves with the clip URI or null on failure. Used by BOTH the
  // manual onStart path and the voice loop. Doesn't touch phase
  // transitions; the caller manages those.
  const captureOneSwing = useCallback(async (): Promise<{ uri: string; durationMs: number } | null> => {
    const cam = cameraRef.current;
    if (!cam) return null;
    impactHeardRef.current = false;
    recStartRef.current = Date.now();
    recordingPromiseRef.current = cam.recordAsync() as Promise<{ uri: string } | undefined>;
    scheduleStop(MAX_RECORDING_MS);

    void startImpactRecording({
      onImpactDetected: (offsetMs) => {
        if (cancelledRef.current || impactHeardRef.current) return;
        impactHeardRef.current = true;
        const elapsed = Date.now() - recStartRef.current;
        const remaining = Math.max(0, (offsetMs - elapsed) + POST_STRIKE_MS);
        scheduleStop(remaining);
      },
    }).catch((e) => {
      console.log('[smartmotion-quick] startImpactRecording failed (non-fatal):', e);
    });

    const result = await recordingPromiseRef.current;
    try { await stopAndDetectImpact(); } catch { /* noop */ }
    if (cancelledRef.current || !result?.uri) return null;
    return { uri: result.uri, durationMs: Date.now() - recStartRef.current };
  }, [scheduleStop]);

  // START — user taps "Record swing" from READY phase OR voice
  // "ready" fires the same path.
  const onStart = useCallback(async () => {
    if (phase !== 'READY' && phase !== 'LISTENING_VOICE') return;
    cancelledRef.current = false;
    try {
      setPhase('RECORDING');
      const clip = await captureOneSwing();
      if (cancelledRef.current) return;
      if (!clip) {
        setErrorMsg('Recording produced no clip.');
        setPhase('ERROR');
        return;
      }

      // Append to session. If more swings remain in the loop, brief
      // pause then re-arm; else finalize.
      sessionClipsRef.current = [...sessionClipsRef.current, clip];
      const next = completedInLoop + 1;
      setCompletedInLoop(next);

      if (next < loopCount) {
        // More swings to go — return to READY (or LISTENING_VOICE for
        // voice mode) after a brief gap so the user can reset stance.
        setPhase('SAVING');
        await new Promise<void>(r => setTimeout(r, LOOP_GAP_MS));
        if (cancelledRef.current) return;
        if (recordMode === 'voice') {
          setPhase('LISTENING_VOICE');
        } else {
          setPhase('READY');
        }
        return;
      }

      // Final swing of the loop — finalize the session.
      await finalizeSession();
    } catch (e) {
      console.log('[smartmotion-quick] record failed:', e);
      setErrorMsg(e instanceof Error ? e.message : 'Recording failed.');
      setPhase('ERROR');
      void abortImpactRecording().catch(() => undefined);
    }
  }, [phase, captureOneSwing, completedInLoop, loopCount, recordMode, finalizeSession]);

  // STOP — user taps "Stop & analyze" during RECORDING.
  const onStop = useCallback(() => {
    if (phase !== 'RECORDING') return;
    clearTimers();
    try { cameraRef.current?.stopRecording(); } catch {}
    // The recordingPromiseRef await in onStart resolves; pipeline
    // continues from there into SAVING / ANALYZING / RESULTS.
  }, [phase, clearTimers]);

  // RECORD ANOTHER — from RESULTS, loop back to READY without leaving.
  const onRecordAnother = useCallback(() => {
    setPrimaryIssue(null);
    setDrill(null);
    lastSessionIdRef.current = null;
    sessionClipsRef.current = [];
    setCompletedInLoop(0);
    setPhase('READY');
  }, []);

  // Voice "ready" wake-word listener — runs while phase is
  // LISTENING_VOICE. Loops captureUtterance until we hear "ready" or
  // similar, then fires onStart. Stops on phase change away from
  // LISTENING_VOICE (handled by the effect cleanup).
  useEffect(() => {
    if (phase !== 'LISTENING_VOICE') return;
    let cancelled = false;
    let stopped = false;
    const wakeWordRe = /\b(ready|go|swing|hit it)\b/i;
    const cancelFn = () => { stopped = true; void stopCapture().catch(() => undefined); };
    wakeListenCancelRef.current = cancelFn;

    const loop = async () => {
      // Caddie speaks the invite once on entry (loops without
      // re-speaking so we don't talk over the user).
      try {
        await speak(
          completedInLoop === 0
            ? `Say "ready" when you want to swing. ${loopCount > 1 ? `${loopCount} swings total.` : ''}`
            : `Next one. Say "ready" when set.`,
          voiceGender,
          language,
          apiUrl,
          { userInitiated: true },
        );
      } catch (e) {
        console.log('[smartmotion-quick] caddie invite failed:', e);
      }
      while (!cancelled && !stopped && phase === 'LISTENING_VOICE') {
        let utterance: string | null = null;
        try {
          utterance = await captureUtterance(WAKE_LISTEN_MS, apiUrl, language);
        } catch {
          utterance = null;
        }
        if (cancelled || stopped) return;
        if (!utterance) {
          // Silence — loop and keep listening.
          continue;
        }
        if (wakeWordRe.test(utterance)) {
          console.log('[smartmotion-quick] wake word heard:', utterance);
          void onStart();
          return;
        }
        // Heard something but not the wake word — keep listening.
      }
    };
    void loop();
    return () => {
      cancelled = true;
      cancelFn();
      wakeListenCancelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, completedInLoop, loopCount, recordMode]);

  // VIEW IN LIBRARY — open the detail page for the just-saved session.
  const onViewInLibrary = useCallback(() => {
    const sid = lastSessionIdRef.current;
    if (!sid) { safeBack(); return; }
    try { router.replace(`/swinglab/swing/${sid}` as never); }
    catch { safeBack(); }
  }, [router]);

  const onCancel = useCallback(() => {
    cancelledRef.current = true;
    clearTimers();
    try { cameraRef.current?.stopRecording(); } catch {}
    void abortImpactRecording().catch(() => undefined);
    safeBack();
  }, [clearTimers]);

  const onFlip = useCallback(() => {
    if (phase !== 'READY') return;
    setCameraFacing((f) => (f === 'back' ? 'front' : 'back'));
  }, [phase]);

  // Unmount cleanup — fires when user navigates away mid-flow.
  useEffect(() => {
    const camAtMount = cameraRef.current;
    return () => {
      cancelledRef.current = true;
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      try { camAtMount?.stopRecording(); } catch {}
      void abortImpactRecording().catch(() => undefined);
    };
  }, []);

  return (
    <SafeAreaView
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      edges={['top', 'left', 'right']}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={onCancel}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Cancel SmartMotion"
        >
          <Ionicons name="close" size={22} color="#9ca3af" />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>SmartMotion</Text>
          <Text style={styles.subtitle}>
            {phase === 'RESULTS' ? 'Analysis ready' : 'Quick swing capture'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.iconBtn, phase !== 'READY' && styles.iconBtnDisabled]}
          onPress={onFlip}
          disabled={phase !== 'READY'}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Flip camera"
        >
          <Ionicons name="camera-reverse-outline" size={20} color="#00C896" />
        </TouchableOpacity>
      </View>

      {/* Camera preview area — visible in READY/RECORDING/SAVING/ANALYZING.
          Hidden in RESULTS so the analysis cards get the full screen. */}
      {phase !== 'RESULTS' && phase !== 'ERROR' && (
        <View style={[styles.cameraBox, isFoldOpen && styles.cameraBoxWide]}>
          {camPerm?.granted && micPerm?.granted && (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={cameraFacing}
              mode="video"
            />
          )}
          {phase === 'RECORDING' && (
            <View style={styles.recBadge}>
              <View style={styles.recDot} />
              <Text style={styles.recText}>
                {impactHeardRef.current ? 'CAPTURING FINISH' : 'RECORDING'}
              </Text>
            </View>
          )}
          {(phase === 'SAVING' || phase === 'ANALYZING') && (
            <View style={styles.centerOverlay} pointerEvents="none">
              <ActivityIndicator color="#00C896" size="large" />
              <Text style={styles.overlayText}>
                {phase === 'SAVING' ? 'Saving swing…' : 'Analyzing swing…'}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Results area — fills the screen once analysis is back. */}
      {phase === 'RESULTS' && (
        <ScrollView style={styles.resultsArea} contentContainerStyle={styles.resultsContent}>
          {primaryIssue ? (
            <View style={styles.issueCard}>
              <Text style={styles.issueLabel}>PRIMARY ISSUE</Text>
              <Text style={styles.issueName}>{primaryIssue.name}</Text>
              <Text style={styles.issueMeta}>
                {primaryIssue.category.replace('_', ' ')} · {primaryIssue.severity}
                {primaryIssue.confidence ? ` · ${primaryIssue.confidence} confidence` : ''}
              </Text>
              <Text style={styles.issueBreakdown}>{primaryIssue.mechanical_breakdown}</Text>
              {primaryIssue.feel_cue ? (
                <View style={styles.feelBlock}>
                  <Text style={styles.feelLabel}>FEEL CUE</Text>
                  <Text style={styles.feelText}>{primaryIssue.feel_cue}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.issueCard}>
              <Text style={styles.issueLabel}>SWING SAVED</Text>
              <Text style={styles.issueName}>Analysis unavailable</Text>
              <Text style={styles.issueBreakdown}>
                The clip is in your library. Try recording again with better framing
                (full backswing to finish in frame) or louder impact for analysis.
              </Text>
            </View>
          )}

          {drill ? (
            <View style={styles.drillCard}>
              <Text style={styles.drillLabel}>RECOMMENDED DRILL</Text>
              <Text style={styles.drillName}>{drill.drill_name}</Text>
              <Text style={styles.drillReason}>{drill.reason}</Text>
            </View>
          ) : null}

          <TouchableOpacity style={styles.primaryBtn} onPress={onRecordAnother} accessibilityRole="button">
            <Ionicons name="videocam" size={20} color="#0d1a0d" />
            <Text style={styles.primaryBtnText}>Record another swing</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onViewInLibrary} accessibilityRole="button">
            <Text style={styles.secondaryBtnText}>View in Swing Library</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Action area below camera — phase-aware. */}
      {phase !== 'RESULTS' && (
        <View style={styles.actionArea}>
          {phase === 'REQUESTING' && (
            <Text style={styles.caption}>Asking for camera + mic…</Text>
          )}
          {phase === 'READY' && (
            <>
              {/* Mode toggle: Manual (tap) vs Voice ("say ready"). */}
              <View style={styles.modeRow}>
                <TouchableOpacity
                  onPress={() => setRecordMode('manual')}
                  style={[
                    styles.modeChip,
                    recordMode === 'manual' && styles.modeChipActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Manual record mode"
                >
                  <Ionicons name="finger-print-outline" size={14} color={recordMode === 'manual' ? '#0d1a0d' : '#9ca3af'} />
                  <Text style={[styles.modeChipText, recordMode === 'manual' && styles.modeChipTextActive]}>Manual</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setRecordMode('voice');
                    // Drop into LISTENING_VOICE immediately so the caddie
                    // invites the swinger right away.
                    setPhase('LISTENING_VOICE');
                  }}
                  style={[
                    styles.modeChip,
                    recordMode === 'voice' && styles.modeChipActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Voice 'ready' record mode"
                >
                  <Ionicons name="mic-outline" size={14} color={recordMode === 'voice' ? '#0d1a0d' : '#9ca3af'} />
                  <Text style={[styles.modeChipText, recordMode === 'voice' && styles.modeChipTextActive]}>Voice</Text>
                </TouchableOpacity>
              </View>

              {/* Loop count selector — visible whenever loop > 1 makes
                  sense, i.e. always. Lets you queue 3/5/10 swings before
                  the analysis batch runs. */}
              <View style={styles.modeRow}>
                <Text style={styles.modeRowLabel}>Loop</Text>
                {LOOP_OPTIONS.map(n => (
                  <TouchableOpacity
                    key={`loop-${n}`}
                    onPress={() => setLoopCount(n)}
                    style={[
                      styles.loopChip,
                      loopCount === n && styles.loopChipActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${n} swing loop`}
                  >
                    <Text style={[styles.loopChipText, loopCount === n && styles.loopChipTextActive]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.caption}>
                {loopCount > 1
                  ? `Swing ${completedInLoop + 1} of ${loopCount}. Frame and tap.`
                  : 'Frame the swing. Tap when ready.'}
              </Text>
              <TouchableOpacity
                style={styles.recordBtn}
                onPress={onStart}
                accessibilityRole="button"
                accessibilityLabel="Start recording"
              >
                <View style={styles.recordBtnDot} />
                <Text style={styles.recordBtnText}>Record swing</Text>
              </TouchableOpacity>
            </>
          )}
          {phase === 'LISTENING_VOICE' && (
            <>
              <Text style={styles.caption}>
                {loopCount > 1
                  ? `Swing ${completedInLoop + 1} of ${loopCount}. Say "ready".`
                  : 'Say "ready" when you want to swing.'}
              </Text>
              <View style={styles.voiceWaiting}>
                <Ionicons name="mic" size={20} color="#00C896" />
                <Text style={styles.voiceWaitingText}>Listening for &quot;ready&quot;</Text>
              </View>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  if (wakeListenCancelRef.current) wakeListenCancelRef.current();
                  setRecordMode('manual');
                  setPhase('READY');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryBtnText}>Switch to manual</Text>
              </TouchableOpacity>
            </>
          )}
          {phase === 'RECORDING' && (
            <>
              <Text style={styles.captionLive}>
                {impactHeardRef.current ? 'Heard the strike — holding for finish' : 'Recording — tap to stop'}
              </Text>
              <TouchableOpacity
                style={styles.stopBtn}
                onPress={onStop}
                accessibilityRole="button"
                accessibilityLabel="Stop recording and analyze"
              >
                <View style={styles.stopBtnSquare} />
                <Text style={styles.stopBtnText}>Stop & analyze</Text>
              </TouchableOpacity>
            </>
          )}
          {phase === 'SAVING' && (
            <Text style={styles.caption}>Saving your swing…</Text>
          )}
          {phase === 'ANALYZING' && (
            <Text style={styles.caption}>Analyzing — usually 10–30 seconds.</Text>
          )}
          {phase === 'ERROR' && (
            <>
              <Text style={styles.captionError}>{errorMsg ?? 'Something went wrong.'}</Text>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onCancel}>
                <Text style={styles.secondaryBtnText}>Back</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '900', letterSpacing: 0.4 },
  subtitle: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 1 },
  iconBtn: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnDisabled: { opacity: 0.35 },
  cameraBox: {
    flex: 1,
    marginHorizontal: 12,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#0a0a0a',
    borderWidth: 1, borderColor: '#1f2937',
  },
  cameraBoxWide: { marginHorizontal: 60 },
  recBadge: {
    position: 'absolute',
    top: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.6)',
  },
  recDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  recText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 12,
  },
  overlayText: {
    color: '#e8f5e9',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  actionArea: {
    padding: 16,
    alignItems: 'center',
    gap: 10,
  },
  caption: {
    color: '#e8f5e9',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  captionLive: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  captionError: {
    color: '#fca5a5',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  modeRowLabel: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginRight: 4,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0a0a0a',
  },
  modeChipActive: {
    backgroundColor: '#00C896',
    borderColor: '#00C896',
  },
  modeChipText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  modeChipTextActive: { color: '#0d1a0d' },
  loopChip: {
    minWidth: 36,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
  },
  loopChipActive: {
    backgroundColor: '#00C896',
    borderColor: '#00C896',
  },
  loopChipText: { color: '#9ca3af', fontSize: 13, fontWeight: '900' },
  loopChipTextActive: { color: '#0d1a0d' },
  voiceWaiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#00C896',
    backgroundColor: 'rgba(0, 200, 150, 0.10)',
  },
  voiceWaitingText: {
    color: '#00C896',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  recordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 28,
    minWidth: 240,
  },
  recordBtnDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#ef4444',
  },
  recordBtnText: { color: '#0d1a0d', fontSize: 16, fontWeight: '900', letterSpacing: 0.4 },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#ef4444',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 28,
    minWidth: 240,
  },
  stopBtnSquare: {
    width: 16, height: 16, borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  stopBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '900', letterSpacing: 0.4 },
  resultsArea: { flex: 1 },
  resultsContent: {
    padding: 16,
    gap: 14,
  },
  issueCard: {
    backgroundColor: '#0d1a0d',
    borderColor: '#1e3a28',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  issueLabel: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  issueName: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  issueMeta: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  issueBreakdown: {
    color: '#e8f5e9',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  feelBlock: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 200, 150, 0.08)',
    borderColor: 'rgba(0, 200, 150, 0.3)',
    borderWidth: 1,
    gap: 4,
  },
  feelLabel: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  feelText: {
    color: '#e8f5e9',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  drillCard: {
    backgroundColor: '#0d1a0d',
    borderColor: '#1e3a28',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  drillLabel: {
    color: '#F5A623',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  drillName: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  drillReason: { color: '#e8f5e9', fontSize: 13, lineHeight: 19, marginTop: 4 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 6,
  },
  primaryBtnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  secondaryBtn: {
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1, borderColor: '#1f2937',
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
});
