import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import {
  createSession,
  endSession,
  addClipEvent,
  finalizeClips,
  getSession,
  getSessionDir,
} from '../services/cageStorage';
import type { CageSession } from '../types/cage';
import { useCageStore } from '../store/cageStore';
import { useFamilyStore } from '../store/familyStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { runPhaseKOnSession } from '../services/videoUpload';
import { cageLog } from '../services/cageTelemetry';
import { setActiveSurface, clearActiveSurface } from '../services/activeSurfaceRegistry';
import { evaluateCageEnd } from '../services/teamIntelligence';
import {
  startImpactRecording,
  stopMultiShotRecording,
  cleanupImpactRecording,
  type ShotDetection,
} from '../services/acousticImpactDetector';
// Phase 402 — vision-based club ID controls + manual picker modal.
// Audit at docs/audit-402-club-detection-state.md found the vision
// pipeline (api/club-recognition.ts + services/clubRecognition.ts) was
// production-ready with zero call sites. These components are the
// previously-missing UI surface.
import ClubIdentifyControls from './cage/ClubIdentifyControls';
import ClubPickerModal from './cage/ClubPickerModal';

// ─── Constants ────────────────────────────────────────────────────────────────

// METER_INTERVAL_MS retained for the telemetry log line; the rest of
// the multi-shot validation constants are owned by the shared detector
// in services/acousticImpactDetector now.
import { METER_INTERVAL_MS } from '../constants/cageDetection';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Optional drill context. When provided, the cage session renders a
 *  drill-info strip (drill name + step) above the camera so the player
 *  has structure inside the same surface as free practice. Recording
 *  mechanics are unchanged in this pass — drill picks layer guidance,
 *  not behavior. Per-drill scoring/recording-length lands in a follow-up. */
export interface CageDrillContext {
  id: string;
  title: string;
  steps: readonly string[];
  /** Optional one-line tip rendered under the steps. */
  tip?: string;
}

interface Props {
  onComplete: (sessionId: string) => void;
  onCancel: () => void;
  /** When set, the session is run as a guided drill — info strip renders
   *  at top; otherwise free-practice (current default). */
  drill?: CageDrillContext | null;
}

type Phase = 'requesting' | 'preview' | 'recording' | 'ending';

// ─── Component ────────────────────────────────────────────────────────────────

/** Curated cage drills exposed in the in-overlay drill picker. Same set
 *  used by SwingLab's drill list — duplicated here as a minimal subset
 *  so the overlay can pick without importing the full DRILLS array
 *  (which would create a UI-side circular-ish dep). When SwingLab adds
 *  a new cage drill, mirror its id/title/steps here. */
const PICKER_DRILLS: CageDrillContext[] = [
  { id: 'alignment',   title: 'Alignment Check', steps: ['Set alignment sticks parallel.', 'Verify shoulder line.', 'Hit 10 with check before each.'], tip: 'Most amateurs aim right.' },
  { id: 'impact',      title: 'Impact Position', steps: ['Set impact bag.', 'Slow swing to impact.', 'Check hands ahead, weight forward.', 'Hold position 5 sec.'], tip: 'Shaft lean = distance.' },
  { id: 'gate',        title: 'Gate Drill',      steps: ['Place tees 1" wider than clubhead.', 'Swing through without hitting either tee.', 'Adjust path until clean.'], tip: 'Path doesn\'t lie.' },
  { id: 'pump',        title: 'Pump Drill',      steps: ['Take club to top.', 'Pump down to hip height 3x.', '4th pump finishes through.'], tip: 'Hands lead clubhead.' },
  { id: 'one-handed',  title: 'One-Handed Swings', steps: ['Trail hand: 10 slow swings.', 'Lead hand: 10 slow swings.', 'Both hands: feel the balance.'], tip: 'Reveals dominant hand.' },
];

