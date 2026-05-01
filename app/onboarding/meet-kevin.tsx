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
import { useVoiceHintsStore } from '../../store/voiceHintsStore';
import { speak, configureAudioForSpeech, captureUtterance } from '../../services/voiceService';
import { checkMicPermission, PERMISSION_EXPLAINER_TEXT } from '../../services/voicePermissionService';
import { voiceCommandRouter } from '../../services/intents';
import type { AppContext } from '../../types/voiceIntent';
import { generateLibrary } from '../../services/fillerLibrary';

const KEVIN_BADGE = require('../../assets/avatars/smartplay_caddie_badge.png');
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

const KEVIN_INTRO = "Hey, I'm Kevin. Talk to me anytime — or tap. Try saying hello.";

type Phase = 'idle' | 'permission' | 'listening' | 'processing' | 'responding' | 'done';

export default function MeetKevin() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const markCompleted = useVoiceHintsStore(s => s.markMeetKevinCompleted);
  const markSkipped = useVoiceHintsStore(s => s.markMeetKevinSkipped);

  const [phase, setPhase] = useState<Phase>('idle');
  const [kevinResponse, setKevinResponse] = useState('');
  const [permissionError, setPermissionError] = useState(false);

  const fadeIn = useRef(new Animated.Value(0)).current;
  const avatarScale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.spring(avatarScale, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();
  }, []);

  const finishToCaddie = () => {
    if (voiceEnabled) generateLibrary(apiUrl, voiceGender, language).catch(() => {});
    router.replace('/(tabs)/caddie' as never);
  };

  const handleSayHi = async () => {
    setPhase('permission');
    const granted = await checkMicPermission();
    if (!granted) {
      setPermissionError(true);
      setPhase('idle');
      return;
    }
    setPermissionError(false);

    setPhase('responding');
    if (voiceEnabled) {
      await configureAudioForSpeech();
      await speak(KEVIN_INTRO, voiceGender, language, apiUrl).catch(() => {});
    }

    setPhase('listening');
    const utterance = await captureUtterance(6000, apiUrl, language);

    if (!utterance || !utterance.trim()) {
      // No reply — exit warmly anyway.
      setKevinResponse("Alright. Talk to me anytime.");
      setPhase('responding');
      if (voiceEnabled) {
        await speak("Alright. Talk to me anytime.", voiceGender, language, apiUrl).catch(() => {});
      }
      markCompleted();
      setPhase('done');
      setTimeout(finishToCaddie, 1500);
      return;
    }

    setPhase('processing');
    const ctx: AppContext = {
      active_screen: 'onboarding',
      active_round: null,
      current_hole: null,
      recent_shots: [],
      trust_spectrum_level: 2,
    };
    let response = "Good to meet you. Let's go.";
    try {
      const { result } = await voiceCommandRouter.route(utterance, ctx, apiUrl);
      if (result.voice_response) response = result.voice_response;
    } catch {
      // Parser failure — keep the warm default.
    }

    setKevinResponse(response);
    setPhase('responding');
    if (voiceEnabled) {
      await speak(response, voiceGender, language, apiUrl).catch(() => {});
    }

    markCompleted();
    setPhase('done');
    setTimeout(finishToCaddie, 1500);
  };

  const handleSkip = () => {
    markSkipped();
    finishToCaddie();
  };

  const styles = useMemo(() => makeStyles(colors, spacing, radii), [colors, spacing, radii]);

  const ctaLabel =
    phase === 'permission' ? 'Asking for mic…' :
    phase === 'listening'  ? 'Listening…' :
    phase === 'processing' ? 'Hearing you out…' :
    phase === 'responding' ? 'Kevin is talking…' :
    phase === 'done'       ? 'Heading in.' :
                             'Say hi to Kevin';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Animated.View style={[styles.content, { opacity: fadeIn }]}>

        <Animated.View style={[styles.avatarWrap, { transform: [{ scale: avatarScale }] }]}>
          <View style={[styles.avatarGlow, { borderColor: colors.accent }]} />
          <Image source={KEVIN_BADGE} style={styles.avatar} resizeMode="contain" />
        </Animated.View>

        <Text style={[styles.heading, { color: colors.accent }]}>MEET KEVIN</Text>
        <Text style={[styles.message, { color: colors.text_primary }]}>{KEVIN_INTRO}</Text>

        {kevinResponse ? (
          <Text style={[styles.kevinResponse, { color: colors.text_primary }]}>
            "{kevinResponse}"
          </Text>
        ) : null}

        {permissionError ? (
          <View style={[styles.permissionBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.permissionText, { color: colors.text_muted }]}>
              {PERMISSION_EXPLAINER_TEXT}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[
            styles.primaryCta,
            { backgroundColor: colors.accent },
            (phase !== 'idle' && phase !== 'done') && styles.primaryCtaDisabled,
          ]}
          onPress={handleSayHi}
          disabled={phase !== 'idle'}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryCtaText}>{ctaLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryCta}
          onPress={handleSkip}
          activeOpacity={0.7}
          disabled={phase !== 'idle' && phase !== 'done'}
        >
          <Text style={[styles.secondaryCtaText, { color: colors.text_muted }]}>
            Skip — I'll discover this myself
          </Text>
        </TouchableOpacity>

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
    container: { flex: 1, backgroundColor: c.background },
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
      opacity: 0.4,
    },
    avatar: { width: 120, height: 120 },
    heading: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 3,
      marginBottom: s.md,
    },
    message: {
      fontSize: 19,
      fontWeight: '500',
      lineHeight: 28,
      textAlign: 'center',
      marginBottom: s.lg,
    },
    kevinResponse: {
      fontSize: 16,
      fontStyle: 'italic',
      lineHeight: 24,
      textAlign: 'center',
      marginBottom: s.lg,
      paddingHorizontal: s.md,
    },
    permissionBox: {
      borderWidth: 1,
      borderRadius: r.md,
      padding: s.md,
      marginBottom: s.lg,
    },
    permissionText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
    primaryCta: {
      paddingVertical: s.md,
      paddingHorizontal: s.xxl,
      borderRadius: r.full,
      marginBottom: s.md,
      minWidth: 220,
      alignItems: 'center',
    },
    primaryCtaDisabled: { opacity: 0.5 },
    primaryCtaText: { color: '#000', fontSize: 16, fontWeight: '800' },
    secondaryCta: { paddingVertical: s.sm, paddingHorizontal: s.md },
    secondaryCtaText: { fontSize: 13, fontWeight: '500' },
  });
}
