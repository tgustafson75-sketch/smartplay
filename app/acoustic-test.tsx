import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, AppState, StyleSheet, PanResponder } from 'react-native';
import Svg, { Polyline, Line } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';
import AppIcon from '../components/AppIcon';
import {
  startMeteredRecording,
  type MeteringHandle,
} from '../services/swing/audioMetering';
import {
  detectStrikes,
  type DetectedStrike,
  type MeterSample,
} from '../services/swing/strikeDetector';
import { configureAudioForSpeech } from '../services/voiceService';
import { useAcousticCalibrationStore } from '../store/acousticCalibrationStore';

/**
 * Phase BO.1 — Acoustic Test Bench, ported from V3.
 *
 * Standalone screen to validate the audio-metering + strike-detection
 * pipeline WITHOUT needing a real range. Tap RECORD, clap or knock on a
 * table 3 times, tap STOP. The screen shows:
 *   - Live dB meter while recording
 *   - dB-vs-time waveform of the captured run
 *   - Floor dB
 *   - Detected strike count + per-strike timestamps
 *   - Detection status (ok / too-short / noisy-environment / audio-failed)
 *
 * Decouples device validation from range validation. If the metering
 * callback never fires on a device, or the detector returns 0 strikes
 * on 3 obvious claps, we know BEFORE driving to a range. Phase BO.2
 * will decide whether to wire the detector into a live capture flow
 * here in Pro.
 */

// 2026-05-26 — Fix BN: bumped 15s → 30s so a multi-swing batch
// session (Tim's intent: 5-10 swings at ~3s each) fits in a single
// recording. Reframes the bench from a single-impact test to a
// session capture — detectStrikes already returns multiple strikes
// per recording, so the screen renders all of them on the waveform
// + the numbered list below.
const MAX_SECONDS = 30;

