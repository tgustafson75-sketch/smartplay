/**
 * Phase 403 — SmartMotion Quick (course-mode swing capture).
 *
 * Simplified counterpart to /swinglab/cage-drill.
 *
 * COURSE MODE (this screen) — for the player who just wants their swing
 * recorded NOW: no bullseye check, no distance calibration, no setup
 * screen, no club selector gate. Camera goes live immediately; the
 * acoustic detector listens for impact; on strike, the video stops
 * POST_STRIKE_MS later (5.5s — long enough to capture follow-through and
 * finish position).
 *
 * CAGE MODE (existing /swinglab/cage-drill) — keeps the full setup flow:
 * bullseye check, distance calibration, club selection, READY/NOT_READY
 * gate. Used for indoor cage practice where setup quality is part of the
 * value.
 *
 * State machine:
 *   REQUESTING → ARMING (1.5s "take stance") → RECORDING (max 10s, but
 *   stops POST_STRIKE_MS after first detected impact) → SAVING → DONE
 *
 * Triggers:
 *   - Tools menu entry "SmartMotion (quick)" — routes here.
 *   - Voice intent "open SmartMotion" — same.
 *
 * Output: the recorded clip is bridged into the swing library via
 * cageStore.ingestUploadedSwing(); Phase K analysis fires fire-and-
 * forget; the user lands back where they came from with a brief saved
 * confirmation. The clip is reviewable via Swing Library.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useCageStore } from '../store/cageStore';
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
  | 'ARMING'
  | 'RECORDING'
  | 'SAVING'
  | 'DONE'
  | 'ERROR';

// Phase 403 — 5.5s after the strike. cage-drill records 12s flat (no
// acoustic stop); CaptureOverlay records 1.5s post-strike for on-course
// shot capture. SmartMotion is between: long enough to see the finish
// hold, short enough to keep clips light.
const POST_STRIKE_MS = 5500;
// If no strike is detected (user steps off, mic blocked, etc.) — cap
// total recording at 10s so the screen self-recovers.
const MAX_RECORDING_MS = 10_000;
// Brief "take your stance" pause before recording rolls. Gives the user
// time to settle so the backswing isn't clipped at frame zero.
const ARMING_MS = 1500;

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
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recStartRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);
  const impactHeardRef = useRef<boolean>(false);

  const [phase, setPhase] = useState<Phase>('REQUESTING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');

  // Tell the active-surface registry we own the camera/mic right now so
  // other surfaces (e.g. brand-header listening session) defer.
  useEffect(() => {
    // 'cage' surface — same camera + acoustic ownership semantics as the
    // existing cage flow; keeps the registry's enum compact.
    setActiveSurface('cage');
    return () => setActiveSurface(null);
  }, []);

  // Permission gate. Asks once on mount; if denied, shows an honest error
  // and the user backs out.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await requestCamPerm();
        const m = await requestMicPerm();
        if (cancelled) return;
        if (!c.granted) {
          setErrorMsg('Camera permission required.');
          setPhase('ERROR');
          return;
        }
        if (!m.granted) {
          setErrorMsg('Microphone permission required for impact detection.');
          setPhase('ERROR');
          return;
        }
        setPhase('ARMING');
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : 'Permission error.');
        setPhase('ERROR');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleStop = useCallback((ms: number) => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      const cam = cameraRef.current;
      try { cam?.stopRecording(); } catch {}
    }, ms);
  }, []);

  // Drive the ARMING → RECORDING transition. Fires once when phase
  // becomes ARMING. Starts the camera record, the acoustic detector,
  // and the safety-cap stop timer.
  useEffect(() => {
    if (phase !== 'ARMING') return;
    cancelledRef.current = false;
    impactHeardRef.current = false;

    armTimerRef.current = setTimeout(async () => {
      const cam = cameraRef.current;
      if (!cam) {
        setErrorMsg('Camera not ready.');
        setPhase('ERROR');
        return;
      }
      try {
        setPhase('RECORDING');
        recStartRef.current = Date.now();
        recordingPromiseRef.current = cam.recordAsync() as Promise<{ uri: string } | undefined>;

        // Safety cap so a missed strike doesn't run forever.
        scheduleStop(MAX_RECORDING_MS);

        // Acoustic listener: on first impact above threshold, reschedule
        // the stop to fire POST_STRIKE_MS after the strike timestamp.
        void startImpactRecording({
          onImpactDetected: (offsetMs) => {
            if (cancelledRef.current || impactHeardRef.current) return;
            impactHeardRef.current = true;
            const elapsed = Date.now() - recStartRef.current;
            const remaining = Math.max(0, (offsetMs - elapsed) + POST_STRIKE_MS);
            scheduleStop(remaining);
          },
        }).catch((e) => {
          // Acoustic detector failure is non-fatal — the safety cap still
          // runs. We just lose the strike-relative stop.
          console.log('[smartmotion-quick] startImpactRecording failed:', e);
        });

        const result = await recordingPromiseRef.current;
        if (cancelledRef.current) return;

        // Tear down the acoustic detector regardless of whether a strike
        // was heard. We don't ship this clip to the ball-speed server.
        try {
          const reading = await stopAndDetectImpact();
          // reading is informational only here; we already used the
          // real-time callback to schedule the stop.
          void reading;
        } catch { /* noop */ }

        if (!result?.uri) {
          setErrorMsg('Recording produced no clip.');
          setPhase('ERROR');
          return;
        }

        // Save phase — bridge into the swing library and fire Phase K
        // analysis. We don't await Phase K; the user can review later.
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
        void runPhaseKOnSession(sessionId).catch((e) => {
          console.log('[smartmotion-quick] phase K failed (background):', e);
        });
        setPhase('DONE');
        // Briefly hold on DONE, then route to the swing-detail review so
        // the user lands on something meaningful instead of an empty
        // confirmation screen.
        setTimeout(() => {
          try {
            router.replace(`/swinglab/swing/${sessionId}` as never);
          } catch {
            safeBack();
          }
        }, 800);
      } catch (e) {
        console.log('[smartmotion-quick] record failed:', e);
        setErrorMsg(e instanceof Error ? e.message : 'Recording failed.');
        setPhase('ERROR');
        void abortImpactRecording().catch(() => undefined);
      }
    }, ARMING_MS);

    return () => {
      if (armTimerRef.current) {
        clearTimeout(armTimerRef.current);
        armTimerRef.current = null;
      }
    };
  }, [phase, router, scheduleStop]);

  // Cleanup on unmount or cancel. Capture ref at effect time per
  // react-hooks/exhaustive-deps guidance so the cleanup doesn't read a
  // possibly-mutated ref at teardown.
  useEffect(() => {
    const camAtMount = cameraRef.current;
    return () => {
      cancelledRef.current = true;
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      try { camAtMount?.stopRecording(); } catch {}
      void abortImpactRecording().catch(() => undefined);
    };
  }, []);

  const onCancel = useCallback(() => {
    cancelledRef.current = true;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    try { cameraRef.current?.stopRecording(); } catch {}
    void abortImpactRecording().catch(() => undefined);
    safeBack();
  }, []);

  const onFlip = useCallback(() => {
    if (phase !== 'ARMING') return; // can't flip mid-record
    setCameraFacing((f) => (f === 'back' ? 'front' : 'back'));
  }, [phase]);

  const captionByPhase: Partial<Record<Phase, string>> = {
    REQUESTING: 'Asking for camera + mic…',
    ARMING:     'Take your stance. Listening for impact.',
    RECORDING:  impactHeardRef.current
      ? 'Heard it. Holding the finish…'
      : 'Listening. Swing when ready.',
    SAVING:     'Saving your swing…',
    DONE:       'Saved. Opening review…',
    ERROR:      errorMsg ?? 'Something went wrong.',
  };

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
          accessibilityLabel="Cancel SmartMotion capture"
        >
          <Ionicons name="close" size={22} color="#9ca3af" />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>SmartMotion</Text>
          <Text style={styles.subtitle}>Quick swing capture</Text>
        </View>
        <TouchableOpacity
          style={[styles.iconBtn, phase !== 'ARMING' && styles.iconBtnDisabled]}
          onPress={onFlip}
          disabled={phase !== 'ARMING'}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Flip camera"
        >
          <Ionicons name="camera-reverse-outline" size={20} color="#00C896" />
        </TouchableOpacity>
      </View>

      <View style={[styles.cameraBox, isFoldOpen && styles.cameraBoxWide]}>
        {(phase !== 'ERROR' && camPerm?.granted && micPerm?.granted) && (
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
              {impactHeardRef.current ? 'CAPTURING FINISH' : 'LISTENING'}
            </Text>
          </View>
        )}
        {(phase === 'REQUESTING' || phase === 'SAVING') && (
          <View style={styles.centerOverlay} pointerEvents="none">
            <ActivityIndicator color="#00C896" size="large" />
          </View>
        )}
      </View>

      <View style={styles.captionWrap}>
        <Text style={styles.caption}>{captionByPhase[phase]}</Text>
        {phase === 'ARMING' && (
          <Text style={styles.captionSub}>
            No setup needed — recording starts now. Just swing.
          </Text>
        )}
        {phase === 'ERROR' && (
          <TouchableOpacity style={styles.retryBtn} onPress={onCancel}>
            <Text style={styles.retryText}>Back</Text>
          </TouchableOpacity>
        )}
      </View>
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
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  captionWrap: {
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  caption: {
    color: '#e8f5e9',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  captionSub: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1, borderColor: '#1f2937',
    backgroundColor: '#0a0a0a',
  },
  retryText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
});
