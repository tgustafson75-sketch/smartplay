/**
 * Phase 411 — In-app Quick Start Guide.
 *
 * Same content as the PDF tester guide, rendered as scrollable
 * sections inside the app so testers can refer back without hunting
 * for the email attachment.
 *
 * Reached from:
 *   - Settings → Help → Quick Start Guide (always available).
 *   - app/welcome.tsx — a "Quick tour" button appears alongside
 *     "Get Started" so first-time testers can opt in to the guide.
 *
 * Layout: vertical card stack inside ScrollView. Each card is a
 * thematic section (caddie team / pillars / getting started / etc.).
 * "Share Feedback" CTA at the bottom opens the mail client with
 * support@smartplaycaddie.com pre-filled.
 */

import React, { useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Linking, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

type Card = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  /** Optional intro line above the bullet list. */
  body?: string;
  /** Optional closing line below the bullets. */
  footer?: string;
  bullets?: string[];
  /** Optional named sub-bullets (term — body). Used for the caddie
   *  roster card so each caddie's label + tagline reads cleanly. */
  named?: { name: string; body: string }[];
};

// Phase 411-followup — Tim's canonical Beta Tester Quick Start content,
// verbatim from the PDF tester guide so the in-app reference is the
// single source of truth. Section order and copy match the PDF.
const CARDS: Card[] = [
  {
    icon: 'people-circle-outline',
    title: 'Your Caddie Team',
    body: 'SmartPlay gives you four AI caddies. Each one shines in a different part of your game.',
    named: [
      { name: 'Kevin — The Steady Hand',        body: 'Warm, knowledgeable, balanced. Your default caddie on the course.' },
      { name: 'Serena — The Composed Professional', body: 'Confident, supportive, precise. Good for technical drill work.' },
      { name: 'Tank — The Intense Coach',       body: 'Marine vet intensity. Direct, motivating. Cage practice specialist.' },
      { name: 'Harry — The Wise Counsel',       body: 'Decades of golf wisdom. Calm authority. Course play alternative.' },
    ],
    footer:
      'Pick your caddie team in Settings → Caddie Team. Defaults work fine to start. Change anytime.',
  },
  {
    icon: 'apps-outline',
    title: 'Three Pillars',
    named: [
      { name: 'ROUND — Play on the course',  body: 'GPS yardages, hole graphics, voice flow through earbuds, shot tracking.' },
      { name: 'PRACTICE — Get better',       body: 'Cage Mode for swing analysis. Drill library. Tutorial integration.' },
      { name: 'PLAY — Have fun',             body: 'Games and growth modes (expanding in future updates).' },
    ],
  },
  {
    icon: 'flag-outline',
    title: 'Getting Started',
    bullets: [
      '1. Open the app — your caddie is ready, no setup required',
      '2. Tap the Caddie tab and just talk to it',
      '3. Connect Bluetooth earbuds if you want hands-free voice',
      '4. Tap Play tab → select a course → start a round',
    ],
    footer: 'For practice: SwingLab tab → Cage Mode → set up phone → record swings.',
  },
  {
    icon: 'mic-outline',
    title: 'Essential Controls',
    named: [
      { name: 'EARBUD TAP', body: 'Single-tap your Bluetooth earbud to talk to your caddie anytime.' },
      { name: 'VOICE QUERIES', body: '"What should I hit?" / "How far to the green?" / "Mark my position" / "Record this shot"' },
      { name: 'SMARTFINDER', body: 'Front, middle, back yardages on every hole. Updates as you walk.' },
      { name: 'SMARTVISION', body: 'Tap to see hole graphic. Drag the yellow Y marker for layup distances.' },
      { name: 'TIGHTLIE', body: 'Tap to capture your lie. Caddie advice adjusts for rough, slopes, divots.' },
      { name: 'MARK MY SPOT', body: 'Tap to capture exact position. Useful before walking forward to scout.' },
    ],
  },
  {
    icon: 'construct-outline',
    title: 'What to Expect',
    body:
      "This is early beta. You'll see things working well and things that need work. That's the point. Your feedback shapes the product.",
    bullets: [
      'Voice recognition occasionally mishears',
      'Some courses have incomplete data (caddie will say so honestly)',
      'Auto club detection works best with light-colored irons in good lighting',
      'Some features are deeper than others — round play and cage practice are most developed',
    ],
  },
  {
    icon: 'mail-outline',
    title: 'How to Give Feedback',
    body: 'Anything that surprises you, breaks, confuses, or impresses you — tell us.',
    named: [
      { name: 'Email',         body: 'support@smartplaycaddie.com' },
      { name: 'Text / Direct', body: "Tim's contact (he'll send separately)" },
    ],
    bullets: [
      'What worked well',
      "What didn't work or felt off",
      'What you wish it did',
      'Any crashes (with what you were doing when it happened)',
    ],
    footer: 'Quick observations beat polished reports. Send them as they happen.',
  },
  {
    icon: 'lock-closed-outline',
    title: 'Privacy',
    body:
      "Your data is yours. SmartPlay stores your profile, round history, and practice analysis to make your caddie smarter over time. We don't share or sell your data. See full privacy policy at smartplaycaddie.com/privacy.",
  },
  {
    icon: 'heart-outline',
    title: 'Thank You',
    body:
      "You're testing something I've been building for months. Your time and honest feedback matters more than I can express. Whatever you find — good, bad, broken, surprising — please share it.",
    footer: '— Tim',
  },
];

