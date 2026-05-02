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
import { useTrustLevelStore, type TrustLevel } from '../../store/trustLevelStore';

const KEVIN_BADGE = require('../../assets/avatars/smartplay_caddie_badge.png');
const GREETING =
  "Hey, I'm Kevin. I'm your caddie. I'll be in your bag for every round, every practice session, every time you want to get better. Before we start, I need to know a couple of things about you. Won't take long.";

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

export default function OnboardingWelcome() {
  const router = useRouter();
  const { colors, spacing, typography: _typography, radii } = useTheme();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const trustLevel = useTrustLevelStore(s => s.level);
  const setTrustLevel = useTrustLevelStore(s => s.setLevel);

  // Sim-report — CTA was previously locked until TTS finished, which made
  // users wait 8-10s to advance. Voice now plays in the background and the
  // user can tap through whenever they're ready. setVoiceDone retained as
  // an indicator for the soft 'Finishing intro…' hint, not a gate.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sim-report — Trust Spectrum at onboarding. Quinn-style users find the
  // Quiet toggle here instead of digging post-onboarding. Defaults stay at
  // L2 (Companion) so existing behavior is preserved for anyone who skips.
  const TRUST_OPTIONS: { level: TrustLevel; label: string; sub: string }[] = [
    { level: 1, label: 'Quiet',     sub: 'I tap when I need you' },
    { level: 2, label: 'Companion', sub: 'Be here when I ask' },
    { level: 3, label: 'Active',    sub: 'Chime in along the way' },
    { level: 4, label: 'Full',      sub: "You're right next to me" },
  ];

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

        {/* TRUST SPECTRUM — pick how present Kevin should be. Default L2. */}
        <View style={styles.trustRow}>
          {TRUST_OPTIONS.map(t => {
            const active = trustLevel === t.level;
            return (
              <TouchableOpacity
                key={t.level}
                onPress={() => setTrustLevel(t.level)}
                style={[
                  styles.trustChip,
                  { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? '#0d2418' : colors.surface },
                ]}
                activeOpacity={0.85}
              >
                <Text style={[styles.trustLabel, { color: active ? colors.accent : colors.text_primary }]}>{t.label}</Text>
                <Text style={[styles.trustSub, { color: colors.text_muted }]}>{t.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* CTA — always tappable; TTS plays in background. */}
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: colors.accent }]}
          onPress={() => router.push('/onboarding/name' as never)}
          activeOpacity={0.85}
        >
          <Text style={[styles.btnText, { color: '#ffffff' }]}>Let&apos;s go</Text>
        </TouchableOpacity>

        {!voiceDone && voiceEnabled && (
          <Text style={[styles.waitHint, { color: colors.text_muted }]}>
            Kevin&apos;s still talking — tap anytime to skip ahead.
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
    trustRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 8,
      marginBottom: s.lg,
      paddingHorizontal: s.md,
    },
    trustChip: {
      borderWidth: 1,
      borderRadius: r.md,
      paddingVertical: 10,
      paddingHorizontal: 12,
      minWidth: 130,
      alignItems: 'center',
    },
    trustLabel: { fontSize: 13, fontWeight: '800', marginBottom: 2 },
    trustSub: { fontSize: 11, textAlign: 'center' },
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
