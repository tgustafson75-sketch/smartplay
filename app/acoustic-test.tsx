import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, AppState, StyleSheet } from 'react-native';
import Svg, { Polyline, Line, Circle } from 'react-native-svg';
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

const MAX_SECONDS = 15;

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
        setStatus('ok');
      } else {
        setStrikes([]);
        setStatus(detection.kind);
      }
    } finally {
      stoppingRef.current = false;
      await configureAudioForSpeech().catch(() => undefined);
    }
  };

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
            {recording ? 'STOP' : 'RECORD (max 15s)'}
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

            {/* Waveform */}
            {samples.length >= 2 ? (
              <View style={styles.waveformWrap}>
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
                  {/* Strike markers */}
                  {strikes.map((s, i) => {
                    const minT = samples[0]!.timeMs;
                    const maxT = samples[samples.length - 1]!.timeMs;
                    const total = Math.max(1, maxT - minT);
                    const x = ((s.timeMs) / total) * 320;
                    return <Circle key={i} cx={x} cy={4} r={3} fill={theme.colors.error} />;
                  })}
                </Svg>
              </View>
            ) : null}

            {/* Strike list */}
            {strikes.length > 0 ? (
              <View style={styles.strikeList}>
                {strikes.map((s, i) => (
                  <Text key={i} style={styles.strikeRow}>
                    {i + 1}. {(s.timeMs / 1000).toFixed(2)}s · {Math.round(s.peakDb)} dB ·
                    {Math.round(s.attackMs)}ms attack · {s.confidence}
                  </Text>
                ))}
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
      </ScrollView>
    </SafeAreaView>
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
