import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';
import CoursePicker, { type PickedCourse } from '../../components/CoursePicker';

const PROMPT = "If you have a regular course, set it now and I'll learn it with you. Or skip — we can add courses anytime.";
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

export default function OnboardingHomeCourse() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const { setHomeCourse } = usePlayerProfileStore();

  const [selected, setSelected] = useState<PickedCourse | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (voiceEnabled) {
        await configureAudioForSpeech();
        speak(PROMPT, voiceGender, language, apiUrl).catch(() => {});
      }
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const handleContinue = () => {
    if (selected) setHomeCourse(selected.name);
    router.push('/onboarding/ready' as never);
  };

  const styles = useMemo(() => makeStyles(colors, spacing, radii), [colors, spacing, radii]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>

        <Text style={[styles.label, { color: colors.accent }]}>KEVIN</Text>
        <Text style={[styles.prompt, { color: colors.text_primary }]}>{PROMPT}</Text>

        <View style={styles.pickerWrap}>
          <CoursePicker selected={selected} onSelect={setSelected} />
        </View>

        {selected && (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: colors.accent }]}
            onPress={handleContinue}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Set Home Course</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.skip} onPress={handleContinue}>
          <Text style={[styles.skipText, { color: colors.text_muted }]}>
            Skip for now
          </Text>
        </TouchableOpacity>

      </View>
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
    content: {
      flex: 1,
      paddingHorizontal: s.lg,
      paddingTop: s.md,
    },
    label: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 2,
      marginBottom: s.sm,
    },
    prompt: {
      fontSize: 20,
      fontWeight: '700',
      lineHeight: 28,
      marginBottom: s.lg,
    },
    pickerWrap: {
      marginBottom: s.lg,
    },
    btn: {
      borderRadius: r.lg,
      paddingVertical: 16,
      alignItems: 'center',
      marginBottom: s.sm,
    },
    btnText: {
      color: '#ffffff',
      fontSize: 17,
      fontWeight: '800',
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
