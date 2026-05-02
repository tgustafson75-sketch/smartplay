import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Image,
  Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useTrustLevelStore } from '../../store/trustLevelStore';
import { speak, stopSpeaking, configureAudioForSpeech } from '../../services/voiceService';
import { generateBriefing } from '../../services/briefingGenerator';
import { checkContent } from '../../services/contentGuardrail';
import { generatePatternInsights } from '../../services/patternDetection';
import { getFirstTeeHint } from '../../services/voiceOnboardingService';
import { ROUND_MODE_LABELS } from '../../types/patterns';

type Phase = 'thinking' | 'speaking' | 'done';

export default function BriefingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { activeCourse, mode, active_ghost, courseHoles: _courseHoles, shots: _shots, scores: _scores, currentRoundId } =
    useRoundStore();
  const { firstName, handicap, goal, dominantMiss } = usePlayerProfileStore();
  const { roundsTogether } = useRelationshipStore();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const trustLevel = useTrustLevelStore(s => s.level);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

  const [phase, setPhase] = useState<Phase>('thinking');
  const [briefText, setBriefText] = useState('');
  const skippedRef = useRef(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const textFade = useRef(new Animated.Value(0)).current;
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  // Thinking pulse on avatar
  useEffect(() => {
    if (phase !== 'thinking') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.97, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Thinking dots
  useEffect(() => {
    if (phase !== 'thinking') return;
    const stagger = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0.3, duration: 400, useNativeDriver: true }),
          Animated.delay(800 - delay),
        ])
      );
    const a1 = stagger(dot1, 0);
    const a2 = stagger(dot2, 240);
    const a3 = stagger(dot3, 480);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const doSkip = useCallback(() => {
    if (skippedRef.current) return;
    skippedRef.current = true;
    stopSpeaking().catch(() => {});
    router.replace('/(tabs)/caddie' as never);
  }, [router]);

  const goToCaddie = useCallback(() => {
    if (skippedRef.current) return;
    skippedRef.current = true;
    router.replace('/(tabs)/caddie' as never);
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Collect pattern insights from current round state
      const roundState = useRoundStore.getState();
      const profileState = usePlayerProfileStore.getState();
      const { insights } = generatePatternInsights(roundState.shots, {
        currentRoundMode: roundState.mode,
        scores: roundState.scores,
        courseHoles: roundState.courseHoles,
        handicap: profileState.handicap,
        dominantMiss: profileState.dominantMiss as 'left' | 'right' | 'straight' | null,
      });

      try {
        const rawText = await generateBriefing({
          roundId: currentRoundId ?? 'unknown',
          courseName: activeCourse ?? 'the course',
          mode: mode ?? 'free_play',
          playerName: firstName || '',
          handicap,
          goal,
          dominantMiss,
          patternInsights: insights,
          ghostLabel: active_ghost?.label ?? null,
          roundsTogether,
          apiUrl,
          language,
        });

        if (cancelled) return;

        const { text } = checkContent(rawText, null);
        setBriefText(text);
        setPhase('speaking');
        Animated.timing(textFade, { toValue: 1, duration: 400, useNativeDriver: true }).start();

        // Sim-report G6 — auto-speak honors the Quiet contract. At L1 the
        // user gets to read the briefing on screen (text already rendered
        // above) and tap-skip; Kevin doesn't speak unsolicited.
        if (voiceEnabled && trustLevel !== 1) {
          await configureAudioForSpeech();
          await speak(text, voiceGender, language, apiUrl);
          // Phase A.4: first-tee hint for first-round users — appended once
          // after the briefing voice finishes, never on subsequent rounds.
          const hint = getFirstTeeHint();
          if (hint && !cancelled) {
            await speak(hint, voiceGender, language, apiUrl);
          }
        }

        if (cancelled) return;
        setPhase('done');
        setTimeout(() => { if (!cancelled) goToCaddie(); }, 1500);

      } catch {
        if (!cancelled) goToCaddie();
      }
    }

    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modeLabel = ROUND_MODE_LABELS[mode ?? 'free_play'] ?? 'Free Play';

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={doSkip}
      activeOpacity={1}
    >
      {/* Top info row */}
      <View style={[styles.topRow, { paddingTop: insets.top + 20 }]}>
        <Text style={styles.courseName} numberOfLines={1}>{activeCourse ?? 'Course'}</Text>
        <View style={styles.modeBadge}>
          <Text style={styles.modeBadgeText}>{modeLabel}</Text>
        </View>
        {active_ghost ? (
          <View style={styles.ghostBadge}>
            <Text style={styles.ghostBadgeText}>👻  {active_ghost.label}</Text>
          </View>
        ) : null}
      </View>

      {/* Kevin Avatar */}
      <Animated.View
        style={[
          styles.avatarWrapper,
          phase === 'thinking' && { transform: [{ scale: pulseAnim }] },
        ]}
      >
        <Image
          source={require('../../assets/avatars/kevin_portrait.jpg')}
          style={styles.avatar}
          resizeMode="cover"
        />
        {phase === 'speaking' && (
          <View style={styles.speakingRing} />
        )}
      </Animated.View>

      {/* Content area — both states always mounted to prevent flash-of-unmount glitch */}
      <View style={styles.contentArea}>
        {/* Thinking dots — visible during 'thinking', hidden after */}
        <Animated.View
          style={{ opacity: phase === 'thinking' ? 1 : 0, alignItems: 'center' }}
          pointerEvents={phase === 'thinking' ? 'auto' : 'none'}
        >
          <View style={styles.dotsRow}>
            <Animated.View style={[styles.dot, { opacity: dot1 }]} />
            <Animated.View style={[styles.dot, { opacity: dot2 }]} />
            <Animated.View style={[styles.dot, { opacity: dot3 }]} />
          </View>
          <Text style={styles.thinkingLabel}>Reading the course...</Text>
        </Animated.View>

        {/* Brief text — fades in once loaded */}
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.contentArea, { opacity: textFade }]}
          pointerEvents={phase !== 'thinking' ? 'auto' : 'none'}
        >
          <Text style={styles.briefText}>{briefText}</Text>
        </Animated.View>
      </View>

      {/* Bottom hint */}
      <View style={[styles.bottomHint, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.hintText}>
          {phase === 'done' ? 'Tap to start round' : 'Tap to skip'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
    alignItems: 'center',
  },
  topRow: {
    width: '100%',
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
  },
  courseName: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  modeBadge: {
    backgroundColor: 'rgba(0, 200, 150, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 200, 150, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  modeBadgeText: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  ghostBadge: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ghostBadgeText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '500',
  },
  avatarWrapper: {
    marginTop: 32,
    position: 'relative',
  },
  avatar: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2.5,
    borderColor: '#00C896',
  },
  speakingRing: {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 90,
    borderWidth: 2,
    borderColor: 'rgba(0, 200, 150, 0.4)',
  },
  contentArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00C896',
  },
  thinkingLabel: {
    color: '#6b7280',
    fontSize: 14,
    fontStyle: 'italic',
  },
  briefText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '500',
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 27,
  },
  bottomHint: {
    alignItems: 'center',
  },
  hintText: {
    color: '#374151',
    fontSize: 13,
    letterSpacing: 0.5,
  },
});
