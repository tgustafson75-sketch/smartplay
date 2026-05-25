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
import { Video, ResizeMode } from 'expo-av';
import { useTheme } from '../contexts/ThemeContext';
import { useSettingsStore } from '../store/settingsStore';
import { playLocalFile, speak, stopSpeaking } from '../services/voiceService';
import {
  pickGreeting,
  recordLaunch,
  getLaunchContext,
  getGreetingCaption,
  type GreetingFilename,
} from '../services/kevinGreeting';
import { getCaddieName } from '../lib/persona';
import { GREETING_ASSETS } from '../services/kevinGreetingManifest';
// 2026-05-25 — D-ID Kevin intro video. When persona=kevin AND the
// bundled clip is available, the greeting plays Kevin's talking-head
// video (with built-in audio) INSTEAD of the avatar + bundled mp3.
// Side effect: kills the boot cut-off bug because the video owns its
// own audio — no separate playLocalFile to race the screen transition.
import { getCaddieClip, hasCaddieClip } from '../services/getCaddieClip';

type Phase = 'ENTERING' | 'SPEAKING' | 'TRANSITIONING' | 'COMPLETE';

const ENTER_DURATION_MS = 300;
// Phase AR follow-up — TRANSITION_DURATION_MS / BADGE_TARGET_LEFT /
// BADGE_TARGET_SIZE removed with the slide-to-badge transition. Greeting
// now fades out and routes; no slide animation to a target frame.

