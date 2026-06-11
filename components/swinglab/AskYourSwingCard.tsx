/**
 * 2026-05-26 — Fix AT: Ask Your Swing card.
 *
 * Conversational vision-grounded Q&A for a specific swing. Lives on
 * the swing detail screen under the PrimaryIssue + Drill cards so the
 * player can dig deeper than the structured analysis:
 *   "Why did I top this?"
 *   "Is my weight shift OK?"
 *   "Show me what to feel on the next swing."
 *
 * The card sends the persisted fault-frame thumbnail (the same one
 * shown next to the diagnosis) plus the player's question to
 * /api/swing-question, which calls Gemini 2.5 Flash first (Bryson-ad
 * parity), then OpenAI gpt-4o, then Anthropic Sonnet as a last resort.
 * The answer comes back in the active caddie's voice and is both
 * shown and spoken aloud.
 *
 * Voice input: tap the mic to record (silence-VAD auto-stops) →
 * Whisper transcribes → fills the question field. Text input is the
 * unchanged path for typed questions.
 *
 * Surfaces ONLY when there's at least one frame source available
 * (visual_reference_path OR perShotAnalysis.visual_reference_path).
 * Sessions without a captured frame stay quiet rather than show an
 * empty affordance.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettingsStore } from '../../store/settingsStore';
import type { CageSession } from '../../store/cageStore';
import { getCaddieName } from '../../lib/persona';
import {
  captureUtterance, speak, configureAudioForSpeech, stopSpeaking,
} from '../../services/voiceService';
import { getApiBaseUrl } from '../../services/apiBase';

interface Props {
  session: CageSession;
}

interface AskResponse {
  answer: string;
  provider: 'gemini' | 'openai' | 'anthropic';
  error?: string;
}

const apiUrl = getApiBaseUrl();

function resolveFrameUri(session: CageSession): string | null {
  if (session.primary_issue?.visual_reference_path) {
    return session.primary_issue.visual_reference_path;
  }
  const perShot = session.shots.find(s => s.perShotAnalysis?.visual_reference_path);
  return perShot?.perShotAnalysis?.visual_reference_path ?? null;
}

export default function AskYourSwingCard({ session }: Props) {
  const { colors } = useTheme();
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const voiceGender = useSettingsStore(s => s.voiceGender);
  const language = useSettingsStore(s => s.language);
  const caddieName = getCaddieName(caddiePersonality);

  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [provider, setProvider] = useState<AskResponse['provider'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const frameUri = resolveFrameUri(session);

  const submitQuestion = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || !frameUri) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setProvider(null);
    try {
      const b64 = await FileSystem.readAsStringAsync(frameUri, { encoding: 'base64' });
      const res = await fetch(`${apiUrl}/api/swing-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: [{ b64, media_type: 'image/jpeg' }],
          question: trimmed,
          context: {
            caddie_name: caddieName,
            club: session.club,
            prior_fault: session.primary_issue?.name ?? null,
            // 2026-05-26 — Pass through GolfFix payload so the answer
            // can riff on the prior read without repeating it. The
            // server prompt told the model "don't recite" — this just
            // gives it grounding when the player asks a follow-up.
            prior_cause: session.primary_issue?.mechanical_breakdown ?? null,
            prior_fix: session.drill_recommendation?.reason ?? null,
            language,
          },
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(typeof errBody.error === 'string' ? errBody.error : `HTTP ${res.status}`);
      }
      const data = (await res.json()) as AskResponse;
      if (!data.answer) throw new Error('Empty answer');
      setAnswer(data.answer);
      setProvider(data.provider);
      // 2026-05-26 — userInitiated:true so the answer speaks even at
      // L1 (Quiet). The user just tapped Ask — that's an explicit
      // invitation to hear the response. [[voice-userinitiated-rule]]
      await configureAudioForSpeech();
      void speak(data.answer, voiceGender, language as 'en' | 'es' | 'zh', apiUrl, { userInitiated: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Question failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [frameUri, caddieName, session, language, voiceGender]);

  const onMic = useCallback(async () => {
    if (listening || busy) return;
    setListening(true);
    try {
      // Stop any currently-speaking answer so the mic doesn't pick it up.
      await stopSpeaking().catch(() => {});
      const heard = await captureUtterance(10_000, apiUrl, language as 'en' | 'es' | 'zh');
      if (heard) {
        setQuestion(heard);
        // Auto-submit so the voice path is true one-tap.
        void submitQuestion(heard);
      }
    } finally {
      setListening(false);
    }
  }, [listening, busy, language, submitQuestion]);

  // Render gate AFTER all hooks (rules-of-hooks): no analyzable frame → no card.
  if (!frameUri) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
        <Text style={[styles.label, { color: colors.accent }]}>ASK {caddieName.toUpperCase()}</Text>
      </View>
      <Text style={[styles.helperText, { color: colors.text_muted }]}>
        Ask anything about this swing — {caddieName} can see the frames.
      </Text>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }]}
          value={question}
          onChangeText={setQuestion}
          placeholder={listening ? 'Listening…' : `e.g. why did I top this one?`}
          placeholderTextColor={colors.text_muted}
          editable={!busy && !listening}
          multiline
          returnKeyType="send"
          onSubmitEditing={() => submitQuestion(question)}
          blurOnSubmit
        />
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={onMic}
          disabled={busy || listening}
          style={[
            styles.iconBtn,
            { borderColor: colors.border, backgroundColor: colors.surface_elevated },
            listening && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
          ]}
          accessibilityRole="button"
          accessibilityLabel={listening ? 'Listening — tap to cancel' : 'Speak your question'}
        >
          <Ionicons
            name={listening ? 'mic' : 'mic-outline'}
            size={18}
            color={listening ? colors.accent : colors.text_primary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => submitQuestion(question)}
          disabled={busy || listening || question.trim().length === 0}
          style={[
            styles.sendBtn,
            { backgroundColor: question.trim().length > 0 && !busy ? colors.accent : colors.surface_elevated },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send question"
        >
          {busy ? (
            <ActivityIndicator size="small" color="#0d1a0d" />
          ) : (
            <>
              <Ionicons name="send" size={14} color={question.trim().length > 0 ? '#0d1a0d' : colors.text_muted} />
              <Text style={[
                styles.sendBtnText,
                { color: question.trim().length > 0 ? '#0d1a0d' : colors.text_muted },
              ]}>Ask</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {answer != null && (
        <View style={[styles.answerCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[styles.answerText, { color: colors.text_primary }]}>{answer}</Text>
          {provider && (
            <Text style={[styles.providerTag, { color: colors.text_muted }]}>
              via {provider}
            </Text>
          )}
        </View>
      )}
      {error && (
        <Text style={[styles.errorText, { color: '#ef4444' }]}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 14,
    borderWidth: 1, padding: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  helperText: { fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  inputRow: { marginTop: 10 },
  input: {
    borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
    fontSize: 14, minHeight: 44, maxHeight: 110,
  },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    gap: 8, marginTop: 8,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10,
    minWidth: 80, justifyContent: 'center',
  },
  sendBtnText: { fontSize: 13, fontWeight: '800' },
  answerCard: {
    marginTop: 12, borderRadius: 10, borderWidth: 1, padding: 12,
  },
  answerText: { fontSize: 14, lineHeight: 21 },
  providerTag: { fontSize: 10, marginTop: 8, letterSpacing: 0.5, textTransform: 'lowercase' },
  errorText: { fontSize: 12, marginTop: 8, fontStyle: 'italic' },
});
