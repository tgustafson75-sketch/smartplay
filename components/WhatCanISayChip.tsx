import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useSettingsStore } from '../store/settingsStore';
import { speak } from '../services/voiceService';
import { voiceCommandRouter } from '../services/intents';
import type { AppContext } from '../types/voiceIntent';

interface Props {
  /** Active screen for help discovery context. */
  surface: string;
  /** Optional style override (e.g. positioning). */
  style?: object;
}

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

/**
 * Subtle chip that surfaces voice discovery on demand. Tapping it speaks the
 * available voice actions for the current screen via the helpHandler.
 *
 * Styling stays low-contrast so the chip is easy to ignore once the user knows
 * about it — the goal is "discoverable when needed, invisible when not."
 */
export default function WhatCanISayChip({ surface, style }: Props) {
  const { colors } = useTheme();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const [busy, setBusy] = useState(false);

  const handlePress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ctx: AppContext = {
        active_screen: surface,
        active_round: null,
        current_hole: null,
        recent_shots: [],
        trust_spectrum_level: 2,
      };
      // Direct help handler dispatch — bypasses the parser since the user already
      // told us what they want.
      const helpHandler = voiceCommandRouter.getHandler('help');
      if (!helpHandler) return;
      const result = await helpHandler.execute(
        { intent_type: 'help', parameters: {}, confidence: 'high', follow_up_question: null, raw_text: '' },
        ctx,
      );
      if (result.voice_response && voiceEnabled) {
        await speak(result.voice_response, voiceGender, language, apiUrl).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={[styles.chip, { borderColor: colors.border, backgroundColor: 'transparent' }, style]}
      disabled={busy}
    >
      <Text style={[styles.text, { color: colors.text_muted, opacity: busy ? 0.4 : 0.7 }]}>
        {busy ? '…' : 'What can I say?'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
});
