/**
 * PGA HOPE follow-up (A2) — pinned caption strip during voice playback.
 *
 * Renders the caddie's currently-spoken line in a high-contrast pill at
 * the top of the screen for the duration of every TTS utterance. Required
 * for hearing-impaired participants who would otherwise miss persona-swap
 * handoff lines and in-flight tactical reads.
 *
 * Gated by settingsStore.ttsCaptions (default true) so users who don't
 * need captions can hide the chrome. Always-mounted from app/_layout.tsx;
 * renders null when no caption is active.
 */

import React, { useEffect, useState, useRef } from 'react';
import { Animated, Text, StyleSheet, useWindowDimensions, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { subscribeToCaption, getCurrentCaption, subscribeToSpeaking, isSpeaking } from '../services/voiceService';
import { useSettingsStore } from '../store/settingsStore';
import { getCurrentRoute, subscribeRouteChanges, type AudioRoute } from '../services/audioRoutingService';

export default function CaptionStrip(): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const ttsCaptions = useSettingsStore(s => s.ttsCaptions);
  const largeText = useSettingsStore(s => s.largeText);
  const [caption, setCaption] = useState<string | null>(getCurrentCaption());
  const [speaking, setSpeaking] = useState<boolean>(isSpeaking());
  const captionOpacity = useRef(new Animated.Value(1)).current;
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  // 2026-05-16 — Suppress the global caption pill on the Caddie tab.
  // The Caddie tab's Cockpit screen renders its OWN speech bubble for
  // Kevin's latest line (displayText = caddieResponse || openingPrompt),
  // positioned over Kevin's avatar. Showing the global pill on top of
  // that AND the brand row is a visible duplicate (Tim's screenshot
  // showed "Good evening Tim..." rendered twice on the Caddie tab).
  // Every other screen keeps the global caption because they don't have
  // their own speech surface.
  const pathname = usePathname();
  const suppressOnCaddieTab = pathname === '/' || pathname === '/(tabs)/caddie' || pathname.endsWith('/caddie');
  // Re-sim P1 — when audio routes through Bluetooth we surface captions
  // automatically *for the duration of the BT connection only*, then ask
  // the user once whether to keep them on permanently. This avoids the
  // silent-surface UX risk flagged in the re-sim (3 of 5 dismissed it
  // as noise the first time).
  const [audioRoute, setAudioRoute] = useState<AudioRoute>(getCurrentRoute());
  const promptShownThisSession = useRef(false);

  const clearCaptionFade = useRef(() => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (fadeAnimRef.current) {
      fadeAnimRef.current.stop();
      fadeAnimRef.current = null;
    }
  }).current;

  useEffect(() => {
    const unsubCaption = subscribeToCaption(setCaption);
    const unsubRoute = subscribeRouteChanges(setAudioRoute);
    const unsubSpeaking = subscribeToSpeaking((speaking) => {
      setSpeaking(speaking);
      if (speaking) {
        clearCaptionFade();
        captionOpacity.setValue(1);
      }
    });
    return () => {
      clearCaptionFade();
      unsubCaption();
      unsubRoute();
      unsubSpeaking();
    };
  }, [captionOpacity, clearCaptionFade]);

  useEffect(() => {
    if (caption) {
      clearCaptionFade();
      captionOpacity.setValue(1);
    }
  }, [caption, captionOpacity, clearCaptionFade]);

  useEffect(() => {
    if (!caption) return;
    if (speaking) return;
    clearCaptionFade();
    fadeTimerRef.current = setTimeout(() => {
      fadeAnimRef.current = Animated.timing(captionOpacity, {
        toValue: 0,
        duration: 1000,
        useNativeDriver: true,
      });
      fadeAnimRef.current.start(({ finished }) => {
        if (finished && !isSpeaking()) {
          setCaption(null);
        }
      });
    }, 6000);

    return () => clearCaptionFade();
  }, [caption, speaking, captionOpacity, clearCaptionFade]);

  // First-time Bluetooth + active speech: ask once whether to keep on.
  useEffect(() => {
    if (audioRoute !== 'bluetooth') return;
    if (!caption) return;
    if (ttsCaptions) return;
    if (promptShownThisSession.current) return;
    const s = useSettingsStore.getState();
    if (s.ttsCaptionsBluetoothPrompt !== 'unasked') return;
    promptShownThisSession.current = true;
    s.setTtsCaptionsBluetoothPrompt('asked');
    Alert.alert(
      'Captions on for Bluetooth audio',
      'You’re on Bluetooth — caddie speech is hard to hear in carts. Want to keep captions on after you disconnect too?',
      [
        { text: 'Don’t ask again', style: 'destructive', onPress: () => s.setTtsCaptionsBluetoothPrompt('never') },
        { text: 'Just for Bluetooth', style: 'cancel' },
        { text: 'Keep them on', onPress: () => s.setTtsCaptions(true) },
      ],
    );
  }, [audioRoute, caption, ttsCaptions]);

  // Effective visibility: explicit user setting wins; otherwise auto-on
  // while Bluetooth is the active route, unless the user said "never".
  const btPromptState = useSettingsStore(s => s.ttsCaptionsBluetoothPrompt);
  const bluetoothAutoOn = audioRoute === 'bluetooth' && btPromptState !== 'never';
  const effectiveCaptionsOn = ttsCaptions || bluetoothAutoOn;
  if (!effectiveCaptionsOn) return null;
  if (!caption) return null;
  // Suppress on Caddie tab — Cockpit speech bubble handles this surface.
  if (suppressOnCaddieTab) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessible
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={[
        styles.wrap,
        { top: insets.top + 6, maxWidth: screenW - 24, opacity: captionOpacity },
      ]}
    >
      <Text style={[styles.text, largeText && styles.textLarge]} numberOfLines={4}>
        {caption}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(6,15,9,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.6)',
    zIndex: 10000,
  },
  text: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
    textAlign: 'center',
  },
  textLarge: {
    fontSize: 18,
    lineHeight: 24,
  },
});
