/**
 * /demo — Investor / Meta demo page.
 *
 * Auto-plays the 9-turn Ray-Ban Caddy interaction from
 * GET /api/meta-voice?demo=1, with dual captions showing
 * what Meta AI hears vs what the API sent.
 *
 * Built as an Expo Router page; runs on web (via expo export
 * --platform web) AND native. On web it uses the browser's
 * SpeechSynthesis API for TTS (no audio dependency). On
 * native it dynamically imports voiceService.speak for the
 * same effect through ElevenLabs / OpenAI.
 *
 * Recording the demo: open the deployed URL in Chrome, hit
 * Play, screen-record (Cmd+Shift+5 on macOS, or OBS) with
 * system audio capture so the TTS lands in the video.
 *
 * No external deps. Plain React Native primitives + a thin
 * web-only TTS helper.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Types ───────────────────────────────────────────────────────────────

interface ApiResponse {
  speak: string;
  details?: string;
  alt?: string;
  tone: 'neutral' | 'hype' | 'calm' | 'coach';
  user_note?: string;
  state: Record<string, unknown>;
}

interface DemoTurn {
  hole: number;
  user_says: string;
  api_response: ApiResponse;
  caption: string;
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function MetaCaddyDemoPage() {
  const [turns, setTurns] = useState<DemoTurn[] | null>(null);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [phase, setPhase] = useState<'user' | 'api' | 'idle'>('idle');
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<boolean>(false);

  const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim() || 'https://smartplay-beta.vercel.app';
  const demoUrl = `${apiUrl}/api/meta-voice?demo=1`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(demoUrl);
        if (!res.ok) throw new Error(`demo fetch ${res.status}`);
        const data = (await res.json()) as { turns: DemoTurn[] };
        if (!cancelled) setTurns(data.turns ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [demoUrl]);

  const onPlay = useCallback(async () => {
    if (!turns || turns.length === 0) return;
    setPlaying(true);
    cancelRef.current = false;
    for (let i = 0; i < turns.length; i++) {
      if (cancelRef.current) break;
      setActiveIdx(i);
      const t = turns[i];
      // Phase 1: "user says" caption + briefly read it in a robotic
      // voice so the viewer hears the question as if Meta AI dictated
      // it. ~1.4s pause before the response so the cadence reads.
      setPhase('user');
      await speak(t.user_says, { rate: 1.1, pitch: 1.05, robotic: true });
      if (cancelRef.current) break;
      await wait(450);
      // Phase 2: "api response" caption + speak the `speak` field
      // (this is the audio that Meta glasses would actually play).
      setPhase('api');
      await speak(t.api_response.speak, { rate: 0.96, pitch: 1.0, robotic: false });
      if (cancelRef.current) break;
      await wait(900);
    }
    setPhase('idle');
    setPlaying(false);
  }, [turns]);

  const onStop = useCallback(() => {
    cancelRef.current = true;
    stopSpeak();
    setPlaying(false);
    setPhase('idle');
  }, []);

  const onReset = useCallback(() => {
    onStop();
    setActiveIdx(-1);
  }, [onStop]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SmartPlay Caddy</Text>
        <Text style={styles.headerSubtitle}>Ray-Ban Meta · 9-hole demo</Text>
      </View>

      <View style={styles.toolbar}>
        {!playing ? (
          <Pressable style={styles.btnPrimary} onPress={onPlay} disabled={!turns}>
            <Text style={styles.btnPrimaryText}>▶  Play 9-hole demo</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.btnDanger} onPress={onStop}>
            <Text style={styles.btnDangerText}>■  Stop</Text>
          </Pressable>
        )}
        <Pressable style={styles.btnGhost} onPress={onReset} disabled={playing}>
          <Text style={styles.btnGhostText}>⟲ Reset</Text>
        </Pressable>
      </View>

      <View style={styles.captionStage}>
        {error && (
          <View style={[styles.captionCard, { borderColor: '#ef4444' }]}>
            <Text style={[styles.captionLabel, { color: '#f87171' }]}>ERROR</Text>
            <Text style={styles.captionText}>{error}</Text>
          </View>
        )}
        {turns && activeIdx >= 0 && (
          <View style={styles.dualCaptions}>
            <View style={[styles.captionCard, phase === 'user' && styles.captionCardActive, { borderColor: '#fbbf24' }]}>
              <Text style={[styles.captionLabel, { color: '#fbbf24' }]}>
                🎙 META AI HEARS USER
              </Text>
              <Text style={styles.captionText}>{turns[activeIdx].user_says}</Text>
            </View>
            <View style={[styles.captionCard, phase === 'api' && styles.captionCardActive, { borderColor: '#22c55e' }]}>
              <Text style={[styles.captionLabel, { color: '#86efac' }]}>
                📡 API → META AI READS BACK
              </Text>
              <Text style={[styles.captionText, styles.captionTextSpeak]}>
                {turns[activeIdx].api_response.speak}
              </Text>
              {turns[activeIdx].api_response.tone ? (
                <View style={styles.toneRow}>
                  <Text style={styles.toneLabel}>TONE</Text>
                  <Text style={styles.toneValue}>{turns[activeIdx].api_response.tone.toUpperCase()}</Text>
                  {turns[activeIdx].api_response.user_note ? (
                    <Text style={styles.noteText}>
                      note → {turns[activeIdx].api_response.user_note}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        )}
        {!turns && !error && (
          <ActivityIndicator color="#22c55e" />
        )}
      </View>

      <ScrollView style={styles.timeline} contentContainerStyle={styles.timelineContent}>
        <Text style={styles.timelineHeading}>Timeline</Text>
        {(turns ?? []).map((t, i) => (
          <Pressable
            key={i}
            style={[styles.timelineRow, i === activeIdx && styles.timelineRowActive]}
            onPress={() => !playing && setActiveIdx(i)}
            disabled={playing}
          >
            <Text style={styles.timelineHole}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.timelineCaption}>{t.caption}</Text>
              <Text style={styles.timelineUser}>{`"${t.user_says}"`}</Text>
              <Text style={styles.timelineApi} numberOfLines={2}>{`→ ${t.api_response.speak}`}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SpeakOpts { rate?: number; pitch?: number; robotic?: boolean }

let stopFn: (() => void) | null = null;

async function speak(text: string, opts: SpeakOpts = {}): Promise<void> {
  if (Platform.OS === 'web') {
    return speakWeb(text, opts);
  }
  // Native: fall through to voiceService if available; otherwise no-op.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const voiceMod = require('../services/voiceService') as typeof import('../services/voiceService');
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
    await voiceMod.speak(text, 'male', 'en', apiUrl, { userInitiated: true });
  } catch {
    // No voiceService available — silent pass-through for web preview-only contexts.
  }
}

function stopSpeak(): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (stopFn) {
    try { stopFn(); } catch { /* ignore */ }
    stopFn = null;
  }
}

