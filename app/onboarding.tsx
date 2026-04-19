import { useState, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Animated,
  KeyboardAvoidingView, Platform, Share, Image, ScrollView,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useUserStore } from '../store/userStore';
import { useSettingsStore } from '../store/settingsStore';
import { useBagStore, DEFAULT_DISTANCES } from '../store/bagStore';
import { CLUB_DEFS } from '../features/onboarding/data/clubs';
import type { ClubName } from '../types/club';

type Goal = 'enjoy' | 'break100' | 'break90' | 'break80';

const GOAL_OPTIONS: { value: Goal; emoji: string; label: string; sub: string; color: string }[] = [
  { value: 'enjoy',    emoji: '😊', label: 'Just Enjoy',  sub: 'No scorecards, just fun',        color: '#4ade80' },
  { value: 'break100', emoji: '🌱', label: 'Break 100',   sub: 'New to the game, building habits', color: '#60a5fa' },
  { value: 'break90',  emoji: '🎯', label: 'Break 90',    sub: 'Getting consistent, fewer blow-ups', color: '#a78bfa' },
  { value: 'break80',  emoji: '🔥', label: 'Break 80',    sub: 'Dialing in every shot',           color: '#fb923c' },
];

// Steps: 0=welcome 1=handicap 2=goal 3=bag 4=distances 5=ready
const TOTAL_STEPS = 6;

// Default clubs pre-selected for a typical bag
const DEFAULT_SELECTED: ClubName[] = ['Driver','3W','5I','6I','7I','8I','9I','PW','SW'];

