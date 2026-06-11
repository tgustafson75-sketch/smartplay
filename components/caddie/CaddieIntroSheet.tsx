/**
 * 2026-05-21 — Fix D: caddie 3-line quick-start intro overlay.
 *
 * Shows when SmartMotion or Cage Mode opens cold — three lines in
 * the active persona's tone, shown as text AND spoken via the
 * existing voiceService when voice is enabled. Skippable. Not a
 * tutorial — three lines and done.
 *
 * Auto-suppress rule: each intro slug tracks `introOpens` in
 * settingsStore. Shown for the first 3 opens of a screen, then
 * silent until the user resets tutorials in Settings. Mounting the
 * sheet does NOT count as an "open" — only dismissal increments
 * the counter, so a user who flicks back without finishing still
 * sees the intro on the next try.
 *
 * Voice gate: passes `userInitiated: true` to speak() because the
 * user opened the screen explicitly — required at L1 Quiet per the
 * project's standing voice rule.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettingsStore } from '../../store/settingsStore';
import { getCaddieName } from '../../lib/persona';
import { speak } from '../../services/voiceService';
import { CaddieMicBadge } from './CaddieMicBadge';
import { getApiBaseUrl } from '../../services/apiBase';

export type CaddieIntroSlug = 'smartmotion' | 'cage_mode';

/** Number of opens after which an intro auto-suppresses. */
export const INTRO_OPEN_SUPPRESS_AFTER = 3;

interface PersonaLines {
  kevin: string[];
  serena: string[];
  tank: string[];
  harry: string[];
}

const SMARTMOTION_LINES: PersonaLines = {
  kevin: [
    "A few steps back. Pick down-the-line or face-on — your call.",
    "Tell me when to record. Tap stop when you're done.",
    "I'll break down what I saw the moment it's ready.",
  ],
  serena: [
    "Step back a few feet, choose your angle — down-the-line for path, face-on for weight.",
    "Tap record when you're set. Stop when the swing is done.",
    "I'll have a clean read for you as soon as the clip lands.",
  ],
  tank: [
    "Back up. Pick your angle. Down-the-line or face-on. Now.",
    "Hit record. Swing. Stop when you're done.",
    "I'll tell you what's broken the second I see it.",
  ],
  harry: [
    "Take a few steps back, pick the angle you want — down-the-line or face-on, both work.",
    "Tap record when you're ready, stop when you've finished the motion.",
    "I'll walk through what I saw with you once it's in.",
  ],
};

const CAGE_MODE_LINES: PersonaLines = {
  kevin: [
    "Get framed up in the cage. Pick your batch size — 1, 3, 5, or 10.",
    "Say 'record' when you're set. I'll catch each swing.",
    "We'll review the whole set together at the end.",
  ],
  serena: [
    "Frame the bullseye, then pick a batch — 1, 3, 5, or 10 swings.",
    "Say 'record' or tap when you're set. I'll handle the captures.",
    "We'll go through the set as a unit when you're done.",
  ],
  tank: [
    "Frame the target. Pick your batch — 1, 3, 5, 10.",
    "Say record. Swing. Repeat.",
    "We review the whole set at the end. No skipping.",
  ],
  harry: [
    "Get the cage framed up, then choose a batch — 1, 3, 5, or 10 swings.",
    "Say 'record' when you're ready and I'll catch each one.",
    "We'll go through the session together when you're finished.",
  ],
};

const LINES_BY_SLUG: Record<CaddieIntroSlug, PersonaLines> = {
  smartmotion: SMARTMOTION_LINES,
  cage_mode: CAGE_MODE_LINES,
};

const TITLE_BY_SLUG: Record<CaddieIntroSlug, string> = {
  smartmotion: 'SMARTMOTION',
  cage_mode: 'CAGE MODE',
};

export interface CaddieIntroSheetProps {
  slug: CaddieIntroSlug;
  visible: boolean;
  onDismiss: () => void;
}

