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
import { View, Text, StyleSheet, useWindowDimensions, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { subscribeToCaption, getCurrentCaption, subscribeToSpeaking } from '../services/voiceService';
import { useSettingsStore } from '../store/settingsStore';
import { getCurrentRoute, subscribeRouteChanges, type AudioRoute } from '../services/audioRoutingService';

export default function CaptionStrip(): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const ttsCaptions = useSettingsStore(s => s.ttsCaptions);
  const largeText = useSettingsStore(s => s.largeText);
  const [caption, setCaption] = useState<string | null>(getCurrentCaption());
  // Re-sim P1 — when audio routes through Bluetooth we surface captions
  // automatically *for the duration of the BT connection only*, then ask
  // the user once whether to keep them on permanently. This avoids the
  // silent-surface UX risk flagged in the re-sim (3 of 5 dismissed it
  // as noise the first time).
  const [audioRoute, setAudioRoute] = useState<AudioRoute>(getCurrentRoute());
  const promptShownThisSession = useRef(false);

  useEffect(() => {
    const unsubCaption = subscribeToCaption(setCaption);
    const unsubRoute = subscribeRouteChanges(setAudioRoute);
    // Re-sim P3 — backstop: clear caption when speaking flips false even
    // if notifyCaption(null) was missed (Tom's Bluetooth re-pair edge case).
    const unsubSpeaking = subscribeToSpeaking((speaking) => {
      if (!speaking) setCaption(null);
    });
    return () => { unsubCaption(); unsubRoute(); unsubSpeaking(); };
  }, []);

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

  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={[
        styles.wrap,
        { top: insets.top + 6, maxWidth: screenW - 24 },
      ]}
    >
      <Text style={[styles.text, largeText && styles.textLarge]} numberOfLines={4}>
        {caption}
      </Text>
    </View>
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
