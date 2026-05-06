import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
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
import { runPhaseKOnSession } from '../services/videoUpload';
import { cageLog } from '../services/cageTelemetry';
import { setActiveSurface } from '../services/activeSurfaceRegistry';
import { evaluateCageEnd } from '../services/teamIntelligence';

// ─── Constants ────────────────────────────────────────────────────────────────

// Phase BY-quick — extracted to constants/cageDetection.ts for tunability.
import {
  METER_INTERVAL_MS,
  METER_BUFFER_SAMPLES,
  NOISE_FLOOR_MIN_SAMPLES,
  TRANSIENT_THRESHOLD_DB,
  DECAY_MIN_DB_PER_SAMPLE,
  DEBOUNCE_MS,
} from '../constants/cageDetection';

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
  const meteringRecRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterBufferRef = useRef<number[]>([]);
  const lastDetectionRef = useRef<number>(0);
  // Phase BY-quick — pending-peak state for multi-criterion validation.
  // A sample that exceeds the threshold becomes a candidate; the NEXT
  // sample either confirms the sharp decay (real impact) or rejects
  // sustained / slow-decay sounds (voice, machinery, claps).
  const pendingPeakRef = useRef<{
    dBFS: number;
    threshold: number;
    offsetSec: number;
    timestamp: number;
  } | null>(null);
  const isMountedRef = useRef(true);

  // Portrait lock — cage recording must be vertical for correct video framing
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    // Phase 105 — register cage surface so caddieResolver routes the
    // cage-pillar caddie (Tank by default) into voice / brain / avatar.
    setActiveSurface('cage');
    return () => {
      setActiveSurface(null);
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

  const startMetering = useCallback(async () => {
    if (!meterAvailable) return;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
      });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.LOW_QUALITY,
        isMeteringEnabled: true,
        android: {
          ...Audio.RecordingOptionsPresets.LOW_QUALITY.android,
          extension: '.m4a',
        },
        ios: {
          ...Audio.RecordingOptionsPresets.LOW_QUALITY.ios,
          extension: '.m4a',
        },
      });
      rec.setOnRecordingStatusUpdate((status) => {
        if (!isMountedRef.current) return;
        if (status.metering !== undefined && status.metering !== null) {
          handleMeterReading(status.metering);
        }
      });
      // expo-av: set progress update interval on the recording
      // (setProgressUpdateInterval may not exist on all versions — guard it)
      if (typeof (rec as unknown as { setProgressUpdateInterval: (ms: number) => void }).setProgressUpdateInterval === 'function') {
        (rec as unknown as { setProgressUpdateInterval: (ms: number) => void }).setProgressUpdateInterval(METER_INTERVAL_MS);
      }
      await rec.startAsync();
      meteringRecRef.current = rec;
      console.log('[CageSession] Metering started');
      cageLog('metering-start', 'ok', { interval_ms: METER_INTERVAL_MS });
    } catch (e) {
      console.warn('[CageSession] Audio metering failed to start — manual detection only:', e);
      cageLog('metering-start', 'fail', { error: e instanceof Error ? e.message : String(e), fallback: 'manual-only' });
      setMeterAvailable(false);
      meteringRecRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meterAvailable]);

  const stopMetering = useCallback(async () => {
    const rec = meteringRecRef.current;
    meteringRecRef.current = null;
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      // Discard the metering audio file — we captured video with its own audio
      const uri = rec.getURI();
      if (uri) {
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists) {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        }
      }
    } catch (e) {
      console.warn('[CageSession] Error stopping metering recording:', e);
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch (_) { /* ignore */ }
  }, []);

  // ─── Swing Detection ───────────────────────────────────────────────────────

  const handleMeterReading = useCallback((dBFS: number) => {
    const buf = meterBufferRef.current;
    const now = Date.now();

    // ─── Phase BY-quick: multi-criterion validation ────────────────────────
    // Step 1 — verify any pending peak from the previous sample.
    //   - If next sample is still above threshold → SUSTAINED sound
    //     (voice, machinery). Reject.
    //   - If decay ≥ DECAY_MIN_DB_PER_SAMPLE → confirmed SHARP transient
    //     (golf impact). Emit detection (subject to debounce) using the
    //     peak's offset, not the verification sample's offset.
    //   - Otherwise → slow decay (clap, distant boom). Reject.
    const pending = pendingPeakRef.current;
    if (pending) {
      pendingPeakRef.current = null;
      const decay = pending.dBFS - dBFS;
      const stillAboveThreshold = dBFS > pending.threshold;
      const sharpDecay = decay >= DECAY_MIN_DB_PER_SAMPLE;

      if (sharpDecay && !stillAboveThreshold) {
        if (now - lastDetectionRef.current > DEBOUNCE_MS &&
            sessionRef.current && phase === 'recording') {
          lastDetectionRef.current = now;
          addClipEvent(sessionRef.current.id, pending.offsetSec, 'audio_transient');
          cageLog('swing-detected', 'ok', {
            method: 'audio_transient',
            offset_seconds: Number(pending.offsetSec.toFixed(2)),
            peak_dBFS: Number(pending.dBFS.toFixed(1)),
            next_dBFS: Number(dBFS.toFixed(1)),
            decay_dB: Number(decay.toFixed(1)),
            threshold_dB: Number(pending.threshold.toFixed(1)),
            session_id: sessionRef.current.id,
          });
          if (isMountedRef.current) {
            setSwingCount((c) => c + 1);
          }
        }
      } else {
        cageLog('swing-rejected', 'partial', {
          reason: stillAboveThreshold ? 'sustained-loudness' : 'slow-decay',
          peak_dBFS: Number(pending.dBFS.toFixed(1)),
          next_dBFS: Number(dBFS.toFixed(1)),
          decay_dB: Number(decay.toFixed(1)),
          threshold_dB: Number(pending.threshold.toFixed(1)),
        });
      }
    }

    // Step 2 — check current sample for a new candidate. Don't emit yet;
    // hold as pending until the next sample verifies decay.
    if (!pendingPeakRef.current && buf.length >= NOISE_FLOOR_MIN_SAMPLES) {
      const noiseFlorDB = buf.reduce((a, b) => a + b, 0) / buf.length;
      const threshold = noiseFlorDB + TRANSIENT_THRESHOLD_DB;
      if (dBFS > threshold) {
        pendingPeakRef.current = {
          dBFS,
          threshold,
          offsetSec: (now - sessionStartRef.current) / 1000,
          timestamp: now,
        };
      }
    }

    // Step 3 — add the current sample to the rolling buffer for future
    // noise-floor calculation.
    buf.push(dBFS);
    if (buf.length > METER_BUFFER_SAMPLES) buf.shift();
  }, [phase]);

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
        const upload = {
          uploaded_at: Date.now(),
          taken_at: sessionStartRef.current,
          has_audio: true,
          duration_sec: durationSeconds,
          swinger: 'Me' as const,
          tag: 'cage' as const,
          notes: `${swingCount} swing${swingCount !== 1 ? 's' : ''} detected`,
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
          const reason = drill ? `cage_drill_${drill.id}` : 'cage_session';
          pointsMod.usePointsStore.getState().addPoints(10, reason);
        } catch (e) { console.log('[points] cage-end emit failed:', e); }
      }

      // Hand the LIBRARY entry id to the consumer (not the cageStorage
      // session id) so navigation lands on the swing detail screen which
      // is keyed by sessionHistory[].id.
      onComplete(libraryEntryId ?? session.id);
    }
  }, [phase, swingCount, stopMetering, onComplete, drill]);

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

      {/* Drill-info strip — only renders when this session was launched
          with a drill context. Shows drill name + current step so the
          player has structure inside the same surface as free practice.
          Tap the chevron to advance the step counter manually (mechanics
          are still free-detect; per-step prompts come in the follow-up). */}
      {drill && (
        <View style={styles.drillStrip}>
          <View style={{ flex: 1 }}>
            <Text style={styles.drillStripTitle} numberOfLines={1}>{drill.title}</Text>
            <Text style={styles.drillStripStep} numberOfLines={2}>
              {`Step ${Math.min(drillStepIdx + 1, drill.steps.length)} of ${drill.steps.length} · `}
              <Text style={styles.drillStripStepBody}>{drill.steps[Math.min(drillStepIdx, drill.steps.length - 1)]}</Text>
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setDrillStepIdx(i => (i + 1) % drill.steps.length)}
            style={styles.drillStripBtn}
            accessibilityRole="button"
            accessibilityLabel={`Advance to next step of ${drill.title} drill`}
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
