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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Animated, Easing, Alert,
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

  // 2026-05-22 — T&C acceptance gate. Read from store so an interrupted
  // onboarding (user closes app mid-form) finds the checkbox already
  // ticked on resume. Persisted timestamp doubles as proof-of-consent
  // for store-submission privacy compliance.
  const termsAcceptedAt = usePlayerProfileStore(s => s.termsAcceptedAt);
  const acceptTerms = usePlayerProfileStore(s => s.acceptTerms);
  const clearTermsAcceptance = usePlayerProfileStore(s => s.clearTermsAcceptance);

  const [name, setLocalName] = useState(existingName);
  const [handicapText, setHandicapText] = useState(
    existingHandicap != null && existingHandicap !== 18 ? String(existingHandicap) : '',
  );
  const [caddie, setCaddie] = useState<Persona>(existingCaddie ?? 'kevin');
  const termsAccepted = termsAcceptedAt != null;

  // 2026-05-22 — Smooth CTA enable/disable transition. Animates opacity
  // when termsAccepted toggles so the "Get started" button visibly
  // wakes up at the moment the user checks the box (and dims back if
  // they uncheck). Easing matches the standard onboarding feel.
  const ctaOpacity = useRef(new Animated.Value(termsAccepted ? 1 : 0.45)).current;
  useEffect(() => {
    Animated.timing(ctaOpacity, {
      toValue: termsAccepted ? 1 : 0.45,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [termsAccepted, ctaOpacity]);

  // Placeholder handlers for "View Full Terms" + "Privacy Policy".
  // Real legal text gets drafted + reviewed before store submission
  // (see SPRINT-LOG launch-prep section). These open a polite Alert
  // explaining the placeholder state until the docs are ready.
  const showTermsPlaceholder = () => {
    Alert.alert(
      'Full Terms — coming soon',
      'The complete Terms of Service document is in legal review before App Store / Play Store submission. The summary above covers the substantive commitments. Reach out to support@smartplaycaddie.com with questions.',
    );
  };
  const showPrivacyPlaceholder = () => {
    Alert.alert(
      'Privacy Policy — coming soon',
      'The full Privacy Policy is in legal review before App Store / Play Store submission. SmartPlay Caddie collects location, voice, camera, and gameplay data as outlined in the summary above. Reach out to support@smartplaycaddie.com with questions.',
    );
  };

  const handleGetStarted = () => {
    // 2026-05-22 — T&C gate. CTA is visually disabled when terms not
    // accepted (opacity .45 + non-interactive), so the only way this
    // handler fires is with consent. Defensive double-check anyway —
    // surfaces a clear nudge instead of silently no-op'ing if the
    // visual gate is ever bypassed (accessibility services, etc.).
    if (!termsAccepted) {
      Alert.alert(
        'Acceptance required',
        'Please review the Terms & Acceptance section and tick the agreement checkbox before continuing.',
      );
      return;
    }
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

          {/* 2026-05-22 — Terms & Acceptance gate. Required before
              "Get started" enables. Acceptance persists immediately to
              the store so an interrupted onboarding (close mid-form)
              resumes with the box pre-ticked. Real legal text is in
              review before store submission (see SPRINT-LOG launch-
              prep); the placeholder buttons surface that state. */}
          <View style={[
            styles.termsCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}>
            <Text style={[styles.fieldLabel, { color: colors.accent, marginBottom: spacing.sm }]}>
              TERMS &amp; ACCEPTANCE
            </Text>
            <ScrollView
              style={styles.termsScroll}
              contentContainerStyle={styles.termsScrollContent}
              showsVerticalScrollIndicator
              nestedScrollEnabled
            >
              <Text style={[styles.termsBody, { color: colors.text_primary }]}>
                By creating a SmartPlay Caddie account and using the platform, you acknowledge and agree that:
              </Text>
              {[
                'SmartPlay Caddie provides AI-generated golf guidance, analytics, recommendations, and coaching insights for informational and entertainment purposes only.',
                'All swing analysis, club recommendations, strategy suggestions, and course guidance are generated algorithmically and should not be considered professional golf instruction, medical advice, or guaranteed performance outcomes.',
                'Users are solely responsible for their own decisions, safety, gameplay, equipment usage, physical activity, and conduct while using the application on or off the golf course.',
                'SmartPlay Caddie does not guarantee accuracy, completeness, or real-time reliability of yardages, hazard detection, environmental conditions, or AI-generated recommendations.',
                'Users assume all risks associated with athletic activity, golf participation, and device usage during play or practice.',
                'SmartPlay Caddie may collect gameplay, swing, voice, camera, device, and performance-related data in accordance with the Privacy Policy to improve platform functionality and personalization features.',
              ].map((line, i) => (
                <View key={i} style={styles.termsBulletRow}>
                  <Text style={[styles.termsBullet, { color: colors.accent }]}>•</Text>
                  <Text style={[styles.termsBulletText, { color: colors.text_primary }]}>{line}</Text>
                </View>
              ))}
            </ScrollView>

            {/* View Full Terms · Privacy Policy — placeholder ghost
                buttons until the legal documents are published. */}
            <View style={styles.termsLinksRow}>
              <TouchableOpacity
                style={[styles.termsLink, { borderColor: colors.border }]}
                onPress={showTermsPlaceholder}
                accessibilityRole="button"
                accessibilityLabel="View Full Terms"
              >
                <Ionicons name="document-text-outline" size={13} color={colors.accent} />
                <Text style={[styles.termsLinkText, { color: colors.accent }]}>View Full Terms</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.termsLink, { borderColor: colors.border }]}
                onPress={showPrivacyPlaceholder}
                accessibilityRole="button"
                accessibilityLabel="Privacy Policy"
              >
                <Ionicons name="shield-checkmark-outline" size={13} color={colors.accent} />
                <Text style={[styles.termsLinkText, { color: colors.accent }]}>Privacy Policy</Text>
              </TouchableOpacity>
            </View>

            {/* Acceptance checkbox row. Tap anywhere on the row toggles
                the state — larger hit target than just the box. */}
            <TouchableOpacity
              style={styles.termsAcceptRow}
              onPress={() => {
                if (termsAccepted) clearTermsAcceptance();
                else acceptTerms();
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: termsAccepted }}
              accessibilityLabel="I have read and agree to the Terms of Service and Privacy Policy"
              activeOpacity={0.7}
            >
              <View style={[
                styles.termsCheckbox,
                { borderColor: termsAccepted ? colors.accent : colors.border },
                termsAccepted && { backgroundColor: colors.accent },
              ]}>
                {termsAccepted && <Ionicons name="checkmark" size={16} color="#ffffff" />}
              </View>
              <Text style={[styles.termsAcceptText, { color: colors.text_primary }]}>
                I have read and agree to the Terms of Service and Privacy Policy.
              </Text>
            </TouchableOpacity>
            {termsAccepted && (
              <Text style={[styles.termsTimestamp, { color: colors.text_muted }]}>
                Accepted {new Date(termsAcceptedAt!).toLocaleString()}
              </Text>
            )}
          </View>

          <Animated.View style={{ opacity: ctaOpacity }}>
            <TouchableOpacity
              style={[
                styles.cta,
                { backgroundColor: colors.accent },
                !termsAccepted && styles.ctaDisabled,
              ]}
              onPress={handleGetStarted}
              activeOpacity={0.85}
              disabled={!termsAccepted}
              accessibilityRole="button"
              accessibilityLabel={termsAccepted ? 'Get started' : 'Get started — disabled until terms accepted'}
              accessibilityState={{ disabled: !termsAccepted }}
            >
              <Text style={styles.ctaText}>Get started</Text>
            </TouchableOpacity>
          </Animated.View>

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
    ctaDisabled: {
      // Subtle visual cue ON TOP of the animated opacity. Accent color
      // stays so the button is still clearly the primary action — just
      // looks "sleeping" until the user accepts.
    },
    ctaText: { color: '#ffffff', fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },
    // ─── Terms & Acceptance card ───────────────────────────────────
    termsCard: {
      marginTop: s.xl,
      borderRadius: r.lg,
      borderWidth: 1,
      padding: s.md,
    },
    termsScroll: {
      maxHeight: 220,
      marginBottom: s.sm,
    },
    termsScrollContent: {
      paddingRight: s.sm,
    },
    termsBody: {
      fontSize: 13,
      lineHeight: 19,
      marginBottom: s.sm,
      fontWeight: '600',
    },
    termsBulletRow: {
      flexDirection: 'row',
      marginBottom: s.sm,
      paddingRight: s.xs,
    },
    termsBullet: {
      width: 14,
      fontSize: 14,
      fontWeight: '900',
      lineHeight: 18,
    },
    termsBulletText: {
      flex: 1,
      fontSize: 12.5,
      lineHeight: 18,
    },
    termsLinksRow: {
      flexDirection: 'row',
      gap: s.sm,
      marginTop: s.xs,
      marginBottom: s.md,
    },
    termsLink: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: r.md,
      borderWidth: 1,
    },
    termsLinkText: {
      fontSize: 11.5,
      fontWeight: '800',
      letterSpacing: 0.3,
    },
    termsAcceptRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: s.sm,
      paddingVertical: s.xs,
    },
    termsCheckbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    termsAcceptText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '600',
    },
    termsTimestamp: {
      fontSize: 10,
      fontWeight: '600',
      marginTop: s.xs,
      letterSpacing: 0.3,
      textAlign: 'right',
    },
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
