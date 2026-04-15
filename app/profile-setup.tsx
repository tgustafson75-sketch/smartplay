import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { usePlayerProfileStore, buildInitialPracticePlan } from '../store/playerProfileStore';
import type { TypicalMiss, BiggestStruggle, BigStrength, PhysicalLimitation } from '../store/playerProfileStore';

const STEPS = [
  {
    key: 'miss' as const,
    question: "What's your typical miss?",
    subtitle: 'Where the ball tends to end up most often',
    options: [
      { value: 'left' as TypicalMiss,     label: '← Left',     desc: 'Pulls, hooks, or smothered shots' },
      { value: 'straight' as TypicalMiss, label: '• Straight',  desc: 'Pretty consistent ball flight' },
      { value: 'right' as TypicalMiss,    label: '→ Right',     desc: 'Slices, pushes, or fades' },
    ],
  },
  {
    key: 'struggle' as const,
    question: 'Where do you struggle most?',
    subtitle: 'Your caddie will give extra attention here',
    options: [
      { value: 'driver' as BiggestStruggle,     label: 'Driver',      desc: 'Off-the-tee inconsistency' },
      { value: 'irons' as BiggestStruggle,      label: 'Irons',       desc: 'Approach shots to the green' },
      { value: 'short-game' as BiggestStruggle, label: 'Short Game',  desc: 'Chipping and pitching' },
      { value: 'putting' as BiggestStruggle,    label: 'Putting',     desc: 'Greens and lag putts' },
      { value: 'mental' as BiggestStruggle,     label: 'Mental Game', desc: 'Decision-making under pressure' },
    ],
  },
  {
    key: 'strength' as const,
    question: "What's your biggest strength?",
    subtitle: "Your caddie will lean on this during the round",
    options: [
      { value: 'distance' as BigStrength,    label: 'Distance',    desc: 'Power off the tee' },
      { value: 'accuracy' as BigStrength,    label: 'Accuracy',    desc: 'Hitting your intended targets' },
      { value: 'short-game' as BigStrength,  label: 'Short Game',  desc: 'Saves and up-and-downs' },
      { value: 'putting' as BigStrength,     label: 'Putting',     desc: 'Holing out and lag control' },
      { value: 'consistency' as BigStrength, label: 'Consistency', desc: 'Rarely make big mistakes' },
    ],
  },
  {
    key: 'physical' as const,
    question: 'Any physical limitations?',
    subtitle: 'Your caddie will adjust advice accordingly',
    options: [
      { value: 'back' as PhysicalLimitation,     label: 'Back',      desc: 'Lower back or hip issues' },
      { value: 'shoulder' as PhysicalLimitation, label: 'Shoulder',  desc: 'Rotator cuff or AC joint' },
      { value: 'knee' as PhysicalLimitation,     label: 'Knee',      desc: 'Stability or rotation issues' },
      { value: 'none' as PhysicalLimitation,     label: 'None',      desc: "Feeling good" },
    ],
  },
] as const;

type StepKey = typeof STEPS[number]['key'];

