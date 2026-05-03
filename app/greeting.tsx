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
import { Asset } from 'expo-asset';
import { useTheme } from '../contexts/ThemeContext';
import { playLocalFile, stopSpeaking } from '../services/voiceService';
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
// Phase AR follow-up — TRANSITION_DURATION_MS / BADGE_TARGET_LEFT /
// BADGE_TARGET_SIZE removed with the slide-to-badge transition. Greeting
// now fades out and routes; no slide animation to a target frame.

export default function GreetingScreen() {
  const router = useRouter();
  const _insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { width: W, height: H } = useWindowDimensions();

  const [phase, setPhase] = useState<Phase>('ENTERING');
  const [greeting, setGreeting] = useState<GreetingFilename | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Avatar animation refs
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;
  const captionOpacity = useRef(new Animated.Value(0)).current;
  // Phase AR follow-up — translateX/Y/sizeAnim removed (slide-to-badge
  // transition dropped; greeting now fades out + router.replace).

  const skippedRef = useRef(false);
  const completedRef = useRef(false);
  // Phase V.7 — track auto-advance timers so skip can cancel them.
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Avatar dims — 40% of the smaller screen edge, scales for Z Fold.
  const avatarSize = Math.min(W, H) * 0.4;
  // Where the avatar lives at rest (centered) and where it travels to (top-left badge).
  // Final-position math removed with the slide-to-badge transition.

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
    // Phase AR follow-up — dropped the slide-to-badge animation. The
    // translateX/translateY/scale transform was making the avatar appear
    // mid-flight when the screen was captured/observed mid-transition,
    // showing as "off-center splash". A simple fade-out → router.replace
    // is faster, more reliable, and visually cleaner.
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      Animated.timing(captionOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setPhase('COMPLETE');
      goToCaddie();
    });
  }, [phase, opacity, captionOpacity, goToCaddie]);

  const handleSkip = useCallback(() => {
    if (skippedRef.current) return;
    skippedRef.current = true;
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    void stopSpeaking().catch(() => {});
    startTransition();
  }, [startTransition]);

  const scheduleAdvance = useCallback((ms: number) => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null;
      if (!skippedRef.current) startTransition();
    }, ms);
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

    // Phase V.7 — route through playLocalFile so the greeting shares the
    // voiceService singleton (speechId/currentSound). Without this, the next
    // speak() in caddie.tsx can overlap the tail of the greeting audio.
    void (async () => {
      try {
        const assetMod = GREETING_ASSETS[greeting];
        const asset = Asset.fromModule(assetMod);
        await asset.downloadAsync();
        if (!asset.localUri) {
          console.warn('[greeting] asset has no localUri:', greeting);
          scheduleAdvance(2000);
          return;
        }
        // playLocalFile blocks until the clip finishes (or its duration-derived
        // timeout fires). It also no-ops silently when voice is disabled, so
        // race against a 2s minimum to guarantee the caption stays readable
        // even on a silent greeting path.
        const minDisplay = new Promise<void>(resolve => setTimeout(resolve, 2000));
        await Promise.all([playLocalFile(asset.localUri), minDisplay]);
        if (!skippedRef.current) startTransition();
      } catch (e) {
        console.warn('[greeting] audio playback failed:', e);
        scheduleAdvance(2000);
      }
    })();

    return () => {
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
      void stopSpeaking().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greeting, scheduleAdvance]);

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
        {/* Phase AR follow-up v2 — true viewport centering. Earlier version
            put avatar + caption as siblings in a justifyContent:center
            parent, which centered them AS A GROUP — pushing the avatar
            up off screen-center by the caption height. Now the avatar
            lives in a flex:1 region (truly center-of-viewport) and the
            caption pins to its own region below. Avatar always centered
            on every aspect, regardless of caption length. */}
        <View style={styles.avatarRegion}>
          <Animated.View
            style={[
              styles.avatarWrap,
              {
                width: avatarSize,
                height: avatarSize,
                borderRadius: avatarSize / 2,
                borderColor: colors.accent,
                opacity,
                transform: [{ scale }],
              },
            ]}
          >
            {/* Phase AR follow-up v3 — swapped from
                smartplay_caddie_badge.png to kevin_portrait.jpg (the
                actual Kevin face we already use in onboarding). The
                badge PNG artwork was off-center within its own canvas
                ("left side of his face in middle of screen"), so even
                a perfectly-centered container rendered the figure
                visibly right-of-center. The portrait JPG is centered
                and is actually Kevin. resizeMode 'cover' fills the
                circular container edge-to-edge. */}
            <Image
              source={require('../assets/avatars/kevin_portrait.jpg')}
              style={styles.avatarPhoto}
              resizeMode="cover"
            />
          </Animated.View>
        </View>
        <View style={styles.captionRegion}>
          {greeting ? (
            <Animated.Text
              style={[
                styles.captionFlex,
                { color: colors.text_primary, opacity: captionOpacity },
              ]}
              numberOfLines={3}
            >
              {GREETING_CAPTION[greeting]}
            </Animated.Text>
          ) : null}
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Avatar region: flex:1 = takes remaining space, centers content within
  // it. With caption region below at flex:0 + ~140px height, the avatar
  // sits roughly at viewport center on every aspect.
  avatarRegion: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  // Caption region: bottom strip with reserved height. Centers caption
  // text horizontally; vertical alignment top so the caption sits just
  // below the avatar even when the text is short.
  captionRegion: {
    minHeight: 120,
    paddingHorizontal: 24,
    paddingBottom: 48,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  avatarWrap: {
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: '88%', height: '88%' },
  // Phase AR v3 — fills circular container edge-to-edge with the photo
  avatarPhoto: { width: '100%', height: '100%' },
  captionFlex: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 24,
  },
  caption: { display: 'none' }, // legacy, replaced by captionFlex
});
