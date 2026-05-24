/**
 * 2026-05-24 — Shared first-run quick tutorial.
 *
 * Standardized 3-line skippable tutorial used on feature entry screens
 * (Caddie home, SmartMotion, Quick Record, SwingLab home). Extracts the
 * pattern Coach Mode already ships (Modal + 3-line copy + spoken + Got
 * it / Skip) into a single source of truth.
 *
 * Reuses settingsStore.tutorialsSeen + markTutorialSeen + resetTutorials
 * — no new store, no parallel seen-flag system. resetTutorials() (already
 * on settingsStore) clears all flags so every tutorial replays on next
 * entry of each screen — that's the owner test path.
 *
 * Usage (self-managed visibility — typical case):
 *   <QuickTutorial
 *     slug="smartmotion_intro"
 *     title="SmartMotion"
 *     lines={["...", "...", "..."]}
 *     spokenText="This is SmartMotion. Hit record. I'll read it back."
 *   />
 *
 * Usage (caller-managed — for "show again" help button):
 *   <QuickTutorial
 *     slug="smartmotion_intro"
 *     visible={tutorialOpen}
 *     onDismiss={() => setTutorialOpen(false)}
 *     ...
 *   />
 *
 * Fold-aware: text wraps, no fixed height. Speaks the spokenText via the
 * active caddie persona's voice when the modal opens (best-effort; speak
 * is fire-and-forget and silent on failure).
 */

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsStore } from '../store/settingsStore';
import { speak } from '../services/voiceService';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

interface QuickTutorialProps {
  /** Persisted-seen key. Matches Coach Mode's COACH_TUTORIAL_KEY pattern. */
  slug: string;
  /** Header title — usually the feature name (SmartMotion, Quick Record, etc.). */
  title: string;
  /** Body lines. Spec is 3 lines; component renders whatever's passed (1-4 ok). */
  lines: string[];
  /** Spoken line (shorter version of the body for TTS). Optional — silent when omitted or voice off. */
  spokenText?: string;
  /** Override the self-managed visibility. When provided, parent owns showing/hiding. */
  visible?: boolean;
  /** Called on Got it / Skip. When omitted, defaults to marking the slug seen. */
  onDismiss?: () => void;
  /** Optional iconography override. */
  iconName?: keyof typeof Ionicons.glyphMap;
}

export function QuickTutorial({
  slug,
  title,
  lines,
  spokenText,
  visible,
  onDismiss,
  iconName = 'school-outline',
}: QuickTutorialProps) {
  const tutorialsSeen = useSettingsStore(s => s.tutorialsSeen);
  const markTutorialSeen = useSettingsStore(s => s.markTutorialSeen);
  const voiceEnabled = useSettingsStore(s => s.voiceEnabled);
  const voiceGender = useSettingsStore(s => s.voiceGender);
  const language = useSettingsStore(s => s.language);

  // Self-managed visibility — open on first mount when the slug hasn't
  // been marked seen. Parent override (visible prop) wins when defined.
  const [selfOpen, setSelfOpen] = useState<boolean>(() => !tutorialsSeen?.[slug]);
  const open = typeof visible === 'boolean' ? visible : selfOpen;

  const handleDismiss = () => {
    if (onDismiss) onDismiss();
    else {
      markTutorialSeen(slug);
      setSelfOpen(false);
    }
  };

  // Speak the spokenText when the modal becomes visible. userInitiated:
  // false because the entry is a navigation event (auto-fire) — silent
  // at L1 by design, which is fine; written copy still renders.
  useEffect(() => {
    if (!open) return;
    if (!voiceEnabled) return;
    if (!spokenText) return;
    speak(spokenText, voiceGender, language, API_URL).catch(() => { /* non-fatal */ });
  }, [open, voiceEnabled, voiceGender, language, spokenText]);

  if (!open) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name={iconName} size={32} color="#00C896" />
          </View>
          <Text style={styles.title}>{title}</Text>
          {lines.map((ln, i) => (
            <Text key={i} style={styles.line}>{`${i + 1}. ${ln}`}</Text>
          ))}
          <TouchableOpacity
            style={styles.gotItBtn}
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel="Got it, dismiss tutorial"
          >
            <Text style={styles.gotItText}>Got it</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel="Skip tutorial"
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#0d1a0d',
    borderColor: '#1e3a28',
    borderWidth: 1,
    borderRadius: 16,
    padding: 22,
    gap: 10,
    alignItems: 'stretch',
  },
  iconWrap: { alignItems: 'center', marginBottom: 4 },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 6,
  },
  line: { color: '#e5e7eb', fontSize: 14, lineHeight: 20, marginVertical: 2 },
  gotItBtn: {
    backgroundColor: '#00C896',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  gotItText: { color: '#0d1a0d', fontSize: 14, fontWeight: '900' },
  skipText: { color: '#9ca3af', fontSize: 12, textAlign: 'center', marginTop: 6 },
});