export default function GreetingScreen() {
  const router = useRouter();
  const _insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const voiceGender = useSettingsStore(s => s.voiceGender);
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const language = useSettingsStore(s => s.language);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const { width: W, height: H } = useWindowDimensions();

  const [phase, setPhase] = useState<Phase>('ENTERING');
  const [greeting, setGreeting] = useState<GreetingFilename | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  // 2026-05-25 — D-ID Kevin intro video gate. When Kevin is active and
  // the bundled video clip is present, render the talking-head video
  // instead of the static avatar + bundled mp3 fork. The video's
  // built-in audio plays inline; we wait for didJustFinish before
  // transitioning. Other personas keep their existing avatar + TTS
  // caption fork (until their own D-ID clips land).
  const useKevinIntroVideo = caddiePersonality === 'kevin' && hasCaddieClip('kevin', 'intro');
  const videoRef = useRef<Video>(null);
  const videoDoneResolveRef = useRef<(() => void) | null>(null);
  // 2026-05-25 — Tail-clip defense. Set true when the greeting playback
  // (video / speak / mp3) resolves naturally. The unmount cleanup gates
  // its stopSpeaking() on !naturalEndRef.current so a happy-path natural
  // completion doesn't risk clipping the last syllable on a slow audio
  // session close. The explicit user-initiated SKIP handler still calls
  // stopSpeaking unconditionally — different path, deliberate cut.
  const naturalEndRef = useRef(false);

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

    // Persona-correct greeting voice:
    //   - kevin: play the bundled mp3 (Kevin's recorded voice; highest quality).
    //   - serena / harry / tank: route through speak() which hits /api/voice
    //     with persona='<id>' so ElevenLabs returns the persona's actual
    //     voice. The bundled mp3s are ALL in Kevin's recorded voice — playing
    //     them for any other persona makes Kevin greet the user with Serena
    //     selected (the bug Tim caught: "heard Kevin say 'there you are' but
    //     I'm set on Serena"). Same caption text, persona-correct audio.
    //
    // Phase V.7 — route through voiceService (playLocalFile or speak) so the
    // greeting shares the voiceService singleton (speechId/currentSound).
    // Without this, the next speak() in caddie.tsx can overlap the tail.
    void (async () => {
      try {
        const minDisplay = new Promise<void>(resolve => setTimeout(resolve, 2000));

        // 2026-05-25 — Kevin D-ID intro video path. Owns its own audio,
        // so we skip playLocalFile/speak entirely and just wait for the
        // <Video>'s didJustFinish via videoDoneResolveRef. Cap at 12s in
        // case didJustFinish never fires (audio focus loss, etc.) so a
        // stuck video can't trap the user on the greeting screen forever.
        if (useKevinIntroVideo) {
          const videoDone = new Promise<void>(resolve => {
            videoDoneResolveRef.current = resolve;
          });
          const videoTimeout = new Promise<void>(resolve => setTimeout(resolve, 12_000));
          await Promise.all([
            Promise.race([videoDone, videoTimeout]),
            minDisplay,
          ]);
          naturalEndRef.current = true;
          if (!skippedRef.current) startTransition();
          return;
        }

        if (caddiePersonality !== 'kevin') {
          // TTS the caption in the active persona's voice. speak() reads
          // caddiePersonality from the store at request time and threads
          // it as `persona` in the /api/voice body — server picks the
          // persona-keyed ElevenLabs voice ID.
          const captionForVoice = getGreetingCaption(greeting, getCaddieName(caddiePersonality));
          await Promise.all([
            speak(captionForVoice, voiceGender, language as 'en' | 'es' | 'zh', apiUrl, { userInitiated: true }),
            minDisplay,
          ]);
          naturalEndRef.current = true;
          if (!skippedRef.current) startTransition();
          return;
        }

        // Kevin: bundled mp3 path (legacy fallback when D-ID intro
        // clip isn't present — useKevinIntroVideo handled that case
        // above).
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
        // userInitiated: true — the user JUST opened the app, so the
        // greeting is user-initiated by definition. Without this flag,
        // isVoiceAllowed silently drops the audio when the persisted
        // trustLevel is 1 (Quiet) — Tim hit this and heard nothing.
        await Promise.all([playLocalFile(asset.localUri, undefined, { userInitiated: true }), minDisplay]);
        naturalEndRef.current = true;
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
      // 2026-05-25 — Tail-clip defense: only call stopSpeaking on
      // unmount when the playback didn't already end naturally. Happy-
      // path: speak/video resolved → naturalEndRef true → skip the
      // stop. Skip handler still calls stopSpeaking explicitly via the
      // handleSkip path so user-initiated cuts work the same. Edge case
      // (mid-flight back gesture, system kill, etc.): naturalEndRef
      // stays false → stopSpeaking fires → silence the orphan audio.
      if (!naturalEndRef.current) {
        void stopSpeaking().catch(() => {});
      }
    };
    // Bug fix — depend ONLY on `greeting`. Including `scheduleAdvance`
    // (or anything that closes over `phase`) caused the effect to re-run
    // when phase transitioned ENTERING → SPEAKING mid-flight. Each re-run
    // hit the cleanup path (stopSpeaking) and then restarted playLocalFile
    // from the top — manifesting as the greeting audio "doubling up" /
    // restarting mid-sentence. The audio kickoff is conceptually a
    // run-once-when-greeting-arrives effect; the closures it captures
    // (startTransition, scheduleAdvance) work correctly with stale refs
    // here because they're called at most once per mount and the cleanup
    // tears them down on unmount.
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
                overflow: 'hidden', // Required for Android to actually clip child to borderRadius circle
              },
            ]}
          >
            {/* 2026-05-25 — Kevin D-ID intro video. When the bundled
                clip is present, render the talking-head video filling
                the circular avatar wrap. resizeMode COVER + overflow
                hidden on the wrap clip to the circle. The video carries
                its own audio (D-ID generates speech+video together) so
                no separate playLocalFile fires for this path. Falls
                back to the static portrait when the clip isn't available
                or for non-Kevin personas. */}
            {useKevinIntroVideo ? (
              <Video
                ref={videoRef}
                source={getCaddieClip('kevin', 'intro') as number}
                style={styles.avatarPhoto}
                resizeMode={ResizeMode.COVER}
                shouldPlay
                isLooping={false}
                isMuted={false}
                onPlaybackStatusUpdate={(status) => {
                  if ('didJustFinish' in status && status.didJustFinish) {
                    videoDoneResolveRef.current?.();
                    videoDoneResolveRef.current = null;
                  }
                }}
              />
            ) : (
              <Image
                source={
                  caddiePersonality === 'serena' ? require('../assets/avatars/serena_portrait.jpg')
                  : caddiePersonality === 'harry' ? require('../assets/avatars/harry_portrait.png')
                  : caddiePersonality === 'tank'  ? require('../assets/avatars/tank_v2_portrait.png')
                  : require('../assets/avatars/kevin_portrait.jpg')
                }
                style={styles.avatarPhoto}
                resizeMode="cover"
              />
            )}
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
              {getGreetingCaption(greeting, getCaddieName(caddiePersonality))}
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
