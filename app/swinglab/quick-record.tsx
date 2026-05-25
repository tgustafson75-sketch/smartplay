/**
 * Phase 416 — SmartMotion Quick Record.
 *
 * Minimal camera screen for SmartMotion's Record button. Single-tap
 * entry to capture — no checklist, no setup screen, no detour. Opens
 * the camera immediately, records a swing on Record tap, and routes
 * back to /swinglab/smartmotion?clipUri=<recorded-uri> when done.
 *
 * Architectural call: replaces the prior /camera-setup → /cage-drill
 * detour for the SmartMotion entry point. cage-drill stays put for
 * the longer cage-session flow (multi-swing, drill recommendation
 * follow-ups); this is the dedicated single-swing on-ramp Tim asked
 * for ("simple, intuitive, quick load, camera opens immediately").
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QuickTutorial } from '../../components/QuickTutorial';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useTheme } from '../../contexts/ThemeContext';
import { useFamilyStore } from '../../store/familyStore';
import KidSwingGuideOverlay, { type GuidePhase } from '../../components/KidSwingGuideOverlay';
import { useWindowDimensions } from 'react-native';
// 2026-05-24 (Metrics C2) — Mirror Cage Mode's parallel-audio-recorder
// pattern so SmartMotion's IN-APP record path produces a discrete
// audio file + impact_ms for /api/acoustic-detect. Same lifecycle,
// same detector, same endpoint — zero new deps. Camera-roll uploads
// have no parallel recording → stay pose-only by construction
// (this screen only fires on the in-app capture flow).
import {
  startImpactRecording,
  stopAndDetectImpact,
  cleanupImpactRecording,
  abortImpactRecording,
} from '../../services/acousticImpactDetector';
import { detectBallSpeed } from '../../services/acousticDetectApi';

const MAX_RECORD_SECONDS = 8;

type Angle = 'down_the_line' | 'face_on';

export default function QuickRecord() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // 2026-05-21 — Fix B: angle is chosen BEFORE recording. Routed in
  // via URL param from SmartMotion's NoClipHero or the voice intent
  // ("record me down the line" / "face on"). Default down-the-line
  // when omitted. autoStart=1 (from voice) fires recording on mount
  // so the spoken command "record me face on" both sets the angle
  // and starts the capture in one shot.
  const { angle: angleParam, autoStart: autoStartParam, club: clubParam } = useLocalSearchParams<{ angle?: string; autoStart?: string; club?: string }>();
  const initialAngle: Angle =
    angleParam === 'face_on' || angleParam === 'face-on' ? 'face_on' : 'down_the_line';
  const [angle, setAngle] = useState<Angle>(initialAngle);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');

  // 2026-05-22 — Family Coaching: when a family member is the active
  // recording target (set by voice "Coach Emma's swing" or by tapping
  // Record from the member library), render the KidSwingGuideOverlay
  // as a static reference. Toggles via a chip in the top-right. The
  // overlay is UI-only — does not appear in the recorded video.
  const activeMemberId = useFamilyStore((s) => s.active_member_id);
  const activeMember = useFamilyStore((s) => s.getMember(activeMemberId));
  const [guideOn, setGuideOn] = useState<boolean>(true);
  const [guidePhase, setGuidePhase] = useState<GuidePhase>('all');
  const { width: winW, height: winH } = useWindowDimensions();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // 2026-05-24 (C2) — Brief post-stop spinner while we await the
  // acoustic chain (stopAndDetectImpact + detectBallSpeed). Mirrors
  // Cage's UPLOADING phase. Typically <2s; never blocks navigation
  // for more than detectBallSpeed's server response.
  const [processing, setProcessing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!camPerm) void requestCamPerm();
    if (!micPerm) void requestMicPerm();
    // request permissions on mount; intentionally one-shot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 2026-05-24 (C2) — Belt-and-suspenders: if the user backs out
  // mid-recording (Close button, hardware back) we don't want the
  // parallel Audio.Recording to leak. abortImpactRecording is
  // idempotent (no-op when nothing is active), safe on every unmount.
  // Mirrors cage-mode.tsx:531-535.
  useEffect(() => {
    return () => {
      void abortImpactRecording().catch(() => undefined);
    };
  }, []);

  const handleRecord = useCallback(async () => {
    if (recording) {
      try { cameraRef.current?.stopRecording(); } catch {}
      return;
    }
    if (!cameraRef.current) return;
    setElapsed(0);
    setRecording(true);
    // 2026-05-24 (C2) — Parallel audio recording starts ALONGSIDE the
    // camera so the meter time-series captures the same window as the
    // video. Fire-and-forget per Cage's pattern: if mic permission is
    // already-denied or the device is busy, the parallel recorder
    // silently skips and stopAndDetectImpact returns null → falls
    // through to pose-only (honest degradation). Mirrors Cage's
    // line 288 exactly.
    void startImpactRecording().catch(() => undefined);
    timerRef.current = setInterval(() => {
      setElapsed(e => {
        if (e + 1 >= MAX_RECORD_SECONDS) {
          try { cameraRef.current?.stopRecording(); } catch {}
        }
        return e + 1;
      });
    }, 1000);
    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: MAX_RECORD_SECONDS });
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setRecording(false);
      setElapsed(0);
      const uri = (result as { uri?: string } | undefined)?.uri ?? null;
      if (!uri) {
        // No video → also abort the parallel audio so nothing leaks.
        void abortImpactRecording().catch(() => undefined);
        return;
      }

      // 2026-05-24 (C2) — Run the acoustic chain inline so the
      // resolved ball speed can ride into SmartMotion as a URL param.
      // Mirrors Cage's lines 344-358 exactly: stopAndDetectImpact →
      // detectBallSpeed (when an impact landed AND we have an audio
      // file) → cleanup. Every step is honest-degradation: any null
      // anywhere along the chain skips the acoustic value and the
      // video routes to SmartMotion pose-only.
      setProcessing(true);
      let measuredBallSpeedMph: number | null = null;
      try {
        const impact = await stopAndDetectImpact();
        if (impact && impact.audio_uri) {
          // 2026-05-24 — Club hint: when Quick Record is launched with
          // a ?club= URL param (e.g. cage→quick-record handoff), pass
          // it through so the server's club-typical heuristic
          // calibrates against the right reference. When no param,
          // pass NOTHING — never silently default to 7I. The user tags
          // the club via Tag Club on the SmartMotion card after the
          // route-back; the metric synthesizer then keys off it
          // honestly. Server-side detectBallSpeed has a 7I fallback
          // for legacy callers; flagged for a future server-side
          // unknown-handling pass.
          const speed = await detectBallSpeed({
            audioUri: impact.audio_uri,
            impact_ms: impact.impact_ms,
            ...(typeof clubParam === 'string' && clubParam.trim().length > 0
              ? { club: clubParam.trim() }
              : {}),
          });
          if (speed && typeof speed.ball_speed_mph === 'number' && Number.isFinite(speed.ball_speed_mph)) {
            measuredBallSpeedMph = speed.ball_speed_mph;
          }
          // Audio file consumed — clean up regardless of speed result
          // so it doesn't linger in cache.
          void cleanupImpactRecording(impact.audio_uri).catch(() => undefined);
        }
      } catch (e) {
        // Acoustic chain failure is non-fatal — pose-only fallback.
        console.log('[quick-record] acoustic chain failed (non-fatal):', e);
      }
      setProcessing(false);

      router.replace({
        pathname: '/swinglab/smartmotion',
        // 2026-05-21 — Fix B: hand the angle back to smartmotion so
        // analyzeSwing fires with the SETUP-chosen orientation,
        // not the default.
        // 2026-05-24 (C2) — measuredBallSpeedMph carries the acoustic
        // estimate (when one was produced) so smartmotion's
        // synthesizeSwingMetrics emits source:'acoustic' for ball speed
        // with the honest estimate-tier shape (~ + tighter range + med
        // ceiling per C1). Absent when the chain produced no value.
        params: {
          clipUri: uri,
          angle,
          ...(measuredBallSpeedMph != null
            ? { measuredBallSpeedMph: String(Math.round(measuredBallSpeedMph)) }
            : {}),
          // 2026-05-24 — Forward club hint to SmartMotion so the
          // metric synthesizer keys off it. Untagged passes nothing
          // (SmartMotion treats null as 'unknown' — honest, not 7I).
          ...(typeof clubParam === 'string' && clubParam.trim().length > 0
            ? { club: clubParam.trim() }
            : {}),
        },
      } as never);
    } catch (e) {
      console.log('[quick-record] recordAsync failed:', e);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      // Video recording failed mid-flight — abort the parallel audio
      // so the recorder state is clean for the next attempt.
      void abortImpactRecording().catch(() => undefined);
      setRecording(false);
      setProcessing(false);
      setElapsed(0);
    }
  }, [recording, router, angle]);

  // 2026-05-21 — Fix B: auto-start from voice intent. When the user
  // says "record me down the line" / "face on", openToolHandler
  // routes here with ?autoStart=1 — fire the record handler once
  // the camera + mic permissions are granted. Guarded by
  // autoStartedRef so we only fire on first mount.
  useEffect(() => {
    if (autoStartParam !== '1') return;
    if (autoStartedRef.current) return;
    if (!camPerm?.granted || !micPerm?.granted) return;
    autoStartedRef.current = true;
    // Slight delay so the CameraView ref is attached before we call
    // recordAsync. 250ms is generous; on real device the view mounts
    // in <100ms.
    const t = setTimeout(() => { void handleRecord(); }, 250);
    return () => clearTimeout(t);
  }, [autoStartParam, camPerm?.granted, micPerm?.granted, handleRecord]);

  // Permission gate
  if (!camPerm || !micPerm) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: '#000' }]}>
        <View style={styles.permView}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[styles.permText, { color: '#fff' }]}>Checking camera permission…</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!camPerm.granted || !micPerm.granted) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: '#000' }]}>
        <View style={styles.permView}>
          <Ionicons name="videocam-off-outline" size={40} color={colors.accent} />
          <Text style={[styles.permTitle, { color: '#fff' }]}>Camera + Mic Access</Text>
          <Text style={[styles.permText, { color: '#9ca3af' }]}>
            SmartMotion records your swing for analysis. Both stay on your phone.
          </Text>
          <TouchableOpacity
            style={[styles.permBtn, { backgroundColor: colors.accent }]}
            onPress={async () => {
              if (!camPerm.granted) {
                if (camPerm.canAskAgain) await requestCamPerm();
                else Linking.openSettings();
              }
              if (!micPerm.granted) {
                if (micPerm.canAskAgain) await requestMicPerm();
                else Linking.openSettings();
              }
            }}
          >
            <Text style={[styles.permBtnText, { color: '#060f09' }]}>
              {camPerm.canAskAgain && micPerm.canAskAgain ? 'Grant Permissions' : 'Open Settings'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={styles.permCancel}>
            <Text style={[styles.permCancelText, { color: '#9ca3af' }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode="video"
        videoQuality="720p"
      />

      {/* 2026-05-22 — Family Coaching guide overlay. Renders ideal swing
          positions for the active family member as a visible reference
          the kid can aim at while their parent records. UI-only, not
          captured in the recorded video. */}
      {guideOn && activeMember && (
        <KidSwingGuideOverlay
          width={winW}
          height={winH}
          phase={guidePhase}
          age={activeMember.age}
          handedness={activeMember.handedness}
          firstName={activeMember.firstName}
          silentMode={recording}
        />
      )}

      {/* Top bar — back + flip camera */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.topBtn}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={styles.elapsedPill}>
          <View style={[styles.recDot, { opacity: recording ? 1 : 0.3 }]} />
          <Text style={styles.elapsedText}>{recording ? `${elapsed}s / ${MAX_RECORD_SECONDS}s` : 'Ready'}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))}
          style={styles.topBtn}
          disabled={recording}
        >
          <Ionicons name="camera-reverse" size={26} color={recording ? '#666' : '#fff'} />
        </TouchableOpacity>
      </View>

      {/* 2026-05-21 — Fix B: angle chip below the top bar. Confirms
          which angle was chosen pre-record + lets the user flip
          before they hit record if they entered with the wrong
          one. Hidden during recording so it doesn't distract. */}
      {/* 2026-05-22 — Family guide phase + visibility toggles. Only
          renders when a family-member recording is active, so adult
          self-record stays uncluttered. */}
      {activeMember && !recording && (
        <View style={[styles.guideToggleRow, { top: insets.top + 60 }]}>
          <TouchableOpacity
            onPress={() => setGuideOn((v) => !v)}
            style={[styles.guideChip, !guideOn && styles.guideChipMuted]}
            accessibilityRole="button"
            accessibilityLabel={guideOn ? 'Hide swing guide overlay' : 'Show swing guide overlay'}
          >
            <Text style={[styles.guideChipText, !guideOn && styles.guideChipTextMuted]}>
              {guideOn ? '👁 GUIDE ON' : '👁 OFF'}
            </Text>
          </TouchableOpacity>
          {guideOn && (
            <TouchableOpacity
              onPress={() => {
                const order: GuidePhase[] = ['all', 'address', 'top', 'impact', 'finish'];
                const idx = order.indexOf(guidePhase);
                setGuidePhase(order[(idx + 1) % order.length]);
              }}
              style={styles.guideChip}
              accessibilityRole="button"
              accessibilityLabel={`Cycle guide phase. Current: ${guidePhase}`}
            >
              <Text style={styles.guideChipText}>{guidePhase.toUpperCase()}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!recording ? (
        <TouchableOpacity
          onPress={() => setAngle(a => (a === 'down_the_line' ? 'face_on' : 'down_the_line'))}
          style={[styles.angleChip, { top: insets.top + (activeMember ? 102 : 60) }]}
          accessibilityRole="button"
          accessibilityLabel={`Camera angle: ${angle === 'down_the_line' ? 'down the line' : 'face on'}. Tap to switch.`}
        >
          <Ionicons
            name={angle === 'down_the_line' ? 'trending-up-outline' : 'person-outline'}
            size={14}
            color="#00C896"
          />
          <Text style={styles.angleChipText}>
            {angle === 'down_the_line' ? 'DOWN THE LINE' : 'FACE ON'}
          </Text>
          <Ionicons name="swap-horizontal" size={13} color="#9ca3af" />
        </TouchableOpacity>
      ) : null}

      {/* Phase 418 — pre-record framing guide. A faint dashed rectangle
          showing roughly where the player should stand head-to-feet.
          Helps Tim avoid recording the floor (which was the original
          fabrication bug). */}
      {!recording ? (
        <View style={styles.framingGuide} pointerEvents="none">
          <View style={styles.framingFrame} />
          <Text style={styles.framingLabel}>Full body · head to feet</Text>
        </View>
      ) : null}

      {/* Bottom — big record button */}
      <View style={[styles.bottomArea, { bottom: insets.bottom + 24 }]}>
        <Text style={styles.hint}>
          {recording
            ? 'Tap to stop'
            : processing
            ? 'Reading impact…'
            : 'Frame the swing · phone vertical · stable mount'}
        </Text>
        <TouchableOpacity
          onPress={handleRecord}
          disabled={processing}
          style={[
            styles.recordOuter,
            { borderColor: recording ? '#ef4444' : '#ffffff', opacity: processing ? 0.5 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
        >
          <View style={[
            styles.recordInner,
            recording
              ? { backgroundColor: '#ef4444', borderRadius: 6, width: 32, height: 32 }
              : { backgroundColor: '#ef4444', borderRadius: 28, width: 56, height: 56 },
          ]} />
        </TouchableOpacity>
      </View>

      {/* 2026-05-24 (C2) — Brief post-stop overlay while the acoustic
          chain resolves. Mirrors Cage's UPLOADING phase but lighter —
          single spinner + label, no full-screen takeover. Disappears
          when measuredBallSpeedMph lands (or the chain returns null
          and we route pose-only). */}
      {processing && (
        <View style={styles.processingOverlay} pointerEvents="none">
          <View style={styles.processingPill}>
            <ActivityIndicator size="small" color="#00C896" />
            <Text style={styles.processingText}>Reading impact…</Text>
          </View>
        </View>
      )}
      <QuickTutorial
        slug="quick_record_intro"
        title="Quick Record"
        lines={[
          "Quick Record is the fast camera for capturing a swing on the fly.",
          "Tap the record button, take your swing — the clip lands in your library.",
          "For full analysis with metrics, use SmartMotion or Cage Mode after.",
        ]}
        spokenText="Quick Record. Tap record, take your swing. Saved to your library."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    zIndex: 10,
  },
  topBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  elapsedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  elapsedText: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  bottomArea: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', gap: 14,
  },
  hint: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },
  recordOuter: {
    width: 78, height: 78, borderRadius: 39,
    borderWidth: 4, alignItems: 'center', justifyContent: 'center',
  },
  recordInner: { /* dynamic */ },
  permView: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  permTitle: { fontSize: 20, fontWeight: '900' },
  permText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  permBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 12 },
  permBtnText: { fontSize: 14, fontWeight: '900' },
  permCancel: { padding: 12, marginTop: 4 },
  permCancelText: { fontSize: 13, fontWeight: '600' },
  framingGuide: {
    position: 'absolute',
    top: '14%',
    left: '18%',
    right: '18%',
    bottom: '22%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  framingFrame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  framingLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    marginBottom: 8,
  },
  angleChip: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(0, 200, 150, 0.5)',
    zIndex: 5,
  },
  angleChipText: { color: '#00C896', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },

  // 2026-05-22 — Family guide toggle row (sits just below the top bar).
  guideToggleRow: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    zIndex: 6,
  },
  guideChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(134, 239, 172, 0.55)',
  },
  guideChipMuted: { borderColor: 'rgba(156, 163, 175, 0.45)' },
  guideChipText: { color: '#86efac', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  guideChipTextMuted: { color: '#9ca3af' },
  // 2026-05-24 (C2) — Post-stop acoustic-chain overlay.
  processingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 20,
  },
  processingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.5)',
  },
  processingText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
});