export default function QuickStartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii } = useTheme();
  const styles = useMemo(() => makeStyles(colors, spacing, radii), [colors, spacing, radii]);

  const handleFeedback = () => {
    const url =
      'mailto:support@smartplaycaddie.com?subject=' +
      encodeURIComponent('SmartPlay Caddie Beta Feedback') +
      '&body=' +
      encodeURIComponent(
        // Helpful prompts so testers don't stare at a blank body.
        "Hi Tim,\n\n" +
        "What worked:\n\n\n" +
        "What didn't:\n\n\n" +
        "What surprised me:\n\n\n" +
        "Phone / OS:\n" +
        "Round count so far:\n"
      );
    Linking.openURL(url).catch(() => {
      Alert.alert(
        'Email unavailable',
        'Could not open your email client. Reach support at support@smartplaycaddie.com directly.',
      );
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Close Quick Start Guide"
        >
          <Ionicons name="close" size={22} color={colors.text_muted} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>Quick Start</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 32 + insets.bottom }]}>
        <Text style={[styles.lead, { color: colors.text_muted }]}>
          A short reference for testers. Tap any section to read; come back anytime via Settings → Help → Quick Start.
        </Text>

        {CARDS.map((card, i) => (
          <View
            key={card.title}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={styles.cardHeader}>
              <Ionicons name={card.icon} size={18} color={colors.accent} />
              <Text style={[styles.cardTitle, { color: colors.text_primary }]}>
                {i + 1}. {card.title}
              </Text>
            </View>
            {card.body ? (
              <Text style={[styles.cardBody, { color: colors.text_primary }]}>{card.body}</Text>
            ) : null}
            {card.named && card.named.length > 0 && (
              <View style={styles.namedList}>
                {card.named.map((n, idx) => (
                  <View key={idx} style={styles.namedRow}>
                    <Text style={[styles.namedName, { color: colors.accent }]}>{n.name}</Text>
                    <Text style={[styles.namedBody, { color: colors.text_primary }]}>{n.body}</Text>
                  </View>
                ))}
              </View>
            )}
            {card.bullets && card.bullets.length > 0 && (
              <View style={styles.bulletList}>
                {card.bullets.map((b, idx) => (
                  <View key={idx} style={styles.bulletRow}>
                    <Text style={[styles.bulletDot, { color: colors.accent }]}>•</Text>
                    <Text style={[styles.bulletText, { color: colors.text_primary }]}>{b}</Text>
                  </View>
                ))}
              </View>
            )}
            {card.footer ? (
              <Text style={[styles.cardFooter, { color: colors.text_muted }]}>{card.footer}</Text>
            ) : null}
          </View>
        ))}

        <TouchableOpacity
          style={[styles.feedbackCta, { backgroundColor: colors.accent }]}
          onPress={handleFeedback}
          accessibilityRole="button"
          accessibilityLabel="Share feedback with the SmartPlay Caddie team"
        >
          <Ionicons name="mail-outline" size={18} color="#0d1a0d" />
          <Text style={styles.feedbackCtaText}>Share Feedback</Text>
        </TouchableOpacity>

        <Text style={[styles.feedbackSub, { color: colors.text_muted }]}>
          Opens your mail client with helpful prompts pre-filled. Honest feedback over polite — anything you noticed is worth telling us about.
        </Text>
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
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '900', letterSpacing: 0.4 },
    scroll: { paddingHorizontal: s.lg, paddingTop: s.lg, gap: s.md },
    lead: { fontSize: 13, lineHeight: 19, marginBottom: s.sm },
    card: {
      borderWidth: 1, borderRadius: r.md,
      paddingHorizontal: s.md, paddingVertical: s.md,
      gap: s.sm,
    },
    cardHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
    },
    cardTitle: {
      fontSize: 15, fontWeight: '900', letterSpacing: 0.3, flex: 1,
    },
    cardBody: {
      fontSize: 14, lineHeight: 20,
    },
    bulletList: { gap: 6, marginTop: 4 },
    bulletRow: {
      flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    },
    bulletDot: { fontSize: 14, fontWeight: '900', lineHeight: 20 },
    bulletText: { flex: 1, fontSize: 13, lineHeight: 19 },
    namedList: { gap: 10, marginTop: 4 },
    namedRow: { gap: 2 },
    namedName: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
    namedBody: { fontSize: 13, lineHeight: 19 },
    cardFooter: { fontSize: 12, marginTop: 8, fontStyle: 'italic', lineHeight: 17 },
    feedbackCta: {
      marginTop: s.lg,
      borderRadius: r.lg, paddingVertical: 14,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    feedbackCtaText: {
      color: '#0d1a0d', fontSize: 15, fontWeight: '900', letterSpacing: 0.3,
    },
    feedbackSub: {
      fontSize: 11, lineHeight: 16, marginTop: s.sm, textAlign: 'center', fontStyle: 'italic',
    },
  });
}