export default function ProfileSetupScreen() {
  const router = useRouter();
  const {
    setTypicalMiss,
    setBiggestStruggle,
    setBigStrength,
    setPhysicalLimitation,
    setProfileComplete,
  } = usePlayerProfileStore();

  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  const [miss, setMiss] = useState<TypicalMiss>(null);
  const [struggle, setStruggle] = useState<BiggestStruggle>(null);
  const [strength, setStrength] = useState<BigStrength>(null);
  const [physical, setPhysical] = useState<PhysicalLimitation>(null);

  const currentStep = STEPS[step];

  const currentValue = (): string | null => {
    if (currentStep.key === 'miss') return miss;
    if (currentStep.key === 'struggle') return struggle;
    if (currentStep.key === 'strength') return strength;
    if (currentStep.key === 'physical') return physical;
    return null;
  };

  const handleSelect = (value: string) => {
    if (currentStep.key === 'miss')      setMiss(value as TypicalMiss);
    if (currentStep.key === 'struggle')  setStruggle(value as BiggestStruggle);
    if (currentStep.key === 'strength')  setStrength(value as BigStrength);
    if (currentStep.key === 'physical')  setPhysical(value as PhysicalLimitation);
  };

  const handleContinue = () => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      // Save all to persisted store
      setTypicalMiss(miss);
      setBiggestStruggle(struggle);
      setBigStrength(strength);
      setPhysicalLimitation(physical);
      setProfileComplete(true);
      setDone(true);
    }
  };

  const handleSkip = () => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      setProfileComplete(true);
      router.replace('/(tabs)/play');
    }
  };

  const practicePlan = buildInitialPracticePlan(miss, struggle, strength, physical);

  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.summaryScroll}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle}>Your Game Plan</Text>
            <Text style={styles.summarySubtitle}>
              Based on your profile, here’s where to focus:
            </Text>
          </View>

          <View style={styles.planCard}>
            <Text style={styles.planText}>{practicePlan || 'Your caddie is ready — let\'s get on the course.'}</Text>
          </View>

          <View style={styles.badgeRow}>
            {miss && (
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>Miss</Text>
                <Text style={styles.badgeValue}>{miss.charAt(0).toUpperCase() + miss.slice(1)}</Text>
              </View>
            )}
            {struggle && (
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>Focus</Text>
                <Text style={styles.badgeValue}>{struggle.charAt(0).toUpperCase() + struggle.slice(1).replace('-', ' ')}</Text>
              </View>
            )}
            {strength && (
              <View style={[styles.badge, styles.badgeGreen]}>
                <Text style={styles.badgeLabel}>Strength</Text>
                <Text style={styles.badgeValue}>{strength.charAt(0).toUpperCase() + strength.slice(1).replace('-', ' ')}</Text>
              </View>
            )}
          </View>

          <Pressable
            style={({ pressed }) => [styles.ctaBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.replace('/(tabs)/play')}
          >
            <Text style={styles.ctaBtnText}>Let’s Play</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
            onPress={() => router.replace('/(tabs)/practice')}
          >
            <Text style={styles.secondaryBtnText}>Go to Practice</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress bar */}
      <View style={styles.progressRow}>
        {STEPS.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i <= step ? styles.dotActive : styles.dotInactive]}
          />
        ))}
      </View>
      <Text style={styles.stepLabel}>{step + 1} of {STEPS.length}</Text>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.question}>{currentStep.question}</Text>
        <Text style={styles.questionSub}>{currentStep.subtitle}</Text>

        <View style={styles.optionsGroup}>
          {currentStep.options.map((opt) => {
            const selected = currentValue() === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={({ pressed }) => [
                  styles.optionCard,
                  selected && styles.optionCardSelected,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => handleSelect(opt.value as string)}
              >
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                  {opt.label}
                </Text>
                <Text style={[styles.optionDesc, selected && styles.optionDescSelected]}>
                  {opt.desc}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.continueBtn,
            !currentValue() && styles.continueBtnDisabled,
            pressed && currentValue() ? { opacity: 0.85 } : null,
          ]}
          onPress={handleContinue}
          disabled={!currentValue()}
        >
          <Text style={styles.continueBtnText}>
            {step < STEPS.length - 1 ? 'Continue' : 'Build My Plan'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.6 }]}
          onPress={handleSkip}
        >
          <Text style={styles.skipBtnText}>Skip</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B3D2E',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingTop: 24,
    paddingBottom: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotActive: {
    backgroundColor: '#4caf50',
  },
  dotInactive: {
    backgroundColor: '#2a5c3e',
  },
  stepLabel: {
    textAlign: 'center',
    color: '#6bbf80',
    fontSize: 12,
    fontFamily: 'Outfit_600SemiBold',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  scroll: {
    padding: 24,
    paddingBottom: 8,
  },
  question: {
    fontSize: 28,
    fontFamily: 'Outfit_800ExtraBold',
    color: '#fff',
    marginBottom: 6,
    lineHeight: 34,
  },
  questionSub: {
    fontSize: 14,
    fontFamily: 'Outfit_400Regular',
    color: '#A7F3D0',
    marginBottom: 28,
    lineHeight: 20,
  },
  optionsGroup: {
    gap: 12,
  },
  optionCard: {
    backgroundColor: '#0f2d1e',
    borderRadius: 14,
    padding: 18,
    borderWidth: 2,
    borderColor: '#1a5c30',
  },
  optionCardSelected: {
    backgroundColor: '#14432a',
    borderColor: '#4caf50',
  },
  optionLabel: {
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
    color: '#ccc',
    marginBottom: 3,
  },
  optionLabelSelected: {
    color: '#fff',
  },
  optionDesc: {
    fontSize: 13,
    color: '#5a9e6e',
    lineHeight: 18,
  },
  optionDescSelected: {
    color: '#A7F3D0',
  },
  footer: {
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
  continueBtn: {
    backgroundColor: '#4caf50',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  continueBtnDisabled: {
    backgroundColor: '#1e4d2b',
  },
  continueBtnText: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  skipBtnText: {
    color: '#5a9e6e',
    fontSize: 14,
    fontFamily: 'Outfit_600SemiBold',
  },
  // Summary screen
  summaryScroll: {
    padding: 24,
    paddingBottom: 40,
  },
  summaryHeader: {
    marginTop: 16,
    marginBottom: 24,
  },
  summaryTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
  },
  summarySubtitle: {
    fontSize: 15,
    color: '#A7F3D0',
    lineHeight: 22,
  },
  planCard: {
    backgroundColor: '#0f2d1e',
    borderRadius: 16,
    padding: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
    marginBottom: 20,
  },
  planText: {
    color: '#ccc',
    fontSize: 15,
    lineHeight: 24,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
    flexWrap: 'wrap',
  },
  badge: {
    backgroundColor: '#14432a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#2a6c45',
  },
  badgeGreen: {
    borderColor: '#4caf50',
  },
  badgeLabel: {
    color: '#6bbf80',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  badgeValue: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  ctaBtn: {
    backgroundColor: '#4caf50',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 10,
  },
  ctaBtnText: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '800',
  },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#2a6c45',
  },
  secondaryBtnText: {
    color: '#A7F3D0',
    fontSize: 16,
    fontWeight: '600',
  },
});
