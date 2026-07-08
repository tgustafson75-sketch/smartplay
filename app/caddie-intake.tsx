/**
 * 2026-07-07 (Tim — narrative profile intake): "Get to know me" — an open conversation
 * where the caddie learns WHO the golfer is: experience, real practice habits, the time
 * they actually have, likes/dislikes, where the game needs work, goals, life context.
 *
 * This is the relationship layer — "it's not an app, it's a personal performance coach
 * and elite caddie." Every answer runs through /api/narrative-extract and merges into
 * the CNS (caddieMemoryStore.recordNarrative), which EVERY brain surface reads via the
 * caddie-memory prompt block — so the caddie coaches inside the golfer's real life from
 * then on, and keeps learning from ordinary conversation after this.
 *
 * Voice: answers can be typed OR spoken via the OS keyboard mic (the same zero-risk
 * dictation path the caddie tab advertises) — no app voice-pipeline involvement, per
 * the standing voice-path freeze.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';
import { useSettingsStore } from '../store/settingsStore';
import { useCaddieMemoryStore, type GolferNarrative } from '../store/caddieMemoryStore';
import { getApiBaseUrl } from '../services/apiBase';

// The question spine — open questions a great caddie would ask on a first walk
// together. Each answer is extracted server-side; SKIP is always fine.
const QUESTIONS: { key: string; q: string }[] = [
  { key: 'experience', q: 'How long have you been playing, and how did you pick up the game? Lessons, self-taught, played growing up?' },
  { key: 'practice', q: 'What does practice actually look like for you — how often do you really get out, and what do you do when you\'re there?' },
  { key: 'time', q: 'How much time do you honestly have for golf in a normal week? Travel, work, family — what does your reality look like?' },
  { key: 'work', q: 'What part of your game do you feel needs the most work right now?' },
  { key: 'strengths', q: 'And the flip side — what\'s working? What part of your game do you trust?' },
  { key: 'likes', q: 'What do you enjoy most about the game — and what do you avoid or flat-out hate doing?' },
  { key: 'goals', q: 'What are you chasing? What would make this season a win for you?' },
  { key: 'story', q: 'Anything else I should know about you — work, travel, family, injuries — that shapes your golf?' },
];

type Bubble = { from: 'caddie' | 'golfer'; text: string };

const CADDIE_LABEL: Record<string, string> = {
  kevin: 'Kevin', serena: 'Serena', harry: 'Harry', tank: 'Tank', custom: 'Your caddie',
};

export default function CaddieIntakeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const persona = useSettingsStore((s) => s.caddiePersonality);
  const caddieName = CADDIE_LABEL[persona] ?? 'Your caddie';

  const [step, setStep] = useState(0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([
    { from: 'caddie', text: `Let's do this the right way — I want to actually know your game, not just your handicap. A few open questions; answer as much or as little as you like. Everything you tell me shapes how I coach you from here on.` },
    { from: 'caddie', text: QUESTIONS[0].q },
  ]);
  const scrollRef = useRef<ScrollView>(null);
  const done = step >= QUESTIONS.length;

  // What the caddie has learned so far (live read — updates as extractions land).
  const narrative = useCaddieMemoryStore((s) => s.getPlayer().narrative);

  const learnedSummary = useMemo(() => {
    const n = narrative;
    if (!n) return null;
    const bits: string[] = [];
    if (n.experience) bits.push(n.experience);
    if (n.practiceFrequency) bits.push(n.practiceFrequency);
    if (n.timeAvailable) bits.push(n.timeAvailable);
    if (n.workAreas.length) bits.push(`working on: ${n.workAreas.slice(0, 3).join(', ')}`);
    if (n.goals.length) bits.push(`goals: ${n.goals.slice(0, 2).join(', ')}`);
    return bits.length ? bits.join(' · ') : null;
  }, [narrative]);

  const advance = useCallback((golferText: string | null) => {
    setBubbles((prev) => {
      const next = [...prev];
      if (golferText) next.push({ from: 'golfer', text: golferText });
      const nextStep = step + 1;
      if (nextStep < QUESTIONS.length) {
        next.push({ from: 'caddie', text: QUESTIONS[nextStep].q });
      } else {
        next.push({
          from: 'caddie',
          text: 'That\'s exactly what I needed. I\'ll remember all of it — and I\'ll keep learning every time we talk, on the course or off. This is your game now, not a generic one.',
        });
      }
      return next;
    });
    setStep((s) => s + 1);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [step]);

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || done) return;
    setInput('');
    setBusy(true);
    const question = QUESTIONS[step]?.q ?? '';
    advance(text);
    // Extraction is best-effort + async — the conversation never blocks on it. A failed
    // extract loses nothing visible; the raw exchange still advances.
    try {
      const res = await fetch(`${getApiBaseUrl().replace(/\/+$/, '')}/api/narrative-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, question }),
      });
      const json = (await res.json().catch(() => ({}))) as { facts?: Partial<Omit<GolferNarrative, 'updated_at'>> };
      if (res.ok && json.facts) {
        useCaddieMemoryStore.getState().recordNarrative({ ...json.facts, nowMs: Date.now() });
      } else {
        // Server unreachable — keep the raw answer as story so nothing is lost.
        useCaddieMemoryStore.getState().recordNarrative({ story: [text.slice(0, 160)], nowMs: Date.now() });
      }
    } catch {
      try { useCaddieMemoryStore.getState().recordNarrative({ story: [text.slice(0, 160)], nowMs: Date.now() }); } catch { /* additive */ }
    } finally {
      setBusy(false);
    }
  }, [input, busy, done, step, advance]);

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={s.title}>{caddieName} — getting to know you</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
          {bubbles.map((b, i) => (
            <View key={i} style={[s.bubble, b.from === 'caddie' ? s.caddieBubble : s.golferBubble]}>
              <Text style={[s.bubbleText, b.from === 'golfer' && { color: '#0b1220' }]}>{b.text}</Text>
            </View>
          ))}
          {done && learnedSummary ? (
            <View style={s.learnedCard}>
              <Text style={s.learnedTitle}>WHAT I'LL REMEMBER</Text>
              <Text style={s.learnedText}>{learnedSummary}</Text>
            </View>
          ) : null}
          {done ? (
            <TouchableOpacity style={s.doneBtn} onPress={() => router.back()} accessibilityRole="button">
              <Text style={s.doneBtnText}>Done — let's play</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>

        {!done ? (
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              placeholder="Type — or tap the mic on your keyboard and just talk"
              placeholderTextColor={colors.text_muted}
              value={input}
              onChangeText={setInput}
              multiline
              accessibilityLabel="Your answer"
            />
            <TouchableOpacity
              style={[s.sendBtn, { opacity: input.trim() && !busy ? 1 : 0.5 }]}
              onPress={submit}
              disabled={!input.trim() || busy}
              accessibilityRole="button"
              accessibilityLabel="Send answer"
            >
              {busy ? <ActivityIndicator color="#0b1220" size="small" /> : <Ionicons name="arrow-up" size={20} color="#0b1220" />}
            </TouchableOpacity>
            <TouchableOpacity style={s.skipBtn} onPress={() => advance(null)} accessibilityRole="button" accessibilityLabel="Skip this question">
              <Text style={s.skipText}>Skip</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
    title: { color: colors.text_primary, fontSize: 16, fontWeight: '800' },
    bubble: { maxWidth: '86%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10 },
    caddieBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface_elevated, borderWidth: 1, borderColor: colors.border },
    golferBubble: { alignSelf: 'flex-end', backgroundColor: '#88F700' },
    bubbleText: { color: colors.text_primary, fontSize: 15, lineHeight: 21 },
    learnedCard: { marginTop: 6, backgroundColor: colors.surface_elevated, borderWidth: 1, borderColor: '#88F700', borderRadius: 14, padding: 14 },
    learnedTitle: { color: '#88F700', fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 6 },
    learnedText: { color: colors.text_primary, fontSize: 14, lineHeight: 20 },
    doneBtn: { marginTop: 14, backgroundColor: '#88F700', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    doneBtnText: { color: '#0b1220', fontWeight: '900', fontSize: 15 },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingBottom: 10, paddingTop: 6, gap: 8 },
    input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: colors.text_primary, fontSize: 15, backgroundColor: colors.surface_elevated },
    sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#88F700', alignItems: 'center', justifyContent: 'center' },
    skipBtn: { height: 44, justifyContent: 'center', paddingHorizontal: 6 },
    skipText: { color: colors.text_muted, fontSize: 13, fontWeight: '700' },
  });
}
