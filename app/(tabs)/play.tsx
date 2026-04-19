/**
 * play.tsx — Round Setup Screen
 *
 * Defines how the caddie behaves for the round:
 *   Course · Strategy · Mode · Mental State · Notes
 *
 * Tapping "Start Round" sets roundStarted = true in RoundContext,
 * which triggers the phase-driven navigation to the Caddie tab.
 */

import { useState } from 'react';
import { MaterialCommunityIcons as MCIcon } from '@expo/vector-icons';
import { DS, Palette, Space, Type, Radius } from '../../constants/theme';
import { speakSwingThought } from '../../features/smartCaddie/hooks/useCaddieVoice';
import { useLayout } from '../../hooks/use-layout';
import {
  View, Text, TextInput, ScrollView, Pressable,
  StyleSheet, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useRoundContext } from '../../context/RoundContext';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useUserStore } from '../../store/userStore';
import CaddieMicButton from '../../components/CaddieMicButton';
import BrandHeader from '../../components/BrandHeader';
import type { RoundState } from '../../context/RoundContext';
import { COURSE_DB } from '../../data/courses';

const LOGO             = require('../../assets/images/logo.png');
const ICON_RANGEFINDER = require('../../assets/images/icon-rangefinder.png');

// ---------------------------------------------------------------------------
// Option sets
// ---------------------------------------------------------------------------

const STRATEGY_OPTIONS: { value: RoundState['strategy']; label: string; sub: string }[] = [
  { value: 'conservative', label: 'Conservative', sub: 'Safe targets, manage risk'   },
  { value: 'balanced',     label: 'Balanced',     sub: 'Smart play, calculated risk' },
  { value: 'aggressive',   label: 'Aggressive',   sub: 'Play to the flag, go low'   },
];

const MODE_OPTIONS: { value: RoundState['mode']; label: string; sub: string }[] = [
  { value: 'safe',    label: 'Safe',    sub: 'Protect the scorecard'   },
  { value: 'neutral', label: 'Neutral', sub: 'Play your own game'       },
  { value: 'attack',  label: 'Attack',  sub: 'Play your best round'     },
];

const MENTAL_OPTIONS: { value: RoundState['mentalState']; label: string }[] = [
  { value: 'confident',  label: 'Locked In'   },
  { value: 'neutral',    label: 'Neutral'      },
  { value: 'nervous',    label: 'Nervous'      },
  { value: 'frustrated', label: 'Frustrated'   },
];

// ---------------------------------------------------------------------------
// Chip selector
// ---------------------------------------------------------------------------

