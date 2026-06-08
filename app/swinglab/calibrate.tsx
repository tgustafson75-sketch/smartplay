/**
 * 2026-06-07 — Acoustic calibration (10-strike flow).
 *
 * Tim's spec: a straight 10 ball strikes — at the range with the phone
 * near the strike, in the backyard, or recorded on the course. We meter
 * the audio, detect the strikes, derive this device/environment's noise
 * floor + transient threshold, and save it as the active calibration so
 * Smart Motion's open-window segmentation matches the user's real mic
 * distance and strike loudness.
 *
 * See memory acoustic-10-strike-calibration + smartmotion-quality-bar.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMicrophonePermissions } from 'expo-camera';
import { useTheme } from '../../contexts/ThemeContext';
import { startMeteredRecording, type MeteringHandle } from '../../services/swing/audioMetering';
import { detectStrikes, type DetectedStrike } from '../../services/swing/strikeDetector';
import { useAcousticCalibrationStore } from '../../store/acousticCalibrationStore';

const TARGET_STRIKES = 10;

type Env = 'range' | 'backyard' | 'course';
type Phase = 'idle' | 'recording' | 'done';

const ENVS: { key: Env; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'range', label: 'Range', icon: 'golf-outline' },
  { key: 'backyard', label: 'Backyard', icon: 'home-outline' },
  { key: 'course', label: 'Course', icon: 'flag-outline' },
];

export default function CalibrateAcoustics() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const saveSession = useAcousticCalibrationStore((s) => s.saveSession);
  const applyCalibration = useAcousticCalibrationStore((s) => s.applyCalibrationFromSession);
  const appliedCalibration = useAcousticCalibrationStore((s) => s.appliedCalibration);

  const [env, setEnv] = useState<Env>('range');
  const [phase, setPhase] = useState<Phase>('idle');
  const [liveDb, setLiveDb] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ floorDb: number; strikes: DetectedStrike[]; durationMs: number; sampleCount: number } | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const meteringRef = useRef<MeteringHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      void meteringRef.current?.cancel().catch(() => undefined);
    };
  }, []);

  const start = useCallback(async () => {
    if (!micPerm?.granted) {
      const r = await requestMicPerm();
      if (!r.granted) {
        Alert.alert('Microphone needed', 'Calibration listens to your ball strikes. Allow microphone access to record.');
        return;
      }
    }
    setResult(null);
    setWarn(null);
    setLiveDb(null);
    setElapsed(0);
    stoppingRef.current = false;
    setPhase('recording');
    try {
      meteringRef.current = await startMeteredRecording((s) => setLiveDb(s.dB));
    } catch (e) {
      setPhase('idle');
      Alert.alert('Could not start', e instanceof Error ? e.message : String(e));
      return;
    }
    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
  }, [micPerm, requestMicPerm]);

  const stop = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const handle = meteringRef.current;
    meteringRef.current = null;
    if (!handle) { setPhase('idle'); return; }
    let res;
    let durationMs = 0;
    let sampleCount = 0;
    try {
      const { samples, durationMs: dMs } = await handle.stop();
      durationMs = dMs;
      sampleCount = samples.length;
      res = detectStrikes(samples, { minRecordingMs: 1500 });
    } catch (e) {
      setPhase('idle');
      Alert.alert('Calibration failed', e instanceof Error ? e.message : String(e));
      return;
    }
    if (res.kind === 'too-short') {
      setWarn('That was too short — record 10 strikes over at least a few seconds.');
      setPhase('idle');
      return;
    }
    if (res.kind === 'noisy-environment') {
      setWarn('Too noisy to read cleanly. Move somewhere quieter or closer to the strike, then retry.');
      setPhase('idle');
      return;
    }
    setResult({ floorDb: res.floorDb, strikes: res.strikes, durationMs, sampleCount });
    setPhase('done');
  }, []);

  const saveAndApply = useCallback(() => {
    if (!result) return;
    const id = saveSession({
      durationMs: result.durationMs,
      floorDb: result.floorDb,
      autoDetected: result.strikes,
      corrected: result.strikes,
      sampleCount: result.sampleCount,
      notes: `10-strike calibration · ${env}`,
    });
    const ok = applyCalibration(id);
    if (ok) {
      Alert.alert('Calibrated', `Smart Motion is tuned to your ${env}. It will now detect your strikes automatically.`, [
        { text: 'Done', onPress: () => router.back() },
      ]);
    } else {
      setWarn('Could not derive a calibration from those strikes — try again with cleaner contact.');
    }
  }, [result, env, saveSession, applyCalibration, router]);

  const detectedCount = result?.strikes.length ?? 0;
  // dB meter fill — map [-60, 0] dBFS to [0, 1].
  const level = liveDb == null ? 0 : Math.max(0, Math.min(1, (liveDb + 60) / 60));

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text_primary }]}>Calibrate Acoustics</Text>
        <View style={{ width: 26 }} />
      </View>

      <Text style={[styles.sub, { color: colors.text_muted }]}>
        Take {TARGET_STRIKES} ball strikes with the phone near where you hit. Smart Motion learns your strike sound so it can count and split your swings automatically.
      </Text>

      {/* Environment */}
      <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>WHERE ARE YOU?</Text>
      <View style={styles.envRow}>
        {ENVS.map((e) => {
          const sel = e.key === env;
          return (
            <Pressable
              key={e.key}
              onPress={() => setEnv(e.key)}
              disabled={phase === 'recording'}
              style={[styles.envChip, { borderColor: sel ? colors.accent : colors.border, backgroundColor: sel ? colors.accent_muted : colors.surface_elevated }]}
            >
              <Ionicons name={e.icon} size={20} color={sel ? colors.accent : colors.text_muted} />
              <Text style={[styles.envLabel, { color: sel ? colors.accent : colors.text_secondary }]}>{e.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Counter / status */}
      <View style={[styles.counterCard, { backgroundColor: colors.surface_elevated, borderColor: phase === 'recording' ? colors.accent : colors.border }]}>
        {phase === 'done' ? (
          <>
            <Text style={[styles.counterBig, { color: colors.text_primary }]}>{detectedCount}</Text>
            <Text style={[styles.counterCaption, { color: colors.text_muted }]}>strikes detected (target {TARGET_STRIKES})</Text>
            <Text style={[styles.counterCaption, { color: colors.text_muted }]}>noise floor {Number.isFinite(result?.floorDb) ? result!.floorDb.toFixed(0) : '—'} dB</Text>
          </>
        ) : phase === 'recording' ? (
          <>
            <Text style={[styles.counterCaption, { color: colors.accent }]}>LISTENING · {elapsed}s</Text>
            <View style={[styles.meterTrack, { backgroundColor: colors.surface }]}>
              <View style={[styles.meterFill, { width: `${level * 100}%`, backgroundColor: colors.accent }]} />
            </View>
            <Text style={[styles.counterCaption, { color: colors.text_muted }]}>Hit your {TARGET_STRIKES} strikes, then tap Done</Text>
          </>
        ) : (
          <>
            <Ionicons name="pulse-outline" size={30} color={colors.text_muted} />
            <Text style={[styles.counterCaption, { color: colors.text_muted }]}>Tap Record, then take {TARGET_STRIKES} strikes</Text>
          </>
        )}
      </View>

      {warn ? <Text style={[styles.warn, { color: colors.warning }]}>{warn}</Text> : null}

      {appliedCalibration && phase === 'idle' ? (
        <Text style={[styles.applied, { color: colors.text_muted }]}>
          ✓ Active calibration: floor {appliedCalibration.noiseFloorDb.toFixed(0)} dB · threshold {appliedCalibration.transientThresholdDb} dB
        </Text>
      ) : null}

      <View style={{ flex: 1 }} />

      {/* Action */}
      {phase === 'recording' ? (
        <Pressable onPress={() => void stop()} style={[styles.btn, { backgroundColor: colors.error }]}>
          <Ionicons name="stop" size={18} color="#fff" />
          <Text style={styles.btnText}>Done</Text>
        </Pressable>
      ) : phase === 'done' ? (
        <View style={{ gap: 10 }}>
          <Pressable onPress={saveAndApply} disabled={detectedCount < 1} style={[styles.btn, { backgroundColor: detectedCount < 1 ? colors.border : colors.accent }]}>
            <Ionicons name="checkmark" size={18} color="#06281b" />
            <Text style={[styles.btnText, { color: '#06281b' }]}>Save & apply</Text>
          </Pressable>
          <Pressable onPress={() => void start()} style={[styles.btnOutline, { borderColor: colors.border }]}>
            <Ionicons name="refresh" size={16} color={colors.text_secondary} />
            <Text style={[styles.btnOutlineText, { color: colors.text_secondary }]}>Retake</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => void start()} style={[styles.btn, { backgroundColor: colors.accent }]}>
          {!micPerm ? <ActivityIndicator color="#06281b" /> : <Ionicons name="radio-button-on" size={18} color="#06281b" />}
          <Text style={[styles.btnText, { color: '#06281b' }]}>Record</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '900', letterSpacing: 0.4 },
  sub: { fontSize: 13, lineHeight: 19, fontWeight: '500', marginTop: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: 18, marginBottom: 8 },
  envRow: { flexDirection: 'row', gap: 8 },
  envChip: { flex: 1, alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 12, paddingVertical: 14 },
  envLabel: { fontSize: 13, fontWeight: '800' },
  counterCard: { marginTop: 18, borderWidth: 1, borderRadius: 16, paddingVertical: 26, paddingHorizontal: 16, alignItems: 'center', gap: 8 },
  counterBig: { fontSize: 56, fontWeight: '900', letterSpacing: -1 },
  counterCaption: { fontSize: 12, fontWeight: '600' },
  meterTrack: { width: '100%', height: 10, borderRadius: 5, overflow: 'hidden', marginVertical: 4 },
  meterFill: { height: '100%', borderRadius: 5 },
  warn: { fontSize: 12, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  applied: { fontSize: 11, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 14 },
  btnText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  btnOutline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderWidth: 1, borderRadius: 12 },
  btnOutlineText: { fontWeight: '800', fontSize: 14 },
});
