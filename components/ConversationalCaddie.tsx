/**
 * ConversationalCaddie.tsx
 *
 * Natural-language chat interface to the caddie AI.
 * Supports both typed text input and voice (mic button).
 *
 * Features
 * ────────
 *  • Scrollable conversation log  — colour-coded user/caddie bubbles
 *  • Typed Q&A                    — full keyboard input + send button
 *  • Mic button                   — delegates to parent triggerVoice pipeline
 *  • Suggested prompts            — quick-tap canned questions
 *  • Context injection            — hole, distance, club, missPattern, par all
 *                                    wired to the AI context builder
 *  • Auto-speak all answers        — routes through parent guardedSpeak
 *  • Tiger mode                   — answering "what would Tiger do?" is a thing
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { getAIResponse } from '../services/aiService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CaddieContext {
  hole?:        number;
  distance?:    number | null;
  club?:        string;
  missPattern?: 'left' | 'right' | 'neutral';
  par?:         number;
  courseName?:  string;
  wind?:        number;
  lie?:         string;
  mentalState?: string;
}

export interface Message {
  id:        string;
  role:      'user' | 'caddie';
  text:      string;
  timestamp: number;
}

export interface ConversationalCaddieProps {
  context:          CaddieContext;
  /** Called with final caddie text so parent can route through VoiceEngine */
  onSpeak:          (text: string) => void;
  /** Called to start mic-based triggerVoice pipeline */
  onMicPress:       () => void;
  /** Whether the voice pipeline is currently active (LISTENING | PROCESSING | SPEAKING) */
  voiceActive:      boolean;
  /** Optional external message pushed in after mic completes */
  externalResponse?: string | null;
}

// ─── Suggested questions ──────────────────────────────────────────────────────

