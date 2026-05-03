/**
 * Kevin launch greeting screen.
 *
 * Single-shot screen rendered once per cold launch (gated upstream by
 * kevinGreetingEnabled and never replayed on warm-start). State machine:
 *
 *   ENTERING (0-300ms)      avatar fades + scales 0.8 → 1.0, centered
 *   SPEAKING  (audio dur)   avatar pulses subtly, caption fades in
 *   TRANSITIONING (400ms)   avatar shrinks + translates to top-left badge
 *                           position; caption fades out
 *   COMPLETE                router.replace → /(tabs)/caddie
 *
 * Tap anywhere to skip immediately into TRANSITIONING.
 *
 * Audio playback is best-effort. If the bundled mp3 is a 0-byte
 * placeholder, expo-av throws on load — caught and treated as a silent
 * greeting (visual + caption still play, audio simply absent).
 *
 * Reduce-motion respected: when AccessibilityInfo reports reduce motion
 * is on, all scale/translate animations collapse to plain fades.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, Animated, Image, TouchableWithoutFeedback,
  useWindowDimensions, AccessibilityInfo, Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { Asset } from 'expo-asset';
import { useTheme } from '../contexts/ThemeContext';
import {
  pickGreeting,
  recordLaunch,
  getLaunchContext,
  GREETING_CAPTION,
  type GreetingFilename,
} from '../services/kevinGreeting';
import { GREETING_ASSETS } from '../services/kevinGreetingManifest';

type Phase = 'ENTERING' | 'SPEAKING' | 'TRANSITIONING' | 'COMPLETE';

const ENTER_DURATION_MS = 300;
const TRANSITION_DURATION_MS = 400;
// Top-left badge target — matches the L1 badge anchor in caddie.tsx.
const BADGE_TARGET_LEFT = 16;
const BADGE_TARGET_SIZE = 64;

export default function GreetingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { width: W, height: H } = useWindowDimensions();

  const [phase, setPhase] = useState<Phase>('ENTERING');
  const [greeting, setGreeting] = useState<GreetingFilename | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Avatar animation refs
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;
  const captionOpacity = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const sizeAnim = useRef(new Animated.Value(1)).current;

  const soundRef = useRef<Audio.Sound | null>(null);
  const skippedRef = useRef(false);
  const completedRef = useRef(false);

  // Avatar dims — 40% of the smaller screen edge, scales for Z Fold.
  const avatarSize = Math.min(W, H) * 0.4;
  // Where the avatar lives at rest (centered) and where it travels to (top-left badge).
  const finalLeft = BADGE_TARGET_LEFT - (W - avatarSize) / 2;
  const finalTop = (insets.top + 60) - (H - avatarSize) / 2;
  const finalScale = BADGE_TARGET_SIZE / avatarSize;

  // ── Reduce-motion check ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (!cancelled) setReduceMotion(v); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Pick greeting on mount; persist launch markers ─────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await getLaunchContext();
        if (cancelled) return;
        const filename = pickGreeting(ctx);
        setGreeting(filename);
        // Persist AFTER selection so the next launch sees a non-first state.
        void recordLaunch();
      } catch (e) {
        console.warn('[greeting] context resolution failed', e);
        if (!cancelled) setGreeting('universal_01.mp3');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── State machine ──────────────────────────────────────────────────

  const goToCaddie = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    router.replace('/(tabs)/caddie' as never);
  }, [router]);

  const startTransition = useCallback(() => {
    if (phase === 'TRANSITIONING' || phase === 'COMPLETE') return;
    setPhase('TRANSITIONING');
    if (reduceMotion) {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setPhase('COMPLETE');
        goToCaddie();
      });
      return;
    }
    Animated.parallel([
      Animated.timing(translateX, { toValue: finalLeft, duration: TRANSITION_DURATION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: finalTop,  duration: TRANSITION_DURATION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(sizeAnim,    { toValue: finalScale, duration: TRANSITION_DURATION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(captionOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setPhase('COMPLETE');
      goToCaddie();
    });
  }, [phase, reduceMotion, finalLeft, finalTop, finalScale, opacity, translateX, translateY, sizeAnim, captionOpacity, goToCaddie]);

  const handleSkip = useCallback(() => {
    if (skippedRef.current) return;
    skippedRef.current = true;
    void (async () => {
      try { await soundRef.current?.stopAsync(); } catch {}
      try { await soundRef.current?.unloadAsync(); } catch {}
      soundRef.current = null;
    })();
    startTransition();
  }, [startTransition]);

  // ── Enter animation + audio kickoff once greeting is picked ────────
  useEffect(() => {
    if (!greeting) return;

    // Fade in avatar
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1, duration: ENTER_DURATION_MS, useNativeDriver: true,
      }),
      reduceMotion
        ? Animated.timing(scale, { toValue: 1, duration: ENTER_DURATION_MS, useNativeDriver: true })
        : Animated.timing(scale, { toValue: 1, duration: ENTER_DURATION_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(() => {
      setPhase('SPEAKING');
      Animated.timing(captionOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });

    // Kick off audio playback in parallel — caption fades in regardless.
    void (async () => {
      try {
        const assetMod = GREETING_ASSETS[greeting];
        const asset = Asset.fromModule(assetMod);
        await asset.downloadAsync();
        // 0-byte placeholder → bail gracefully and let the visual run alone.
        if (!asset.localUri || (typeof asset.uri === 'string' && asset.uri.length === 0)) {
          console.warn('[greeting] asset has no localUri:', greeting);
          // Auto-advance after a 2s read-the-text moment.
          setTimeout(() => { if (!skippedRef.current) startTransition(); }, 2000);
          return;
        }
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });
        const { sound, status } = await Audio.Sound.createAsync(
          { uri: asset.localUri },
          { shouldPlay: true, volume: 1.0 },
        );
        soundRef.current = sound;
        if (!status.isLoaded || (status.isLoaded && (status.durationMillis ?? 0) === 0)) {
          // Empty / unloadable file → silent path + 2s read window.
          try { await sound.unloadAsync(); } catch {}
          soundRef.current = null;
          setTimeout(() => { if (!skippedRef.current) startTransition(); }, 2000);
          return;
        }
        sound.setOnPlaybackStatusUpdate((s) => {
          if (!s.isLoaded) return;
          if (s.didJustFinish) {
            try { void sound.unloadAsync(); } catch {}
            soundRef.current = null;
            if (!skippedRef.current) startTransition();
          }
        });
      } catch (e) {
        console.warn('[greeting] audio playback failed:', e);
        // Audio is optional. Show the caption for ~2s, then advance.
        setTimeout(() => { if (!skippedRef.current) startTransition(); }, 2000);
      }
    })();

    return () => {
      // Clean up audio if the screen unmounts mid-playback.
      const s = soundRef.current;
      if (s) { void s.stopAsync().catch(() => {}); void s.unloadAsync().catch(() => {}); soundRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greeting]);

  // Slow breathing pulse during SPEAKING — opacity 0.94↔1.0 at ~0.45 Hz with
  // sine easing. The previous 0.85↔1.0 / 180ms cycle read as a strobe.
  useEffect(() => {
    if (phase !== 'SPEAKING' || reduceMotion) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.94, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1.00, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduceMotion]);

  return (
    <TouchableWithoutFeedback onPress={handleSkip} accessibilityLabel="Skip greeting">
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Animated.View
          style={[
            styles.avatarWrap,
            {
              left: (W - avatarSize) / 2,
              top: (H - avatarSize) / 2,
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize / 2,
              borderColor: colors.accent,
              opacity,
              transform: [
                { translateX },
                { translateY },
                { scale: Animated.multiply(scale, sizeAnim) },
              ],
            },
          ]}
        >
          <Image
            source={require('../assets/avatars/smartplay_caddie_badge.png')}
            style={styles.avatarImg}
            resizeMode="contain"
          />
        </Animated.View>

        {greeting ? (
          <Animated.Text
            style={[
              styles.caption,
              {
                color: colors.text_primary,
                opacity: captionOpacity,
                top: (H - avatarSize) / 2 + avatarSize + 28,
              },
            ]}
            numberOfLines={3}
          >
            {GREETING_CAPTION[greeting]}
          </Animated.Text>
        ) : null}
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  avatarWrap: {
    position: 'absolute',
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: '85%', height: '85%' },
  caption: {
    position: 'absolute',
    left: 24,
    right: 24,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 24,
  },
});
