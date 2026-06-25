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

  // 2026-06-24 (Tim — "once it lets you pass the splash, Caddie should be warm").
  // The intro video is a guaranteed 5-7s window with the user just watching — use
  // it to heat the whole voice chain (transcribe + brain + TTS) so the FIRST real
  // turn after the splash isn't a cold 12-15s wait. force=true bypasses the dedupe;
  // gated on voiceEnabled. Fire-and-forget; never blocks the video/exit.
  useEffect(() => {
    if (!useSettingsStore.getState().voiceEnabled) return;
    void import('../services/voiceWarmup').then(m => m.prewarmVoice(true)).catch(() => {});
  }, []);

  // Reveal the Skip button after the first second so the user has an
  // out within ~1s if they don't want to watch.
  useEffect(() => {
    const t = setTimeout(() => setShowSkip(true), 800);
    return () => clearTimeout(t);
  }, []);

  // 2026-05-27 — Fix EI: REMOVED the Audio.setAudioModeAsync call
  // that lived here. It was scaffolding for an optional ball-drop
  // sound (still commented out below) but was actively muddying the
  // app's audio session BEFORE voiceService had a chance to configure
  // it for speech. Tim's report: "ever since we put the mp4 video
  // splash intro, our voice behavior has not worked right." This
  // setAudioModeAsync call ran on cold-launch, partially set the
  // session (only 2 of 7 fields), and bypassed voiceService's
  // setAudioModeSerial queue — meaning the next configureAudioForSpeech
  // could race with this orphan write and the OS session ended up in
  // a state where playback loaded but didn't emit (matches the
  // silence symptom). Removing the call entirely: the video is
  // muted (line ~140), so it needs NO audio session at all. When the
  // ball-drop sound is wired up, it should route through
  // voiceService's setAudioModeSerial to stay coordinated.

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