const SUGGESTIONS: { label: string; question: string }[] = [
  { label: '🏌️ What should I hit?',      question: 'What should I hit here?' },
  { label: '🐅 What would Tiger do?',     question: 'What would Tiger do here?' },
  { label: '🎯 Am I missing right?',       question: 'Am I missing right today?' },
  { label: '💨 How do I play the wind?',  question: 'How do I play the wind?' },
  { label: '😤 Shake it off',             question: 'I\'m struggling today — help me reset.' },
  { label: '📐 Aim tip',                  question: 'Where should I be aiming?' },
  { label: '⛳ Strategy',                 question: 'What\'s the smart play here?' },
  { label: '🧠 Focus',                    question: 'I\'m nervous. What\'s my one thought?' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function ConversationalCaddie({
  context,
  onSpeak,
  onMicPress,
  voiceActive,
  externalResponse,
}: ConversationalCaddieProps) {
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [inputText,  setInputText]  = useState('');
  const [loading,    setLoading]    = useState(false);
  const scrollRef                   = useRef<ScrollView>(null);
  const inputRef                    = useRef<TextInput>(null);

  // ── Send a typed or suggestion message ─────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    Keyboard.dismiss();
    setInputText('');

    // Push user bubble immediately
    const userMsg: Message = {
      id:        `u-${Date.now()}`,
      role:      'user',
      text:      trimmed,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    // Scroll to bottom
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const response = await getAIResponse(trimmed, buildAIContext(context));
      const caddieMsg: Message = {
        id:        `c-${Date.now()}`,
        role:      'caddie',
        text:      response,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, caddieMsg]);
      // Route through VoiceEngine via parent
      onSpeak(response);
    } catch {
      const errMsg: Message = {
        id:        `c-err-${Date.now()}`,
        role:      'caddie',
        text:      "Couldn't reach the AI. Check your connection and try again.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [context, loading, onSpeak]);

  // ── Display context banner ──────────────────────────────────────────────
  const contextParts: string[] = [];
  if (context.hole)     contextParts.push(`Hole ${context.hole}`);
  if (context.par)      contextParts.push(`Par ${context.par}`);
  if (context.distance) contextParts.push(`${context.distance}yd`);
  if (context.club)     contextParts.push(context.club);
  if (context.missPattern && context.missPattern !== 'neutral')
    contextParts.push(`tends ${context.missPattern}`);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.wrapper}>

        {/* ── Context ribbeon ─────────────────────────────────────────── */}
        {contextParts.length > 0 && (
          <View style={styles.contextBanner}>
            <Text style={styles.contextText}>
              📍 {contextParts.join('  ·  ')}
            </Text>
          </View>
        )}

        {/* ── Message log ─────────────────────────────────────────────── */}
        <ScrollView
          ref={scrollRef}
          style={styles.log}
          contentContainerStyle={styles.logContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🏌️‍♂️</Text>
              <Text style={styles.emptyTitle}>Ask your caddie anything</Text>
              <Text style={styles.emptySubtitle}>
                Tap a suggestion or type your own question.{'\n'}
                I know your round, your miss, your yardages.
              </Text>
            </View>
          )}

          {messages.map((msg) => (
            <View
              key={msg.id}
              style={[
                styles.bubble,
                msg.role === 'user' ? styles.userBubble : styles.caddieBubble,
              ]}
            >
              {msg.role === 'caddie' && (
                <Text style={styles.bubbleRole}>🏌️ Caddie</Text>
              )}
              <Text style={[
                styles.bubbleText,
                msg.role === 'user' ? styles.userText : styles.caddieText,
              ]}>
                {msg.text}
              </Text>
            </View>
          ))}

          {loading && (
            <View style={[styles.bubble, styles.caddieBubble, styles.loadingBubble]}>
              <ActivityIndicator size="small" color="#4ade80" />
              <Text style={styles.thinkingText}>Thinking…</Text>
            </View>
          )}
        </ScrollView>

        {/* ── Suggestions ─────────────────────────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.suggestionScroll}
          contentContainerStyle={styles.suggestionContent}
        >
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s.question}
              onPress={() => sendMessage(s.question)}
              style={({ pressed }) => [
                styles.suggestionChip,
                pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] },
              ]}
            >
              <Text style={styles.suggestionText}>{s.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* ── Input row ───────────────────────────────────────────────── */}
        <View style={styles.inputRow}>
          {/* Mic button */}
          <Pressable
            onPress={onMicPress}
            disabled={voiceActive}
            style={({ pressed }) => [
              styles.micBtn,
              voiceActive && styles.micBtnActive,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={styles.micIcon}>
              {voiceActive ? '⏳' : '🎤'}
            </Text>
          </Pressable>

          {/* Text input */}
          <TextInput
            ref={inputRef}
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask your caddie…"
            placeholderTextColor="#2d5a3e"
            multiline={false}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(inputText)}
            editable={!loading}
            selectionColor="#4ade80"
          />

          {/* Send button */}
          <Pressable
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim() || loading}
            style={({ pressed }) => [
              styles.sendBtn,
              (!inputText.trim() || loading) && styles.sendBtnDisabled,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </Pressable>
        </View>

      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Context builder ──────────────────────────────────────────────────────────

function buildAIContext(ctx: CaddieContext): Record<string, unknown> {
  return {
    hole:        ctx.hole,
    distance:    ctx.distance,
    club:        ctx.club,
    missPattern: ctx.missPattern,
    par:         ctx.par,
    courseName:  ctx.courseName,
    wind:        ctx.wind,
    lie:         ctx.lie,
    mentalState: ctx.mentalState,
  };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: '#091410',
  },
  contextBanner: {
    backgroundColor: '#0d2018',
    borderBottomWidth: 1,
    borderBottomColor: '#1a4a2e',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  contextText: {
    color: '#4a7c5e',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  log: {
    flex: 1,
  },
  logContent: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
    gap: 10,
  },
  emptyIcon:     { fontSize: 42 },
  emptyTitle:    { color: '#4ade80', fontSize: 16, fontWeight: '800' },
  emptySubtitle: { color: '#2d5a3e', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  bubble: {
    maxWidth: '85%',
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#14532d',
    borderWidth: 1,
    borderColor: '#166534',
  },
  caddieBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#0d2018',
    borderWidth: 1,
    borderColor: '#1a4a2e',
  },
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  bubbleRole: {
    color: '#4a7c5e',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
  },
  bubbleText:  { fontSize: 14, lineHeight: 21 },
  userText:    { color: '#d1fae5' },
  caddieText:  { color: '#a7f3d0' },
  thinkingText: { color: '#4a7c5e', fontSize: 13, fontStyle: 'italic' },

  suggestionScroll: {
    flexGrow: 0,
    borderTopWidth: 1,
    borderTopColor: '#1a3020',
  },
  suggestionContent: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestionChip: {
    backgroundColor: '#0d2018',
    borderWidth: 1,
    borderColor: '#1a4a2e',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  suggestionText: {
    color: '#4ade80',
    fontSize: 12,
    fontWeight: '700',
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a3020',
    backgroundColor: '#091410',
  },
  micBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#0d2018',
    borderWidth: 1.5,
    borderColor: '#1a4a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnActive: {
    borderColor: '#4ade80',
    backgroundColor: '#14532d',
  },
  micIcon: { fontSize: 18 },
  textInput: {
    flex: 1,
    height: 42,
    backgroundColor: '#0d2018',
    borderRadius: 21,
    borderWidth: 1.5,
    borderColor: '#1a4a2e',
    paddingHorizontal: 16,
    color: '#d1fae5',
    fontSize: 14,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#0d2018',
    borderWidth: 1,
    borderColor: '#1a3020',
  },
  sendIcon: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
