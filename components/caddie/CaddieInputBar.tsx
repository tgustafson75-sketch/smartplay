/**
 * 2026-07-24 (Tim — beta: "users would rather TYPE than talk; the caddie mic surface is fragmented and
 * clashing"). THE one unified caddie input: a mic + a text box, identical on every screen. You can TALK
 * (tap the mic) or TYPE (the field) — both route through the SAME brain, so "what's my 7 iron", "pull up
 * Doral", "start a lesson" work whether spoken or typed.
 *
 * Deliberately thin + SAFE: it does NOT reimplement the frozen live-listening loop. It composes the two
 * existing, working entry points —
 *   - mic  → listeningSession.toggle()          (the exact same tap-to-talk the badge/earbud use)
 *   - text → handleTranscribedUtterance(text)   (local precheck → classifier → handler → speak; offline-first)
 * — so adopting it can't change voice behavior. It's the clean surface the fragmented mics collapse into.
 *
 * Additive: this component is unused until a screen mounts it. Rollout is one screen at a time (verify on
 * device), starting where the caddie interaction lives, before it replaces the floating GlobalCaddieMic.
 */
import React, { useState, useCallback } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Keyboard, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { CaddieMicBadge } from './CaddieMicBadge';
import { useListeningSessionStore } from '../../store/listeningSessionStore';
import { handleTranscribedUtterance } from '../../services/listeningSession';

export interface CaddieInputBarProps {
  /** Placeholder in the text field. */
  placeholder?: string;
  /** Mic diameter (px). The bar sizes around it. */
  micSize?: number;
}

/**
 * The unified caddie input. Talk (mic) OR type (field) — one surface, one brain.
 */
export function CaddieInputBar({ placeholder = 'Ask or tell your caddie…', micSize = 40 }: CaddieInputBarProps) {
  const { colors } = useTheme();
  const listeningState = useListeningSessionStore((s) => s.state);
  const busy = listeningState === 'thinking' || listeningState === 'responding';
  const [text, setText] = useState('');
  // 2026-08-01 (tester — "need to be able to minimize the keyboard"). Track focus so a chevron-down
  // dismiss button appears while the keyboard is up (returnKey is "send", so there was no way to just
  // close the keyboard without sending).
  const [focused, setFocused] = useState(false);
  const s = makeStyles(colors);

  const submit = useCallback(() => {
    const q = text.trim();
    if (!q) return;
    setText('');
    Keyboard.dismiss();
    try { Haptics.selectionAsync().catch(() => {}); } catch { /* haptics optional */ }
    // Route the TYPED question through the SAME brain the voice path uses (offline-first precheck →
    // classifier → handler → spoken/shown reply). Fire-and-forget; the reply surfaces via the normal
    // caddie response path. Never throws.
    void handleTranscribedUtterance(q).catch(() => {});
  }, [text]);

  return (
    <View style={s.bar}>
      {/* While typing, the mic slot becomes a keyboard-dismiss button so you can minimize the keyboard
          without sending (tester request). Off-focus it's the tap-to-talk mic as everywhere else. */}
      {focused ? (
        <TouchableOpacity
          onPress={() => Keyboard.dismiss()}
          style={s.send}
          accessibilityRole="button"
          accessibilityLabel="Hide keyboard"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-down" size={20} color="#0d1a0d" />
        </TouchableOpacity>
      ) : (
        <CaddieMicBadge size={micSize} accessibilityLabel="Tap to talk to your caddie" />
      )}
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
      <TouchableOpacity
        onPress={submit}
        disabled={!text.trim()}
        style={[s.send, { opacity: text.trim() ? 1 : 0.35 }]}
        accessibilityRole="button"
        accessibilityLabel="Send to caddie"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="arrow-up" size={18} color="#0d1a0d" />
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 28,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    input: {
      flex: 1,
      color: colors.text_primary,
      fontSize: 16,
      paddingVertical: Platform.OS === 'ios' ? 8 : 4,
      paddingHorizontal: 4,
    },
    send: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}

export default CaddieInputBar;