export default function OnboardingScreen() {
  const router = useRouter();
  const storeDisplayName = useUserStore((s) => s.displayName);
  const storeFirstName = useUserStore((s) => s.firstName);
  const displayName = storeDisplayName || storeFirstName || 'Golfer';
  const setHandicap = useUserStore((s) => s.setHandicap);
  const setGoal = useUserStore((s) => s.setGoal);
  const setOnboardingComplete = useUserStore((s) => s.setOnboardingComplete);
  const setPlayerMode = useSettingsStore((s) => s.setPlayerMode);

  const { setSelectedClubs, setClubDistances, setBagSetupDone } = useBagStore();

  const [step, setStep] = useState(0);
  const [handicapInput, setHandicapInput] = useState('');
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);

  // Bag setup state
  const [bagClubs, setBagClubs]           = useState<ClubName[]>(DEFAULT_SELECTED);
  // Distance inputs — keyed by ClubName, values are string for TextInput
  const [distInputs, setDistInputs]       = useState<Partial<Record<ClubName, string>>>({});

  const slideAnim = useRef(new Animated.Value(0)).current;

  const animateNext = (nextStep: number) => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -30, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
    setStep(nextStep);
  };

  const handleHandicapNext = () => {
    const hcp = parseFloat(handicapInput);
    if (!isNaN(hcp) && hcp >= 0 && hcp <= 54) setHandicap(hcp);
    animateNext(2);
  };

  const handleGoalNext = () => {
    if (!selectedGoal) return;
    setGoal(selectedGoal);
    const modeMap: Record<Goal, 'beginner' | 'break90' | 'break80'> = {
      enjoy: 'beginner', break100: 'beginner', break90: 'break90', break80: 'break80',
    };
    setPlayerMode(modeMap[selectedGoal]);
    animateNext(3);
  };

  const toggleClub = (name: ClubName) => {
    setBagClubs((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]
    );
  };

  const handleBagNext = () => {
    // Pre-fill distance inputs with defaults for selected clubs
    const defaults: Partial<Record<ClubName, string>> = {};
    bagClubs.forEach((c) => {
      defaults[c] = String(DEFAULT_DISTANCES[c]);
    });
    setDistInputs(defaults);
    animateNext(4);
  };

  const handleDistancesNext = () => {
    // Persist to bag store
    const distances: Partial<Record<ClubName, number>> = {};
    bagClubs.forEach((c) => {
      const val = parseInt(distInputs[c] ?? '', 10);
      distances[c] = isNaN(val) ? DEFAULT_DISTANCES[c] : val;
    });
    setSelectedClubs(bagClubs);
    setClubDistances(distances);
    setBagSetupDone(true);
    animateNext(5);
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message:
          "I'm improving my golf game with SmartPlay Caddie 🏌️\n\n" +
          'It gives real-time club recommendations, tracks my shots, and coaches me on-course.\n\n' +
          "I've been playing smarter — try it free!",
        title: 'SmartPlay Caddie',
      });
    } catch { /* user dismissed */ }
  };

  const handleFinish = () => {
    setOnboardingComplete(true);
    router.replace('/(tabs)/caddie');
  };

  const progressWidth = ((step + 1) / TOTAL_STEPS) * 100;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: `${progressWidth}%` as any }]} />
      </View>

      <Animated.View style={[styles.stepWrap, { transform: [{ translateY: slideAnim }] }]}>

        {/* ── Step 0: Welcome ─────────────────────────────────────────────── */}
        {step === 0 && (
          <View style={styles.step}>
            <Image
              source={require('../assets/images/logo.png')}
              style={styles.logo}
              resizeMode="cover"
            />
            <Text style={styles.heading}>Welcome,{'\n'}{displayName} 👋</Text>
            <Text style={styles.sub}>{"Let's set up your caddie in"}{`\n`}under 30 seconds.</Text>
            <View style={styles.bullets}>
              {['Personalised club selection', 'Shot tracking & patterns', 'Real-time coaching'].map((b) => (
                <View key={b} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>●</Text>
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              ))}
            </View>
            <Pressable style={styles.btnPrimary} onPress={() => animateNext(1)}>
              <Text style={styles.btnPrimaryText}>Get Started →</Text>
            </Pressable>
          </View>
        )}

        {/* ── Step 1: Handicap ────────────────────────────────────────────── */}
        {step === 1 && (
          <View style={styles.step}>
            <Text style={styles.emoji}>⛳</Text>
            <Text style={styles.heading}>{"What's your handicap?"}</Text>
            <Text style={styles.sub}>Used to pick the right clubs{'\n'}and calibrate your caddie.</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 18"
              placeholderTextColor="#555"
              keyboardType="decimal-pad"
              value={handicapInput}
              onChangeText={setHandicapInput}
              autoFocus
              maxLength={5}
            />
            <Pressable style={styles.btnPrimary} onPress={handleHandicapNext}>
              <Text style={styles.btnPrimaryText}>Next →</Text>
            </Pressable>
            <Pressable style={styles.btnSkip} onPress={() => animateNext(2)}>
              <Text style={styles.btnSkipText}>Skip for now</Text>
            </Pressable>
          </View>
        )}

        {/* ── Step 2: Goal ─────────────────────────────────────────────────── */}
        {step === 2 && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.step} keyboardShouldPersistTaps="handled">
            <Text style={styles.emoji}>🏆</Text>
            <Text style={styles.heading}>{"What's your goal"}{`\n`}this season?</Text>
            <Text style={styles.sub}>Your caddie adapts its advice{'\n'}to match your ambition.</Text>
            <View style={styles.goalGrid}>
              {GOAL_OPTIONS.map((g) => (
                <Pressable
                  key={g.value}
                  style={[
                    styles.goalCard,
                    selectedGoal === g.value && { borderColor: g.color, backgroundColor: `${g.color}18` },
                  ]}
                  onPress={() => setSelectedGoal(g.value)}
                >
                  <Text style={styles.goalEmoji}>{g.emoji}</Text>
                  <Text style={[styles.goalLabel, selectedGoal === g.value && { color: g.color }]}>{g.label}</Text>
                  <Text style={styles.goalSub}>{g.sub}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={[styles.btnPrimary, !selectedGoal && styles.btnDisabled]}
              onPress={handleGoalNext}
              disabled={!selectedGoal}
            >
              <Text style={styles.btnPrimaryText}>Next →</Text>
            </Pressable>
          </ScrollView>
        )}

        {/* ── Step 3: Bag Setup ────────────────────────────────────────────── */}
        {step === 3 && (
          <View style={styles.step}>
            <Text style={styles.emoji}>🎒</Text>
            <Text style={styles.heading}>{"What's in{'\n'}your bag?"}</Text>
            <Text style={styles.sub}>Tap to select the clubs you carry.{'\n'}Your caddie will only recommend these.</Text>

            {/* Club grid — 2 columns */}
            <ScrollView style={{ alignSelf: 'stretch', maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {CLUB_DEFS.map((club) => {
                  const active = bagClubs.includes(club.name);
                  return (
                    <Pressable
                      key={club.name}
                      onPress={() => toggleClub(club.name)}
                      style={{
                        width: '44%', paddingVertical: 12, paddingHorizontal: 10,
                        borderRadius: 12, borderWidth: 1.5,
                        borderColor: active ? '#4ade80' : '#1e3a28',
                        backgroundColor: active ? '#0d3a1d' : '#0e1f14',
                        flexDirection: 'row', alignItems: 'center', gap: 8,
                      }}
                    >
                      <Text style={{ fontSize: 18 }}>{club.icon}</Text>
                      <View>
                        <Text style={{ color: active ? '#4ade80' : '#d1fae5', fontSize: 14, fontWeight: '700' }}>
                          {club.name}
                        </Text>
                        <Text style={{ color: '#6b7280', fontSize: 11 }}>{club.defaultDistance} yds</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={{ color: '#6b7280', fontSize: 12 }}>{bagClubs.length} clubs selected</Text>
            <Pressable
              style={[styles.btnPrimary, bagClubs.length === 0 && styles.btnDisabled]}
              onPress={handleBagNext}
              disabled={bagClubs.length === 0}
            >
              <Text style={styles.btnPrimaryText}>Next →</Text>
            </Pressable>
          </View>
        )}

        {/* ── Step 4: Club Distances ────────────────────────────────────────── */}
        {step === 4 && (
          <View style={[styles.step, { justifyContent: 'flex-start', paddingTop: 16 }]}>
            <Text style={styles.emoji}>📏</Text>
            <Text style={styles.heading}>Your carry{'\n'}distances</Text>
            <Text style={styles.sub}>Edit any that look wrong.{'\n'}These improve automatically as you play.</Text>

            <ScrollView style={{ alignSelf: 'stretch', maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {bagClubs.map((club) => {
                const def = CLUB_DEFS.find((c) => c.name === club);
                return (
                  <View
                    key={club}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      marginBottom: 8, paddingHorizontal: 4,
                    }}
                  >
                    <Text style={{ fontSize: 16, marginRight: 8 }}>{def?.icon ?? '⛳'}</Text>
                    <Text style={{ color: '#d1fae5', fontSize: 15, fontWeight: '700', flex: 1 }}>{club}</Text>
                    <TextInput
                      style={styles.distInput}
                      keyboardType="number-pad"
                      value={distInputs[club] ?? String(DEFAULT_DISTANCES[club])}
                      onChangeText={(v) => setDistInputs((prev) => ({ ...prev, [club]: v }))}
                      maxLength={3}
                      selectTextOnFocus
                    />
                    <Text style={{ color: '#6b7280', fontSize: 12, marginLeft: 4 }}>yds</Text>
                  </View>
                );
              })}
            </ScrollView>

            <Pressable style={styles.btnPrimary} onPress={handleDistancesNext}>
              <Text style={styles.btnPrimaryText}>Save & Continue →</Text>
            </Pressable>
          </View>
        )}

        {/* ── Step 5: Share + Finish ───────────────────────────────────────── */}
        {step === 5 && (
          <View style={styles.step}>
            <Text style={styles.emoji}>🎉</Text>
            <Text style={styles.heading}>{"You're all set,"}{'\n'}{displayName}!</Text>
            <Text style={styles.sub}>Your caddie knows your bag{'\n'}and is ready to coach.</Text>

            {/* Summary */}
            <View style={styles.summaryCard}>
              {handicapInput !== '' && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryIcon}>⛳</Text>
                  <Text style={styles.summaryText}>Handicap: {handicapInput}</Text>
                </View>
              )}
              {selectedGoal && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryIcon}>{GOAL_OPTIONS.find((g) => g.value === selectedGoal)?.emoji}</Text>
                  <Text style={styles.summaryText}>Goal: {GOAL_OPTIONS.find((g) => g.value === selectedGoal)?.label}</Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryIcon}>🎒</Text>
                <Text style={styles.summaryText}>{bagClubs.length} clubs in bag</Text>
              </View>
            </View>

            <Pressable style={styles.btnShare} onPress={handleShare}>
              <Text style={styles.btnShareText}>📣  Spread the Word</Text>
              <Text style={styles.btnShareSub}>{'"Play smarter with SmartPlay Caddie"'}</Text>
            </Pressable>

            <Pressable style={styles.btnPrimary} onPress={handleFinish}>
              <Text style={styles.btnPrimaryText}>Start Playing →</Text>
            </Pressable>
          </View>
        )}

      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#060e0a',
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#1a2a1e',
    width: '100%',
  },
  progressFill: {
    height: 4,
    backgroundColor: '#4ade80',
    borderRadius: 2,
  },
  stepWrap: {
    flex: 1,
  },
  step: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 40,
    paddingTop: 20,
    gap: 14,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 999,
    marginBottom: 4,
  },
  emoji: {
    fontSize: 52,
    marginBottom: 4,
  },
  heading: {
    color: '#f0fdf4',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 36,
  },
  sub: {
    color: '#86efac',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  bullets: {
    alignSelf: 'stretch',
    gap: 8,
    marginVertical: 8,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bulletDot: {
    color: '#4ade80',
    fontSize: 10,
  },
  bulletText: {
    color: '#d1fae5',
    fontSize: 15,
  },
  input: {
    backgroundColor: '#111',
    color: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#2d5a3e',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
    marginVertical: 4,
  },
  distInput: {
    backgroundColor: '#111',
    color: '#4ade80',
    borderWidth: 1,
    borderColor: '#2d5a3e',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    width: 56,
  },
  goalGrid: {
    width: '100%',
    gap: 10,
    marginVertical: 4,
  },
  goalCard: {
    backgroundColor: '#0e1f14',
    borderWidth: 1.5,
    borderColor: '#1e3a28',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  goalEmoji: {
    fontSize: 26,
    width: 32,
    textAlign: 'center',
  },
  goalLabel: {
    color: '#d1fae5',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  goalSub: {
    color: '#6b7280',
    fontSize: 11,
    flex: 2,
    textAlign: 'right',
  },
  summaryCard: {
    backgroundColor: '#0e1f14',
    borderWidth: 1,
    borderColor: '#2d5a3e',
    borderRadius: 14,
    padding: 16,
    alignSelf: 'stretch',
    gap: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  summaryIcon: {
    fontSize: 18,
  },
  summaryText: {
    color: '#d1fae5',
    fontSize: 15,
    fontWeight: '600',
  },
  btnPrimary: {
    backgroundColor: '#16a34a',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 4,
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  btnDisabled: {
    backgroundColor: '#1a2a1e',
  },
  btnSkip: {
    paddingVertical: 10,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  btnSkipText: {
    color: '#4b5563',
    fontSize: 13,
  },
  btnShare: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 4,
  },
  btnShareText: {
    color: '#a5b4fc',
    fontSize: 16,
    fontWeight: '700',
  },
  btnShareSub: {
    color: '#6366f1',
    fontSize: 12,
    fontStyle: 'italic',
  },
});
