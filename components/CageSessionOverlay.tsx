import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import {
  createSession,
  endSession,
  addClipEvent,
  finalizeClips,
  getSessionDir,
} from '../services/cageStorage';
import type { CageSession } from '../types/cage';

// ─── Constants ────────────────────────────────────────────────────────────────

const METER_INTERVAL_MS = 100;
const METER_BUFFER_SAMPLES = 20; // 2 seconds at 100ms
const TRANSIENT_THRESHOLD_DB = 14; // noise_floor + 14 dB ≈ 5x linear
const DEBOUNCE_MS = 1500;
const NOISE_FLOOR_MIN_SAMPLES = 5;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  onComplete: (sessionId: string) => void;
  onCancel: () => void;
}

type Phase = 'requesting' | 'preview' | 'recording' | 'ending';

// ─── Component ────────────────────────────────────────────────────────────────

export default function CageSessionOverlay({ onComplete, onCancel }: Props) {
  const { width } = useWindowDimensions();
  const isFoldOpen = width > 500;

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
  const isMountedRef = useRef(true);

  // Portrait lock — cage recording must be vertical for correct video framing
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    return () => { ScreenOrientation.unlockAsync(); };
  }, []);

  // ─── Permissions ──────────────────────────────────────────────────────────

  useEffect(() => {
    isMountedRef.current = true;
    (async () => {
      // Camera
      if (!cameraPermission?.granted) {
        const result = await requestCameraPermission();
        if (!result.granted) {
          onCancel();
          return;
        }
      }
      // Microphone (for expo-av metering recording)
      const micResult = await Audio.requestPermissionsAsync();
      if (!isMountedRef.current) return;
      if (!micResult.granted) {
        // Can continue without metering; manual-only
        console.warn('[CageSession] Microphone permission denied — manual detection only');
        setMeterAvailable(false);
      }
      setPhase('preview');
    })();

    return () => {
      isMountedRef.current = false;
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
    } catch (e) {
      console.warn('[CageSession] Audio metering failed to start — manual detection only:', e);
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

    // Compute noise floor from existing buffer (before adding new sample)
    if (buf.length >= NOISE_FLOOR_MIN_SAMPLES) {
      const noiseFlorDB = buf.reduce((a, b) => a + b, 0) / buf.length;
      const threshold = noiseFlorDB + TRANSIENT_THRESHOLD_DB;

      if (dBFS > threshold) {
        const now = Date.now();
        if (now - lastDetectionRef.current > DEBOUNCE_MS) {
          lastDetectionRef.current = now;
          if (sessionRef.current) {
            const offset = (now - sessionStartRef.current) / 1000;
            addClipEvent(sessionRef.current.id, offset, 'audio_transient');
            if (isMountedRef.current) {
              setSwingCount((c) => c + 1);
            }
            console.log(`[CageSession] Auto-detected swing @ ${offset.toFixed(1)}s (${dBFS.toFixed(1)} dBFS vs threshold ${threshold.toFixed(1)})`);
          }
        }
      }
    }

    // Add to rolling buffer
    buf.push(dBFS);
    if (buf.length > METER_BUFFER_SAMPLES) buf.shift();
  }, []);

  // ─── Start Session ─────────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    if (!cameraRef.current) return;
    setPhase('recording');

    try {
      // Create session record
      const session = await createSession();
      sessionRef.current = session;
      sessionStartRef.current = Date.now();

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
    } catch (e) {
      console.error('[CageSession] Failed to start session:', e);
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
  }, [phase]);

  // ─── End Session ───────────────────────────────────────────────────────────

  const handleEndSession = useCallback(async () => {
    if (!sessionRef.current || phase !== 'recording') return;
    const session = sessionRef.current;
    setPhase('ending');

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const durationSeconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);

    // Stop camera recording
    cameraRef.current?.stopRecording();
    let masterVideoPath = '';
    try {
      const result = await videoPromiseRef.current;
      if (result?.uri) {
        // Move temp file to session directory
        const sessionDir = await getSessionDir(session.id);
        masterVideoPath = sessionDir + 'master.mp4';
        await FileSystem.moveAsync({ from: result.uri, to: masterVideoPath });
      }
    } catch (e) {
      console.error('[CageSession] Error saving master video:', e);
    }

    // Stop metering
    await stopMetering();

    // Finalize storage
    await endSession(session.id, masterVideoPath);
    await finalizeClips(session.id, durationSeconds);

    console.log(`[CageSession] Session ended. Duration: ${durationSeconds}s, Swings: ${swingCount}, Video: ${masterVideoPath}`);

    if (isMountedRef.current) {
      onComplete(session.id);
    }
  }, [phase, swingCount, stopMetering, onComplete]);

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
      <SafeAreaView style={styles.container}>
        <View style={styles.previewHeader}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelBtnText}>✕ Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.previewTitle}>Cage Session</Text>
          <TouchableOpacity
            style={styles.flipBtn}
            onPress={() => setCameraFacing((f) => (f === 'back' ? 'front' : 'back'))}
          >
            <Text style={styles.flipBtnText}>⇄ Flip</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.cameraPreviewBox, isFoldOpen && styles.cameraPreviewBoxWide]}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={cameraFacing}
            mode="video"
          />
          <View style={styles.cameraOverlayHint}>
            <Text style={styles.cameraOverlayHintText}>
              Point at your swing. Place the phone on the cage floor or shelf.
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
          <Text style={styles.startBtnIcon}>⏺</Text>
          <Text style={styles.startBtnText}>Start Recording</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ─── Render: Recording or Ending ───────────────────────────────────────────

  const isEnding = phase === 'ending';

  return (
    <SafeAreaView style={styles.container}>
      {/* Recording indicator + timer */}
      <View style={styles.timerRow}>
        <View style={styles.recDot} />
        <Text style={styles.timerText}>{formatTime(elapsedSeconds)}</Text>
        {!meterAvailable && (
          <Text style={styles.manualOnlyBadge}>Manual only</Text>
        )}
      </View>

      {/* Swing count */}
      <View style={styles.swingCountBox}>
        <Text style={styles.swingCountNum}>{swingCount}</Text>
        <Text style={styles.swingCountLabel}>
          {swingCount === 1 ? 'swing detected' : 'swings detected'}
        </Text>
      </View>

      {/* Small camera preview (so Tim can verify angle before putting phone down) */}
      <View style={[styles.livePreviewBox, isFoldOpen && styles.livePreviewBoxWide]}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={cameraFacing}
          mode="video"
        />
        <View style={styles.liveOverlay}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
          <TouchableOpacity
            style={styles.smallFlipBtn}
            onPress={() => setCameraFacing((f) => (f === 'back' ? 'front' : 'back'))}
            disabled={isEnding}
          >
            <Text style={styles.smallFlipText}>⇄</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.instructionText}>
        Put the phone down and hit balls.{'\n'}Tap below if auto-detect misses one.
      </Text>

      {/* Log swing button */}
      <TouchableOpacity
        style={[styles.logSwingBtn, isEnding && styles.btnDisabled]}
        onPress={handleLogSwing}
        disabled={isEnding}
        activeOpacity={0.75}
      >
        <Text style={styles.logSwingIcon}>🏌️</Text>
        <Text style={styles.logSwingText}>Log swing</Text>
      </TouchableOpacity>

      {/* End session button */}
      <TouchableOpacity
        style={[styles.endBtn, isEnding && styles.btnDisabled]}
        onPress={handleEndSession}
        disabled={isEnding}
        activeOpacity={0.8}
      >
        <Text style={styles.endBtnText}>
          {isEnding ? 'Saving session…' : 'End Session'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },

  requestingText: {
    color: '#6b7280',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 80,
  },

  // Preview phase
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 16,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelBtnText: {
    color: '#6b7280',
    fontSize: 14,
  },
  previewTitle: {
    color: '#e8f5e9',
    fontSize: 18,
    fontWeight: '700',
  },
  flipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#0a2a1a',
    borderRadius: 8,
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
    minHeight: 280,
    maxHeight: 460,
    position: 'relative',
  },
  cameraPreviewBoxWide: {
    maxHeight: 380,
  },
  cameraOverlayHint: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
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
    borderRadius: 8,
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
    paddingVertical: 20,
    marginTop: 16,
    gap: 10,
  },
  startBtnIcon: {
    fontSize: 22,
    color: '#060f09',
  },
  startBtnText: {
    color: '#060f09',
    fontSize: 20,
    fontWeight: '800',
  },

  // Recording phase
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 16,
    paddingBottom: 8,
    gap: 10,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  timerText: {
    color: '#e8f5e9',
    fontSize: 36,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
  manualOnlyBadge: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: '#2a1a00',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },

  swingCountBox: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  swingCountNum: {
    color: '#00C896',
    fontSize: 64,
    fontWeight: '800',
    lineHeight: 72,
    fontVariant: ['tabular-nums'],
  },
  swingCountLabel: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 2,
  },

  livePreviewBox: {
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginVertical: 12,
    position: 'relative',
  },
  livePreviewBoxWide: {
    height: 200,
  },
  liveOverlay: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
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
  },
  smallFlipBtn: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  smallFlipText: {
    color: '#e8f5e9',
    fontSize: 14,
  },

  instructionText: {
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
  },

  logSwingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a2a1a',
    borderRadius: 14,
    paddingVertical: 22,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#00C89644',
    gap: 10,
  },
  logSwingIcon: {
    fontSize: 26,
  },
  logSwingText: {
    color: '#e8f5e9',
    fontSize: 22,
    fontWeight: '700',
  },

  endBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3b0d0d',
    borderRadius: 14,
    paddingVertical: 20,
    borderWidth: 2,
    borderColor: '#ef444444',
  },
  endBtnText: {
    color: '#fca5a5',
    fontSize: 20,
    fontWeight: '700',
  },

  btnDisabled: {
    opacity: 0.4,
  },
});
