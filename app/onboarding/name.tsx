import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';

const PROMPT = "First — what should I call you?";
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

export default function OnboardingName() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const { setName } = usePlayerProfileStore();

  const [value, setValue] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (voiceEnabled) {
        await configureAudioForSpeech();
        speak(PROMPT, voiceGender, language, apiUrl).catch(() => {});
      }
      inputRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const handleContinue = () => {
    const name = value.trim() || 'friend';
    setName(name);
    router.push('/onboarding/mode' as never);
  };

  const styles = useMemo(() => makeStyles(colors, spacing, radii), [colors, spacing, radii]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>

          <Text style={[styles.label, { color: colors.accent }]}>KEVIN</Text>
          <Text style={[styles.prompt, { color: colors.text_primary }]}>{PROMPT}</Text>

          <TextInput
            ref={inputRef}
            style={[styles.input, { color: colors.text_primary, borderColor: colors.border, backgroundColor: colors.surface }]}
            value={value}
            onChangeText={setValue}
            placeholder="Your first name"
            placeholderTextColor={colors.text_muted}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={handleContinue}
          />

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: colors.accent }]}
            onPress={handleContinue}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Continue</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skip}
            onPress={handleContinue}
          >
            <Text style={[styles.skipText, { color: colors.text_muted }]}>Skip</Text>
          </TouchableOpacity>

        </View>
      </KeyboardAvoidingView>
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
    kav: { flex: 1 },
    content: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: s.lg,
    },
    label: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 2,
      marginBottom: s.sm,
    },
    prompt: {
      fontSize: 26,
      fontWeight: '700',
      lineHeight: 34,
      marginBottom: s.xl,
    },
    input: {
      borderWidth: 1,
      borderRadius: r.md,
      paddingVertical: 14,
      paddingHorizontal: s.md,
      fontSize: 20,
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
      paddingVertical: s.sm,
      alignItems: 'center',
    },
    skipText: {
      fontSize: 14,
    },
  });
}
