/**
 * Global Tools menu modal.
 *
 * Mounted ONCE at app/_layout.tsx root. Open/close state lives in
 * store/toolsMenuStore.ts so the ••• pill in any tab's BrandHeaderRow
 * can trigger it without prop-drilling.
 *
 * What's inside (minimum viable — matches the Caddie tab's local Tools
 * menu for the cross-tab actions that make sense everywhere):
 *
 *   1. Presence cycler — Quiet → Cockpit → Companion → Active → Full →
 *      Quiet. Single canonical mode switcher per Tim's 2026-05-14 call
 *      ("Tools menu cycler is the only mode control").
 *   2. Caddie persona cycler — Kevin → Serena → Tank → Kevin.
 *   3. Open Settings link.
 *
 * Caddie-tab-specific actions (Mark current shot, scorecard pin, etc.)
 * stay on the Caddie tab's own Tools menu since they only make sense
 * mid-round on that surface.
 */

import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { useToolsMenuStore } from '../../store/toolsMenuStore';
import {
  useTrustLevelStore,
  TRUST_LEVEL_META,
  TRUST_LEVEL_SLIDER_ORDER,
} from '../../store/trustLevelStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getCaddieName, ACTIVE_PERSONAS, type Persona } from '../../lib/persona';
import { recalibrateGps } from '../../services/gpsManager';
import { forceMarkPosition } from '../../services/positionMarkBus';

export function GlobalToolsMenu() {
  const router = useRouter();
  const { colors } = useTheme();
  const isOpen = useToolsMenuStore((s) => s.isOpen);
  const close = useToolsMenuStore((s) => s.close);
  const trustLevel = useTrustLevelStore((s) => s.level);
  const setTrustLevel = useTrustLevelStore((s) => s.setLevel);
  const caddiePersonality = useSettingsStore((s) => s.caddiePersonality);
  const setCaddiePersonality = useSettingsStore((s) => s.setCaddiePersonality);
  const voiceEnabled = useSettingsStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useSettingsStore((s) => s.setVoiceEnabled);
  const castMode = useSettingsStore((s) => s.castMode);
  const setCastMode = useSettingsStore((s) => s.setCastMode);

  const cycleMode = () => {
    const cur = TRUST_LEVEL_SLIDER_ORDER.indexOf(trustLevel);
    const next = TRUST_LEVEL_SLIDER_ORDER[(cur + 1) % TRUST_LEVEL_SLIDER_ORDER.length];
    setTrustLevel(next);
  };

  const cyclePersona = () => {
    const list = ACTIVE_PERSONAS as readonly Persona[];
    const idx = list.indexOf(caddiePersonality as Persona);
    const next = list[(idx + 1) % list.length];
    setCaddiePersonality(next);
  };

  const openSettings = () => {
    close();
    router.push('/settings' as never);
  };

  const refreshGps = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      const fix = await recalibrateGps();
      // Also force-mark the position so every yardage consumer picks
      // up the fresh fix immediately (same cascade Mark uses).
      void forceMarkPosition().catch(() => undefined);
      if (fix?.accuracy_m != null) {
        Alert.alert('GPS refreshed', `Fresh fix at ±${Math.round(fix.accuracy_m)}m.`);
      } else {
        Alert.alert('GPS refreshed', 'Fresh fix acquired.');
      }
    } catch {
      Alert.alert('GPS refresh failed', 'Step into open sky and try again.');
    }
  };

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close}>
        <Pressable
          // Inner Pressable swallows scrim taps so taps on the card
          // itself don't close the modal.
          onPress={() => undefined}
          style={[styles.sheet, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
        >
          <Text style={[styles.title, { color: colors.text_muted }]}>TOOLS</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Row
              icon="options-outline"
              label={`${getCaddieName(caddiePersonality)}'s Presence: ${TRUST_LEVEL_META[trustLevel].label}`}
              sub={`${TRUST_LEVEL_META[trustLevel].one_liner} · Tap to cycle`}
              onPress={cycleMode}
              colors={colors}
            />

            <Row
              icon="sparkles-outline"
              label={`Your Caddie: ${getCaddieName(caddiePersonality)}`}
              sub={`Tap to cycle · ${ACTIVE_PERSONAS.map((p) => getCaddieName(p)).join(' · ')}`}
              onPress={cyclePersona}
              colors={colors}
            />

            <Row
              icon="locate-outline"
              label="Refresh GPS"
              sub="Pull a fresh high-accuracy fix and recalibrate yardages"
              onPress={refreshGps}
              colors={colors}
            />

            <Row
              icon={voiceEnabled ? 'volume-high-outline' : 'volume-mute-outline'}
              label={voiceEnabled ? 'Voice: ON' : 'Voice: OFF'}
              sub={voiceEnabled ? 'Caddie speaks responses aloud · Tap to mute' : 'Caddie is silent · Tap to enable voice'}
              onPress={() => setVoiceEnabled(!voiceEnabled)}
              colors={colors}
            />

            <Row
              icon={castMode ? 'tv' : 'tv-outline'}
              label={castMode ? 'Cast Mode: ON' : 'Cast Mode: OFF'}
              sub={castMode ? 'Large-text display optimized for casting · Tap to disable' : 'Switch to large-text display for casting to a TV'}
              onPress={() => setCastMode(!castMode)}
              colors={colors}
            />

            <Row
              icon="settings-outline"
              label="Settings"
              sub="Profile, voice, course preferences, and more"
              onPress={openSettings}
              colors={colors}
            />
          </ScrollView>

          <Pressable
            onPress={close}
            style={({ pressed }) => [
              styles.closeBtn,
              { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.closeText, { color: colors.text_muted }]}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface RowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sub: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}

function Row({ icon, label, sub, onPress, colors }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={22} color={colors.accent} style={styles.rowIcon} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{label}</Text>
        <Text style={[styles.rowSub, { color: colors.text_muted }]} numberOfLines={2}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.text_muted} />
    </Pressable>
  );
}

export default GlobalToolsMenu;

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  title: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    paddingBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowIcon: { width: 28 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  closeBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  closeText: { fontSize: 13, fontWeight: '700' },
});
