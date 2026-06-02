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
import { playLocalFile, speak, stopSpeaking, configureAudioForSpeech } from '../services/voiceService';
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
  // 2026-05-28 — Fix FS: gate the audio-kickoff effect on settings
  // hydration. Without this, the effect could fire while caddiePersonality
  // is still the default 'kevin' even though the user persisted Serena /
  // Tank / Harry — picking the wrong audio path. Once hydration lands
  // the hook re-renders with the persisted values; the audio effect
  // sees a stable state then fires.
  const settingsHydrated = useSettingsStore(s => s.hasHydrated);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const { width: W, height: H } = useWindowDimensions();

  const [phase, setPhase] = useState<Phase>('ENTERING');
  const [greeting, setGreeting] = useState<GreetingFilename | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  // 2026-06-01 — Fix GB: gate the Kevin intro video render on audio
  // session being configured for playback. Verifiable defect this
  // closes: configureAudioForSpeech() was previously only called from
  // (a) the speak() path used by Serena/Harry/Tank greetings, and
  // (b) app/_layout.tsx's glasses-mode boot config (gated on
  // settings.glassesMode === true — most users don't have it).
  // The Kevin-video branch rendered <Video shouldPlay isMuted={false}>
  // without ever configuring the audio session, so on iOS with the
  // silent switch up (and Android defaults that vary), the video would
  // play visually but emit no audio. Default audio category respects
  // the silent switch unless playsInSilentModeIOS:true is set, which
  // is what configureAudioForSpeech does. Setting audioReady true only
  // after that call resolves; <Video> mount waits on it. The TTS
  // branches were unaffected (speak() calls configureAudioForSpeech
  // internally as its first step).
  const [audioReady, setAudioReady] = useState(false);

  // 2026-06-01 — Fix GG: REVERT the D-ID Kevin intro video. Tim's repro
  // across many sessions: video renders visually but audio fires late
  // on the NEXT screen with the captions appearing there instead of
  // on the splash. Confirmed by screenshots showing "Good morning,
  // Tim" captions popping up on the SwingLab tab after the splash
  // ended. Fix GB tried to address by gating Video mount on audio
  // session being configured — that didn't solve it. Going back to
  // the prior bundled-mp3 method per Tim's explicit instruction.
  //
  // Set useKevinIntroVideo=false unconditionally so the Kevin branch
  // takes the bundled-mp3 fallback path that has worked historically.
  // The Video JSX still exists below but is now never rendered. Kept
  // in place (not deleted) so we can re-enable later if/when the
  // audio-session race is properly diagnosed.
  const useKevinIntroVideo = false;
  // Reference + ref values kept so the gated branches and unmount
  // cleanup still type-check; unused at runtime with the toggle off.
  const videoRef = useRef<Video>(null);
  const videoDoneResolveRef = useRef<(() => void) | null>(null);
  // 2026-06-01 — Fix GG: silence unused-var lint on the kept-for-later
  // video ref. It'll be live again when/if the video path is restored.
  void videoRef;
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
  // 2026-05-25 — Bumped from 0.4 → 0.55 of the smaller screen edge so
  // the intro avatar feels more present on phone + Z Fold. Combined
  // with the transform scale below, this gives Kevin's face more
  // pixel area AND crops more of the D-ID side watermarks.
  const avatarSize = Math.min(W, H) * 0.55;
  // 2026-05-25 (fold-open fix) — Static-portrait avatar uses min-edge
  // sizing (circle works on any aspect). The KEVIN VIDEO needs to be
  // sized off SCREEN HEIGHT — on Z Fold open (~2200×1768 landscape)
  // min(W,H)=H so 0.55×H gave a tiny strip floating in the middle of a
  // huge canvas. Sizing video off H directly + capping width at 90% of
  // W keeps it fold-safe AND fills the screen on phone-closed.
  // Reserve ~200px for the caption region below.
  const videoHeight = Math.min((H - 200) * 0.95, W * 1.7);
  const videoWidth = videoHeight * 0.50;
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

  // 2026-06-01 — Fix GB: configure audio session for playback BEFORE
  // the Kevin video gets a chance to render+play. Fire once on mount.
  // configureAudioForSpeech is idempotent + safe to call when already
  // configured. Flipping audioReady afterward gates the <Video>
  // component mount in the JSX below — so on cold launch the video
  // never plays into an unconfigured audio session. On Tim's iOS
  // silent-switch-up case (default audio category respects silent),
  // this is the difference between hearing intro and seeing only the
  // video frames in silence.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await configureAudioForSpeech();
      } catch (e) {
        console.log('[greeting] configureAudioForSpeech failed (proceeding anyway):', e);
      }
      if (!cancelled) setAudioReady(true);
    })();
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

  // 2026-06-01 — Fix GJ: structural fix for the splash audio cut-off.
  // The audio-kickoff effect's deps [greeting, settingsHydrated,
  // audioReady] cause it to re-fire each time a dep flips. EACH
  // re-fire runs the previous run's cleanup BEFORE the new body —
  // and the cleanup calls stopSpeaking() when !naturalEndRef.current.
  // At boot, deps flip multiple times in sequence (settings hydrate,
  // audio session ready, etc). Any stray re-fire AFTER playback
  // started would unload currentSound mid-mp3 — Tim's "2 words then
  // cut off" symptom.
  //
  // Structural fix: gate kickoff on a startedRef so it runs EXACTLY
  // ONCE per mount even if the effect re-fires. Cleanup is now
  // safe to run on every dep flip because it no longer calls
  // stopSpeaking — that's moved to a separate unmount-only effect
  // below that fires ONLY when the component truly unmounts.
  const audioKickoffStartedRef = useRef(false);

  // ── Enter animation + audio kickoff once greeting is picked ────────
  useEffect(() => {
    if (audioKickoffStartedRef.current) return; // already started — don't re-fire
    if (!greeting) return;
    // 2026-05-28 — Fix FS: hold the audio kickoff until settingsStore
    // has hydrated. Persona/voiceGender/language reads below are
    // load-bearing for which audio path runs — kevin-mp3 vs persona TTS.
    // Once `settingsHydrated` flips true, the hook re-renders and this
    // effect re-runs with the persisted values. Animation can still
    // start without the gate, but audio waits.
    if (!settingsHydrated) return;
    // 2026-06-01 — Fix GB: also wait for audioReady. The Kevin video
    // branch below awaits videoDoneResolveRef which only fires when
    // the <Video> component plays through. The <Video> JSX is itself
    // gated on `audioReady` (see render below). Without this gate
    // here too, the effect would start a 12s timer waiting for a
    // video that hasn't mounted yet → ends silent. Effect re-runs
    // when audioReady flips true.
    if (!audioReady) return;

    // 2026-06-01 — Fix GJ: claim the start so the effect can never
    // re-enter mid-playback. Any subsequent dep flip will hit the
    // `audioKickoffStartedRef.current` guard at the top and bail
    // immediately — no double-kickoff, no spurious cleanup running
    // stopSpeaking on the live mp3.
    audioKickoffStartedRef.current = true;

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
        // 2026-05-25 — Two-tier minDisplay. Kevin VIDEO path doesn't
        // need the long floor because the video itself is 6-10s. Non-
        // video paths (Kevin mp3 fallback, Tank/Serena/Harry TTS) MUST
        // hold longer so the user can read the caption — bumped 2s →
        // 4s after Tim caught Tank's splash flashing past too quickly
        // when /api/voice resolved fast for some persona-voice combos.
        const VIDEO_MIN_DISPLAY_MS = 2000;
        const NONVIDEO_MIN_DISPLAY_MS = 4000;

        // 2026-05-25 — Kevin D-ID intro video path. Owns its own audio,
        // so we skip playLocalFile/speak entirely and just wait for the
        // <Video>'s didJustFinish via videoDoneResolveRef. Cap at 12s in
        // case didJustFinish never fires (audio focus loss, etc.) so a
        // stuck video can't trap the user on the greeting screen forever.
        if (useKevinIntroVideo) {
          const minDisplay = new Promise<void>(resolve => setTimeout(resolve, VIDEO_MIN_DISPLAY_MS));
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
          const speakStartedAt = Date.now();
          const minDisplay = new Promise<void>(resolve => setTimeout(resolve, NONVIDEO_MIN_DISPLAY_MS));
          await Promise.all([
            speak(captionForVoice, voiceGender, language as 'en' | 'es' | 'zh', apiUrl, { userInitiated: true }),
            minDisplay,
          ]);
          // 2026-05-25 — If speak() resolved suspiciously fast (<800ms),
          // the audio likely silently failed (voice config issue, network
          // hiccup) — add a "read floor" so the user has time to read the
          // caption text-only. 4500ms after speak resolved is enough to
          // scan a 2-3 line greeting. Doesn't fire on normal audio
          // (typical greeting is 3-5s of audio so speak() takes that long).
          const speakDurMs = Date.now() - speakStartedAt;
          if (speakDurMs < 800) {
            await new Promise<void>(resolve => setTimeout(resolve, 4500 - speakDurMs));
          }
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
        // race against a 4s minimum to guarantee the caption stays readable
        // even on a silent greeting path.
        // userInitiated: true — the user JUST opened the app, so the
        // greeting is user-initiated by definition. Without this flag,
        // isVoiceAllowed silently drops the audio when the persisted
        // trustLevel is 1 (Quiet) — Tim hit this and heard nothing.
        const kevinMp3MinDisplay = new Promise<void>(resolve => setTimeout(resolve, NONVIDEO_MIN_DISPLAY_MS));
        await Promise.all([playLocalFile(asset.localUri, undefined, { userInitiated: true }), kevinMp3MinDisplay]);
        naturalEndRef.current = true;
        if (!skippedRef.current) startTransition();
      } catch (e) {
        console.warn('[greeting] audio playback failed:', e);
        scheduleAdvance(2000);
      }
    })();

    return () => {
      // 2026-06-01 — Fix GJ: dep-change cleanup MUST NOT call
      // stopSpeaking. The audio kickoff is gated by
      // audioKickoffStartedRef so it runs exactly once, but React still
      // runs THIS cleanup on every dep flip (greeting, settingsHydrated,
      // audioReady) and on unmount. If we called stopSpeaking here, any
      // dep flip after playback started would unload currentSound
      // mid-mp3 — the "2 words then cut off" symptom. The unmount-only
      // cleanup below handles orphan-audio silence on true teardown.
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
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
    // 2026-05-28 — Fix FS: `settingsHydrated` added so the effect re-fires
    // once hydration completes (initial pass with hasHydrated=false bails
    // at the new gate above).
    // 2026-06-01 — Fix GB: `audioReady` added for the same reason —
    // effect re-runs after configureAudioForSpeech resolves so the
    // Kevin-video await aligns with the actual <Video> mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greeting, settingsHydrated, audioReady]);

  // 2026-06-01 — Fix GJ: unmount-only cleanup. Runs ONLY when the
  // greeting screen truly unmounts (router.replace → /(tabs)/caddie or
  // back-gesture). Empty deps array means React fires this cleanup
  // exactly once, on real unmount — never on dep flips. Tail-clip
  // defense preserved: skip the stop if playback already ended
  // naturally so we don't risk clipping the last syllable.
  useEffect(() => {
    return () => {
      if (!naturalEndRef.current) {
        void stopSpeaking().catch(() => {});
      }
    };
  }, []);

  // Slow breathing pulse during SPEAKING — opacity 0.94↔1.0 at ~0.45 Hz with
  // sine easing. The previous 0.85↔1.0 / 180ms cycle read as a strobe.
  // 2026-05-25 — Skip the pulse when the D-ID Kevin video is rendering.
  // The video already has natural face/mouth motion; layering an opacity
  // pulse on top read as distracting "blinking" per Tim's on-device feedback.
  useEffect(() => {
    if (phase !== 'SPEAKING' || reduceMotion) return;
    if (useKevinIntroVideo) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.94, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1.00, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduceMotion, useKevinIntroVideo]);

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
              useKevinIntroVideo
                ? {
                    // 2026-05-25 — Big portrait rectangle. Sized off SCREEN
                    // HEIGHT (videoHeight/videoWidth above) so it actually
                    // fills the canvas on Z Fold open (where min(W,H)=H made
                    // the old sizing produce a tiny strip). Aspect 0.50 is
                    // ~11% narrower than the video's 9:16 native aspect, so
                    // ResizeMode COVER auto-crops the sides where the D-ID
                    // watermark panels live; the inner transform scale (1.5)
                    // adds more crop so even ports that ignore aspect-based
                    // cropping hide the side watermarks. NOTE: no transform
                    // on the wrap itself — entry zoom (scale 0.8→1.0) read
                    // as a "pulse" once the video was already moving its
                    // own face/mouth; fade-only is cleaner.
                    width: videoWidth,
                    height: videoHeight,
                    borderRadius: 18,
                    borderColor: colors.accent,
                    opacity,
                    overflow: 'hidden',
                  }
                : {
                    width: avatarSize,
                    height: avatarSize,
                    borderRadius: avatarSize / 2,
                    borderColor: colors.accent,
                    opacity,
                    transform: [{ scale }],
                    overflow: 'hidden',
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
            {useKevinIntroVideo && audioReady ? (
              // 2026-05-25 — With the new narrow portrait wrap
              // (width = 0.55 × height), ResizeMode COVER naturally
              // crops the video's side panels (D-ID watermarks) because
              // the wrap aspect (~0.55) is narrower than the video's
              // (~0.5625). The transform: scale 1.3 is a mild extra
              // zoom for nice face framing; if Android ignores it the
              // narrow-wrap geometry alone still hides watermarks.
              // 2026-06-01 — Fix GB: audioReady gate — see the
              // configureAudioForSpeech effect above. Video mount is
              // deferred until the audio session is configured for
              // playback so the intro is never played into silence
              // (iOS silent-switch / unconfigured-session case).
              <Video
                ref={videoRef}
                source={getCaddieClip('kevin', 'intro') as number}
                style={[styles.avatarPhoto, { transform: [{ scale: 1.5 }] }]}
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