export default function AcousticTestScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useStyles();
  const meteringRef = useRef<MeteringHandle | null>(null);
  const stoppingRef = useRef(false);

  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveDb, setLiveDb] = useState<number>(-160);
  const [samples, setSamples] = useState<MeterSample[]>([]);
  const [strikes, setStrikes] = useState<DetectedStrike[]>([]);
  const [floorDb, setFloorDb] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'ok' | 'too-short' | 'noisy-environment' | 'audio-failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  // 2026-05-26 — Fix BO: corrected-strikes editor + persist.
  // correctedStrikes starts as a copy of auto-detected strikes
  // (so unedited sessions save the detector's read as ground truth)
  // and tracks user adjustments: drag-to-correct timestamps, manual
  // adds, deletes. Saved as a CalibrationSession when the user taps
  // Save — these become the labeled dataset for tuning the detector.
  const [correctedStrikes, setCorrectedStrikes] = useState<DetectedStrike[]>([]);
  const [waveformWidthPx, setWaveformWidthPx] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const saveSession = useAcousticCalibrationStore(s => s.saveSession);
  const savedSessions = useAcousticCalibrationStore(s => s.sessions);
  const deleteSavedSession = useAcousticCalibrationStore(s => s.deleteSession);
  // 2026-05-28 — Fix FC: Apply-as-my-calibration wiring.
  const applyCalibration = useAcousticCalibrationStore(s => s.applyCalibrationFromSession);
  const clearAppliedCalibration = useAcousticCalibrationStore(s => s.clearAppliedCalibration);
  const appliedCalibration = useAcousticCalibrationStore(s => s.appliedCalibration);

  // Tick elapsed time during recording.
  useEffect(() => {
    if (!recording) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => clearInterval(id);
  }, [recording]);

  // App backgrounding stops the recording cleanly.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && recording) void onStop();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      void meteringRef.current?.cancel();
      // Release recording focus so subsequent TTS routes to speaker.
      void configureAudioForSpeech().catch(() => undefined);
    };
  }, []);

  // Auto-stop at MAX_SECONDS.
  useEffect(() => {
    if (!recording) return;
    if (elapsedMs >= MAX_SECONDS * 1000) {
      void onStop();
    }
    // onStop is intentionally excluded — it has no React-state deps that
    // would change its behavior between ticks; including it would
    // re-trigger this effect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, elapsedMs]);

  const onStart = async () => {
    setError(null);
    setSamples([]);
    setStrikes([]);
    setCorrectedStrikes([]);
    setFloorDb(null);
    setStatus('idle');
    try {
      meteringRef.current = await startMeteredRecording((sample) => {
        setLiveDb(sample.dB);
        setSamples((prev) => [...prev, sample]);
      });
      setRecording(true);
    } catch (e) {
      meteringRef.current = null;
      setError(`Mic init failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  const onStop = async () => {
    if (stoppingRef.current || !recording) return;
    stoppingRef.current = true;
    try {
      const handle = meteringRef.current;
      meteringRef.current = null;
      if (!handle) {
        setRecording(false);
        setStatus('audio-failed');
        return;
      }
      const result = await handle.stop();
      setRecording(false);
      if (result.samples.length === 0) {
        setStatus('audio-failed');
        return;
      }
      const detection = detectStrikes(result.samples);
      setSamples(result.samples);
      setFloorDb(detection.floorDb);
      if (detection.kind === 'ok') {
        setStrikes(detection.strikes);
        // 2026-05-26 — Fix BO: seed corrected with auto so an unedited
        // save preserves the detector's read as the labeled outcome.
        setCorrectedStrikes(detection.strikes.map(s => ({ ...s })));
        setStatus('ok');
      } else {
        setStrikes([]);
        setCorrectedStrikes([]);
        setStatus(detection.kind);
      }
    } finally {
      stoppingRef.current = false;
      await configureAudioForSpeech().catch(() => undefined);
    }
  };

  // 2026-05-26 — Fix BO: helpers for the slide-to-correct UI.
  const recordingDurationMs = useMemo(() => {
    if (samples.length < 2) return 0;
    return samples[samples.length - 1].timeMs - samples[0].timeMs;
  }, [samples]);

  /** Map a strike's timeMs to a pixel x-position on the waveform. */
  const strikeTimeToX = useCallback(
    (timeMs: number): number => {
      if (waveformWidthPx === 0 || recordingDurationMs === 0) return 0;
      const minT = samples[0]?.timeMs ?? 0;
      return ((timeMs - minT) / recordingDurationMs) * waveformWidthPx;
    },
    [waveformWidthPx, recordingDurationMs, samples],
  );

  /** Reverse: pixel x → timeMs. Clamped to recording bounds. */
  const xToStrikeTime = useCallback(
    (x: number): number => {
      if (waveformWidthPx === 0 || recordingDurationMs === 0) return 0;
      const minT = samples[0]?.timeMs ?? 0;
      const clampedX = Math.max(0, Math.min(waveformWidthPx, x));
      return minT + (clampedX / waveformWidthPx) * recordingDurationMs;
    },
    [waveformWidthPx, recordingDurationMs, samples],
  );

  const updateStrikeTime = useCallback((index: number, newTimeMs: number) => {
    setCorrectedStrikes(prev => {
      const next = [...prev];
      if (index >= 0 && index < next.length) {
        next[index] = { ...next[index], timeMs: newTimeMs };
      }
      return next;
    });
  }, []);

  const addManualStrike = useCallback(() => {
    if (recordingDurationMs === 0) return;
    const minT = samples[0]?.timeMs ?? 0;
    // Drop the new manual strike at the midpoint of the recording —
    // user drags it to the actual impact moment.
    const midTime = minT + recordingDurationMs / 2;
    const manualStrike: DetectedStrike = {
      timeMs: midTime,
      peakDb: floorDb != null ? floorDb + 20 : -20,
      attackMs: 0,
      confidence: 'low',
    };
    setCorrectedStrikes(prev =>
      [...prev, manualStrike].sort((a, b) => a.timeMs - b.timeMs),
    );
  }, [recordingDurationMs, samples, floorDb]);

  const deleteCorrectedStrike = useCallback((index: number) => {
    setCorrectedStrikes(prev => prev.filter((_, i) => i !== index));
  }, []);

  const onSaveCalibration = useCallback(() => {
    if (samples.length < 2) return;
    saveSession({
      durationMs: recordingDurationMs,
      floorDb: floorDb ?? -160,
      autoDetected: strikes.map(s => ({ ...s })),
      corrected: correctedStrikes.map(s => ({ ...s })),
      sampleCount: samples.length,
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }, [samples, recordingDurationMs, floorDb, strikes, correctedStrikes, saveSession]);

  // Build the waveform polyline from samples.
  const waveform = (() => {
    if (samples.length < 2) return '';
    const minTime = samples[0]!.timeMs;
    const maxTime = samples[samples.length - 1]!.timeMs;
    const width = 320;
    const height = 80;
    const points: string[] = [];
    for (const s of samples) {
      const x = ((s.timeMs - minTime) / Math.max(1, maxTime - minTime)) * width;
      // Map dB [-60, 0] to y [height, 0].
      const norm = Math.max(0, Math.min(1, (s.dB + 60) / 60));
      const y = height - norm * height;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return points.join(' ');
  })();

  const elapsedSec = Math.floor(elapsedMs / 1000);
  const meterFill = Math.max(0, Math.min(1, (liveDb + 60) / 60));

  const liveMeterColor =
    liveDb > -10 ? theme.colors.error :
    liveDb > -25 ? theme.colors.warning :
    theme.colors.accent;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backRow}>
          <AppIcon name="chevron-back" size={22} color={theme.colors.accent} />
          <Text style={styles.backText}>SwingLab</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>ACOUSTIC TEST BENCH</Text>
        <Text style={styles.title}>Validate the strike pipeline</Text>
        <Text style={styles.sub}>
          Tap RECORD, clap (or knock on a table) 3 times with brief pauses, tap STOP.
          You should see ≈3 strikes detected. If the live meter never moves, the
          metering callback isn&apos;t firing on this device.
        </Text>

        {/* Live indicator */}
        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>{recording ? `RECORDING — ${elapsedSec}s` : 'Idle'}</Text>
          <View style={styles.meterTrack}>
            <View
              style={[
                styles.meterFill,
                {
                  width: `${Math.round(meterFill * 100)}%`,
                  backgroundColor: liveMeterColor,
                },
              ]}
            />
          </View>
          <Text style={styles.dbText}>
            {recording ? `${Math.round(liveDb)} dB` : '— dB'}
          </Text>
        </View>

        <Pressable
          onPress={recording ? onStop : onStart}
          style={[styles.cta, { backgroundColor: recording ? theme.colors.error : theme.colors.accent }]}
        >
          <AppIcon
            name={recording ? 'stop' : 'mic'}
            size={20}
            color={theme.colors.background}
          />
          <Text style={[styles.ctaText, { color: theme.colors.background }]}>
            {recording ? 'STOP' : `RECORD (max ${MAX_SECONDS}s)`}
          </Text>
        </Pressable>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Result card */}
        {status !== 'idle' ? (
          <View style={styles.resultCard}>
            <Text style={styles.section}>RESULT</Text>
            <Text style={styles.statusText}>{statusLabel(status)}</Text>
            {floorDb != null ? (
              <Text style={styles.metaText}>Floor: {Math.round(floorDb)} dB · Samples: {samples.length}</Text>
            ) : null}
            {status === 'ok' ? (
              <Text style={[styles.strikeCountText, { color: theme.colors.accent }]}>
                {strikes.length} strike{strikes.length === 1 ? '' : 's'} detected
              </Text>
            ) : null}

            {/* Waveform with draggable strike markers (Fix BO).
                The Svg renders the waveform + auto-detected static
                strike circles for reference. The corrected (editable)
                strikes overlay as absolute-positioned Views with
                pan-responder for drag-to-correct + long-press to
                delete. */}
            {samples.length >= 2 ? (
              <View
                style={styles.waveformWrap}
                onLayout={(e) => setWaveformWidthPx(e.nativeEvent.layout.width)}
              >
                <Svg width="100%" height={80} viewBox="0 0 320 80" preserveAspectRatio="none">
                  {/* Floor reference line */}
                  {floorDb != null ? (
                    <Line
                      x1={0}
                      y1={80 - Math.max(0, Math.min(1, (floorDb + 60) / 60)) * 80}
                      x2={320}
                      y2={80 - Math.max(0, Math.min(1, (floorDb + 60) / 60)) * 80}
                      stroke={theme.colors.text_muted}
                      strokeWidth={0.5}
                      strokeDasharray="4 4"
                    />
                  ) : null}
                  <Polyline
                    points={waveform}
                    fill="none"
                    stroke={theme.colors.accent}
                    strokeWidth={1.2}
                  />
                </Svg>
                {/* Auto-detect ghost markers — show where the detector
                    originally landed so the user can see how far they
                    dragged. Behind the corrected markers. */}
                {strikes.map((s, i) => {
                  const x = strikeTimeToX(s.timeMs);
                  return (
                    <View
                      key={`auto-${i}`}
                      pointerEvents="none"
                      style={[
                        styles.autoStrikeStripe,
                        { left: x - 1, backgroundColor: theme.colors.text_muted },
                      ]}
                    />
                  );
                })}
                {/* Corrected markers — draggable, deletable. */}
                {correctedStrikes.map((s, i) => (
                  <DraggableStrike
                    key={`corr-${i}`}
                    x={strikeTimeToX(s.timeMs)}
                    color={theme.colors.error}
                    label={String(i + 1)}
                    onDrag={(dx) => updateStrikeTime(i, xToStrikeTime(strikeTimeToX(s.timeMs) + dx))}
                    onDelete={() => deleteCorrectedStrike(i)}
                  />
                ))}
              </View>
            ) : null}

            {/* Calibration action row — add manual / save corrected.
                Renders alongside the waveform when there's a session
                worth saving (≥ 2 samples). */}
            {samples.length >= 2 ? (
              <View style={styles.calibActionRow}>
                <Pressable
                  onPress={addManualStrike}
                  style={({ pressed }) => [
                    styles.calibBtn,
                    { borderColor: theme.colors.accent, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <AppIcon name="add" size={16} color={theme.colors.accent} />
                  <Text style={[styles.calibBtnText, { color: theme.colors.accent }]}>Add strike</Text>
                </Pressable>
                <Pressable
                  onPress={onSaveCalibration}
                  style={({ pressed }) => [
                    styles.calibBtn,
                    {
                      borderColor: theme.colors.accent,
                      backgroundColor: savedFlash ? theme.colors.accent : 'transparent',
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <AppIcon
                    name={savedFlash ? 'checkmark' : 'save-outline'}
                    size={16}
                    color={savedFlash ? theme.colors.background : theme.colors.accent}
                  />
                  <Text style={[
                    styles.calibBtnText,
                    { color: savedFlash ? theme.colors.background : theme.colors.accent },
                  ]}>
                    {savedFlash ? 'Saved' : 'Save calibration'}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* Strike list — reflects user corrections (Fix BO). */}
            {correctedStrikes.length > 0 ? (
              <View style={styles.strikeList}>
                {correctedStrikes.map((s, i) => (
                  <Text key={i} style={styles.strikeRow}>
                    {i + 1}. {(s.timeMs / 1000).toFixed(2)}s · {Math.round(s.peakDb)} dB ·
                    {Math.round(s.attackMs)}ms attack · {s.confidence}
                  </Text>
                ))}
              </View>
            ) : null}

            {/* 2026-05-26 — Fix BN: session summary stats. When the user
                runs a multi-swing batch (Tim's use case: 5-10 swings in
                one recording), the per-strike list above gets long.
                These three rolled-up stats give the at-a-glance read:
                consistency of peak dB (tighter = more repeatable
                contact), avg attack (cleaner = better strike), avg
                inter-strike gap (faster cadence = drill flow). */}
            {correctedStrikes.length >= 2 ? (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryHeader}>SESSION SUMMARY</Text>
                {(() => {
                  const avgPeakDb = correctedStrikes.reduce((a, s) => a + s.peakDb, 0) / correctedStrikes.length;
                  const avgAttack = correctedStrikes.reduce((a, s) => a + s.attackMs, 0) / correctedStrikes.length;
                  const gaps: number[] = [];
                  for (let i = 1; i < correctedStrikes.length; i++) {
                    gaps.push((correctedStrikes[i].timeMs - correctedStrikes[i - 1].timeMs) / 1000);
                  }
                  const avgGap = gaps.reduce((a, g) => a + g, 0) / gaps.length;
                  const peakRange = Math.max(...correctedStrikes.map(s => s.peakDb)) - Math.min(...correctedStrikes.map(s => s.peakDb));
                  return (
                    <>
                      <Text style={styles.summaryRow}>Avg peak: {Math.round(avgPeakDb)} dB (range {Math.round(peakRange)} dB)</Text>
                      <Text style={styles.summaryRow}>Avg attack: {Math.round(avgAttack)} ms</Text>
                      <Text style={styles.summaryRow}>Avg gap: {avgGap.toFixed(1)}s between swings</Text>
                    </>
                  );
                })()}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Diagnostic checklist */}
        <Text style={styles.section}>WHAT THIS PROVES</Text>
        <View style={styles.diagCard}>
          <DiagRow ok={samples.length > 0} text="Audio.Recording metering callback fires on this device" />
          <DiagRow
            ok={floorDb != null && floorDb < -30}
            text={floorDb != null && floorDb >= -30 ? `Environment too loud (floor ${Math.round(floorDb)} dB)` : 'Environment quiet enough for detection'}
          />
          <DiagRow ok={status === 'ok'} text="strikeDetector returns ok (samples >= 2s, valid floor)" />
          <DiagRow ok={strikes.length > 0} text="Detector finds at least 1 strike from your taps" />
        </View>

        {/* 2026-05-26 — Fix BO: saved calibration sessions list.
            Renders below the diag card. Each saved session shows
            counts (auto vs corrected) + a tap-to-delete. Persists
            across app restarts. */}
        {savedSessions.length > 0 ? (
          <>
            <Text style={styles.section}>SAVED CALIBRATIONS</Text>
            <View style={styles.savedListCard}>
              {[...savedSessions].reverse().slice(0, 10).map((session) => {
                const dt = new Date(session.capturedAt);
                const diff = session.corrected.length - session.autoDetected.length;
                // 2026-05-28 — Fix FC: highlight the session that's
                // currently feeding the live cage detector.
                const isActive = appliedCalibration?.sourceSessionId === session.id;
                return (
                  <View key={session.id} style={styles.savedRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.savedRowTitle}>
                        {dt.toLocaleDateString()} {dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        {isActive ? '  ✓ active' : ''}
                      </Text>
                      <Text style={styles.savedRowMeta}>
                        Auto {session.autoDetected.length} → Corrected {session.corrected.length}
                        {diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff})` : ''} ·
                        {' '}{(session.durationMs / 1000).toFixed(1)}s
                        {isActive && appliedCalibration ? ` · thresh ${appliedCalibration.transientThresholdDb}dB` : ''}
                      </Text>
                    </View>
                    {/* 2026-05-28 — Fix FC: per-session Apply button.
                        Promotes this session to the live cage detector's
                        active calibration. Hidden on the active session
                        (replaced by a Revert button so user can drop
                        back to the hardcoded defaults if needed). */}
                    {isActive ? (
                      <Pressable
                        onPress={() => clearAppliedCalibration()}
                        hitSlop={10}
                        style={({ pressed }) => [{
                          paddingHorizontal: 10, paddingVertical: 6,
                          borderRadius: 8, borderWidth: 1,
                          borderColor: theme.colors.text_muted,
                          marginRight: 8,
                          opacity: pressed ? 0.5 : 1,
                        }]}
                      >
                        <Text style={{ color: theme.colors.text_muted, fontSize: 11, fontWeight: '700' }}>Revert</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => applyCalibration(session.id)}
                        hitSlop={10}
                        style={({ pressed }) => [{
                          paddingHorizontal: 10, paddingVertical: 6,
                          borderRadius: 8, borderWidth: 1,
                          borderColor: theme.colors.accent,
                          backgroundColor: theme.colors.accent_muted,
                          marginRight: 8,
                          opacity: pressed ? 0.5 : 1,
                        }]}
                      >
                        <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: '700' }}>Apply</Text>
                      </Pressable>
                    )}
                    <Pressable
                      onPress={() => deleteSavedSession(session.id)}
                      hitSlop={10}
                      style={({ pressed }) => [styles.savedDeleteBtn, { opacity: pressed ? 0.5 : 1 }]}
                    >
                      <AppIcon name="trash-outline" size={16} color={theme.colors.text_muted} />
                    </Pressable>
                  </View>
                );
              })}
              {savedSessions.length > 10 ? (
                <Text style={styles.savedFooter}>
                  + {savedSessions.length - 10} older (auto-trimmed at 50)
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * 2026-05-26 — Fix BO: draggable strike marker overlay for the
 * acoustic test bench waveform. Sits absolutely over the SVG
 * waveform; PanResponder converts horizontal drag into a timestamp
 * adjustment via the parent's onDrag(dx) callback. Long-press
 * deletes (via onDelete). Number label inside so the user can
 * cross-reference with the per-strike list below.
 */
function DraggableStrike({
  x, color, label, onDrag, onDelete,
}: {
  x: number;
  color: string;
  label: string;
  onDrag: (dx: number) => void;
  onDelete: () => void;
}) {
  const startXRef = useRef(0);
  const styles = useStyles();
  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startXRef.current = 0;
      },
      onPanResponderMove: (_, g) => {
        const incremental = g.dx - startXRef.current;
        startXRef.current = g.dx;
        onDrag(incremental);
      },
      onPanResponderRelease: () => {
        startXRef.current = 0;
      },
    }),
    [onDrag],
  );

  return (
    <View
      {...panResponder.panHandlers}
      onTouchEnd={undefined}
      style={[
        styles.draggableStripe,
        { left: x - 9, backgroundColor: color },
      ]}
    >
      <Pressable
        onLongPress={onDelete}
        delayLongPress={400}
        hitSlop={6}
        style={styles.draggableHandle}
      >
        <Text style={styles.draggableLabel}>{label}</Text>
      </Pressable>
    </View>
  );
}

