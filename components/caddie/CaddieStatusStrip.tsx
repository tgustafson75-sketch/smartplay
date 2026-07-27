/**
 * 2026-07-25/26 (Tim) — the ONE universal caddie text/state display. Reads the existing signals the
 * voice pipeline already broadcasts (listening-session state + the voiceService caption = the caddie's
 * spoken words on every speak() + the speaking flag) and shows one of:
 *   • "Listening…" (mic open) · "Thinking…" (brain working)
 *   • the caddie's WORDS while it speaks (so you SEE the answer, not just hear it)
 * Hidden when idle. pointerEvents=none so it never blocks taps.
 *
 * Two placements:
 *   - default: inline, sits directly above the GlobalCaddieBar (every normal screen).
 *   - floating: an absolute overlay for the full-screen CAPTURE screens (SmartMotion, Coach lesson)
 *     where the full bar can't go (it would shrink the camera). Same look, floats over the camera
 *     above the record controls. `bottomOffset` positions it clear of each screen's controls.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useListeningSessionStore } from '../../store/listeningSessionStore';
import { subscribeToCaption, subscribeToSpeaking } from '../../services/voiceService';
import { useSettingsStore } from '../../store/settingsStore';

const NEON = '#88F700';

export function CaddieStatusStrip({ floating = false, bottomOffset = 120 }: { floating?: boolean; bottomOffset?: number }) {
  const state = useListeningSessionStore((s) => s.state);
  // 2026-07-27 (full-app audit) — the OLD top CaptionStrip honored this opt-out; this newer strip didn't,
  // silently defeating "captions off". Respect it here too.
  const ttsCaptions = useSettingsStore((s) => s.ttsCaptions);
  const pathname = usePathname();
  const [caption, setCaption] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    const unCap = subscribeToCaption(setCaption);
    const unSpk = subscribeToSpeaking(setSpeaking);
    return () => { unCap(); unSpk(); };
  }, []);
  // 2026-07-27 (full-app audit — caption bleed) — this is a single global instance (mounted in
  // GlobalCaddieBar) whose caption state was never reset by route, so a line spoken on one screen (or a
  // 6.5s muted flash) lingered onto unrelated screens. Clear it on navigation so a caption only shows on
  // the screen it fired on; a new speak on the next screen re-sets it immediately.
  useEffect(() => { setCaption(null); }, [pathname]);

  const cap = caption?.trim() || '';
  let label: string | null = null;
  let icon: React.ComponentProps<typeof Ionicons>['name'] = 'ellipse';
  let speakingStyle = false;
  // 2026-07-27 (Tim — "always see what the caddie says", every line incl. proactive) — show the caption
  // whenever there IS one and captions aren't turned off. A "speaking" treatment only when audio is
  // actually playing; a muted flash gets a text glyph (no false audio cue).
  if (cap && ttsCaptions) { label = cap; icon = speaking ? 'volume-medium' : 'chatbox-ellipses'; speakingStyle = true; }
  else if (state === 'thinking') { label = 'Thinking…'; icon = 'ellipsis-horizontal'; }
  else if (state === 'listening') { label = 'Listening…'; icon = 'mic'; }
  else if (state === 'opening') { label = 'One sec…'; icon = 'ellipsis-horizontal'; }
  if (!label) return null;

  return (
    <View style={floating ? [strip.wrap, strip.floating, { bottom: bottomOffset }] : strip.wrap} pointerEvents="none">
      <View style={[strip.pill, speakingStyle && strip.pillSpeaking]}>
        <Ionicons name={icon} size={14} color={NEON} style={{ marginTop: 1 }} />
        <Text style={strip.text} numberOfLines={speakingStyle ? 4 : 1}>{label}</Text>
      </View>
    </View>
  );
}

const strip = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingBottom: 6, alignItems: 'stretch' },
  floating: { position: 'absolute', left: 6, right: 6, zIndex: 20, paddingBottom: 0 },
  pill: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(6,15,9,0.94)', borderRadius: 16, borderWidth: 1,
    borderColor: 'rgba(136,247,0,0.45)', paddingHorizontal: 12, paddingVertical: 8,
  },
  pillSpeaking: { borderColor: 'rgba(136,247,0,0.7)' },
  text: { flex: 1, color: '#e8f5e9', fontSize: 13, fontWeight: '600', lineHeight: 18 },
});
