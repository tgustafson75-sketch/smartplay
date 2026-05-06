/**
 * First-launch intro video.
 *
 * Plays the brand intro animation exactly ONCE per install. After the
 * first successful play (OR skip OR error), tutorialsSeen.intro_video
 * flips true and the user never sees this screen again.
 *
 * Defensive design: every failure path routes the user OUT of this
 * screen to the next step in the cold-launch flow. A corrupt video
 * file, codec mismatch, missing asset, or stuck playback can never
 * strand the user on a black screen.
 *
 * Audio: the bundled video plays MUTED. The hole-in-cup sound is
 * intended to play as a separate expo-av Sound asset overlaid on top
 * (file slot at assets/intro/ball_drop.mp3). If the sound asset is
 * missing the video plays silent — that's intentional, NOT a bug.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { Video, ResizeMode, Audio, type AVPlaybackStatus } from 'expo-av';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettingsStore } from '../store/settingsStore';

// Cap how long we'll sit on this screen no matter what. 5s video + 2s
// safety margin. If playback hasn't reported didJustFinish by then we
// move on — covers stuck-loading, codec stalls, and other dark corners.
const HARD_TIMEOUT_MS = 7_000;

export default function IntroVideoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const videoRef = useRef<Video | null>(null);
  const exitedRef = useRef(false);
  const ballDropRef = useRef<Audio.Sound | null>(null);
  const [showSkip, setShowSkip] = useState(false);

  // Single exit path. Marks the tutorial seen so a relaunch doesn't
  // replay, unloads any audio, then routes the user forward. Idempotent
  // — multiple callers (end-of-video / skip / error / timeout) all
  // converge here without causing nav-stack churn.
  const exit = React.useCallback((reason: 'finished' | 'skipped' | 'error' | 'timeout') => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    try { useSettingsStore.getState().markTutorialSeen('intro_video'); } catch { /* never block exit on store error */ }
    if (ballDropRef.current) {
      ballDropRef.current.unloadAsync().catch(() => {});
      ballDropRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.stopAsync().catch(() => {});
    }
    console.log('[intro-video] exit:', reason);
    // Bounce back through the index router so it picks the right next
    // step (onboarding vs greeting vs caddie) using the same logic as
    // a normal cold launch — we don't have to duplicate it here.
    try { router.replace('/'); } catch { /* ignore */ }
  }, [router]);

  // Hard timeout safety net. If the video never finishes (codec stall,
  // muted file, malformed mp4), we still hand the user off to the home
  // flow within 7 seconds.
  useEffect(() => {
    const t = setTimeout(() => exit('timeout'), HARD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [exit]);

  // Reveal the Skip button after the first second so the user has an
  // out within ~1s if they don't want to watch.
  useEffect(() => {
    const t = setTimeout(() => setShowSkip(true), 800);
    return () => clearTimeout(t);
  }, []);

  // Pre-load the optional ball-drop sound. Failure to load is silent —
  // the video itself plays muted, so the worst case is "no sound."
  useEffect(() => {
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
        }).catch(() => {});
        // Optional asset — if the file isn't there yet, the require()
        // would be a build-time error, so we leave it commented until
        // the audio file is dropped at assets/intro/ball_drop.mp3.
        // Once added, uncomment this block and the trigger effect below
        // and the sound layers in over the muted video at ~3.2s.
        //
        // const { sound } = await Audio.Sound.createAsync(
        //   require('../assets/intro/ball_drop.mp3'),
        //   { volume: 0.85, shouldPlay: false },
        // );
        // ballDropRef.current = sound;
      } catch (e) {
        console.log('[intro-video] ball-drop preload failed (non-fatal):', e);
      }
    })();
  }, []);

  // Trigger the ball-drop sound at a hand-tuned offset into the video
  // (3.2s — close to where the ball drops in the typical golf cup
  // animation). Tweak after you've watched the final cut.
  useEffect(() => {
    if (!ballDropRef.current) return;
    const sound = ballDropRef.current;
    const t = setTimeout(() => {
      sound.replayAsync().catch(() => {});
    }, 3200);
    return () => clearTimeout(t);
  }, []);

  const onPlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      // Loading error — bail out cleanly.
      if ('error' in status && status.error) {
        console.log('[intro-video] playback error:', status.error);
        exit('error');
      }
      return;
    }
    if (status.didJustFinish) {
      exit('finished');
    }
  };

  return (
    <View style={styles.container} accessibilityLabel="Intro video">
      <Video
        ref={videoRef}
        source={require('../assets/intro/intro_video.mp4')}
        style={[styles.video, { width: screenW, height: screenH }]}
        resizeMode={ResizeMode.COVER}
        shouldPlay
        isLooping={false}
        // Muted — ball-drop sound (when present) plays as a separate
        // overlaid Audio.Sound. Music in the source file is suppressed.
        isMuted
        onPlaybackStatusUpdate={onPlaybackStatusUpdate}
        onError={(e) => {
          console.log('[intro-video] <Video> onError:', e);
          exit('error');
        }}
      />

      {showSkip && (
        <TouchableOpacity
          onPress={() => exit('skipped')}
          style={[styles.skipBtn, { top: insets.top + 12 }]}
          accessibilityRole="button"
          accessibilityLabel="Skip intro video"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    position: 'absolute',
  },
  skipBtn: {
    position: 'absolute',
    right: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  skipText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
});
