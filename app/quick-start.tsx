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
  body: string;
  bullets?: string[];
};

const CARDS: Card[] = [
  {
    icon: 'people-circle-outline',
    title: 'Your Caddie Team',
    body:
      "SmartPlay Caddie has four caddies, each with a distinct voice and approach. You pick the one that fits how you want to be coached.",
    bullets: [
      'Kevin — warm, balanced, decisive. The default. Good place to start.',
      'Tank — Marine cadence, intense, demanding standards. For players who want to be pushed.',
      'Serena — precise instructor, confident, energetic-professional. Technical clarity.',
      'Harry — Army medic, measured wisdom, partnership tone. Calm authority.',
    ],
  },
  {
    icon: 'apps-outline',
    title: 'Three Pillars',
    body:
      "Everything in the app maps to one of three pillars. Same caddie team across all three; you can assign a different lead per pillar in Settings.",
    bullets: [
      'Play — on-course rounds. SmartFinder yardages, hole-to-hole flow, real-time coaching.',
      'Practice — Cage Mode + SwingLab. Swing analysis with fault-frame visual evidence.',
      'Drills — guided technique work. Tutorials, drill catalog, focused practice.',
    ],
  },
  {
    icon: 'flag-outline',
    title: 'Getting Started',
    body: "First round in under two minutes.",
    bullets: [
      '1. Play tab → pick your course (the app sorts by distance from you).',
      '2. Tap "Start Round Here". Permissions prompts come up — accept Location and Mic.',
      '3. Caddie tab is your in-round home. Talk to your caddie, tap to log shots.',
      '4. End of round → recap surfaces hole-by-hole + shot-tracking insights.',
    ],
  },
  {
    icon: 'mic-outline',
    title: 'Essential Controls',
    body: "The fastest paths through the app.",
    bullets: [
      'Voice — tap the caddie portrait OR tap the brand badge on any tab to talk.',
      'Tools menu — three dots top-right. Quick access to SmartFinder, SmartVision, Cage Mode, SmartMotion, TightLie.',
      'Mark — bottom of Caddie tab. Tap when you arrive at your ball to lock GPS.',
      'I\'m at my ball — say it out loud, same effect as tapping Mark.',
      'Open SmartMotion — fast swing capture with acoustic auto-stop.',
      'Check my lie — opens TightLie for lie analysis + shot strategy.',
    ],
  },
  {
    icon: 'construct-outline',
    title: 'What to Expect (Beta Context)',
    body:
      "This is a local-device beta. Real things you should know up front:",
    bullets: [
      'Your profile lives on this phone. No cloud sync yet — switching phones means starting over. v1.2 ships real accounts.',
      'No login required. Open the app, use it. Settings → Reset App Data wipes everything if you want a fresh start.',
      'GPS in background works when you accept the "Allow all the time" prompt at round start. You\'ll see a persistent notification while a round is active.',
      'Caddie voice may sound slightly slow on first launch while the voice library regenerates. Restart the app once after install for the tuned voices.',
      'Things will be rough. That\'s the point. Honest feedback over polite — see "Share Feedback" below.',
    ],
  },
  {
    icon: 'lock-closed-outline',
    title: 'Privacy',
    body:
      "What leaves your device + what we collect.",
    bullets: [
      'GPS, swing audio, lie photos, and voice transcripts are sent to AI providers (Anthropic + OpenAI + Mapbox) to power the caddie. Standard service-provider data flow.',
      'No personal identifiers leave the device — no name, no email, no PII attached to the AI calls.',
      'No third-party analytics, no ad tracking, no data sale.',
      'Full Privacy Policy at smartplaycaddie.com/privacy.',
      'Reset App Data in Settings clears everything stored on your device.',
    ],
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
            <Text style={[styles.cardBody, { color: colors.text_primary }]}>{card.body}</Text>
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