function speakWeb(text: string, opts: SpeakOpts): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve();
      return;
    }
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = opts.rate ?? 1.0;
    utter.pitch = opts.pitch ?? 1.0;
    utter.volume = 1.0;
    // Robotic voice for the "user says" phase: pick a built-in voice
    // that sounds compressed / phone-quality so the viewer reads it as
    // "what Meta AI heard," not the caddie.
    if (opts.robotic) {
      const voices = window.speechSynthesis.getVoices();
      const robotVoice = voices.find((v) => /Microsoft|Daniel|Google/i.test(v.name)) ?? voices[0];
      if (robotVoice) utter.voice = robotVoice;
    }
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

// Memoize the apiUrl read so the page doesn't re-fetch on every render.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _memoApiUrl() { return useMemo(() => process.env.EXPO_PUBLIC_API_URL ?? '', []); }

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a1410' },
  header: { paddingHorizontal: 24, paddingVertical: 18, gap: 4 },
  headerTitle: { color: '#86efac', fontSize: 26, fontWeight: '900', letterSpacing: -0.3 },
  headerSubtitle: { color: '#9ca3af', fontSize: 13, fontWeight: '600', letterSpacing: 0.4 },

  toolbar: { flexDirection: 'row', gap: 10, paddingHorizontal: 24, paddingBottom: 12 },
  btnPrimary: { backgroundColor: '#22c55e', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10 },
  btnPrimaryText: { color: '#06140a', fontWeight: '900', fontSize: 14, letterSpacing: 0.5 },
  btnDanger: { backgroundColor: '#ef4444', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10 },
  btnDangerText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  btnGhost: { borderWidth: 1, borderColor: '#1e3a28', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  btnGhostText: { color: '#cbd5e1', fontWeight: '700', fontSize: 13 },

  captionStage: { minHeight: 180, paddingHorizontal: 24, justifyContent: 'center' },
  dualCaptions: { gap: 10 },
  captionCard: {
    borderWidth: 1, borderRadius: 14, padding: 14, gap: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  captionCardActive: { borderWidth: 2, shadowOpacity: 0.5, shadowRadius: 12, shadowColor: '#22c55e' },
  captionLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  captionText: { color: '#e5e7eb', fontSize: 17, fontWeight: '600', lineHeight: 22 },
  captionTextSpeak: { color: '#fef3c7', fontSize: 18 },
  toneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  toneLabel: { color: '#9ca3af', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  toneValue: {
    color: '#0a1410', fontSize: 10, fontWeight: '900', letterSpacing: 0.6,
    backgroundColor: '#86efac', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  noteText: { color: '#9ca3af', fontSize: 11, fontStyle: 'italic', flex: 1 },

  timeline: { flex: 1, marginTop: 4 },
  timelineContent: { paddingHorizontal: 24, paddingBottom: 32, gap: 8 },
  timelineHeading: { color: '#9ca3af', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 6 },
  timelineRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#0d1a0d', borderWidth: 1, borderColor: '#1e3a28',
    padding: 12, borderRadius: 10,
  },
  timelineRowActive: { borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.08)' },
  timelineHole: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#1e3a28',
    color: '#86efac', fontWeight: '900', textAlign: 'center', lineHeight: 28, fontSize: 13,
  },
  timelineCaption: { color: '#cbd5e1', fontWeight: '700', fontSize: 12, letterSpacing: 0.3, marginBottom: 4 },
  timelineUser: { color: '#fbbf24', fontWeight: '600', fontSize: 12, fontStyle: 'italic', marginBottom: 4 },
  timelineApi: { color: '#86efac', fontWeight: '700', fontSize: 13, lineHeight: 18 },
});
