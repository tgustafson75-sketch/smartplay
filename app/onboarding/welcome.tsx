import React, { useEffect, useRef, useState, useMemo } from 'react';
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
import { speak, configureAudioForSpeech } from '../../services/voiceService';

const KEVIN_BADGE = require('../../assets/avatars/smartplay_caddie_badge.png');
const GREETING =
  "Hey, I'm Kevin. I'm your caddie. I'll be in your bag for every round, every practice session, every time you want to get better. Before we start, I need to know a couple of things about you. Won't take long.";

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

export default function OnboardingWelcome() {
  const router = useRouter();
  const { colors, spacing, typography, radii } = useTheme();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();

  const [voiceDone, setVoiceDone] = useState(false);
  const fadeIn = useRef(new Animated.Value(0)).current;
  const avatarScale = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(avatarScale, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(async () => {
      if (voiceEnabled) {
        await configureAudioForSpeech();
        await speak(GREETING, voiceGender, language, apiUrl);
      }
      setVoiceDone(true);
    }, 600);

    return () => clearTimeout(timer);
  }, []);

  const styles = useMemo(() => makeStyles(colors, spacing, radii), [colors, spacing, radii]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Animated.View style={[styles.content, { opacity: fadeIn }]}>

        {/* KEVIN AVATAR */}
        <Animated.View style={[styles.avatarWrap, { transform: [{ scale: avatarScale }] }]}>
          <View style={styles.avatarGlow} />
          <Image source={KEVIN_BADGE} style={styles.avatar} resizeMode="contain" />
        </Animated.View>

        {/* GREETING TEXT */}
        <View style={styles.textBlock}>
          <Text style={[styles.name, { color: colors.accent }]}>Kevin</Text>
          <Text style={[styles.greeting, { color: colors.text_primary }]}>
            {GREETING}
          </Text>
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[
            styles.btn,
            { backgroundColor: colors.accent },
            !voiceDone && styles.btnDisabled,
          ]}
          onPress={() => router.push('/onboarding/name' as never)}
          disabled={!voiceDone}
          activeOpacity={0.85}
        >
          <Text style={[styles.btnText, { color: '#ffffff' }]}>Let's go</Text>
        </TouchableOpacity>

        {!voiceDone && (
          <Text style={[styles.waitHint, { color: colors.text_muted }]}>
            Finishing intro…
          </Text>
        )}

      </Animated.View>
    </SafeAreaView>
  );
}

function makeStyles(
  c: ReturnType<typeof useTheme>['colors'],
  s: ReturnType<typeof useTheme>['spacing'],
  r: ReturnType<typeof useTheme>['radii'],
) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    content: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: s.lg,
    },
    avatarWrap: {
      width: 140,
      height: 140,
      marginBottom: s.xl,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarGlow: {
      position: 'absolute',
      width: 140,
      height: 140,
      borderRadius: 70,
      borderWidth: 2,
      borderColor: c.accent,
      opacity: 0.35,
    },
    avatar: {
      width: 110,
      height: 110,
    },
    textBlock: {
      alignItems: 'center',
      marginBottom: s.xxl,
    },
    name: {
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 2,
      marginBottom: s.sm,
    },
    greeting: {
      fontSize: 18,
      fontWeight: '500',
      lineHeight: 27,
      textAlign: 'center',
    },
    btn: {
      borderRadius: r.lg,
      paddingVertical: 16,
      paddingHorizontal: s.xxl,
      alignItems: 'center',
      minWidth: 180,
    },
    btnDisabled: {
      opacity: 0.45,
    },
    btnText: {
      fontSize: 17,
      fontWeight: '800',
    },
    waitHint: {
      marginTop: s.md,
      fontSize: 13,
    },
  });
}