function ChipRow<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string; sub?: string }[];
  selected: T;
  onSelect: (v: T) => void;
}) {
  return (
    <View style={s.chipRow}>
      {options.map((o) => {
        const active = o.value === selected;
        return (
          <Pressable
            key={o.value}
            onPress={() => onSelect(o.value)}
            style={[s.chip, active && s.chipActive]}
          >
            <Text style={[s.chipLabel, active && s.chipLabelActive]}>{o.label}</Text>
            {o.sub ? (
              <Text style={[s.chipSub, active && s.chipSubActive]}>{o.sub}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function PlaySetupScreen() {
  const layout = useLayout();
  const {
    course, setCourse,
    strategy, setStrategy,
    mode, setMode,
    mentalState, setMentalState,
    notes, setNotes,
    setRoundStarted,
  } = useRoundContext();

  const storeSetIsRoundActive  = useRoundStore((s) => s.setIsRoundActive);
  const storeSelectedCourseIdx  = useRoundStore((s) => s.selectedCourseIdx);
  const storeSetCourseIdx       = useRoundStore((s) => s.setSelectedCourseIdx);
  const storeSetActiveCourse    = useRoundStore((s) => s.setActiveCourse);
  const router = useRouter();
  const setIsGuest = useUserStore((s) => s.setIsGuest);
  const voiceEnabled   = useSettingsStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useSettingsStore((s) => s.setVoiceEnabled);
  const voiceStyle     = useSettingsStore((s) => s.voiceStyle);
  const setVoiceStyle  = useSettingsStore((s) => s.setVoiceStyle);
  const voiceGender    = useSettingsStore((s) => s.voiceGender);
  const setVoiceGender = useSettingsStore((s) => s.setVoiceGender);
  const highContrast    = useSettingsStore((s) => s.highContrast);
  const setHighContrast = useSettingsStore((s) => s.setHighContrast);
  const brightMode      = useSettingsStore((s) => s.brightMode);
  const setBrightMode   = useSettingsStore((s) => s.setBrightMode);

  const [courseInput, setCourseInput] = useState(course ?? '');
  const [showToolsMenu, setShowToolsMenu] = useState(false);

  const handleLogout = async () => {
    setShowToolsMenu(false);
    try { await signOut(auth); } catch {}
    setIsGuest(false);
    router.replace('/auth');
  };

  const handleStart = () => {
    // Sync selected course into context/store before starting
    const selectedCourse = COURSE_DB[storeSelectedCourseIdx] ?? COURSE_DB[0];
    setCourse(selectedCourse.name);
    storeSetActiveCourse(selectedCourse.name);
    setRoundStarted(true);
    storeSetIsRoundActive(true);
    speakSwingThought();
    // Navigate directly to caddie screen
    router.replace('/(tabs)/caddie');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.brand }} edges={['top', 'left', 'right']}>
      <BrandHeader rightSlot={
        <Pressable
          onPress={() => setShowToolsMenu((v) => !v)}
          style={[s.toolsPill, showToolsMenu && s.toolsPillActive]}
        >
          {[0,1,2].map((i) => (
            <View key={i} style={[s.dot, showToolsMenu && s.dotActive]} />
          ))}
        </Pressable>
      } />

      {/* ── Header bar ── */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Round Setup</Text>
          <Text style={s.headerSub}>Tell the caddie how to coach you today.</Text>
        </View>
        {/* Rangefinder shortcut */}
        <Pressable
          onPress={() => router.push('/rangefinder')}
          style={s.rfBtn}
        >
          <Image source={ICON_RANGEFINDER} style={{ width: 20, height: 20, tintColor: Palette.accent }} resizeMode="contain" />
        </Pressable>
      </View>

      {/* Tools backdrop */}
      {showToolsMenu && (
        <Pressable
          onPress={() => setShowToolsMenu(false)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}
        />
      )}

      {/* Tools dropdown */}
      {showToolsMenu && (
        <ScrollView
          style={s.toolsMenu}
          contentContainerStyle={{ padding: 10, gap: 8 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={() => setVoiceEnabled(!voiceEnabled)} style={[s.menuItem, !voiceEnabled && { backgroundColor: '#0e1a12', borderColor: '#1a3326' }]}>
            <MCIcon name={voiceEnabled ? 'volume-high' : 'volume-off'} size={16} color={voiceEnabled ? Palette.muted : '#527a64'} />
            <Text style={s.menuItemText}>{voiceEnabled ? 'Voice On' : 'Voice Off'}</Text>
          </Pressable>
          <Pressable onPress={() => setVoiceStyle(voiceStyle === 'calm' ? 'aggressive' : 'calm')} style={s.menuItem}>
            <MCIcon name={voiceStyle === 'aggressive' ? 'bullhorn-outline' : 'meditation'} size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>{voiceStyle === 'aggressive' ? 'Aggressive' : 'Calm'} Voice</Text>
          </Pressable>
          <Pressable onPress={() => setVoiceGender(voiceGender === 'male' ? 'female' : 'male')} style={s.menuItem}>
            <MCIcon name="account-voice" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>{voiceGender === 'male' ? 'Male' : 'Female'} Voice</Text>
          </Pressable>
          <Pressable onPress={() => setHighContrast(!highContrast)} style={[s.menuItem, highContrast && { backgroundColor: '#0e1a12', borderColor: '#1a3326' }]}>
            <MCIcon name="contrast-circle" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>{highContrast ? 'High Contrast' : 'Normal'}</Text>
          </Pressable>
          <Pressable onPress={() => setBrightMode(!brightMode)} style={[s.menuItem, brightMode && { backgroundColor: '#0e1a12', borderColor: '#1a3326' }]}>
            <MCIcon name="white-balance-sunny" size={16} color={brightMode ? Palette.positiveFaint : Palette.muted} />
            <Text style={[s.menuItemText, brightMode && { color: Palette.positiveFaint }]}>Bright Mode {brightMode ? 'On' : 'Off'}</Text>
          </Pressable>
          <Pressable onPress={() => { setShowToolsMenu(false); router.push('/rangefinder'); }} style={[s.menuItem, { borderColor: Palette.accent }]}>
            <Image source={ICON_RANGEFINDER} style={{ width: 18, height: 18, tintColor: Palette.accent }} resizeMode="contain" />
            <Text style={[s.menuItemText, { color: '#FFE600' }]}>AR Rangefinder</Text>
          </Pressable>
          <Pressable onPress={() => { setShowToolsMenu(false); router.push('/profile-setup'); }} style={s.menuItem}>
            <MCIcon name="account-circle-outline" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>Profile</Text>
          </Pressable>
          <Pressable onPress={() => { setShowToolsMenu(false); router.push('/settings' as any); }} style={s.menuItem}>
            <MCIcon name="cog-outline" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>Settings</Text>
          </Pressable>
          <Pressable onPress={() => { void handleLogout(); }} style={[s.menuItem, { borderColor: '#6b2020', backgroundColor: '#1a0c0c' }]}>
            <MCIcon name="logout" size={16} color="#e8a0a0" />
            <Text style={[s.menuItemText, { color: '#e8a0a0' }]}>Sign Out</Text>
          </Pressable>
        </ScrollView>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingHorizontal: layout.hPad }]}
        keyboardShouldPersistTaps="handled"
      >

        {/* Course */}
        <View style={s.section}>
          <Text style={s.label}>Course</Text>
          {COURSE_DB.map((c, idx) => {
            const active = idx === storeSelectedCourseIdx;
            return (
              <Pressable
                key={c.id}
                onPress={() => {
                  storeSetCourseIdx(idx);
                  storeSetActiveCourse(c.name);
                  setCourse(c.name);
                }}
                style={[coursePickerStyles.row, active && coursePickerStyles.rowActive]}
              >
                <Image
                    source={c.thumbnail}
                    style={{ width: 44, height: 44, borderRadius: 8, marginRight: 12 }}
                    resizeMode="cover"
                  />
                  <View style={{ flex: 1 }}>
                  <Text style={[coursePickerStyles.name, active && coursePickerStyles.nameActive]}>
                    {c.name}
                  </Text>
                  <Text style={coursePickerStyles.loc}>{c.location} · Rating {c.rating} · Slope {c.slope}</Text>
                </View>
                {active && <Text style={{ color: Palette.positive, fontSize: 14, fontWeight: '700' }}>✓</Text>}
              </Pressable>
            );
          })}
        </View>

        {/* Strategy */}
        <View style={s.section}>
          <Text style={s.label}>Strategy</Text>
          <ChipRow options={STRATEGY_OPTIONS} selected={strategy} onSelect={setStrategy} />
        </View>

        {/* Mode */}
        <View style={s.section}>
          <Text style={s.label}>Mode</Text>
          <ChipRow options={MODE_OPTIONS} selected={mode} onSelect={setMode} />
        </View>

        {/* Mental State */}
        <View style={s.section}>
          <Text style={s.label}>Mental State</Text>
          <ChipRow options={MENTAL_OPTIONS} selected={mentalState} onSelect={setMentalState} />
        </View>

        {/* Notes */}
        <View style={s.section}>
          <Text style={s.label}>Notes for Caddie</Text>
          <TextInput
            style={[s.input, s.inputMulti]}
            placeholder="e.g. Working on tempo today. Avoid driver."
            placeholderTextColor="#4a7c5e"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            returnKeyType="done"
          />
        </View>

        {/* CTA */}
        <Pressable
          onPress={handleStart}
          style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}
        >
          <Text style={s.ctaText}>Start Round</Text>
        </Pressable>

      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  // Header
  header:          DS.header,
  headerTitle:     DS.headerTitle,
  headerSub:       DS.headerSub,
  rfBtn:           DS.rfBtn,
  toolsPill:       DS.toolsPill,
  toolsPillActive: DS.toolsPillActive,
  dot:             DS.dot,
  dotActive:       DS.dotActive,
  toolsMenu:   { ...DS.toolsMenu, top: 72 },
  menuItem:    DS.menuItem,
  menuItemIcon: DS.menuItemIcon,
  menuItemText: DS.menuItemText,
  scroll: {
    padding: Space.xl,
    paddingTop: Space.section,
    paddingBottom: 48,
  },
  title: {
    fontSize: Type.h1,
    fontWeight: Type.bold,
    color: Palette.positiveFaint,
    marginBottom: Space.xs,
  },
  subtitle: {
    fontSize: Type.md,
    color: Palette.textSub,
    marginBottom: Space.section,
  },
  section: {
    marginBottom: Space.section,
  },
  label: DS.label as any,
  input: DS.input,
  inputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.md,
  },
  chip: DS.chip,
  chipActive: {
    backgroundColor: Palette.bgActive,
    borderColor: Palette.borderActive,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Palette.muted,
  },
  chipLabelActive: {
    color: Palette.textPrimary,
  },
  chipSub: {
    fontSize: 12,
    color: Palette.textSub,
    marginTop: 2,
    textAlign: 'center',
  },
  chipSubActive: {
    color: Palette.textSub,
  },
  cta: {
    backgroundColor: Palette.positive,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#071E16',
    letterSpacing: 0.3,
  },
});

const coursePickerStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.cardBg,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    padding: 13,
    marginBottom: 7,
  },
  rowActive: {
    borderColor: Palette.borderActive,
    backgroundColor: Palette.bgActive,
  },
  name: {
    color: Palette.textSub,
    fontWeight: '600',
    fontSize: 14,
    marginBottom: 2,
  },
  nameActive: {
    color: Palette.textPrimary,
  },
  loc: {
    color: Palette.textSub,
    fontSize: 12,
  },
});

