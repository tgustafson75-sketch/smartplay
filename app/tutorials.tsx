import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AppIcon, { type IconName } from '../components/AppIcon';
import { useSettingsStore } from '../store/settingsStore';
import { getCaddieName } from '../lib/persona';

/**
 * Tutorials surface — selectable cards by app function. Tap a card to expand
 * the steps. Content is editable here as features evolve; categories below
 * cover the current shipped surfaces.
 */

type Tutorial = {
  id: string;
  icon: IconName;
  title: string;
  blurb: string;
  steps: string[];
};

const buildTutorials = (caddieName: string, pronoun: string): Tutorial[] => [
  {
    id: 'voice',
    icon: 'mic',
    title: `Talking to ${caddieName}`,
    blurb: 'Voice anytime, tap anytime, both equal.',
    steps: [
      `Tap ${caddieName} or the mic icon to talk. ${pronoun} listens for a few seconds, then responds.`,
      'Try natural lines like "What\'d you hit?" or "How far to the green?".',
      'Tap the ? button (L2 / L3) for a list of what you can say on the current screen.',
      'Voice can be muted in Tools → Voice On/Off if you want to play in silence.',
    ],
  },
  {
    id: 'trust',
    icon: 'options-outline',
    title: `Trust Spectrum (${caddieName}'s Presence)`,
    blurb: 'Four levels, your call any time.',
    steps: [
      `Quiet: just a logo and a SmartVision card. ${caddieName} is reachable, not present.`,
      `Companion (default): split with ${caddieName} and SmartVision side-by-side.`,
      `Active: ${caddieName} takes most of the screen, chimes in between shots.`,
      `Full: ${caddieName} centered, voice-first. SmartFinder collapses to a corner icon.`,
      `Change anytime in Tools → "${caddieName}'s Presence" or in Settings.`,
    ],
  },
  {
    id: 'smartfinder',
    icon: 'locate-outline',
    title: 'SmartFinder',
    blurb: 'Camera rangefinder with three modes plus Putt.',
    steps: [
      'Standard: aim the camera, tap to lock distance via tilt.',
      'Target: tap any point on the hole overhead view to get yardage to it.',
      'Map: full hole view with player, tee, green markers.',
      'Putt: tap point A (ball), tap point B (cup) — get distance and slope.',
      'Front / Middle / Back yardages always live on the embedded card.',
    ],
  },
  {
    id: 'smartvision',
    icon: 'telescope-outline',
    title: 'SmartVision',
    blurb: 'Tap the hole-view card to open it for the current hole.',
    steps: [
      'On L1 / L2 the SmartVision card sits above SmartFinder showing the current hole.',
      'Tap the card to open the full SmartVision tool for that hole.',
      'Course geometry shows tee, green, your position, and shot path when available.',
      'Falls back to a satellite or curated hole image when live geometry isn\'t loaded.',
    ],
  },
  {
    id: 'course',
    icon: 'golf-outline',
    title: 'Course Detail',
    blurb: 'Preview a course before you tee off.',
    steps: [
      'In Round Setup, search a course and tap the (i) icon on a result.',
      'Course Detail opens with hero photo, stats, AI About + Caddie Tips, hole guide.',
      'Tap "Start Round Here" to jump straight into Round Setup with the course pre-selected.',
    ],
  },
  {
    id: 'shots',
    icon: 'flag-outline',
    title: 'Shot Logging',
    blurb: 'Voice or tap, after each shot.',
    steps: [
      `${caddieName} asks "What'd you hit?" after a detected shot. Just say it: "smoked a seven iron".`,
      'Or tap the shot card and pick from the menu.',
      'Add a penalty stroke from the scoring tool (water, OB, lost ball).',
      'Each shot writes GPS, weather, and your raw words to your round.',
    ],
  },
  {
    id: 'recap',
    icon: 'stats-chart-outline',
    title: 'Recap',
    blurb: 'Coach voice after the round.',
    steps: [
      'Recap opens automatically after End Round, or from Tools any time.',
      'Hero moment, hole-by-hole, and a "Walk me through it" voice narration.',
      'Tap "View hole" on any hole row to see the shot map for that hole.',
    ],
  },
  {
    // 2026-07-04 (elite-clean audit, menu finding #14) — this card described the
    // PRE-rebuild menu (Cast Mode, "Open Practice / Cage", a Recap entry — none
    // exist). Rewritten to match the live GlobalToolsMenu.
    id: 'tools',
    icon: 'construct-outline',
    title: 'Tools menu',
    blurb: 'Three-dot menu top-right of Caddie home.',
    steps: [
      `Switch your caddie or cycle ${caddieName}'s Presence without leaving the menu.`,
      'Open SmartMotion, SwingLab, SmartVision, SmartFinder, Smart Play, or TightLie.',
      'Refresh GPS, view the Shot Log, end the round, or toggle Coach Mode.',
      'Tutorials (this screen) and Your Caddie live under Help.',
    ],
  },
];

export default function TutorialsScreen() {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const voiceGender = useSettingsStore(s => s.voiceGender);
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const caddieName = getCaddieName(caddiePersonality);
  const pronoun = voiceGender === 'female' ? 'She' : 'He';
  const tutorials = useMemo(() => buildTutorials(caddieName, pronoun), [caddieName, pronoun]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Tutorials</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.subtitle}>Tap any card to see how it works.</Text>

        {tutorials.map(t => {
          const open = openId === t.id;
          return (
            <TouchableOpacity
              key={t.id}
              style={[styles.card, open && styles.cardOpen]}
              activeOpacity={0.85}
              onPress={() => setOpenId(open ? null : t.id)}
            >
              <View style={styles.cardHeader}>
                <AppIcon name={t.icon} size={24} color="#00C896" />
                <View style={styles.cardHeaderText}>
                  <Text style={styles.cardTitle}>{t.title}</Text>
                  <Text style={styles.cardBlurb}>{t.blurb}</Text>
                </View>
                <Text style={styles.chev}>{open ? '−' : '+'}</Text>
              </View>
              {open && (
                <View style={styles.steps}>
                  {t.steps.map((step, i) => (
                    <View key={i} style={styles.stepRow}>
                      <Text style={styles.stepNum}>{i + 1}</Text>
                      <Text style={styles.stepText}>{step}</Text>
                    </View>
                  ))}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { width: 60 },
  backText: { color: '#00C896', fontSize: 16, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  scroll: { padding: 16, paddingBottom: 32 },
  subtitle: { color: '#9ca3af', fontSize: 13, marginBottom: 16, textAlign: 'center' },
  card: {
    backgroundColor: '#0d2418',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 14,
    marginBottom: 10,
  },
  cardOpen: { borderColor: '#00C896' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { fontSize: 24, width: 32, textAlign: 'center' },
  cardHeaderText: { flex: 1 },
  cardTitle: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  cardBlurb: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  chev: { color: '#00C896', fontSize: 22, fontWeight: '300', width: 18, textAlign: 'center' },
  steps: { marginTop: 14, gap: 10 },
  stepRow: { flexDirection: 'row', gap: 10 },
  stepNum: {
    color: '#00C896', fontSize: 12, fontWeight: '900', width: 18, textAlign: 'right',
  },
  stepText: { color: '#e8f5e9', fontSize: 13, lineHeight: 19, flex: 1 },
});
