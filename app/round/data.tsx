/**
 * 2026-09-29 (Tim: "an icon that would just show the data as this mode did") — THE ROUND DATA VIEW.
 *
 * The v2 "cockpit" layout — hole / shots / putts steppers, live FRONT · CENTER · BACK, the quick
 * shot row and the tools — was retired as a Caddie-tab LAYOUT on 2026-08-26, but the screen itself
 * (components/caddie/CockpitCaddieScreen) and all of its data logic survived intact and unreachable.
 * This route is its new door: one tap from the Caddie tab, no layout switching, nothing else moves.
 *
 * It does not own a voice pipeline of its own. The mic is the one global listening session (the same
 * one the bottom caddie bar drives), so there is never a second recorder alive, and the SmartFinder /
 * SmartVision openers are CockpitCaddieScreen's own plan-gated fallbacks.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import CockpitCaddieScreen from '../../components/caddie/CockpitCaddieScreen';
import { useListeningSessionStore, type ListeningState } from '../../store/listeningSessionStore';
import type { VoiceState } from '../../components/CaddieAvatar';
import { safeBack } from '../../services/safeBack';

/** The listening session's states, in the avatar's vocabulary the cockpit header speaks. */
const VOICE_STATE_FOR: Record<ListeningState, VoiceState> = {
  idle: 'idle',
  opening: 'arming',
  listening: 'listening',
  thinking: 'thinking',
  responding: 'speaking',
};

export default function RoundDataScreen() {
  const session = useListeningSessionStore((s) => s.state);
  return (
    <View style={styles.fill}>
      <CockpitCaddieScreen
        voiceState={VOICE_STATE_FOR[session] ?? 'idle'}
        caddieResponse=""
        onClose={() => safeBack()}
        onMicPress={() => {
          try {
            void (require('../../services/listeningSession') as typeof import('../../services/listeningSession')).toggle();
          } catch { /* the mic is best-effort from here; the bottom bar still works */ }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
