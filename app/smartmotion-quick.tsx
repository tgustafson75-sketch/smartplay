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

type Phase =
  | 'REQUESTING'
  | 'READY'
  | 'RECORDING'
  | 'SAVING'
  | 'ANALYZING'
  | 'RESULTS'
  | 'ERROR';

// Post-strike continuation: when acoustic detector hears impact, we
// keep filming this long to capture follow-through + finish. Tuned
// empirically — see prior commit notes for rationale.
const POST_STRIKE_MS = 5500;
// Hard cap so a forgotten / missed stop can't drain disk forever.
const MAX_RECORDING_MS = 15_000;

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

  // START — user taps "Record swing" from READY phase.
  const onStart = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam || phase !== 'READY') return;
    cancelledRef.current = false;
    impactHeardRef.current = false;
    try {
      setPhase('RECORDING');
      recStartRef.current = Date.now();
      recordingPromiseRef.current = cam.recordAsync() as Promise<{ uri: string } | undefined>;

      // Safety cap so a forgotten stop can't run forever.
      scheduleStop(MAX_RECORDING_MS);

      // Acoustic auto-stop as a fallback for hands-free flow. User
      // tapping STOP still wins because cam.stopRecording resolves the
      // recording promise immediately regardless of timer state.
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
      if (cancelledRef.current) return;

      // Tear down the acoustic listener regardless of how recording ended.
      try { await stopAndDetectImpact(); } catch { /* noop */ }

      if (!result?.uri) {
        setErrorMsg('Recording produced no clip.');
        setPhase('ERROR');
        return;
      }

      // Ingest clip into cageStore + kick analysis pipeline.
      setPhase('SAVING');
      const now = Date.now();
      const sessionId = useCageStore.getState().ingestUploadedSwing({
        clipUri: result.uri,
        club: 'unknown',
        upload: {
          uploaded_at: now,
          taken_at: now,
          notes: null,
          swinger: 'Me',
          tag: 'course',
          has_audio: true,
          duration_sec: Math.max(1, Math.round((now - recStartRef.current) / 1000)),
        },
        source: 'uploaded_video',
      });
      lastSessionIdRef.current = sessionId;

      // Awaited — we want the result on THIS screen, not a separate
      // detail page. Phase K takes 10-30s typically. Spinner runs in
      // ANALYZING phase.
      setPhase('ANALYZING');
      try {
        const k = await runPhaseKOnSession(sessionId);
        if (cancelledRef.current) return;
        setPrimaryIssue(k.primary_issue);
        setDrill(k.drill_recommendation);
        setPhase('RESULTS');
      } catch (e) {
        console.log('[smartmotion-quick] phase K failed:', e);
        // Even if analysis fails, the clip is saved. Land on RESULTS
        // with null analysis so the "View in library" path still works.
        setPrimaryIssue(null);
        setDrill(null);
        setPhase('RESULTS');
      }
    } catch (e) {
      console.log('[smartmotion-quick] record failed:', e);
      setErrorMsg(e instanceof Error ? e.message : 'Recording failed.');
      setPhase('ERROR');
      void abortImpactRecording().catch(() => undefined);
    }
  }, [phase, scheduleStop]);

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
    setPhase('READY');
  }, []);

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
              <Text style={styles.caption}>Frame the swing. Tap when ready.</Text>
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
