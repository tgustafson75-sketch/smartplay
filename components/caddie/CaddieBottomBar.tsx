/**
 * 2026-07-24 (Tim — the ONE clean caddie surface). A persistent bottom bar, identical on every screen:
 *
 *     [ ‹ back ]   ( 🎙 neon mic )   [ ask or tell your caddie… ]   [ › forward ]
 *
 * It solves TWO things at once, cleanly, at the bottom (clearing the top nav / chevron overlap):
 *   - NAVIGATION — the ‹ › chevrons are universal page back/forward (see services/navHistory).
 *   - CADDIE INPUT — talk (the neon mic, a green-outline version of the brand caddie) OR type (the
 *     field). Both route through the SAME brain, so the upper-left caddie badge can become a STATIC logo.
 *
 * SAFE by construction: it composes the two EXISTING entry points and does NOT touch the frozen live-
 * listening loop:
 *   - mic  → listeningSession.toggle()
 *   - text → handleTranscribedUtterance()   (local precheck → classifier → handler → reply; offline-first)
 * Additive — unused until a screen mounts it; rollout is one screen at a time, device-verified.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Keyboard, Platform, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// 2026-07-24 (Tim) — THE caddie mic mark: the neon SmartPlay caddie SPEAKING (head + sound waves),
// cropped out of the brand logo (ring + name removed). It literally shows the caddie talking → the
// perfect, on-brand tap-to-talk button.
const MIC_CADDIE = require('../../assets/icons/caddie/mic-caddie.png');
import * as Haptics from 'expo-haptics';
import { router, usePathname } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { safeBack } from '../../services/safeBack';
import { toggle as toggleListening } from '../../services/listeningSession';
import { handleTranscribedUtterance } from '../../services/listeningSession';
import { useTourTarget } from '../../hooks/useTourTarget';
import { useListeningSessionStore } from '../../store/listeningSessionStore';
import {
  markChevronNav, consumeChevronNav, pushForward, popForward, hasForward, clearForward,
} from '../../services/navHistory';

// Brand neon green (matches the caddie voice-state cue).
const NEON = '#88F700';

export interface CaddieBottomBarProps {
  placeholder?: string;
}

export function CaddieBottomBar({ placeholder = 'Ask or tell your caddie…' }: CaddieBottomBarProps) {
  const { colors } = useTheme();
  const pathname = usePathname();
  const listeningState = useListeningSessionStore((s) => s.state);
  const isListening = listeningState === 'listening';
  const busy = listeningState === 'thinking' || listeningState === 'responding';
  const [text, setText] = useState('');
  const [canForward, setCanForward] = useState(false);
  // 2026-08-01 (tester — "need to be able to minimize the keyboard"). When the field is focused and
  // empty, the right slot becomes a keyboard-dismiss button (returnKey is "send", so there was no way
  // to just close the keyboard without sending).
  const [focused, setFocused] = useState(false);
  // 2026-08-01 (tester — clean spotlights) — register the bar + mic bounds so the first-run tour can
  // spotlight the actual on-screen elements.
  const barTarget = useTourTarget('caddie.bar');
  const micTarget = useTourTarget('caddie.mic');
  const s = makeStyles(colors);

  // Browser-style forward stack: a NORMAL navigation (not chevron-driven) clears forward.
  useEffect(() => {
    if (!consumeChevronNav()) clearForward();
    setCanForward(hasForward());
  }, [pathname]);

  const goBack = useCallback(() => {
    try { Haptics.selectionAsync().catch(() => {}); } catch { /* optional */ }
    markChevronNav();
    pushForward(pathname);          // so › can return here
    safeBack();
    setCanForward(true);
  }, [pathname]);

  const goForward = useCallback(() => {
    const r = popForward();
    if (!r) return;
    try { Haptics.selectionAsync().catch(() => {}); } catch { /* optional */ }
    markChevronNav();
    try { router.push(r as never); } catch { /* route may be gone — no-op */ }
    setCanForward(hasForward());
  }, []);

  const submit = useCallback(() => {
    const q = text.trim();
    if (!q) return;
    setText('');
    Keyboard.dismiss();
    try { Haptics.selectionAsync().catch(() => {}); } catch { /* optional */ }
    void handleTranscribedUtterance(q).catch(() => {});
  }, [text]);

  const onMic = useCallback(() => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); } catch { /* optional */ }
    try { toggleListening(); } catch { /* toggle guards itself */ }
  }, []);

  return (
    <View style={s.bar} ref={barTarget.ref} onLayout={barTarget.onLayout}>
      {/* ‹ universal page back */}
      <TouchableOpacity onPress={goBack} style={s.chevron} accessibilityRole="button" accessibilityLabel="Back"
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
        <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
      </TouchableOpacity>

      {/* The neon caddie SPEAKING = tap to talk (same listeningSession as everywhere) */}
      <TouchableOpacity
        ref={micTarget.ref}
        onLayout={micTarget.onLayout}
        onPress={onMic}
        style={[s.mic, isListening && s.micActive]}
        accessibilityRole="button"
        accessibilityLabel="Tap to talk to your caddie"
      >
        <Image source={MIC_CADDIE} style={s.micImg} resizeMode="contain" />
      </TouchableOpacity>

      <TextInput
        style={s.input}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.text_muted}
        returnKeyType="send"
        onSubmitEditing={submit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        blurOnSubmit={false}
        editable={!busy}
        accessibilityLabel="Type a question or command for your caddie"
      />

      {text.trim() ? (
        <TouchableOpacity onPress={submit} style={s.send} accessibilityRole="button" accessibilityLabel="Send to caddie">
          <Ionicons name="arrow-up" size={18} color="#0d1a0d" />
        </TouchableOpacity>
      ) : focused ? (
        // Keyboard is up with an empty field → tap to minimize it (tester request).
        <TouchableOpacity onPress={() => Keyboard.dismiss()} style={s.chevron}
          accessibilityRole="button" accessibilityLabel="Hide keyboard"
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
          <Ionicons name="chevron-down" size={24} color={colors.text_primary} />
        </TouchableOpacity>
      ) : (
        // › universal page forward (disabled/dim when there's nowhere forward)
        <TouchableOpacity onPress={goForward} disabled={!canForward} style={[s.chevron, { opacity: canForward ? 1 : 0.3 }]}
          accessibilityRole="button" accessibilityLabel="Forward"
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
          <Ionicons name="chevron-forward" size={24} color={colors.text_primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    // 2026-07-24 (Tim — "not sure the new bar at the bottom is visible enough"). Give it a
    // neon-tinted border + soft green glow so it reads as THE branded caddie surface, not a
    // muted input strip. Taller pad + darker fill lift it off the page behind it.
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 9,
      borderRadius: 26,
      backgroundColor: '#0d1a0d',
      borderWidth: 1.5,
      borderColor: 'rgba(136,247,0,0.6)',
      shadowColor: NEON,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.35,
      shadowRadius: 9,
      elevation: 7,
    },
    chevron: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    // The caddie mark IS the button (the neon speaking-caddie), sized to its wide aspect. A soft neon
    // glow behind it when actively listening so it visibly "wakes up".
    mic: {
      width: 50, height: 38, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent',
    },
    micActive: { backgroundColor: 'rgba(136,247,0,0.18)', borderWidth: 1, borderColor: NEON },
    micImg: { width: 46, height: 32 },
    input: {
      flex: 1,
      color: colors.text_primary,
      fontSize: 16,
      paddingVertical: Platform.OS === 'ios' ? 8 : 4,
      paddingHorizontal: 4,
    },
    send: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    },
  });
}

export default CaddieBottomBar;