export default function CageSessionOverlay({ onComplete, onCancel, drill }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Audit fix: was `width > 500` only, which mis-identified some tablets
  // (always wide) as folded-open AND missed Z Fold's reconfigure if the
  // device was rotated. Aspect-ratio + width together gives a sturdier
  // signal — folded-open Z Fold is roughly square-ish (aspect 0.85–1.15);
  // closed Z Fold and standard phones are tall (aspect > 1.6). Tablets
  // are wide enough that we keep the width check too as a backstop.
  const aspect = height / Math.max(width, 1);
  const isFoldOpen = (aspect < 1.5 && width > 500) || width > 700;
  // Local drill state — initialized from prop, mutable via the in-
  // overlay picker so the user can pick a drill AFTER opening Cage
  // Mode (rather than having to pick before opening). Null = Free
  // Practice (the default cage behavior).
  const [activeDrill, setActiveDrill] = useState<CageDrillContext | null>(drill ?? null);
  // Drill step counter — currently advances on session-start only since
  // mechanics are identical to free practice in this pass. The shape is
  // ready for the follow-up that wires per-step prompts.
  const [drillStepIdx, setDrillStepIdx] = useState(0);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('requesting');
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('back');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [swingCount, setSwingCount] = useState(0);
  const [meterAvailable, setMeterAvailable] = useState(true);

  const cameraRef = useRef<CameraView>(null);
  const sessionRef = useRef<CageSession | null>(null);
  const sessionStartRef = useRef<number>(0);
  const videoPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // meteringRecRef / meterBufferRef / lastDetectionRef / pendingPeakRef
  // removed — multi-shot validation now lives in the shared detector
  // (services/acousticImpactDetector mode: 'multi-shot').
  const isMountedRef = useRef(true);

  // Portrait lock — cage recording must be vertical for correct video framing
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    // Phase 105 — register cage surface so caddieResolver routes the
    // cage-pillar caddie (Tank by default) into voice / brain / avatar.
    setActiveSurface('cage');
    return () => {
      clearActiveSurface('cage');
      ScreenOrientation.unlockAsync();
    };
  }, []);

  // ─── Permissions ──────────────────────────────────────────────────────────

  useEffect(() => {
    isMountedRef.current = true;
    cageLog('overlay-mount', 'ok', { isFoldOpen });
    (async () => {
      // Camera
      if (!cameraPermission?.granted) {
        cageLog('camera-perm-request', 'ok');
        const result = await requestCameraPermission();
        if (!result.granted) {
          cageLog('camera-perm-deny', 'fail', { reason: 'user-denied' });
          onCancel();
          return;
        }
        cageLog('camera-perm-grant', 'ok');
      } else {
        cageLog('camera-perm-grant', 'ok', { cached: true });
      }
      // Microphone (for expo-av metering recording)
      cageLog('mic-perm-request', 'ok');
      const micResult = await Audio.requestPermissionsAsync();
      if (!isMountedRef.current) return;
      if (!micResult.granted) {
        // Can continue without metering; manual-only
        console.warn('[CageSession] Microphone permission denied — manual detection only');
        cageLog('mic-perm-deny', 'partial', { mode: 'manual-only' });
        setMeterAvailable(false);
      } else {
        cageLog('mic-perm-grant', 'ok');
      }
      setPhase('preview');
      cageLog('phase-preview', 'ok');
    })();

    return () => {
      isMountedRef.current = false;
      cageLog('overlay-unmount', 'ok');
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Audio Metering ────────────────────────────────────────────────────────
  // Multi-shot validation (noise-floor + decay verification + debounce)
  // moved into services/acousticImpactDetector so the same logic backs
  // cage-drill / on-course / cage-session surfaces. This component is
  // now a thin caller: start, receive ShotDetection events, stop.

  const handleShotDetected = useCallback((d: ShotDetection) => {
    if (!isMountedRef.current) return;
    if (!sessionRef.current || phase !== 'recording') return;
    const offsetSec = d.offset_ms / 1000;
    addClipEvent(sessionRef.current.id, offsetSec, 'audio_transient');
    cageLog('swing-detected', 'ok', {
      method: 'audio_transient',
      offset_seconds: Number(offsetSec.toFixed(2)),
      peak_dBFS: Number(d.peak_db.toFixed(1)),
      decay_dB: Number(d.decay_db.toFixed(1)),
      noise_floor_dB: Number(d.noise_floor_db.toFixed(1)),
      session_id: sessionRef.current.id,
    });
    setSwingCount((c) => c + 1);
  }, [phase]);

  const startMetering = useCallback(async () => {
    if (!meterAvailable) return;
    const ok = await startImpactRecording({
      mode: 'multi-shot',
      onShotDetected: handleShotDetected,
    });
    if (!ok) {
      cageLog('metering-start', 'fail', { fallback: 'manual-only' });
      setMeterAvailable(false);
      return;
    }
    cageLog('metering-start', 'ok', { interval_ms: METER_INTERVAL_MS, via: 'shared-detector' });
  }, [meterAvailable, handleShotDetected]);

  const stopMetering = useCallback(async () => {
    const res = await stopMultiShotRecording();
    if (res?.audio_uri) {
      void cleanupImpactRecording(res.audio_uri);
    }
  }, []);

  // ─── Start Session ─────────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    if (!cameraRef.current) {
      cageLog('session-start', 'fail', { reason: 'camera-ref-null' });
      return;
    }
    setPhase('recording');
    cageLog('session-start', 'ok');

    try {
      // Create session record
      const session = await createSession();
      sessionRef.current = session;
      sessionStartRef.current = Date.now();
      cageLog('storage-session-created', 'ok', { session_id: session.id });

      // Start timer
      timerRef.current = setInterval(() => {
        if (isMountedRef.current) {
          setElapsedSeconds(Math.floor((Date.now() - sessionStartRef.current) / 1000));
        }
      }, 1000);

      // Start metering (parallel audio) — muted camera avoids audio session conflict
      await startMetering();

      // Start camera recording (video + audio)
      videoPromiseRef.current = cameraRef.current.recordAsync() as Promise<{ uri: string } | undefined>;

      console.log('[CageSession] Recording started, session:', session.id);
      cageLog('recording-begin', 'ok', { session_id: session.id });
    } catch (e) {
      console.error('[CageSession] Failed to start session:', e);
      cageLog('session-start', 'fail', { error: e instanceof Error ? e.message : String(e) });
      if (isMountedRef.current) setPhase('preview');
    }
  }, [startMetering]);

  // ─── Manual Log Swing ──────────────────────────────────────────────────────

  const handleLogSwing = useCallback(() => {
    if (!sessionRef.current || phase !== 'recording') return;
    const offset = (Date.now() - sessionStartRef.current) / 1000;
    addClipEvent(sessionRef.current.id, offset, 'manual');
    setSwingCount((c) => c + 1);
    console.log(`[CageSession] Manual swing logged @ ${offset.toFixed(1)}s`);
    cageLog('swing-detected', 'ok', {
      method: 'manual',
      offset_seconds: Number(offset.toFixed(2)),
      session_id: sessionRef.current.id,
    });
  }, [phase]);

  // ─── End Session ───────────────────────────────────────────────────────────

  const handleEndSession = useCallback(async () => {
    if (!sessionRef.current || phase !== 'recording') return;
    const session = sessionRef.current;
    setPhase('ending');
    cageLog('session-end-trigger', 'ok', { session_id: session.id });

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const durationSeconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);

    // Stop camera recording
    cameraRef.current?.stopRecording();
    cageLog('camera-stop', 'ok');
    let masterVideoPath = '';
    try {
      const result = await videoPromiseRef.current;
      if (result?.uri) {
        // Move temp file to session directory
        const sessionDir = await getSessionDir(session.id);
        masterVideoPath = sessionDir + 'master.mp4';
        await FileSystem.moveAsync({ from: result.uri, to: masterVideoPath });
        cageLog('master-video-saved', 'ok', { path: masterVideoPath, duration_seconds: durationSeconds });
      } else {
        cageLog('master-video-saved', 'fail', { reason: 'no-result-uri' });
      }
    } catch (e) {
      console.error('[CageSession] Error saving master video:', e);
      cageLog('master-video-saved', 'fail', { error: e instanceof Error ? e.message : String(e) });
    }

    // Stop metering
    await stopMetering();
    cageLog('metering-stop', 'ok');

    // Finalize storage
    await endSession(session.id, masterVideoPath);
    await finalizeClips(session.id, durationSeconds);
    cageLog('clips-finalized', 'ok', { session_id: session.id, swing_count: swingCount });

    console.log(`[CageSession] Session ended. Duration: ${durationSeconds}s, Swings: ${swingCount}, Video: ${masterVideoPath}`);
    cageLog('session-end', 'ok', { session_id: session.id, duration_seconds: durationSeconds, swing_count: swingCount });

    // Phase BS-followup Issue G — bridge the cage live session into the
    // Zustand cageStore.sessionHistory so My Swing Library renders it.
    // Previously the cage flow only wrote to filesystem (cageStorage) and
    // routed to /cage-debug; the swing library never saw these sessions.
    // Now: ingest the master video as a one-shot CageSession with source
    // 'live_cage', then fire Phase K analysis in the background. The
    // swing detail screen subscribes to the analysis_status transitions
    // so the user sees "Watching the swing…" → "ok" naturally.
    //
    // Issue H — club defaults to 'unknown' since the new cage flow
    // doesn't yet integrate the BL three-tier club detection. User can
    // tap the club label on the detail surface to set it manually, or
    // a follow-up phase wires BL into the recording start step.
    let libraryEntryId: string | null = null;
    if (masterVideoPath) {
      cageLog('library-bridge-start', 'ok', { source: 'live_cage', clipUri: masterVideoPath });
      try {
        // Phase BW — read finalized clip metadata from cageStorage and
        // build per-swing CageShots, each with clipBoundaries pointing
        // into the master video. Phase K then samples frames from the
        // swing's window only (not the whole 6-minute master). Falls
        // back to single-shot ingestUploadedSwing if no detections were
        // recorded (zero-swing recording → keep one CageShot pointing
        // at the master so the library entry still exists).
        const storageSession = await getSession(session.id);
        const clipMetadata = storageSession?.clips ?? [];
        // 2026-05-23 (Fix #7) — Attribution: when a family member is
        // active in familyStore at session-end (coach hitting in the
        // cage with the student observing, or vice versa), attribute
        // this multi-swing cage session to THAT member with
        // perspective='watching_someone' so Phase K runs the full
        // swing analyzer. Was previously hardcoded swinger:'Me' which
        // collapsed everyone into a single account-holder bucket.
        const famState = useFamilyStore.getState();
        const activeMember = famState.active_member_id
          ? famState.members.find(m => m.id === famState.active_member_id) ?? null
          : null;
        const swinger = activeMember?.firstName
          ?? usePlayerProfileStore.getState().firstName
          ?? 'Me';
        const perspective: 'pov_self' | 'watching_someone' =
          activeMember ? 'watching_someone' : 'pov_self';
        const upload = {
          uploaded_at: Date.now(),
          taken_at: sessionStartRef.current,
          has_audio: true,
          duration_sec: durationSeconds,
          swinger,
          tag: 'cage' as const,
          notes: `${swingCount} swing${swingCount !== 1 ? 's' : ''} detected`,
          perspective,
        };
        if (clipMetadata.length > 0) {
          libraryEntryId = useCageStore.getState().ingestLiveCageSession({
            masterVideoPath,
            club: 'unknown',
            upload,
            shots: clipMetadata.map(clip => ({
              correlationId: clip.id,
              detectionOffsetSeconds: clip.detected_at_session_offset_seconds,
              clipStartSeconds: clip.start_time_seconds,
              clipEndSeconds: clip.end_time_seconds,
              detectionMethod: clip.detection_method,
            })),
          });
          cageLog('library-bridge', 'ok', {
            library_entry_id: libraryEntryId,
            shot_count: clipMetadata.length,
            mode: 'multi-shot',
          });
        } else {
          // Zero detections — fall back to one shot pointing at the master
          // so the library still has an entry the user can review.
          libraryEntryId = useCageStore.getState().ingestUploadedSwing({
            clipUri: masterVideoPath,
            club: 'unknown',
            upload,
            source: 'live_cage',
          });
          cageLog('library-bridge', 'partial', {
            library_entry_id: libraryEntryId,
            mode: 'single-shot-fallback',
            reason: 'no_detections',
          });
        }
        console.log(`[CageSession] Bridged to swing library as ${libraryEntryId}`);
        // Fire-and-forget Phase K. With per-swing clipBoundaries the
        // analysis runs on each swing's window separately, producing
        // per-shot results that the review UI surfaces as per-swing cards.
        cageLog('phase-k-invoke', 'ok', { library_entry_id: libraryEntryId, mode: 'background' });
        void runPhaseKOnSession(libraryEntryId).catch(e => {
          console.log('[CageSession] Phase K background error', e);
          cageLog('phase-k-invoke', 'fail', { error: e instanceof Error ? e.message : String(e) });
        });
      } catch (e) {
        console.error('[CageSession] Bridge to swing library failed:', e);
        cageLog('library-bridge', 'fail', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (isMountedRef.current) {
      // Phase 106 — evaluate cage-end triggers now that the session is
      // captured. Conservative: this fires the drill-plateau detector
      // which only triggers if the recent N cage sessions all share
      // the same primary issue label.
      try { evaluateCageEnd(); } catch (e) { console.warn('[teamIntelligence] cage-end eval threw:', e); }

      // Points — every cage session that captured at least one swing
      // earns 10 pts (drill or free practice). Drill context tags the
      // history entry so the points log reads as a record of what was
      // practiced, not just a count. Empty sessions don't farm points.
      if (swingCount > 0) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pointsMod = require('../store/pointsStore');
          const reason = activeDrill ? `cage_drill_${activeDrill.id}` : 'cage_session';
          pointsMod.usePointsStore.getState().addPoints(10, reason);
        } catch (e) { console.log('[points] cage-end emit failed:', e); }
      }

      // Hand the LIBRARY entry id to the consumer (not the cageStorage
      // session id) so navigation lands on the swing detail screen which
      // is keyed by sessionHistory[].id.
      onComplete(libraryEntryId ?? session.id);
    }
  }, [phase, swingCount, stopMetering, onComplete, activeDrill]);

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  const cleanup = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    await stopMetering();
    if (phase === 'recording') {
      cameraRef.current?.stopRecording();
    }
  }, [phase, stopMetering]);

  // ─── Formatting ────────────────────────────────────────────────────────────

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ─── Render: Requesting permissions ────────────────────────────────────────

  if (phase === 'requesting') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.requestingText}>Requesting camera access…</Text>
      </SafeAreaView>
    );
  }

  // ─── Render: Preview (pre-recording) ───────────────────────────────────────

  if (phase === 'preview') {
    return (
      <SafeAreaView style={[styles.container, { paddingBottom: insets.bottom + 12 }]} edges={['top', 'left', 'right']}>
        <View style={styles.previewHeader}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color="#6b7280" />
          </TouchableOpacity>
          <Text style={styles.previewTitle}>Cage Session</Text>
          <TouchableOpacity
            style={styles.flipBtn}
            onPress={() => setCameraFacing((f) => (f === 'back' ? 'front' : 'back'))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="camera-reverse-outline" size={20} color="#00C896" />
            <Text style={styles.flipBtnText}>Flip</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.cameraPreviewBox, isFoldOpen && styles.cameraPreviewBoxWide]}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={cameraFacing}
            mode="video"
          />

          {/* Silhouette + swing-arc framing — same overlay as recording
              phase so the user knows BEFORE they start where their full
              swing needs to fit. (Issue E) */}
          <View style={styles.silhouetteFrame} pointerEvents="none">
            <View style={styles.silhouetteArcTop} />
            <View style={styles.silhouettePersonWrap}>
              <Ionicons name="body-outline" size={140} color="rgba(0, 200, 150, 0.42)" />
            </View>
            <View style={styles.silhouetteArcBottom} />
          </View>

          <View style={styles.cameraOverlayHint}>
            <Text style={styles.cameraOverlayHintText}>
              Place phone so you stand inside the figure. Backswing top + follow-through must fit between the dashed lines.
            </Text>
          </View>
        </View>

        {/* Drill picker — Free Practice (default) + each cage drill.
            Lives inside Cage Mode so the user picks AFTER opening the
            camera, not before. Tapping a chip sets the drill context;
            the recording will render the drill-info strip when started.
            Free Practice clears any selection. */}
        <View style={styles.drillPickerWrap}>
          <Text style={styles.drillPickerLabel}>DRILL (OPTIONAL)</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.drillPickerRow}
          >
            <TouchableOpacity
              style={[
                styles.drillPickerChip,
                activeDrill === null && styles.drillPickerChipActive,
              ]}
              onPress={() => setActiveDrill(null)}
              accessibilityRole="button"
              accessibilityLabel="Free practice — no drill structure"
            >
              <Text style={[
                styles.drillPickerChipText,
                activeDrill === null && styles.drillPickerChipTextActive,
              ]}>Free</Text>
            </TouchableOpacity>
            {PICKER_DRILLS.map(d => (
              <TouchableOpacity
                key={d.id}
                style={[
                  styles.drillPickerChip,
                  activeDrill?.id === d.id && styles.drillPickerChipActive,
                ]}
                onPress={() => setActiveDrill(d)}
                accessibilityRole="button"
                accessibilityLabel={`Run ${d.title} drill`}
              >
                <Text style={[
                  styles.drillPickerChipText,
                  activeDrill?.id === d.id && styles.drillPickerChipTextActive,
                ]}>{d.title}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {!meterAvailable && (
          <View style={styles.warnBanner}>
            <Text style={styles.warnText}>
              Microphone unavailable — auto-detection off. Use &quot;Log swing&quot; manually.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.startBtn}
          onPress={startSession}
          activeOpacity={0.8}
        >
          <Ionicons name="ellipse" size={18} color="#060f09" />
          <Text style={styles.startBtnText}>Start Recording</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ─── Render: Recording or Ending ───────────────────────────────────────────

  const isEnding = phase === 'ending';

  return (
    <SafeAreaView style={[styles.container, { paddingBottom: insets.bottom + 12 }]} edges={['top', 'left', 'right']}>
      {/* Header row — recording indicator + timer + swing count, compact */}
      <View style={styles.recHeader}>
        <View style={styles.recHeaderLeft}>
          <View style={styles.recDot} />
          <Text style={styles.timerText}>{formatTime(elapsedSeconds)}</Text>
        </View>
        <View style={styles.recHeaderRight}>
          <Text style={styles.swingCountNum}>{swingCount}</Text>
          <Text style={styles.swingCountLabel}>
            {swingCount === 1 ? 'swing' : 'swings'}
          </Text>
        </View>
      </View>
      {!meterAvailable && (
        <Text style={styles.manualOnlyBadge}>Auto-detect off — log manually</Text>
      )}

      {/* Phase 402 — current-club chip + ID-club camera button. Always
          visible during an active recording. Tapping the chip opens the
          manual picker; tapping ID launches expo-image-picker and routes
          the Sonnet vision response by confidence (high auto-accepts,
          medium prompts, low/error falls through to manual). */}
      <ClubIdentifyControls />

      {/* Drill-info strip — only renders when this session was launched
          with a drill context. Shows drill name + current step so the
          player has structure inside the same surface as free practice.
          Tap the chevron to advance the step counter manually (mechanics
          are still free-detect; per-step prompts come in the follow-up). */}
      {activeDrill && (
        <View style={styles.drillStrip}>
          <View style={{ flex: 1 }}>
            <Text style={styles.drillStripTitle} numberOfLines={1}>{activeDrill.title}</Text>
            <Text style={styles.drillStripStep} numberOfLines={2}>
              {`Step ${Math.min(drillStepIdx + 1, activeDrill.steps.length)} of ${activeDrill.steps.length} · `}
              <Text style={styles.drillStripStepBody}>{activeDrill.steps[Math.min(drillStepIdx, activeDrill.steps.length - 1)]}</Text>
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setDrillStepIdx(i => (i + 1) % activeDrill.steps.length)}
            style={styles.drillStripBtn}
            accessibilityRole="button"
            accessibilityLabel={`Advance to next step of ${activeDrill.title} drill`}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.drillStripBtnText}>Next ›</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* LIVE preview — fills available space so the user can verify
          framing in real time (Issue D). Silhouette + swing-zone overlay
          (Issue E) helps them position so the full swing fits. */}
      <View style={styles.livePreviewBox}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={cameraFacing}
          mode="video"
        />

        {/* Silhouette + swing-arc framing overlay (Issue E) — guides the
            user to place the phone so a full backswing-to-follow-through
            arc fits within the frame. The figure outline marks where the
            golfer should stand; the dashed arc shows the swing envelope.
            Pure absolute positioning, no SVG dependency. */}
        <View style={styles.silhouetteFrame} pointerEvents="none">
          <View style={styles.silhouetteArcTop} />
          <View style={styles.silhouettePersonWrap}>
            <Ionicons name="body-outline" size={140} color="rgba(0, 200, 150, 0.42)" />
          </View>
          <View style={styles.silhouetteArcBottom} />
          <View style={styles.silhouetteHintWrap}>
            <Text style={styles.silhouetteHintText}>
              Stand inside the figure. Full backswing + follow-through fit between the dashed lines.
            </Text>
          </View>
        </View>

        <View style={styles.liveBadgeRow}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
          <TouchableOpacity
            style={styles.smallFlipBtn}
            onPress={() => setCameraFacing((f) => (f === 'back' ? 'front' : 'back'))}
            disabled={isEnding}
          >
            <Ionicons name="camera-reverse-outline" size={18} color="#e8f5e9" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Action row — Log swing + End session, compact, side-by-side on
          Fold-open (more horizontal space) and stacked on Fold-closed.
          Icons via Ionicons (Issue A). Sizes reduced (Issue B). */}
      <View style={[styles.actionRow, !isFoldOpen && styles.actionRowStacked]}>
        <TouchableOpacity
          style={[styles.logSwingBtn, isEnding && styles.btnDisabled, isFoldOpen && styles.actionFlex]}
          onPress={handleLogSwing}
          disabled={isEnding}
          activeOpacity={0.75}
        >
          <Ionicons name="golf-outline" size={20} color="#00C896" />
          <Text style={styles.logSwingText}>Log swing</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.endBtn, isEnding && styles.btnDisabled, isFoldOpen && styles.actionFlex]}
          onPress={handleEndSession}
          disabled={isEnding}
          activeOpacity={0.8}
        >
          <Ionicons name={isEnding ? 'hourglass-outline' : 'stop-circle-outline'} size={18} color="#fca5a5" />
          <Text style={styles.endBtnText}>
            {isEnding ? 'Saving…' : 'End Session'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Phase 402 — manual club picker. Renders when cageStore.clubMenuOpen
          is true (set by the chip tap, the ID button's low-confidence
          fallback, or the club_menu voice intent). */}
      <ClubPickerModal />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
    paddingHorizontal: 16,
    // paddingBottom is set dynamically via useSafeAreaInsets so the End
    // Session button clears the gesture-nav band on Android edge-to-edge
    // (Issue C). Default safe value if no insets.
    paddingBottom: 16,
  },

  requestingText: {
    color: '#6b7280',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 80,
  },

  // ─── Preview phase ─────────────────────────────────────────────────
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 12,
  },
  cancelBtn: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 18,
  },
  previewTitle: {
    color: '#e8f5e9',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  flipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#0a2a1a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  flipBtnText: {
    color: '#00C896',
    fontSize: 13,
    fontWeight: '700',
  },
  cameraPreviewBox: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    minHeight: 320,
    position: 'relative',
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  cameraPreviewBoxWide: {
    // Wide-screen Fold-open keeps the same flex sizing — no maxHeight
    // cap so the preview takes all available space (Issue D).
  },
  cameraOverlayHint: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(6, 15, 9, 0.78)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cameraOverlayHintText: {
    color: '#e8f5e9',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  warnBanner: {
    backgroundColor: '#2a1a00',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#b4530944',
  },
  warnText: {
    color: '#fbbf24',
    fontSize: 12,
    textAlign: 'center',
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 14,
    gap: 10,
    shadowColor: '#00C896',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  startBtnText: {
    color: '#060f09',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // ─── Recording phase ───────────────────────────────────────────────
  // Phase BS-followup Issue B — replaced separate timerRow + swingCountBox
  // (which together took ~150px of vertical real estate) with a single
  // compact horizontal recHeader (~52px). Frees space for the live
  // preview to fill (Issue D).
  recHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 10,
  },
  recHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recHeaderRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  recDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#ef4444',
  },
  timerText: {
    color: '#e8f5e9',
    fontSize: 22,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  manualOnlyBadge: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(42, 26, 0, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'center',
    marginBottom: 6,
  },
  drillStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(0, 200, 150, 0.10)',
    borderColor: 'rgba(0, 200, 150, 0.45)',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  drillPickerWrap: {
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4,
  },
  drillPickerLabel: {
    color: '#9ca3af', fontSize: 10, fontWeight: '800',
    letterSpacing: 1.2, marginBottom: 6,
  },
  drillPickerRow: {
    flexDirection: 'row', gap: 8, paddingRight: 8,
  },
  drillPickerChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: 'rgba(0, 200, 150, 0.10)',
    borderColor: 'rgba(0, 200, 150, 0.45)', borderWidth: 1,
    borderRadius: 16,
  },
  drillPickerChipActive: {
    backgroundColor: '#00C896', borderColor: '#00C896',
  },
  drillPickerChipText: { color: '#d1d5db', fontSize: 12, fontWeight: '700' },
  drillPickerChipTextActive: { color: '#0d1a0d', fontSize: 12, fontWeight: '900' },
  drillStripTitle: { color: '#00C896', fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  drillStripStep:  { color: '#9ca3af', fontSize: 12, marginTop: 2, lineHeight: 16 },
  drillStripStepBody: { color: '#d1d5db', fontWeight: '600' },
  drillStripBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#00C896',
    borderRadius: 8,
  },
  drillStripBtnText: { color: '#0d1a0d', fontSize: 12, fontWeight: '900' },
  swingCountNum: {
    // Phase BS-followup Issue B — was 64px standalone block; now an inline
    // accent in the header row at 28px, giving the live preview the
    // vertical room it needs.
    color: '#00C896',
    fontSize: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    lineHeight: 30,
  },
  swingCountLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
  },

  // Phase BS-followup Issue D — flex:1 so the preview fills all available
  // space between the recHeader and actionRow. User can now verify
  // framing in real time.
  livePreviewBox: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginBottom: 12,
    position: 'relative',
    borderWidth: 1,
    borderColor: '#1e3a28',
  },

  // Phase BS-followup Issue E — silhouette + swing-arc framing overlay.
  // Three layered elements show the user where to stand and how much
  // vertical room their backswing/follow-through needs.
  silhouetteFrame: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  silhouetteArcTop: {
    position: 'absolute',
    top: '12%',
    left: '15%',
    right: '15%',
    height: 0,
    borderTopWidth: 1.5,
    borderTopColor: 'rgba(0, 200, 150, 0.55)',
    borderStyle: 'dashed',
  },
  silhouetteArcBottom: {
    position: 'absolute',
    bottom: '14%',
    left: '15%',
    right: '15%',
    height: 0,
    borderTopWidth: 1.5,
    borderTopColor: 'rgba(0, 200, 150, 0.55)',
    borderStyle: 'dashed',
  },
  silhouettePersonWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  silhouetteHintWrap: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(6, 15, 9, 0.62)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  silhouetteHintText: {
    color: '#e8f5e9',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 15,
  },

  liveBadgeRow: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#ef4444',
  },
  liveText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  smallFlipBtn: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 18,
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },

  // Phase BS-followup Issue B — buttons compacted: padding 22→14,
  // text 22→16. Stacked on Fold-closed (vertical), side-by-side on
  // Fold-open (more horizontal real estate, less vertical waste).
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionRowStacked: {
    flexDirection: 'column',
    gap: 10,
  },
  actionFlex: {
    flex: 1,
  },
  logSwingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a2a1a',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: '#00C89655',
    gap: 8,
  },
  logSwingText: {
    color: '#e8f5e9',
    fontSize: 16,
    fontWeight: '700',
  },
  endBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f0a0a',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: '#ef444466',
    gap: 8,
  },
  endBtnText: {
    color: '#fca5a5',
    fontSize: 16,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.4,
  },
});