/**
 * Hook that decides whether the intro should show on mount for a
 * given slug. Returns the visible flag + a dismiss handler that
 * increments the counter. Consumers wire this into the screen's
 * mount effect and pass the values to <CaddieIntroSheet />.
 *
 * Suppresses when the user has already seen the intro
 * INTRO_OPEN_SUPPRESS_AFTER times.
 */
export function useCaddieIntro(slug: CaddieIntroSlug, gate: boolean = true): {
  visible: boolean;
  dismiss: () => void;
} {
  const seenCount = useSettingsStore(s => s.introOpens?.[slug] ?? 0);
  const incrementIntroOpen = useSettingsStore(s => s.incrementIntroOpen);
  const [visible, setVisible] = React.useState(false);
  const decidedRef = useRef(false);

  useEffect(() => {
    if (decidedRef.current) return;
    if (!gate) return;
    decidedRef.current = true;
    if (seenCount < INTRO_OPEN_SUPPRESS_AFTER) {
      setVisible(true);
    }
  }, [gate, seenCount]);

  const dismiss = React.useCallback(() => {
    setVisible(false);
    incrementIntroOpen(slug);
  }, [slug, incrementIntroOpen]);

  return { visible, dismiss };
}

export function CaddieIntroSheet({ slug, visible, onDismiss }: CaddieIntroSheetProps) {
  const { colors } = useTheme();
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const voiceEnabled = useSettingsStore(s => s.voiceEnabled);
  const voiceGender = useSettingsStore(s => s.voiceGender);
  const language = useSettingsStore(s => s.language);
  const caddieName = getCaddieName(caddiePersonality);

  const lines = useMemo<string[]>(() => {
    const set = LINES_BY_SLUG[slug];
    const persona = (caddiePersonality as keyof PersonaLines);
    return set[persona] ?? set.kevin;
  }, [slug, caddiePersonality]);

  // Speak the intro once when the sheet becomes visible. Joined as
  // one utterance so the TTS pause cadence matches the on-screen
  // line breaks. userInitiated:true is required (the user opened
  // the screen — that IS a user-initiated action; passes L1 Quiet).
  const spokenRef = useRef(false);
  useEffect(() => {
    if (!visible) { spokenRef.current = false; return; }
    if (spokenRef.current) return;
    spokenRef.current = true;
    if (!voiceEnabled) return;
    const apiUrl = getApiBaseUrl();
    const text = lines.join(' ');
    speak(text, voiceGender, language, apiUrl, { userInitiated: true })
      .catch((e) => console.log('[caddie-intro] speak failed', e));
  }, [visible, voiceEnabled, voiceGender, language, lines]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        {/* Tap outside the card to dismiss — same effect as Skip. */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityLabel="Dismiss intro"
        />
        <View style={[styles.card, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
          <View style={styles.headerRow}>
            <CaddieMicBadge size={42} hideMicIcon onPress={null} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.eyebrow, { color: colors.text_muted }]}>{TITLE_BY_SLUG[slug]}</Text>
              <Text style={[styles.caddieName, { color: colors.accent }]}>{caddieName.toUpperCase()}</Text>
            </View>
          </View>
          <View style={styles.linesWrap}>
            {lines.map((line, i) => (
              <View key={i} style={styles.lineRow}>
                <View style={[styles.lineBullet, { backgroundColor: colors.accent }]} />
                <Text style={[styles.lineText, { color: colors.text_primary }]}>{line}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            onPress={onDismiss}
            style={[styles.skipBtn, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Skip intro and continue"
          >
            <Text style={[styles.skipBtnText, { color: '#060f09' }]}>Got it</Text>
            <Ionicons name="arrow-forward" size={16} color="#060f09" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
  caddieName: { fontSize: 14, fontWeight: '900', letterSpacing: 1.2, marginTop: 2 },
  linesWrap: { gap: 10 },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  lineBullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  lineText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 2,
  },
  skipBtnText: { fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },
});

export default CaddieIntroSheet;
