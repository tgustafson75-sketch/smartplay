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

import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsStore } from '../store/settingsStore';
import { speak } from '../services/voiceService';
import { getApiBaseUrl } from '../services/apiBase';
// 2026-06-14 (Tim) — quick instructions are SILENT pop-up cards by default (out of the
// caddie's voice path). A 🔊 button plays the narration ON DEMAND only — accessibility
// without ever clashing with the caddie's voice profile.
const API_URL = getApiBaseUrl();

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
  const introOpens = useSettingsStore(s => s.introOpens);
  const incrementIntroOpen = useSettingsStore(s => s.incrementIntroOpen);
  const voiceGender = useSettingsStore(s => s.voiceGender);
  const language = useSettingsStore(s => s.language);

  // Self-managed visibility — open on first mount when the slug hasn't
  // been marked seen. Parent override (visible prop) wins when defined.
  // 2026-06-30 (Tim — "only the first ~2 times per tool, then they stop; still
  // resettable in settings") — restore the throttle using the per-slug `introOpens`
  // counter that was built but never wired. Show while NOT explicitly dismissed AND
  // shown fewer than SHOW_LIMIT times. Settings → Reset Tutorials clears both.
  const SHOW_LIMIT = 2;
  const [selfOpen, setSelfOpen] = useState<boolean>(
    () => !tutorialsSeen?.[slug] && (introOpens?.[slug] ?? 0) < SHOW_LIMIT,
  );
  const open = typeof visible === 'boolean' ? visible : selfOpen;
  // Count this self-managed view once (a parent-controlled `visible` doesn't count).
  useEffect(() => {
    if (selfOpen && typeof visible !== 'boolean') {
      try { incrementIntroOpen(slug); } catch { /* non-fatal */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDismiss = () => {
    if (onDismiss) onDismiss();
    else {
      markTutorialSeen(slug);
      setSelfOpen(false);
    }
  };

  // Silent by default — nothing auto-speaks (out of the caddie's voice path). The 🔊
  // button below plays the narration ON DEMAND only (accessibility, user-initiated).
  const playNarration = () => {
    if (!spokenText) return;
    void speak(spokenText, voiceGender, language, API_URL, { userInitiated: true }).catch(() => { /* non-fatal */ });
  };

  if (!open) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name={iconName} size={32} color="#00C896" />
          </View>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            {spokenText ? (
              <TouchableOpacity
                onPress={playNarration}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Read these instructions aloud"
                style={styles.speakerBtn}
              >
                <Ionicons name="volume-high" size={20} color="#00C896" />
              </TouchableOpacity>
            ) : null}
          </View>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 },
  speakerBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,200,150,0.5)', backgroundColor: 'rgba(0,200,150,0.12)',
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
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