function statusLabel(s: 'idle' | 'ok' | 'too-short' | 'noisy-environment' | 'audio-failed'): string {
  switch (s) {
    case 'ok': return 'Detection completed';
    case 'too-short': return 'Recording too short (need >= 2s)';
    case 'noisy-environment': return 'Environment too loud — floor above -30 dB';
    case 'audio-failed': return 'Audio capture failed — no samples received';
    default: return '';
  }
}

function DiagRow({ ok, text }: { ok: boolean; text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.diagRow}>
      <AppIcon
        name={ok ? 'checkmark-circle' : 'ellipse-outline'}
        size={16}
        color={ok ? '#00C896' : '#9ca3af'}
      />
      <Text style={[styles.diagText, !ok && { color: '#9ca3af' }]}>{text}</Text>
    </View>
  );
}

// Inline V3's Space/Type/Radius scales as numeric literals so the screen
// keeps visual fidelity with V3 without depending on Pro's broader theme-token
// system (which uses different scales).
function useStyles() {
  const theme = useTheme();
  return useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.colors.background },
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 11,
          paddingVertical: 7,
        },
        backRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
        backText: { color: theme.colors.accent, fontSize: 16, fontWeight: '700' },
        body: { paddingHorizontal: 11, paddingBottom: 24, gap: 7 },
        eyebrow: { color: theme.colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
        title: { color: theme.colors.text_primary, fontSize: 22, fontWeight: '900' },
        sub: { color: theme.colors.text_muted, fontSize: 12, lineHeight: 18 },
        liveCard: {
          backgroundColor: theme.colors.surface_elevated,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 14,
          padding: 11,
          marginTop: 11,
          gap: 7,
        },
        liveLabel: {
          color: theme.colors.text_muted,
          fontSize: 11,
          fontWeight: '900',
          letterSpacing: 1.4,
        },
        meterTrack: {
          height: 12,
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderRadius: 6,
          overflow: 'hidden',
        },
        meterFill: { height: '100%', borderRadius: 6 },
        dbText: { color: theme.colors.text_primary, fontSize: 16, fontWeight: '900' },
        cta: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          paddingVertical: 11,
          borderRadius: 999,
          marginTop: 7,
        },
        ctaText: { fontSize: 16, fontWeight: '800' },
        errorCard: {
          backgroundColor: 'rgba(239,68,68,0.12)',
          borderColor: theme.colors.error,
          borderWidth: 1,
          borderRadius: 12,
          padding: 11,
          marginTop: 7,
        },
        errorText: { color: theme.colors.error, fontSize: 12, fontWeight: '700' },
        resultCard: {
          backgroundColor: theme.colors.surface_elevated,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 14,
          padding: 11,
          marginTop: 11,
          gap: 4,
        },
        section: {
          color: theme.colors.accent,
          fontSize: 11,
          fontWeight: '900',
          letterSpacing: 1.6,
          marginTop: 14,
        },
        statusText: { color: theme.colors.text_primary, fontSize: 14, fontWeight: '800' },
        metaText: { color: theme.colors.text_muted, fontSize: 11 },
        strikeCountText: { fontSize: 22, fontWeight: '900', marginTop: 4 },
        waveformWrap: {
          height: 80,
          backgroundColor: theme.colors.background,
          borderRadius: 8,
          overflow: 'hidden',
          marginTop: 4,
        },
        strikeList: { gap: 2, marginTop: 4 },
        strikeRow: { color: theme.colors.text_muted, fontSize: 11, fontFamily: 'Courier' },
        summaryCard: {
          marginTop: 12,
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accent_muted,
          gap: 3,
        },
        summaryHeader: {
          color: theme.colors.accent,
          fontSize: 10,
          fontWeight: '900',
          letterSpacing: 1,
          marginBottom: 4,
        },
        summaryRow: {
          color: theme.colors.text_primary,
          fontSize: 12,
          fontWeight: '600',
        },
        // 2026-05-26 — Fix BO: drag-to-correct + saved-sessions UI.
        autoStrikeStripe: {
          position: 'absolute',
          top: 0,
          width: 2,
          height: 80,
          opacity: 0.45,
        },
        draggableStripe: {
          position: 'absolute',
          top: -4,
          width: 18,
          height: 88,
          borderRadius: 4,
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingTop: 1,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.4,
          shadowRadius: 2,
          elevation: 3,
        },
        draggableHandle: {
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: 'rgba(0,0,0,0.55)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        draggableLabel: {
          color: '#ffffff',
          fontSize: 10,
          fontWeight: '900',
        },
        calibActionRow: {
          flexDirection: 'row',
          gap: 8,
          marginTop: 10,
        },
        calibBtn: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderRadius: 8,
          borderWidth: 1,
        },
        calibBtnText: {
          fontSize: 12,
          fontWeight: '800',
          letterSpacing: 0.3,
        },
        savedListCard: {
          marginTop: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          paddingVertical: 4,
        },
        savedRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          gap: 8,
        },
        savedRowTitle: {
          color: theme.colors.text_primary,
          fontSize: 13,
          fontWeight: '700',
        },
        savedRowMeta: {
          color: theme.colors.text_muted,
          fontSize: 11,
          marginTop: 1,
        },
        savedDeleteBtn: {
          padding: 4,
        },
        savedFooter: {
          color: theme.colors.text_muted,
          fontSize: 10,
          fontStyle: 'italic',
          paddingHorizontal: 12,
          paddingVertical: 6,
        },
        diagCard: {
          backgroundColor: theme.colors.surface_elevated,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 14,
          padding: 11,
          gap: 7,
        },
        diagRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
        },
        diagText: { flex: 1, color: theme.colors.text_primary, fontSize: 12 },
      }),
    [theme],
  );
}
