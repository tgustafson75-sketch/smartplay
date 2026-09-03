import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AppIcon, { type IconName } from '../components/AppIcon';
import { useSettingsStore } from '../store/settingsStore';
import { getCaddieName } from '../lib/persona';
import { SUBSCRIPTIONS_ENABLED, HEALTH_CONNECT_ENABLED } from '../services/featureAccess';

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

/**
 * 2026-09-03 — the trial card only exists when there IS a trial.
 *
 * 1.0 ships with SUBSCRIPTIONS_ENABLED false (paywall off, nothing restricted, so Play review needs
 * no bypass account). With the ladder unlocked, planTrialExtension correctly answers 'not_on_trial'
 * and the light-use offer never fires — which is right, but it would have left a tutorial telling
 * the player "if your trial runs out we add another week" about a trial they do not have. A
 * tutorial that describes a feature the build cannot reach is worse than no tutorial: it is the app
 * lying to someone who went looking for help. [[no-deferred-wiring-placeholders]]
 */
const buildTutorials = (caddieName: string, pronoun: string): Tutorial[] => {
  const all: Tutorial[] = [
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
    /**
     * 2026-09-03 (Tim — "it's not what's new, it's what is part of the tutorial and highlights").
     *
     * The round-effort card needs a tutorial rather than a changelog line for two reasons: it is
     * Android-only, and it does nothing until the player grants Health Connect. A feature the
     * player cannot find is experienced as a feature that does not work.
     */
    id: 'walk',
    icon: 'walk-outline',
    title: 'The Walk',
    blurb: 'What the round cost you, on your recap.',
    steps: [
      'Your recap can show miles walked, steps, average heart rate, and calories for the round.',
      `${caddieName} mentions it when he walks you through the round, so you hear it as well as see it.`,
      'Android only, and it needs Health Connect: Settings → Health Data, then grant access when asked.',
      'Nothing to do during the round — it reads the window between your first tee shot and End Round.',
      'No watch, no card. It shows nothing rather than a row of zeroes.',
    ],
  },
  {
    /**
     * 2026-09-03 — invite a friend. A tutorial rather than a changelog line because there IS a step:
     * the code has to be typed. Deferred deep linking does not exist without a third-party SDK, so
     * a friend who taps the link and installs arrives with no memory of it — the code is the part
     * that actually works, and a player who does not know to enter it never gets credited.
     */
    id: 'invite',
    icon: 'people-outline',
    title: 'Invite a friend',
    blurb: 'They play, you get rewarded.',
    steps: [
      'Settings → Invite a friend has your code and a Share button.',
      'Send the link. It shows your friend the code and points them at the right app store.',
      'After they install, they enter that code under Settings → Invite a friend → Got a code?',
      'You are credited once they actually play a round — an install on its own does not count.',
    ],
  },
  {
    /**
     * 2026-09-03 — a HIGHLIGHT, not an instruction: there is no step to perform. It is here because
     * a player who does not know the offer exists cannot count on it, and the whole point is that
     * they should feel free to take their time.
     */
    id: 'trial',
    icon: 'gift-outline',
    title: 'Your free trial',
    blurb: 'Miss it and we extend it.',
    steps: [
      `Every new player gets a full free trial of everything — no card up front.`,
      'If it runs out and you never really got a chance to play, we add another week instead of a bill.',
      'It offers itself: fewer than three days out with the app and the card appears. One tap, no charge.',
      'Weather, daylight and tee times are not your fault. A trial you never got to use is not a trial.',
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
  return all
    .filter((t) => t.id !== 'trial' || SUBSCRIPTIONS_ENABLED)
    // 'The Walk' explains how to connect Health Connect. Without the permissions in this
    // build there is nothing to connect, so the card would be instructions for a dead end.
    .filter((t) => t.id !== 'walk' || HEALTH_CONNECT_ENABLED);
};

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
  subtitle: { color: '#c2cad4', fontSize: 13, marginBottom: 16, textAlign: 'center' },
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
  cardBlurb: { color: '#c2cad4', fontSize: 12, marginTop: 2 },
  chev: { color: '#00C896', fontSize: 22, fontWeight: '300', width: 18, textAlign: 'center' },
  steps: { marginTop: 14, gap: 10 },
  stepRow: { flexDirection: 'row', gap: 10 },
  stepNum: {
    color: '#00C896', fontSize: 12, fontWeight: '900', width: 18, textAlign: 'right',
  },
  stepText: { color: '#e8f5e9', fontSize: 13, lineHeight: 19, flex: 1 },
});
