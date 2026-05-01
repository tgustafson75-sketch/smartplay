import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';

const KEVIN_BADGE = require('../../assets/avatars/smartplay_caddie_badge.png');
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

export default function OnboardingReady() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const { firstName, name, completeOnboarding, completeSetup } = usePlayerProfileStore();

  const fadeIn = useRef(new Animated.Value(0)).current;
  const avatarScale = useRef(new Animated.Value(0.9)).current;

  const displayName = firstName || name || 'friend';
  const message = `Alright, ${displayName}. We're set. Tap anywhere to start your first round, or just hang out and ask me anything. I'm here.`;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.spring(avatarScale, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(async () => {
      if (voiceEnabled) {
        await configureAudioForSpeech();
        speak(message, voiceGender, language, apiUrl).catch(() => {});
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const handleFinish = () => {
    completeOnboarding();
    completeSetup();
    // Filler library generation moved to meet-kevin.tsx (the next-and-final
    // onboarding screen). Routing there now instead of straight to Caddie.
    router.replace('/onboarding/meet-kevin' as never);
  };

  const styles = useMemo(() => makeStyles(colors, spacing, radii), [colors, spacing, radii]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TouchableOpacity
        style={styles.fullTap}
        onPress={handleFinish}
        activeOpacity={1}
      >
        <Animated.View style={[styles.content, { opacity: fadeIn }]}>

          <Animated.View style={[styles.avatarWrap, { transform: [{ scale: avatarScale }] }]}>
            <View style={styles.avatarGlow} />
            <Image source={KEVIN_BADGE} style={styles.avatar} resizeMode="contain" />
          </Animated.View>

          <Text style={[styles.readyLabel, { color: colors.accent }]}>READY</Text>
          <Text style={[styles.message, { color: colors.text_primary }]}>{message}</Text>

          <View style={[styles.tapHint, { borderColor: colors.accent }]}>
            <Text style={[styles.tapHintText, { color: colors.accent }]}>Tap anywhere to start</Text>
          </View>

        </Animated.View>
      </TouchableOpacity>
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
    fullTap: { flex: 1 },
    content: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: s.lg,
    },
    avatarWrap: {
      width: 160,
      height: 160,
      marginBottom: s.xl,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarGlow: {
      position: 'absolute',
      width: 160,
      height: 160,
      borderRadius: 80,
      borderWidth: 2,
      borderColor: c.accent,
      opacity: 0.4,
    },
    avatar: {
      width: 120,
      height: 120,
    },
    readyLabel: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 3,
      marginBottom: s.md,
    },
    message: {
      fontSize: 20,
      fontWeight: '500',
      lineHeight: 30,
      textAlign: 'center',
      marginBottom: s.xxl,
    },
    tapHint: {
      borderWidth: 1,
      borderRadius: r.full,
      paddingVertical: s.sm,
      paddingHorizontal: s.lg,
    },
    tapHintText: {
      fontSize: 14,
      fontWeight: '700',
    },
  });
}
