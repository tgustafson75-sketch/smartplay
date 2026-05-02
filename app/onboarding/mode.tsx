import React, { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';
import AppIcon, { type IconName } from '../../components/AppIcon';

const PROMPT = "What are you trying to do this season? Don't worry, you can change this anytime.";
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

type Mode = 'break_100' | 'break_90' | 'break_80' | 'free_play';

const MODES: { id: Mode; title: string; description: string; icon: IconName }[] = [
  { id: 'break_100', title: 'Break 100', description: 'Getting the scorecard under control. Smart decisions, fewer disasters.', icon: 'trending-up-outline' },
  { id: 'break_90',  title: 'Break 90',  description: 'Building consistency. Less chunking, more pars.', icon: 'analytics-outline' },
  { id: 'break_80',  title: 'Break 80',  description: 'Scoring mode. Dialing in the short game, playing the angles.', icon: 'flame-outline' },
  { id: 'free_play', title: 'Free Play', description: 'No specific target — just enjoy the game and get better.', icon: 'golf-outline' },
];

export default function OnboardingMode() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const { setDefaultMode } = usePlayerProfileStore();

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (voiceEnabled) {
        await configureAudioForSpeech();
        speak(PROMPT, voiceGender, language, apiUrl).catch(() => {});
      }
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const handleSelect = (mode: Mode) => {
    setDefaultMode(mode);
    router.push('/onboarding/home-course' as never);
  };

  const handleSkip = () => {
    setDefaultMode('free_play');
    router.push('/onboarding/home-course' as never);
  };

  const styles = useMemo(() => makeStyles(colors, spacing, radii), [colors, spacing, radii]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.label, { color: colors.accent }]}>KEVIN</Text>
        <Text style={[styles.prompt, { color: colors.text_primary }]}>{PROMPT}</Text>

        {MODES.map(mode => (
          <TouchableOpacity
            key={mode.id}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => handleSelect(mode.id)}
            activeOpacity={0.8}
          >
            <AppIcon name={mode.icon} size={26} color="#00C896" />
            <View style={styles.cardText}>
              <Text style={[styles.cardTitle, { color: colors.text_primary }]}>{mode.title}</Text>
              <Text style={[styles.cardDesc, { color: colors.text_muted }]}>{mode.description}</Text>
            </View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={styles.skip} onPress={handleSkip}>
          <Text style={[styles.skipText, { color: colors.text_muted }]}>Skip — I'll decide later</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(
  c: ReturnType<typeof useTheme>['colors'],
  s: ReturnType<typeof useTheme>['spacing'],
  r: ReturnType<typeof useTheme>['radii'],
) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: {
      paddingHorizontal: s.lg,
      paddingBottom: s.xl,
      paddingTop: s.md,
    },
    label: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 2,
      marginBottom: s.sm,
    },
    prompt: {
      fontSize: 22,
      fontWeight: '700',
      lineHeight: 30,
      marginBottom: s.lg,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: r.lg,
      borderWidth: 1,
      padding: s.md,
      marginBottom: s.sm,
      gap: s.md,
    },
    icon: {
      fontSize: 28,
      width: 40,
      textAlign: 'center',
    },
    cardText: { flex: 1 },
    cardTitle: {
      fontSize: 18,
      fontWeight: '800',
      marginBottom: 4,
    },
    cardDesc: {
      fontSize: 13,
      lineHeight: 18,
    },
    skip: {
      paddingVertical: s.md,
      alignItems: 'center',
    },
    skipText: {
      fontSize: 14,
    },
  });
}
