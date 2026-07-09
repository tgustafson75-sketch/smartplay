/**
 * 2026-06-11 — Tempo Trainer (Tour Tempo style).
 * 2026-07-08 — Reworked into a "Choose Your Training Mode" selector (Tim): a clean
 *   card menu — 3:1 Full Swing trainer, 2:1 Short Game trainer, and GolfFather
 *   personal swing analysis — modeled on the intuitive tempo layout, rendered in
 *   OUR product language (dark surface, neon-green #88F700 accent, persona-brand
 *   feel). The metronome engine below is unchanged; the menu just picks its ratio.
 *
 * Tank's idea, v1 (the "works best for now" piece): a fixed-ratio audio metronome
 * the player swings to. Three tones per swing — tick (takeaway) · tick (top) ·
 * tock (strike) — looped with a rest so you reset between reps. Pure audio +
 * haptics; no detection, no analysis dependency.
 *
 * NOTE: this plays tones through the speaker, so it is NOT meant to run during CAGE
 * acoustic capture (the strike mic would hear the tones). Standalone drill, or on
 * headphones alongside a recording.
 *
 * The adaptive, event-driven version (tones tied to real ball-departure + smash) is
 * the bigger follow-up — see memory tempo-tones-idea.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, AppState, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useTheme } from '../../contexts/ThemeContext';

// Canonical SmartPlay neon green — the brand accent (mirrors colors.accent, pinned
// here for the ratio badges so they read the same in either theme).
const NEON = '#88F700';
const GOLD = '#E8B23A';

type TrainerMode = 'full' | 'short';

// Full-swing presets — Tour Tempo, 30fps, 3:1 (backswing:downswing).
const FULL_PRESETS = [
  { key: 'learn',    label: 'Learning', frames: '30/10', back: 1000, down: 333 },
  { key: 'smooth',   label: 'Smooth',   frames: '27/9',  back: 900,  down: 300 },
  { key: 'standard', label: 'Standard', frames: '24/8',  back: 800,  down: 267 },
  { key: 'quick',    label: 'Quick',    frames: '21/7',  back: 700,  down: 233 },
] as const;

// Short-game presets — 2:1 (a shorter, quieter motion; chips/pitches/bunker/putt-style).
const SHORT_PRESETS = [
  { key: 'learn',    label: 'Learning', frames: '20/10', back: 667, down: 333 },
  { key: 'smooth',   label: 'Smooth',   frames: '18/9',  back: 600, down: 300 },
  { key: 'standard', label: 'Standard', frames: '16/8',  back: 533, down: 267 },
  { key: 'quick',    label: 'Quick',    frames: '14/7',  back: 467, down: 233 },
] as const;

const REST_MS = 2000; // pause between reps so the player can reset/re-address

type Beat = 'takeaway' | 'top' | 'strike' | null;

// ─── The mode-selection cards (the "Choose Your Training Mode" screen) ───────────
const MODE_CARDS: {
  key: TrainerMode;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  ratio: string;
  blurb: string;
  chips: string[];
}[] = [
  {
    key: 'full',
    icon: 'trending-up',
    title: '3:1 Full Swing Tempo Trainer',
    ratio: '3:1',
    blurb: 'For driver, irons, hybrids, fairway woods, and full wedges.',
    chips: ['Driver', 'Irons', 'Hybrids', 'Fairway Woods', 'Full Wedges'],
  },
  {
    key: 'short',
    icon: 'flag',
    title: '2:1 Short Game Tempo Trainer',
    ratio: '2:1',
    blurb: 'For chips, pitches, partial wedges, bunker shots, and putting-style strokes.',
    chips: ['Chips', 'Pitches', 'Partial Wedges', 'Bunker Shots', 'Putting-style'],
  },
];

export default function TempoTrainerScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  // 'menu' = the mode selector; 'full'/'short' = the running metronome for that mode.
  const [mode, setMode] = useState<'menu' | TrainerMode>('menu');
  const presets = mode === 'short' ? SHORT_PRESETS : FULL_PRESETS;
  const [presetKey, setPresetKey] = useState<string>('standard');
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState<Beat>(null);
  const [ready, setReady] = useState(false);

  const preset = presets.find((p) => p.key === presetKey) ?? presets[2];

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
    // 2026-06-11 (audit) — set the playback audio mode only when actually starting
    // (so merely visiting the screen doesn't change the app's global audio session).
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
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next !== 'active') stop();
    });
    return () => sub.remove();
  }, [stop]);

  // Changing the tempo while running restarts cleanly on the new ratio.
  const selectPreset = useCallback((k: string) => {
    setPresetKey(k);
    if (runningRef.current) {
      timersRef.current.forEach(clearTimeout); timersRef.current = [];
      const p = presets.find((x) => x.key === k) ?? presets[2];
      scheduleCycle(p.back, p.down);
    }
  }, [presets, scheduleCycle]);

  // Enter a trainer from the menu; leaving a trainer stops it and returns to the menu.
  const openMode = useCallback((m: TrainerMode) => { setPresetKey('standard'); setMode(m); }, []);
  const backToMenu = useCallback(() => { stop(); setMode('menu'); }, [stop]);

  const ratio = (preset.back / preset.down).toFixed(1);
  const beats: { key: Beat; label: string }[] = [
    { key: 'takeaway', label: 'TAKEAWAY' },
    { key: 'top', label: mode === 'short' ? 'HINGE' : 'TOP' },
    { key: 'strike', label: 'STRIKE' },
  ];

  // ─── MENU: Choose Your Training Mode ──────────────────────────────────────────
  if (mode === 'menu') {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerIcon} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text_primary }]}>Tempo Trainer & Analysis</Text>
          <View style={styles.headerIcon} />
        </View>

        <ScrollView contentContainerStyle={styles.menuBody} showsVerticalScrollIndicator={false}>
          <Text style={[styles.h1, { color: colors.text_primary }]}>Choose your training mode</Text>
          <Text style={[styles.h1sub, { color: colors.text_muted }]}>
            Pick a tempo trainer to swing to the beat, or let your caddie read your real swing.
          </Text>

          {MODE_CARDS.map((card) => (
            <Pressable
              key={card.key}
              onPress={() => openMode(card.key)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.surface, borderColor: NEON, opacity: pressed ? 0.9 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={card.title}
            >
              <View style={styles.cardTop}>
                <View style={[styles.cardIcon, { backgroundColor: 'rgba(136,247,0,0.12)' }]}>
                  <Ionicons name={card.icon} size={22} color={NEON} />
                </View>
                <Text style={[styles.cardTitle, { color: colors.text_primary }]}>{card.title}</Text>
                <View style={[styles.ratioBadge, { backgroundColor: 'rgba(136,247,0,0.14)', borderColor: NEON }]}>
                  <Text style={[styles.ratioBadgeText, { color: NEON }]}>{card.ratio}</Text>
                </View>
              </View>
              <Text style={[styles.cardBlurb, { color: colors.text_muted }]}>{card.blurb}</Text>
              <View style={styles.chipRow}>
                {card.chips.map((chip) => (
                  <View key={chip} style={[styles.chip, { borderColor: colors.border }]}>
                    <Text style={[styles.chipText, { color: colors.text_muted }]}>{chip}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
          ))}

          {/* GolfFather personal swing analysis — the premium, AI-read tier (routes to the
              real honest tempo analysis, Smart Tempo). Gold-accented to read as premium. */}
          <Pressable
            onPress={() => router.push('/swinglab/smart-tempo' as never)}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: colors.surface, borderColor: GOLD, opacity: pressed ? 0.9 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="GolfFather personal swing analysis"
          >
            <View style={styles.cardTop}>
              <View style={[styles.cardIcon, { backgroundColor: 'rgba(232,178,58,0.14)' }]}>
                <Ionicons name="ribbon" size={22} color={GOLD} />
              </View>
              <Text style={[styles.cardTitle, { color: colors.text_primary }]}>GolfFather Personal Swing Analysis</Text>
              <View style={[styles.ratioBadge, { backgroundColor: 'rgba(232,178,58,0.16)', borderColor: GOLD }]}>
                <Text style={[styles.ratioBadgeText, { color: GOLD }]}>PREMIUM</Text>
              </View>
            </View>
            <Text style={[styles.cardBlurb, { color: colors.text_muted }]}>
              Record a swing and your caddie reads YOUR real tempo, positions, and the fault
              that&apos;s costing you — no guessing, only what the swing actually shows.
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── TRAINER: the metronome for the chosen mode ───────────────────────────────
  const modeTitle = mode === 'short' ? 'Short Game Tempo' : 'Full Swing Tempo';
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={backToMenu} hitSlop={10} style={styles.headerIcon} accessibilityLabel="Back to training modes">
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text_primary }]}>{modeTitle}</Text>
        <View style={styles.headerIcon} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.sub, { color: colors.text_muted }]}>
          Swing to the beat — <Text style={{ color: colors.text_primary, fontWeight: '800' }}>tick</Text> takeaway,
          {' '}<Text style={{ color: colors.text_primary, fontWeight: '800' }}>tick</Text> {mode === 'short' ? 'hinge' : 'top'},
          {' '}<Text style={{ color: colors.accent, fontWeight: '800' }}>tock</Text> strike. Target tempo {ratio}:1.
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
          {presets.map((p) => {
            const sel = p.key === presetKey;
            return (
              <Pressable
                key={p.key}
                onPress={() => selectPreset(p.key)}
                style={[styles.presetChip, { borderColor: sel ? colors.accent : colors.border, backgroundColor: sel ? colors.accent_muted : 'transparent' }]}
                accessibilityRole="button"
                accessibilityLabel={`${p.label} tempo, ${p.frames}`}
              >
                <Text style={[styles.presetLabel, { color: sel ? colors.accent : colors.text_primary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{p.label}</Text>
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
          Tip: this plays through the speaker — use it standalone, or on headphones when recording in cage mode (so the strike mic won&apos;t hear the tones).
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '900', letterSpacing: 0.2 },

  // Menu
  menuBody: { paddingHorizontal: 18, paddingBottom: 32 },
  h1: { fontSize: 26, fontWeight: '900', letterSpacing: 0.2, marginTop: 6 },
  h1sub: { fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 18 },
  card: { borderWidth: 1.5, borderRadius: 18, padding: 16, marginBottom: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '800', lineHeight: 21 },
  ratioBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  ratioBadgeText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  cardBlurb: { fontSize: 13, lineHeight: 19, marginTop: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 11, fontWeight: '700' },

  // Trainer
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
  presetChip: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center' },
  presetLabel: { fontSize: 13, fontWeight: '800' },
  presetFrames: { fontSize: 10, marginTop: 2 },
  playBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 28, paddingVertical: 15, borderRadius: 14, alignSelf: 'stretch' },
  playBtnText: { color: '#06281b', fontSize: 17, fontWeight: '900' },
  foot: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 18 },
});
