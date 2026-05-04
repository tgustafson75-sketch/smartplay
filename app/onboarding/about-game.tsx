/**
 * Phase BB — Onboarding context capture screen.
 *
 * Captures three fields that meaningfully change Kevin's day-1 voice:
 *   1. Handicap (number; "I don't know" → defaults to 18)
 *   2. Miss type (slice/hook/thin/fat/pull/push/varies)
 *   3. Experience context (starting/improving/returning/competitive)
 *
 * Persisted to playerProfileStore. The next screen (meet-kevin) calls
 * synthesizeOnboardingProfile() which now includes these fields in the
 * Sonnet prompt so kevinContext has real substance from day 1.
 *
 * Why these three:
 *   - Handicap drives mode-relative framing and recommendation
 *     conservatism. Without it Kevin treats everyone as a 18-handicap.
 *   - Miss type seeds club + target advice ("with that slice tendency,
 *     favor the left side off the tee").
 *   - Experience context calibrates Kevin's tone — Returning Golfer
 *     gets supportive Psychologist register; Competitive gets terse
 *     Caddie precision. Without this, Kevin's voice is one-size for
 *     all personas.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';

const PROMPT = "A few quick things about your game so I can caddie for you, not for some generic golfer.";
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

type MissType = 'slice' | 'hook' | 'thin' | 'fat' | 'pull' | 'push' | 'varies';
type ExperienceContext = 'starting' | 'improving' | 'returning' | 'competitive';

const MISS_OPTIONS: { id: MissType; label: string; sub: string }[] = [
  { id: 'slice',  label: 'Slice / Fade',  sub: 'Right miss for a righty' },
  { id: 'hook',   label: 'Hook / Pull',   sub: 'Left miss' },
  { id: 'thin',   label: 'Thin / Topped', sub: 'Hitting the top of the ball' },
  { id: 'fat',    label: 'Fat / Chunk',   sub: 'Hitting behind it' },
  { id: 'pull',   label: 'Pull',          sub: 'Straight left' },
  { id: 'push',   label: 'Push',          sub: 'Straight right' },
  { id: 'varies', label: 'Varies / Not sure', sub: 'Some days one, some days another' },
];

const EXPERIENCE_OPTIONS: { id: ExperienceContext; label: string; sub: string }[] = [
  { id: 'starting',    label: 'Just getting started',     sub: 'Newer to the game' },
  { id: 'improving',   label: 'Improving regularly',      sub: 'I play and practice with a goal in mind' },
  { id: 'returning',   label: 'Getting back to the game', sub: 'Used to play, want to rebuild' },
  { id: 'competitive', label: 'Competitive / serious',    sub: 'Tournaments, single digits, focused' },
];

export default function OnboardingAboutGame() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const setHandicap = usePlayerProfileStore(s => s.setHandicap);
  const setMissType = usePlayerProfileStore(s => s.setMissType);
  const setExperienceContext = usePlayerProfileStore(s => s.setExperienceContext);

  const [handicapText, setHandicapText] = useState('');
  const [unknownHandicap, setUnknownHandicap] = useState(false);
  const [miss, setMiss] = useState<MissType | null>(null);
  const [experience, setExperience] = useState<ExperienceContext | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (voiceEnabled) {
        await configureAudioForSpeech();
        speak(PROMPT, voiceGender, language, apiUrl).catch(() => {});
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canContinue = (handicapText.trim().length > 0 || unknownHandicap) && miss !== null && experience !== null;

  const handleContinue = () => {
    if (!canContinue) return;
    if (!unknownHandicap) {
      const n = parseFloat(handicapText.trim());
      if (!isNaN(n) && n >= 0 && n <= 54) setHandicap(Math.round(n));
    }
    setMissType(miss);
    setExperienceContext(experience);
    router.push('/onboarding/ready' as never);
  };

  const handleSkip = () => {
    router.push('/onboarding/ready' as never);
  };

  const styles = useMemo(() => makeStyles(colors, spacing, radii), [colors, spacing, radii]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.label, { color: colors.accent }]}>KEVIN</Text>
        <Text style={[styles.prompt, { color: colors.text_primary }]}>{PROMPT}</Text>

        {/* Handicap */}
        <Text style={[styles.section, { color: colors.text_secondary }]}>WHAT&apos;S YOUR HANDICAP?</Text>
        <View style={styles.row}>
          <TextInput
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.text_primary, backgroundColor: colors.surface, opacity: unknownHandicap ? 0.4 : 1 },
            ]}
            value={handicapText}
            onChangeText={(t) => { setHandicapText(t); if (t.length > 0) setUnknownHandicap(false); }}
            placeholder="e.g. 14"
            placeholderTextColor={colors.text_muted}
            keyboardType="numeric"
            editable={!unknownHandicap}
            maxLength={3}
          />
          <TouchableOpacity
            style={[
              styles.unknownChip,
              {
                backgroundColor: unknownHandicap ? colors.accent : colors.surface,
                borderColor: unknownHandicap ? colors.accent : colors.border,
              },
            ]}
            onPress={() => { setUnknownHandicap(v => !v); setHandicapText(''); }}
            activeOpacity={0.85}
          >
            <Text style={[styles.unknownChipText, { color: unknownHandicap ? '#ffffff' : colors.text_primary }]}>
              I don&apos;t know
            </Text>
          </TouchableOpacity>
        </View>

        {/* Miss type */}
        <Text style={[styles.section, { color: colors.text_secondary, marginTop: spacing.lg }]}>WHAT&apos;S YOUR TYPICAL MISS?</Text>
        <View style={styles.optionGrid}>
          {MISS_OPTIONS.map(opt => {
            const sel = miss === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[
                  styles.optionCard,
                  { backgroundColor: sel ? colors.accent : colors.surface, borderColor: sel ? colors.accent : colors.border },
                ]}
                onPress={() => setMiss(opt.id)}
                activeOpacity={0.85}
              >
                <Text style={[styles.optionLabel, { color: sel ? '#ffffff' : colors.text_primary }]}>{opt.label}</Text>
                <Text style={[styles.optionSub, { color: sel ? 'rgba(255,255,255,0.85)' : colors.text_muted }]}>{opt.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Experience */}
        <Text style={[styles.section, { color: colors.text_secondary, marginTop: spacing.lg }]}>WHERE ARE YOU IN YOUR GOLF?</Text>
        <View style={styles.optionGrid}>
          {EXPERIENCE_OPTIONS.map(opt => {
            const sel = experience === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[
                  styles.optionCard,
                  { backgroundColor: sel ? colors.accent : colors.surface, borderColor: sel ? colors.accent : colors.border },
                ]}
                onPress={() => setExperience(opt.id)}
                activeOpacity={0.85}
              >
                <Text style={[styles.optionLabel, { color: sel ? '#ffffff' : colors.text_primary }]}>{opt.label}</Text>
                <Text style={[styles.optionSub, { color: sel ? 'rgba(255,255,255,0.85)' : colors.text_muted }]}>{opt.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Continue */}
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: canContinue ? colors.accent : colors.surface, opacity: canContinue ? 1 : 0.55 }]}
          onPress={handleContinue}
          disabled={!canContinue}
          activeOpacity={0.85}
        >
          <Text style={[styles.btnText, { color: canContinue ? '#ffffff' : colors.text_muted }]}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skip} onPress={handleSkip}>
          <Text style={[styles.skipText, { color: colors.text_muted }]}>Skip &mdash; fill this in later</Text>
        </TouchableOpacity>
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
    scroll: {
      paddingHorizontal: s.lg,
      paddingTop: s.md,
      paddingBottom: s.xl,
    },
    label: { fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: s.sm },
    prompt: { fontSize: 20, fontWeight: '700', lineHeight: 28, marginBottom: s.lg },
    section: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: s.sm },
    row: { flexDirection: 'row', alignItems: 'stretch', gap: s.sm },
    input: {
      flex: 1,
      height: 48,
      paddingHorizontal: 14,
      borderRadius: r.md,
      borderWidth: 1.5,
      fontSize: 17,
      fontWeight: '700',
    },
    unknownChip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: r.md,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    unknownChipText: { fontSize: 13, fontWeight: '700' },
    optionGrid: { gap: s.sm },
    optionCard: {
      borderWidth: 1.5,
      borderRadius: r.md,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    optionLabel: { fontSize: 15, fontWeight: '800' },
    optionSub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
    btn: {
      borderRadius: r.lg,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: s.lg,
    },
    btnText: { fontSize: 17, fontWeight: '800' },
    skip: { paddingVertical: s.md, alignItems: 'center' },
    skipText: { fontSize: 14 },
  });
}
