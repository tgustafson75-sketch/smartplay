import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { speak, stopSpeaking } from '../services/voiceService';
import { useSettingsStore } from '../store/settingsStore';
import { voiceCommandRouter } from '../services/intents';
import type { AppContext } from '../types/voiceIntent';

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

type Props = {
  surface: string;
};

/**
 * Round "?" button that surfaces voice discovery on demand. Tap → fetches the
 * help-handler response for the current surface, opens a modal showing those
 * capabilities as a readable list, and speaks the same content aloud while the
 * card is visible. Closing the card stops Kevin mid-sentence cleanly.
 *
 * Positioned to the right of Kevin's avatar by the consumer site (Caddie home).
 * Round shape + small footprint = no avatar overlap, easy tap target.
 */
export default function KevinHelpButton({ surface }: Props) {
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handlePress = async () => {
    if (open || loading) return;
    setLoading(true);
    try {
      const ctx: AppContext = {
        active_screen: surface,
        active_round: null,
        current_hole: null,
        recent_shots: [],
        trust_spectrum_level: 2,
      };
      const helpHandler = voiceCommandRouter.getHandler('help');
      if (!helpHandler) return;
      const result = await helpHandler.execute(
        { intent_type: 'help', parameters: {}, confidence: 'high', follow_up_question: null, raw_text: '' },
        ctx,
      );
      const fullText = result.voice_response ?? '';
      // Split into bullet-friendly lines on sentence ends. Keeps any
      // semicolon-separated lists as single bullets so the modal reads cleanly.
      const split = fullText
        .split(/(?<=\.)\s+/)
        .map(s => s.trim())
        .filter(Boolean);
      setLines(split);
      setOpen(true);
      // Fire-and-forget speak — Kevin reads the same content the user is now
      // looking at. If the user closes the modal, handleClose stops him.
      if (voiceEnabled && fullText) {
        speak(fullText, voiceGender, language, apiUrl).catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    setOpen(false);
    try { await stopSpeaking(); } catch {}
  };

  return (
    <>
      <TouchableOpacity
        onPress={handlePress}
        disabled={loading}
        style={styles.btn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="What can I say?"
      >
        <Text style={styles.questionMark}>?</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={handleClose}>
        <TouchableOpacity activeOpacity={1} style={styles.scrim} onPress={handleClose}>
          <TouchableOpacity activeOpacity={1} style={styles.card}>
            <Text style={styles.title}>WHAT YOU CAN SAY</Text>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {lines.length === 0 ? (
                <Text style={styles.empty}>Loading…</Text>
              ) : (
                lines.map((line, i) => (
                  <View key={i} style={styles.row}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.line}>{line}</Text>
                  </View>
                ))
              )}
            </ScrollView>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(13, 36, 24, 0.7)',
    borderWidth: 1.5,
    borderColor: '#00C896',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionMark: {
    color: '#00C896',
    fontSize: 18,
    fontWeight: '900',
    marginTop: -1,
  },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#0d2418',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 18,
    width: '100%',
    maxWidth: 420,
    maxHeight: '70%',
  },
  title: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 12,
    textAlign: 'center',
  },
  scroll: { flexShrink: 1 },
  scrollContent: { gap: 10, paddingBottom: 4 },
  empty: { color: '#6b7280', fontSize: 13, fontStyle: 'italic', textAlign: 'center' },
  row: { flexDirection: 'row', gap: 8 },
  bullet: { color: '#00C896', fontSize: 14, lineHeight: 20 },
  line: { color: '#e8f5e9', fontSize: 14, lineHeight: 20, flex: 1 },
  closeBtn: {
    marginTop: 14,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e3a28',
    borderRadius: 10,
  },
  closeText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
});
