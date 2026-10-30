/**
 * SmartMotion's "talk to your caddie" button — THE BADGE'S TAP, not a second microphone.
 *
 * 2026-10-27 (capture-half audit C7). The button ran its own captureUtterance and threw away every way
 * it could come back empty: no signal, a failed transcribe, a busy mic. Offline, the player tapped,
 * spoke, and got silence. The caddie badge in the same top bar goes through services/listeningSession
 * `toggle()`, which owns the failure reply (services/caddieFailureReply: answer locally, or say why on
 * evidence), the mic handover and the recording-stop chokepoint. One owner: this button is that tap.
 *
 * 2026-10-28 (recheck VC-R3-3) — and it takes that tap's LOOK. While the caddie thinks, toggle() drops a
 * tap (a buzz and nothing else); this button kept its idle look and "Talk to your caddie", so the player
 * kept pressing a control that was ignoring him. Same rule as the badge and the bottom bar: micTapLook.
 */
import React from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useListeningSessionStore } from '../../store/listeningSessionStore';
import { toggle as toggleListening } from '../../services/listeningSession';
import { micTapLook } from '../../services/voice/tapIsDroppedIn';

export interface TalkToCaddieButtonProps {
  style?: StyleProp<ViewStyle>;
  accent: string;
  /** The screen's pressable (SmartMotion's tactile one); a plain Pressable by default. */
  Touchable?: React.ComponentType<React.ComponentProps<typeof Pressable>>;
}

export function TalkToCaddieButton({ style, accent, Touchable = Pressable }: TalkToCaddieButtonProps) {
  const { t } = useTranslation();
  const state = useListeningSessionStore((s) => s.state);
  const live = state === 'opening' || state === 'listening';
  const micLook = micTapLook(state);
  return (
    <Touchable
      onPress={() => { void toggleListening(); }}
      style={[style, { backgroundColor: live ? accent : 'rgba(6,15,9,0.72)', opacity: micLook.opacity }]}
      accessibilityRole="button"
      accessibilityLabel={micLook.dropped
        ? t('smartmotion_talk_to_caddie_button.accessibility_label.caddie_is_thinking')
        : live
          ? t('smartmotion_talk_to_caddie_button.accessibility_label.listening_tap_to_stop')
          : t('smartmotion_talk_to_caddie_button.accessibility_label.talk_to_your_caddie')}
      accessibilityState={{ disabled: micLook.dropped }}
    >
      <Ionicons name={live ? 'mic' : 'mic-outline'} size={18} color={live ? '#06140b' : accent} />
    </Touchable>
  );
}
