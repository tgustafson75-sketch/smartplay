import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { voiceCommandRouter } from '../services/intents';
import { useRoundStore } from '../store/roundStore';
import type { AppContext, VoiceIntent, IntentResult } from '../types/voiceIntent';
import { useDebugRouteGate } from '../hooks/useDebugRouteGate';

export default function VoiceDebugScreen() {
  const _gateAllowed = useDebugRouteGate();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<VoiceIntent | null>(null);
  const [result, setResult] = useState<IntentResult | null>(null);
  const [running, setRunning] = useState(false);

  const buildContext = (): AppContext => {
    const round = useRoundStore.getState();
    return {
      active_screen: 'voice-debug',
      active_round: round.isRoundActive
        ? {
            course: round.activeCourse,
            mode: round.mode,
            holesPlayed: round.getHolesPlayed(),
            totalScore: round.getTotalScore(),
            scoreVsPar: round.getScoreVsPar(),
          }
        : null,
      current_hole: round.currentHole,
      recent_shots: round.shots.slice(-5),
      trust_spectrum_level: 2,
    };
  };

  const onParseOnly = async () => {
    setRunning(true);
    setResult(null);
    try {
      const intent = await voiceCommandRouter.parse(text, buildContext(), apiUrl);
      setParsed(intent);
    } finally {
      setRunning(false);
    }
  };

  const onRouteFull = async () => {
    setRunning(true);
    try {
      const out = await voiceCommandRouter.route(text, buildContext(), apiUrl);
      setParsed(out.intent);
      setResult(out.result);
    } finally {
      setRunning(false);
    }
  };

  const handlers = voiceCommandRouter.getRegisteredHandlers();
  const history = voiceCommandRouter.getHistory().slice().reverse();

  // 2026-05-17 — gate check AFTER all hooks (Rules of Hooks)
  if (!_gateAllowed) return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color="#9ca3af" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Voice Debug</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.section}>Test intent</Text>
        <TextInput
          style={styles.input}
          placeholder='e.g. "open SmartVision"'
          placeholderTextColor="#4b5563"
          value={text}
          onChangeText={setText}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={onParseOnly}
            disabled={running || !text.trim()}
          >
            <Text style={styles.btnSecondaryText}>{running ? '…' : 'Parse only'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={onRouteFull}
            disabled={running || !text.trim()}
          >
            <Text style={styles.btnPrimaryText}>{running ? '…' : 'Route + execute'}</Text>
          </TouchableOpacity>
        </View>

        {parsed && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Parsed intent</Text>
            <Text style={styles.code}>{JSON.stringify(parsed, null, 2)}</Text>
          </View>
        )}

        {result && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Handler result</Text>
            <Text style={styles.code}>{JSON.stringify(result, null, 2)}</Text>
          </View>
        )}

        <Text style={styles.section}>Registered intents ({handlers.length})</Text>
        {handlers.map(h => (
          <View key={h.intent_type} style={styles.card}>
            <Text style={styles.handlerName}>{h.intent_type}</Text>
            {Object.keys(h.parameter_schema).length > 0 && (
              <Text style={styles.code}>{JSON.stringify(h.parameter_schema, null, 2)}</Text>
            )}
            <Text style={styles.examplesLabel}>Examples:</Text>
            {h.examples.map((ex, i) => (
              <Text key={i} style={styles.example}>• {ex}</Text>
            ))}
          </View>
        ))}

        <View style={styles.historyHeader}>
          <Text style={styles.section}>Recent routes ({history.length})</Text>
          {history.length > 0 && (
            <TouchableOpacity onPress={() => { voiceCommandRouter.clearHistory(); setParsed(null); setResult(null); }}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        {history.length === 0 ? (
          <Text style={styles.empty}>No routes yet.</Text>
        ) : history.map((log, i) => (
          <View key={i} style={styles.card}>
            <Text style={styles.timestamp}>{new Date(log.timestamp).toLocaleTimeString()}</Text>
            <Text style={styles.historyText}>&quot;{log.raw_text}&quot;</Text>
            <Text style={styles.historyMeta}>
              → {log.parsed_intent.intent_type} ({log.parsed_intent.confidence})
              {log.result.success ? ' ✓' : ' ✗'}
            </Text>
            {log.result.voice_response && (
              <Text style={styles.historyResp}>Kevin: {log.result.voice_response}</Text>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#111827',
  },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  section: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0f1c14',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#00C896' },
  btnPrimaryText: { color: '#000', fontWeight: '800', fontSize: 14 },
  btnSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#1f2937' },
  btnSecondaryText: { color: '#9ca3af', fontWeight: '600', fontSize: 14 },
  card: {
    backgroundColor: '#0f1c14',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 12,
    marginBottom: 10,
  },
  cardLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  code: {
    color: '#d1d5db',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  handlerName: { color: '#00C896', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  examplesLabel: { color: '#6b7280', fontSize: 11, marginTop: 8, marginBottom: 4 },
  example: { color: '#9ca3af', fontSize: 12, marginLeft: 4 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  clearText: { color: '#6b7280', fontSize: 12 },
  empty: { color: '#4b5563', fontSize: 13, fontStyle: 'italic' },
  timestamp: { color: '#4b5563', fontSize: 11, marginBottom: 4 },
  historyText: { color: '#fff', fontSize: 13, marginBottom: 4 },
  historyMeta: { color: '#9ca3af', fontSize: 12 },
  historyResp: { color: '#00C896', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});
