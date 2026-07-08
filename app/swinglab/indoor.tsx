/**
 * 2026-07-07 (Tim — "build the indoor and hotel mode... I wanna try it tonight").
 *
 * HOTEL MODE — phone-in-hand tempo practice for the road. No camera, no space, no
 * setup: grip the phone like a club (or palm it for putting), take swings, and the
 * gyroscope reads TEMPO, TRANSITION, and RHYTHM CONSISTENCY at ~100Hz. The purest
 * expression of the north star: the phone's own sensors, anywhere, in the dark.
 *
 * HONEST envelope (docs/indoor-hotel-mode-eval.md): rhythm & tempo only — no
 * clubhead speed, no ball flight, ever. Reps feed the SAME CNS tendencies as the
 * range (recordSwingMetrics) + practice points, so hotel nights build the one tempo
 * picture the caddie cites everywhere.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Gyroscope } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import {
  IndoorRepDetector, summarizeIndoorReps, INDOOR_CONFIG,
  type IndoorMode, type IndoorRep,
} from '../../services/indoorSwing';
import { usePracticePointsStore } from '../../store/practicePointsStore';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { useCaddieMemoryStore } from '../../store/caddieMemoryStore';
import { useToastStore } from '../../store/toastStore';

const NEON = '#88F700';

type Stage = 'intro' | 'live' | 'summary';

export default function IndoorHotelModeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [mode, setMode] = useState<IndoorMode>('swing');
  const [stage, setStage] = useState<Stage>('intro');
  const [reps, setReps] = useState<IndoorRep[]>([]);
  const repsRef = useRef<IndoorRep[]>([]);
  const detectorRef = useRef<IndoorRepDetector | null>(null);
  const subRef = useRef<{ remove: () => void } | null>(null);
  const savedRef = useRef(false);

  // Pulsing ring while listening — the "I'm watching" heartbeat.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (stage !== 'live') return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [stage, pulse]);

  const stopSensor = useCallback(() => {
    try { subRef.current?.remove(); } catch { /* already removed */ }
    subRef.current = null;
  }, []);

  const start = useCallback(() => {
    setReps([]);
    repsRef.current = [];
    savedRef.current = false;
    detectorRef.current = new IndoorRepDetector(mode);
    setStage('live');
    try {
      Gyroscope.setUpdateInterval(10); // ~100Hz — the whole point of IMU tempo
      subRef.current = Gyroscope.addListener((s) => {
        const rep = detectorRef.current?.onSample({ t: Date.now(), x: s.x, y: s.y, z: s.z }) ?? null;
        if (rep) {
          repsRef.current = [...repsRef.current, rep];
          setReps(repsRef.current);
          // Tactile "got it" tick the instant a rep reads — eyes stay off the screen.
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      });
    } catch {
      useToastStore.getState().show('Couldn\'t start the motion sensor on this device.');
      setStage('intro');
    }
  }, [mode]);

  // Finish → summary + credit (points, practice history, CNS tempo tendencies).
  const finish = useCallback(() => {
    stopSensor();
    setStage('summary');
    const set = repsRef.current;
    if (set.length === 0 || savedRef.current) return;
    savedRef.current = true;
    try {
      const label = mode === 'swing' ? 'Hotel Tempo' : 'Hotel Putting';
      const pts = usePracticePointsStore.getState().awardPracticePoints({
        key: `indoor:${mode}`, label, swings: set.length, now: Date.now(),
      });
      usePracticeSessionStore.getState().recordCompletedSession({
        kind: 'focus', focus: `indoor_${mode}`, label,
        swingCount: set.length, environment: 'indoor',
        swingSamples: set.map((r) => ({ club: null, tier: 'none' as const, tempoRatio: r.tempoRatio, divergenceDeg: null })),
      });
      // One brain: hotel reps build the SAME rolling tempo picture as the range.
      const mem = useCaddieMemoryStore.getState();
      for (const r of set) mem.recordSwingMetrics({ tempoRatio: r.tempoRatio, nowMs: Date.now() });
      useToastStore.getState().show(`Logged · +${pts} practice points`);
    } catch { /* crediting is additive — never blocks the summary */ }
  }, [mode, stopSensor]);

  // Leaving the screen mid-set still credits what was done (never lose reps).
  useEffect(() => () => {
    stopSensor();
    if (repsRef.current.length > 0 && !savedRef.current) {
      savedRef.current = true;
      try {
        const set = repsRef.current;
        const label = mode === 'swing' ? 'Hotel Tempo' : 'Hotel Putting';
        usePracticePointsStore.getState().awardPracticePoints({ key: `indoor:${mode}`, label, swings: set.length, now: Date.now() });
        usePracticeSessionStore.getState().recordCompletedSession({
          kind: 'focus', focus: `indoor_${mode}`, label, swingCount: set.length, environment: 'indoor',
          swingSamples: set.map((r) => ({ club: null, tier: 'none' as const, tempoRatio: r.tempoRatio, divergenceDeg: null })),
        });
      } catch { /* additive */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => summarizeIndoorReps(reps, mode), [reps, mode]);
  const last = reps.length > 0 ? reps[reps.length - 1] : null;
  const benchmark = INDOOR_CONFIG[mode].benchmark;
  const s = makeStyles(colors);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.1] });

  return (
    <SafeAreaView style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => { stopSensor(); router.back(); }} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={s.title}>HOTEL MODE</Text>
          <Text style={s.subtitle}>tempo anywhere · no ball needed</Text>
        </View>
        <View style={{ width: 26 }} />
      </View>

      {/* Mode toggle */}
      <View style={s.toggleRow}>
        {(['swing', 'putt'] as IndoorMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[s.toggleBtn, mode === m && s.toggleBtnActive]}
            onPress={() => { if (stage === 'intro') setMode(m); }}
            disabled={stage !== 'intro'}
            accessibilityRole="button"
            accessibilityLabel={m === 'swing' ? 'Full swing mode' : 'Putting mode'}
          >
            <Ionicons name={m === 'swing' ? 'golf-outline' : 'flag-outline'} size={15} color={mode === m ? '#0b1220' : '#9aa5b1'} />
            <Text style={[s.toggleText, mode === m && s.toggleTextActive]}>{m === 'swing' ? 'FULL SWING' : 'PUTTING'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {stage === 'intro' ? (
        <View style={s.centerWrap}>
          <View style={s.holdCard}>
            <Ionicons name="phone-portrait-outline" size={40} color={NEON} />
            <Text style={s.holdTitle}>{mode === 'swing' ? 'Grip the phone like a club' : 'Lay the phone in your lead palm'}</Text>
            <Text style={s.holdText}>
              {mode === 'swing'
                ? 'Both hands, screen facing out, arms relaxed. Take real-speed practice swings — I\'ll read every one.'
                : 'Grip it lightly like a putter and make real strokes. I\'ll read the rhythm and whether you accelerate through.'}
            </Text>
          </View>
          <TouchableOpacity style={s.startBtn} onPress={start} accessibilityRole="button" accessibilityLabel="Start">
            <Text style={s.startBtnText}>START</Text>
          </TouchableOpacity>
          <Text style={s.honestLine}>Rhythm & tempo only — no ball flight is claimed indoors.</Text>
        </View>
      ) : stage === 'live' ? (
        <View style={s.centerWrap}>
          {/* Pulsing listening ring + the live tempo readout */}
          <View style={s.ringWrap}>
            <Animated.View style={[s.ringPulse, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
            <View style={s.ringCore}>
              {last ? (
                <>
                  <Text style={s.tempoBig}>{last.tempoRatio.toFixed(1)}<Text style={s.tempoUnit}> : 1</Text></Text>
                  <Text style={s.tempoBench}>benchmark {benchmark.toFixed(0)}:1</Text>
                </>
              ) : (
                <Text style={s.waitingText}>{mode === 'swing' ? 'SWING WHEN READY' : 'STROKE WHEN READY'}</Text>
              )}
            </View>
          </View>

          {/* Last-rep detail chips */}
          {last ? (
            <View style={s.chipRow}>
              <View style={[s.chip, last.transition === 'smooth' ? s.chipGood : last.transition === 'quick' ? s.chipWarn : s.chipBad]}>
                <Text style={s.chipText}>{last.transition === 'smooth' ? 'SMOOTH TOP' : last.transition === 'quick' ? 'QUICK TOP' : 'SNATCHED'}</Text>
              </View>
              {mode === 'putt' && last.throughStroke ? (
                <View style={[s.chip, last.throughStroke === 'accelerating' ? s.chipGood : s.chipBad]}>
                  <Text style={s.chipText}>{last.throughStroke === 'accelerating' ? 'ACCELERATING' : 'DECEL — CLASSIC MISS'}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Rep dots */}
          <View style={s.dotsRow}>
            {reps.map((r, i) => (
              <View key={i} style={[s.dot, { backgroundColor: r.transition === 'snatched' ? '#ef4444' : NEON }]} />
            ))}
          </View>
          <Text style={s.repCount}>{reps.length} {reps.length === 1 ? 'rep' : 'reps'}</Text>

          <TouchableOpacity style={s.doneBtn} onPress={finish} accessibilityRole="button" accessibilityLabel="Finish set">
            <Text style={s.doneBtnText}>DONE — READ MY SET</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={s.headline}>{summary.headline}</Text>

          <View style={s.statGrid}>
            <View style={s.statCard}>
              <Text style={s.statValue}>{summary.avgTempo != null ? `${summary.avgTempo.toFixed(1)}:1` : '—'}</Text>
              <Text style={s.statLabel}>AVG TEMPO · bench {benchmark.toFixed(0)}:1</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statValue}>{summary.consistency != null ? `${summary.consistency}` : '—'}</Text>
              <Text style={s.statLabel}>CONSISTENCY / 100</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statValue}>{summary.reps}</Text>
              <Text style={s.statLabel}>REPS READ</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statValue}>{summary.smoothCount}/{summary.reps}</Text>
              <Text style={s.statLabel}>SMOOTH TRANSITIONS</Text>
            </View>
          </View>

          {mode === 'putt' && summary.decelCount != null && summary.reps > 0 ? (
            <View style={[s.holdCard, { marginTop: 14 }]}>
              <Text style={s.holdTitle}>{summary.decelCount === 0 ? 'Accelerating through — that\'s the stroke.' : `${summary.decelCount} of ${summary.reps} decelerated into the ball`}</Text>
              <Text style={s.holdText}>Decel is the classic three-putt move. Shorter backstroke, accelerate through the strike.</Text>
            </View>
          ) : null}

          {/* Per-rep strip */}
          {reps.length > 0 ? (
            <View style={{ marginTop: 14 }}>
              <Text style={s.sectionLabel}>EVERY REP</Text>
              {reps.map((r, i) => (
                <View key={i} style={s.repRow}>
                  <Text style={s.repIdx}>{i + 1}</Text>
                  <Text style={s.repTempo}>{r.tempoRatio.toFixed(1)}:1</Text>
                  <Text style={s.repDetail}>{Math.round(r.backswingMs)}ms / {Math.round(r.downswingMs)}ms</Text>
                  <Text style={[s.repTrans, { color: r.transition === 'smooth' ? NEON : r.transition === 'quick' ? '#F0C030' : '#ef4444' }]}>
                    {r.transition.toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <TouchableOpacity style={[s.startBtn, { marginTop: 20 }]} onPress={start} accessibilityRole="button" accessibilityLabel="Run another set">
            <Text style={s.startBtnText}>RUN IT BACK</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={() => { stopSensor(); router.back(); }} accessibilityRole="button" accessibilityLabel="Done">
            <Text style={s.ghostBtnText}>Done for tonight</Text>
          </TouchableOpacity>
          <Text style={s.honestLine}>Rhythm & tempo only — no ball flight is claimed indoors. Reps feed your caddie&apos;s one tempo picture.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: '#060f09' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
    title: { color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: 2.5 },
    subtitle: { color: '#9aa5b1', fontSize: 11, marginTop: 2 },
    toggleRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginTop: 6 },
    toggleBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
    toggleBtnActive: { backgroundColor: NEON, borderColor: NEON },
    toggleText: { color: '#9aa5b1', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    toggleTextActive: { color: '#0b1220' },
    centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    holdCard: { alignItems: 'center', backgroundColor: 'rgba(136,247,0,0.06)', borderWidth: 1, borderColor: 'rgba(136,247,0,0.35)', borderRadius: 18, padding: 22, gap: 10 },
    holdTitle: { color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
    holdText: { color: '#c2cbd4', fontSize: 14, lineHeight: 20, textAlign: 'center' },
    startBtn: { marginTop: 22, backgroundColor: NEON, borderRadius: 30, paddingVertical: 16, paddingHorizontal: 60 },
    startBtnText: { color: '#0b1220', fontWeight: '900', fontSize: 16, letterSpacing: 2 },
    honestLine: { color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 16, paddingHorizontal: 10 },
    ringWrap: { width: 250, height: 250, alignItems: 'center', justifyContent: 'center' },
    ringPulse: { position: 'absolute', width: 230, height: 230, borderRadius: 115, borderWidth: 2, borderColor: NEON },
    ringCore: { width: 200, height: 200, borderRadius: 100, borderWidth: 2, borderColor: 'rgba(136,247,0,0.7)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,15,9,0.6)' },
    tempoBig: { color: '#fff', fontSize: 54, fontWeight: '900' },
    tempoUnit: { color: NEON, fontSize: 26, fontWeight: '900' },
    tempoBench: { color: '#9aa5b1', fontSize: 12, marginTop: 2 },
    waitingText: { color: NEON, fontSize: 15, fontWeight: '900', letterSpacing: 1.6, textAlign: 'center' },
    chipRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
    chip: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
    chipGood: { borderColor: NEON, backgroundColor: 'rgba(136,247,0,0.12)' },
    chipWarn: { borderColor: '#F0C030', backgroundColor: 'rgba(240,192,48,0.12)' },
    chipBad: { borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.12)' },
    chipText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
    dotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 18, maxWidth: 260, justifyContent: 'center' },
    dot: { width: 10, height: 10, borderRadius: 5 },
    repCount: { color: '#9aa5b1', fontSize: 13, marginTop: 8 },
    doneBtn: { marginTop: 22, borderWidth: 1.5, borderColor: NEON, borderRadius: 26, paddingVertical: 13, paddingHorizontal: 40 },
    doneBtnText: { color: NEON, fontWeight: '900', fontSize: 14, letterSpacing: 1.4 },
    headline: { color: '#fff', fontSize: 19, fontWeight: '800', lineHeight: 26 },
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
    statCard: { width: '47.5%', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: 14, alignItems: 'center' },
    statValue: { color: NEON, fontSize: 26, fontWeight: '900' },
    statLabel: { color: '#9aa5b1', fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginTop: 4, textAlign: 'center' },
    sectionLabel: { color: '#9aa5b1', fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 },
    repRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
    repIdx: { color: '#6b7280', fontSize: 12, width: 18, fontWeight: '800' },
    repTempo: { color: '#fff', fontSize: 15, fontWeight: '800', width: 62 },
    repDetail: { color: '#9aa5b1', fontSize: 12, flex: 1 },
    repTrans: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
    ghostBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 12 },
    ghostBtnText: { color: '#9aa5b1', fontSize: 14, fontWeight: '700' },
  });
}
