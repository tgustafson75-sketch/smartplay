/**
 * Phase BH — In-Round Diagnostic Coach card.
 *
 * Optional visual surface for the in_round_diagnostic intent. User can
 * append "show me" / "card me" to a diagnostic query and the listening
 * session pushes here with the pattern + Kevin's reasoning text as
 * params. The card structures the reasoning into:
 *   - "What you described" (the pattern)
 *   - "Likely causes" (extracted bullets — ~3)
 *   - "Try this round" (extracted from "try" / "this round" sentences)
 *   - "Worth working on" (extracted from "after" / "cage" / "work on" sentences)
 *   - "Listen to Kevin's full reasoning" replay button
 *
 * The reasoning text comes from /api/kevin's in-round-diagnostic Coach
 * sub-prompt which is structured to be ~80-110 words. Parsing here is
 * heuristic — split on common pattern markers. Falls back to showing
 * the full text in a single block if parsing fails.
 *
 * Additive surface only — no Caddie-home or other locked layouts touched.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useSettingsStore } from '../store/settingsStore';
import { speak, stopSpeaking } from '../services/voiceService';

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

/**
 * Heuristic split of Kevin's reasoning text into structured sections.
 * Patterns the Coach sub-prompt is steered to use:
 *   - "Likely causes" markers: "likely", "probably", "could be", "might be"
 *   - "Try this round" markers: "try", "this round", "right now", "next tee"
 *   - "Work on after" markers: "after the round", "cage", "next session",
 *     "work on", "longer term"
 */
function parseReasoning(text: string): { causes: string[]; tryNow: string[]; workOn: string[] } {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const causes: string[] = [];
  const tryNow: string[] = [];
  const workOn: string[] = [];

  for (const s of sentences) {
    const lower = s.toLowerCase();
    const isWorkOn = /\b(after the round|after this round|cage|next session|work on|longer term|practice on)\b/.test(lower);
    const isTryNow = /\b(try|this round|right now|next tee|on the next|grip firmer|firm grip|focus on this)\b/.test(lower);
    const isCause = /\b(likely|probably|could be|might be|usually means|typically|that pattern means|that's a)\b/.test(lower);

    if (isWorkOn) workOn.push(s);
    else if (isTryNow) tryNow.push(s);
    else if (isCause) causes.push(s);
  }

  return { causes, tryNow, workOn };
}

export default function DiagnosticCard() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const params = useLocalSearchParams<{ pattern?: string; reasoning?: string }>();
  const { voiceGender, language } = useSettingsStore();
  const [playing, setPlaying] = useState(false);

  const pattern = String(params.pattern ?? '');
  const reasoning = String(params.reasoning ?? '');

  const sections = useMemo(() => parseReasoning(reasoning), [reasoning]);
  const hasParsed = sections.causes.length + sections.tryNow.length + sections.workOn.length > 0;

  const replay = async () => {
    if (playing) {
      await stopSpeaking().catch(() => {});
      setPlaying(false);
      return;
    }
    setPlaying(true);
    try {
      await speak(reasoning, voiceGender, language, apiUrl, { userInitiated: true });
    } finally {
      setPlaying(false);
    }
  };

  const styles = useMemo(() => makeStyles(colors, spacing, radii), [colors, spacing, radii]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={26} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>Mid-Round Diagnostic</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Pattern user described */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>WHAT YOU DESCRIBED</Text>
          <Text style={[styles.sectionBody, { color: colors.text_primary }]}>{pattern || '—'}</Text>
        </View>

        {/* If parsing succeeded, show structured sections */}
        {hasParsed ? (
          <>
            {sections.causes.length > 0 && (
              <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.sectionLabel, { color: colors.accent }]}>LIKELY CAUSES</Text>
                {sections.causes.map((c, i) => (
                  <View key={i} style={styles.bullet}>
                    <Text style={[styles.bulletDot, { color: colors.accent }]}>•</Text>
                    <Text style={[styles.bulletText, { color: colors.text_primary }]}>{c}</Text>
                  </View>
                ))}
              </View>
            )}
            {sections.tryNow.length > 0 && (
              <View style={[styles.section, { backgroundColor: colors.surface, borderColor: '#facc15' }]}>
                <Text style={[styles.sectionLabel, { color: '#facc15' }]}>TRY THIS ROUND</Text>
                {sections.tryNow.map((c, i) => (
                  <View key={i} style={styles.bullet}>
                    <Text style={[styles.bulletDot, { color: '#facc15' }]}>•</Text>
                    <Text style={[styles.bulletText, { color: colors.text_primary }]}>{c}</Text>
                  </View>
                ))}
              </View>
            )}
            {sections.workOn.length > 0 && (
              <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>WORTH WORKING ON</Text>
                {sections.workOn.map((c, i) => (
                  <View key={i} style={styles.bullet}>
                    <Text style={[styles.bulletDot, { color: colors.text_muted }]}>•</Text>
                    <Text style={[styles.bulletText, { color: colors.text_primary }]}>{c}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        ) : (
          // Fallback: show full reasoning text if heuristic parse found nothing
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.accent }]}>KEVIN'S READ</Text>
            <Text style={[styles.sectionBody, { color: colors.text_primary }]}>{reasoning || '—'}</Text>
          </View>
        )}

        {/* Replay button */}
        {reasoning ? (
          <TouchableOpacity
            onPress={replay}
            style={[styles.replayBtn, { backgroundColor: playing ? '#ef4444' : colors.accent }]}
            activeOpacity={0.85}
          >
            <Ionicons name={playing ? 'stop' : 'play'} size={18} color="#ffffff" />
            <Text style={styles.replayText}>{playing ? 'Stop' : "Listen to Kevin's full reasoning"}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(
  c: ReturnType<typeof useTheme>['colors'],
  s: ReturnType<typeof useTheme>['spacing'],
  r: ReturnType<typeof useTheme>['radii'],
) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 8,
      height: 56,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
    scroll: { padding: s.lg },
    section: {
      borderWidth: 1.5,
      borderRadius: r.md,
      padding: s.md,
      marginBottom: s.sm,
    },
    sectionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 },
    sectionBody: { fontSize: 15, fontWeight: '500', lineHeight: 22 },
    bullet: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
    bulletDot: { fontSize: 16, fontWeight: '900', marginRight: 8, lineHeight: 22 },
    bulletText: { flex: 1, fontSize: 14, fontWeight: '500', lineHeight: 22 },
    replayBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: r.lg,
      marginTop: s.md,
    },
    replayText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  });
}
