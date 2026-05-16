/**
 * Phase 410 — first-launch welcome screen.
 *
 * Captures the three things a tester opens the app to set up:
 *   1. Name (so the caddie can address them by it)
 *   2. Active caddie (Kevin default, Tank / Serena / Harry available)
 *   3. Handicap (optional, can skip)
 *
 * Lives outside `app/onboarding/` because Tim explicitly disabled the
 * multi-step onboarding gate ("Get rid of that whole stupid onboarding
 * nonsense"). This is a single screen — low friction, clear intent,
 * everything skippable.
 *
 * Routing:
 *   - app/index.tsx routes here when `first_opened_at` is null AND
 *     `name` is empty (fresh install). Sets first_opened_at after
 *     completion so returning users skip it.
 *   - Settings → "Edit Profile" routes here directly so testers can
 *     update without hunting for individual field editors.
 *   - "Get started" continues to /(tabs)/caddie.
 *
 * No required fields. Tapping Get Started with an empty form still
 * persists what's filled (or just marks first_opened_at so we don't
 * re-prompt on next launch).
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useSettingsStore, type Persona } from '../store/settingsStore';

type CaddiePick = {
  id: Persona;
  name: string;
  blurb: string;
  accent: string;
};

const CADDIES: CaddiePick[] = [
  { id: 'kevin',  name: 'Kevin',  blurb: 'Warm, balanced, decisive',                 accent: '#00C896' },
  { id: 'tank',   name: 'Tank',   blurb: 'Marine cadence, intense, demanding',       accent: '#ef4444' },
  { id: 'serena', name: 'Serena', blurb: 'Precise instructor, confident, energetic', accent: '#a855f7' },
  { id: 'harry',  name: 'Harry',  blurb: 'Army medic, measured wisdom, partnership', accent: '#3b82f6' },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const styles = useMemo(() => makeStyles(colors, spacing, radii), [colors, spacing, radii]);

  // Read existing values so Edit Profile pre-populates (vs. always blank
  // for a fresh install).
  const existingName = usePlayerProfileStore(s => s.firstName ?? s.name ?? '');
  const existingHandicap = usePlayerProfileStore(s => s.handicap);
  const existingCaddie = useSettingsStore(s => s.caddiePersonality);

  const setName = usePlayerProfileStore(s => s.setName);
  const setHandicap = usePlayerProfileStore(s => s.setHandicap);
  const setCaddiePersonality = useSettingsStore(s => s.setCaddiePersonality);

  const [name, setLocalName] = useState(existingName);
  const [handicapText, setHandicapText] = useState(
    existingHandicap != null && existingHandicap !== 18 ? String(existingHandicap) : '',
  );
  const [caddie, setCaddie] = useState<Persona>(existingCaddie ?? 'kevin');

  const handleGetStarted = () => {
    // Persist what was filled. Empty name -> default 'friend' so the
    // caddie has SOMETHING to address them by; user can update later
    // via Edit Profile.
    const trimmed = name.trim();
    if (trimmed.length > 0) setName(trimmed);
    else if (!existingName) setName('friend');

    const hcp = parseFloat(handicapText.trim());
    if (Number.isFinite(hcp) && hcp >= 0 && hcp <= 54) setHandicap(hcp);

    setCaddiePersonality(caddie);

    // Stamp first_opened_at if it isn't set — prevents this screen from
    // re-firing on the next cold launch. Done via a direct set() so
    // we don't need a dedicated action.
    const profile = usePlayerProfileStore.getState();
    if (!profile.first_opened_at) {
      usePlayerProfileStore.setState({ first_opened_at: Date.now() });
    }

    router.replace('/(tabs)/caddie' as never);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.headerBlock}>
            <Text style={[styles.title, { color: colors.text_primary }]}>
              Welcome to SmartPlay Caddie
            </Text>
            <Text style={[styles.subtitle, { color: colors.text_muted }]}>
              Set up your profile so your caddie knows who they&apos;re working with. Everything below is optional.
            </Text>
          </View>

          <Text style={[styles.fieldLabel, { color: colors.accent }]}>YOUR NAME</Text>
          <TextInput
            style={[styles.input, {
              color: colors.text_primary, borderColor: colors.border, backgroundColor: colors.surface,
            }]}
            value={name}
            onChangeText={setLocalName}
            placeholder="First name"
            placeholderTextColor={colors.text_muted}
            autoCapitalize="words"
            returnKeyType="next"
          />

          <Text style={[styles.fieldLabel, { color: colors.accent, marginTop: spacing.lg }]}>HANDICAP (OPTIONAL)</Text>
          <TextInput
            style={[styles.input, {
              color: colors.text_primary, borderColor: colors.border, backgroundColor: colors.surface,
            }]}
            value={handicapText}
            onChangeText={setHandicapText}
            placeholder="e.g. 12"
            placeholderTextColor={colors.text_muted}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />

          <Text style={[styles.fieldLabel, { color: colors.accent, marginTop: spacing.lg }]}>PICK YOUR CADDIE</Text>
          <View style={styles.caddieList}>
            {CADDIES.map(c => {
              const isActive = caddie === c.id;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.caddieRow,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                    isActive && { borderColor: c.accent, backgroundColor: `${c.accent}15` },
                  ]}
                  onPress={() => setCaddie(c.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${c.name}`}
                >
                  <View style={[styles.caddieDot, { backgroundColor: c.accent }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.caddieName, { color: colors.text_primary }]}>{c.name}</Text>
                    <Text style={[styles.caddieBlurb, { color: colors.text_muted }]}>{c.blurb}</Text>
                  </View>
                  {isActive && <Ionicons name="checkmark-circle" size={20} color={c.accent} />}
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[styles.fineprint, { color: colors.text_muted }]}>
            You can change this anytime in Settings.
          </Text>

          <TouchableOpacity
            style={[styles.cta, { backgroundColor: colors.accent }]}
            onPress={handleGetStarted}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaText}>Get started</Text>
          </TouchableOpacity>

          {/* Phase 411 — opt-in tour. Lower-profile button so it
              doesn't compete with "Get started". Testers who want
              orientation tap here; everyone else proceeds directly. */}
          <TouchableOpacity
            style={styles.tourBtn}
            onPress={() => router.push('/quick-start' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open the Quick Start Guide"
          >
            <Text style={[styles.tourBtnText, { color: colors.text_muted }]}>
              First time? Read the Quick Start guide →
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    kav: { flex: 1 },
    scroll: { paddingHorizontal: s.lg, paddingTop: s.lg, paddingBottom: s.xl },
    headerBlock: { marginBottom: s.xl },
    title: { fontSize: 26, fontWeight: '900', letterSpacing: -0.3, lineHeight: 32 },
    subtitle: { fontSize: 14, lineHeight: 20, marginTop: s.sm },
    fieldLabel: {
      fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginBottom: s.sm,
    },
    input: {
      borderWidth: 1, borderRadius: r.md,
      paddingVertical: 12, paddingHorizontal: s.md, fontSize: 16,
    },
    caddieList: { gap: s.sm },
    caddieRow: {
      flexDirection: 'row', alignItems: 'center', gap: s.sm,
      paddingHorizontal: s.md, paddingVertical: 12,
      borderWidth: 1, borderRadius: r.md,
    },
    caddieDot: { width: 12, height: 12, borderRadius: 6 },
    caddieName: { fontSize: 16, fontWeight: '800' },
    caddieBlurb: { fontSize: 12, marginTop: 1 },
    fineprint: { fontSize: 11, marginTop: s.sm, fontStyle: 'italic' },
    cta: {
      borderRadius: r.lg, paddingVertical: 14, alignItems: 'center',
      marginTop: s.xl,
    },
    ctaText: { color: '#ffffff', fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },
    tourBtn: {
      paddingVertical: s.sm,
      alignItems: 'center',
      marginTop: s.sm,
    },
    tourBtnText: {
      fontSize: 13,
      fontWeight: '600',
    },
  });
}
