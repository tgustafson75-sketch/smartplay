/**
 * 2026-06-11 — Tempo Trainer (Tour Tempo style).
 *
 * Tank's idea, v1 (the "works best for now" piece): a fixed-ratio audio
 * metronome the player swings to. Three tones per swing at a 3:1
 * backswing:downswing ratio — tick (takeaway) · tick (top) · tock (strike) —
 * looped with a rest so you reset between reps. Pure audio + haptics; no
 * detection, no analysis dependency.
 *
 * NOTE: this plays tones through the speaker, so it is NOT meant to run during
 * CAGE acoustic capture (the strike mic would hear the tones). It's a standalone
 * drill — practice the beat here, or run it on headphones alongside a recording.
 *
 * The adaptive, event-driven version (tones tied to real ball-departure + smash,
 * which also restores honest range tempo) is the bigger follow-up — see memory
 * tempo-tones-idea.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useTheme } from '../../contexts/ThemeContext';

// Tour Tempo presets — frames at 30fps, ratio 3:1 (backswing:downswing).
const PRESETS = [
  { key: 'learn',    label: 'Learning', frames: '30/10', back: 1000, down: 333 },
  { key: 'smooth',   label: 'Smooth',   frames: '27/9',  back: 900,  down: 300 },
  { key: 'standard', label: 'Standard', frames: '24/8',  back: 800,  down: 267 },
  { key: 'quick',    label: 'Quick',    frames: '21/7',  back: 700,  down: 233 },
] as const;

const REST_MS = 2000; // pause between reps so the player can reset/re-address

type Beat = 'takeaway' | 'top' | 'strike' | null;

export default function TempoTrainerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [presetKey, setPresetKey] = useState<typeof PRESETS[number]['key']>('standard');
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState<Beat>(null);
  const [ready, setReady] = useState(false);

  const preset = PRESETS.find((p) => p.key === presetKey)!;

  const tickRef = useRef<Audio.Sound | null>(null);
  const tockRef = useRef<Audio.Sound | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const runningRef = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  // Load the two tones once.
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const tick = new Audio.Sound();
        await tick.loadAsync(require('../../assets/audio/tempo/tick.mp3'));
        const tock = new Audio.Sound();
        await tock.loadAsync(require('../../assets/audio/tempo/tock.mp3'));
        if (!mounted) { void tick.unloadAsync(); void tock.unloadAsync(); return; }
        tickRef.current = tick; tockRef.current = tock; setReady(true);
      } catch { /* tones just won't play; UI still renders */ }
    })();
    return () => {
      mounted = false;
      runningRef.current = false;
      timersRef.current.forEach(clearTimeout);
      void tickRef.current?.unloadAsync();
      void tockRef.current?.unloadAsync();
    };
  }, []);

  const flashPulse = useCallback((strong: boolean) => {
    pulse.setValue(strong ? 1 : 0.6);
    Animated.timing(pulse, { toValue: 0, duration: strong ? 280 : 200, useNativeDriver: true }).start();
  }, [pulse]);

  const playTick = useCallback(() => { void tickRef.current?.replayAsync().catch(() => undefined); }, []);
  const playTock = useCallback(() => { void tockRef.current?.replayAsync().catch(() => undefined); }, []);

  const scheduleCycle = useCallback((back: number, down: number) => {
    if (!runningRef.current) return;
    // beat 1 — takeaway
    setBeat('takeaway'); playTick(); flashPulse(false);
    const T = timersRef.current;
    // beat 2 — top
    T.push(setTimeout(() => { if (!runningRef.current) return; setBeat('top'); playTick(); flashPulse(false); }, back));
    // beat 3 — strike
    T.push(setTimeout(() => { if (!runningRef.current) return; setBeat('strike'); playTock(); flashPulse(true); }, back + down));
    // clear the highlight after the strike, then loop after the rest
    T.push(setTimeout(() => { if (runningRef.current) setBeat(null); }, back + down + 380));
    T.push(setTimeout(() => scheduleCycle(back, down), back + down + REST_MS));
  }, [playTick, playTock, flashPulse]);

  const start = useCallback(async () => {
    if (!ready) return;
    // 2026-06-11 (audit) — set the playback audio mode only when actually
    // starting (so merely visiting the screen doesn't change the app's global
    // audio session). playsInSilentModeIOS lets the tones be heard on silent.
    try { await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false, shouldDuckAndroid: true }); } catch { /* tones may be muted on silent */ }
    runningRef.current = true; setRunning(true);
    scheduleCycle(preset.back, preset.down);
  }, [ready, preset.back, preset.down, scheduleCycle]);

  const stop = useCallback(() => {
    runningRef.current = false; setRunning(false);
    timersRef.current.forEach(clearTimeout); timersRef.current = [];
    setBeat(null);
  }, []);

  // Stop the metronome when the app backgrounds (phone call, home button).
  // Without this, the recursive setTimeout loop keeps draining battery
  // and the audio session stays open against OS policy.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next !== 'active') stop();
    });
    return () => sub.remove();
  }, [stop]);

  // Changing the tempo while running restarts cleanly on the new ratio.
  const selectPreset = useCallback((k: typeof PRESETS[number]['key']) => {
    setPresetKey(k);
    if (runningRef.current) {
      timersRef.current.forEach(clearTimeout); timersRef.current = [];
      const p = PRESETS.find((x) => x.key === k)!;
      scheduleCycle(p.back, p.down);
    }
  }, [scheduleCycle]);

  const ratio = (preset.back / preset.down).toFixed(1);
  const beats: { key: Beat; label: string }[] = [
    { key: 'takeaway', label: 'TAKEAWAY' },
    { key: 'top', label: 'TOP' },
    { key: 'strike', label: 'STRIKE' },
  ];

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerIcon} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text_primary }]}>Tempo Trainer</Text>
        <View style={styles.headerIcon} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.sub, { color: colors.text_muted }]}>
          Swing to the beat — <Text style={{ color: colors.text_primary, fontWeight: '800' }}>tick</Text> takeaway,
          {' '}<Text style={{ color: colors.text_primary, fontWeight: '800' }}>tick</Text> top,
          {' '}<Text style={{ color: colors.accent, fontWeight: '800' }}>tock</Text> strike. A pro tempo is {ratio}:1.
        </Text>

        {/* Ratio readout + pulse ring */}
        <View style={styles.ratioWrap}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulseRing,
              { borderColor: colors.accent, opacity: pulse, transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }] },
            ]}
          />
          <Text style={[styles.ratioValue, { color: colors.accent }]}>{ratio}</Text>
          <Text style={[styles.ratioUnit, { color: colors.text_muted }]}>: 1</Text>
        </View>

        {/* Beat guide */}
        <View style={styles.beatRow}>
          {beats.map((b) => {
            const on = beat === b.key;
            const strike = b.key === 'strike';
            const c = on ? (strike ? colors.accent : colors.success) : colors.border;
            return (
              <View key={b.label} style={styles.beatItem}>
                <View style={[styles.beatDot, { backgroundColor: on ? c : 'transparent', borderColor: c }]} />
                <Text style={[styles.beatLabel, { color: on ? colors.text_primary : colors.text_muted }]}>{b.label}</Text>
              </View>
            );
          })}
        </View>

        {/* Tempo presets */}
        <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>TEMPO</Text>
        <View style={styles.presetRow}>
          {PRESETS.map((p) => {
            const sel = p.key === presetKey;
            return (
              <Pressable
                key={p.key}
                onPress={() => selectPreset(p.key)}
                style={[styles.presetChip, { borderColor: sel ? colors.accent : colors.border, backgroundColor: sel ? colors.accent_muted : 'transparent' }]}
                accessibilityRole="button"
                accessibilityLabel={`${p.label} tempo, ${p.frames}`}
              >
                <Text style={[styles.presetLabel, { color: sel ? colors.accent : colors.text_primary }]}>{p.label}</Text>
                <Text style={[styles.presetFrames, { color: colors.text_muted }]}>{p.frames}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Start / Stop */}
        <Pressable
          onPress={running ? stop : () => void start()}
          disabled={!ready}
          style={[styles.playBtn, { backgroundColor: running ? colors.error : colors.accent, opacity: ready ? 1 : 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel={running ? 'Stop tempo' : 'Start tempo'}
        >
          <Ionicons name={running ? 'stop' : 'play'} size={22} color="#06281b" />
          <Text style={styles.playBtnText}>{running ? 'Stop' : ready ? 'Start' : 'Loading…'}</Text>
        </Pressable>

        <Text style={[styles.foot, { color: colors.text_muted }]}>
          Tip: this plays through the speaker — use it as a standalone drill, or on headphones when recording in cage mode (so the strike mic will not hear the tones).
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  body: { flex: 1, paddingHorizontal: 24, alignItems: 'center' },
  sub: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  ratioWrap: { marginTop: 28, height: 150, width: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  pulseRing: { position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 3 },
  ratioValue: { fontSize: 64, fontWeight: '900' },
  ratioUnit: { fontSize: 22, fontWeight: '700', marginLeft: 4, marginBottom: 8, alignSelf: 'flex-end' },
  beatRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 24, paddingHorizontal: 20 },
  beatItem: { alignItems: 'center', gap: 8 },
  beatDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  beatLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, alignSelf: 'flex-start', marginTop: 34, marginBottom: 10 },
  presetRow: { flexDirection: 'row', gap: 8, width: '100%' },
  presetChip: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  presetLabel: { fontSize: 13, fontWeight: '800' },
  presetFrames: { fontSize: 10, marginTop: 2 },
  playBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 28, paddingVertical: 15, borderRadius: 14, alignSelf: 'stretch' },
  playBtnText: { color: '#06281b', fontSize: 17, fontWeight: '900' },
  foot: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 18 },
});
