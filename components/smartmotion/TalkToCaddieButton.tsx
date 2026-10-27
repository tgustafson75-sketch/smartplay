/**
 * SmartMotion's "talk to your caddie" button — THE BADGE'S TAP, not a second microphone.
 *
 * 2026-10-27 (capture-half audit C7). The button ran its own captureUtterance and threw away every way
 * it could come back empty: no signal, a failed transcribe, a busy mic. Offline, the player tapped,
 * spoke, and got silence. The caddie badge in the same top bar goes through services/listeningSession
 * `toggle()`, which owns the failure reply (services/caddieFailureReply: answer locally, or say why on
 * evidence), the mic handover and the recording-stop chokepoint. One owner: this button is that tap.
 */
import React from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useListeningSessionStore } from '../../store/listeningSessionStore';
import { toggle as toggleListening } from '../../services/listeningSession';

export interface TalkToCaddieButtonProps {
  style?: StyleProp<ViewStyle>;
  accent: string;
  /** The screen's pressable (SmartMotion's tactile one); a plain Pressable by default. */
  Touchable?: React.ComponentType<React.ComponentProps<typeof Pressable>>;
}

export function TalkToCaddieButton({ style, accent, Touchable = Pressable }: TalkToCaddieButtonProps) {
  const state = useListeningSessionStore((s) => s.state);
  const live = state === 'opening' || state === 'listening';
  return (
    <Touchable
      onPress={() => { void toggleListening(); }}
      style={[style, { backgroundColor: live ? accent : 'rgba(6,15,9,0.72)' }]}
      accessibilityRole="button"
      accessibilityLabel={live ? 'Listening — tap to stop' : 'Talk to your caddie'}
    >
      <Ionicons name={live ? 'mic' : 'mic-outline'} size={18} color={live ? '#06140b' : accent} />
    </Touchable>
  );
}
