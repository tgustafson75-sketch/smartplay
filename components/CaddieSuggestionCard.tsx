/**
 * Phase 106 — Caddie Suggestion Card.
 *
 * Renders the team's pending suggestion as a dismissible card with
 * Accept / Decline / Tell me more actions. Mounted at the app root
 * (similar to BatteryPrompt) so it can surface on any pillar surface.
 *
 * Visibility:
 *   - Hidden when caddieSuggestions === 'off' (suppression).
 *   - Hidden when no pending suggestion in the team intelligence store.
 *   - 'soft' mode: card shows but no voice line plays (handled by the
 *     handoff orchestrator, not here — this component is purely visual).
 *
 * Accept/Decline route through the team intelligence store; the handoff
 * orchestrator subscribes for accept events to execute the pillar swap.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useSettingsStore } from '../store/settingsStore';
import { useTeamIntelligenceStore } from '../store/teamIntelligenceStore';
import type { Persona } from '../store/settingsStore';

const PORTRAIT_FOR: Record<Persona, ImageSourcePropType> = {
  kevin:  require('../assets/avatars/kevin_portrait.jpg'),
  serena: require('../assets/avatars/serena_portrait.jpg'),
  harry:  require('../assets/avatars/harry_portrait.png'),
  tank:   require('../assets/avatars/tank_v2_portrait.png'),
  // Custom caddie falls back to Kevin's portrait here. The actual
  // user-generated portrait (customCaddiePortraitB64) is consumed by
  // CaddieAvatar.tsx + caddie.tsx where it has access to the profile
  // store; this suggestion card is a teammate-style recommendation
  // surface that doesn't need the user's own portrait.
  custom: require('../assets/avatars/kevin_portrait.jpg'),
};

const NAME_FOR: Record<Persona, string> = {
  kevin: 'Kevin', serena: 'Serena', harry: 'Harry', tank: 'Tank',
  custom: 'My Caddie',
};

export default function CaddieSuggestionCard() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const suppression = useSettingsStore(s => s.caddieSuggestions);
  const pending = useTeamIntelligenceStore(s => s.pendingSuggestion);
  const acceptPending = useTeamIntelligenceStore(s => s.acceptPendingSuggestion);
  const declinePending = useTeamIntelligenceStore(s => s.declinePendingSuggestion);
  const [expanded, setExpanded] = useState(false);

  if (suppression === 'off') return null;
  if (!pending) return null;

  const fromName = NAME_FOR[pending.fromPersona];
  const toName = NAME_FOR[pending.toPersona];

  return (
    <View style={[
      styles.wrap,
      { top: insets.top + 12, backgroundColor: colors.surface, borderColor: colors.border },
    ]}>
      <View style={styles.header}>
        <Image source={PORTRAIT_FOR[pending.fromPersona]} style={styles.portrait} />
        <View style={styles.headerText}>
          <Text style={[styles.from, { color: colors.text_muted }]}>{fromName} suggests</Text>
          <Text style={[styles.title, { color: colors.text_primary }]}>Bring in {toName}?</Text>
        </View>
      </View>

      {expanded ? (
        <Text style={[styles.body, { color: colors.text_primary }]}>{pending.reason}</Text>
      ) : (
        <Text style={[styles.bodyShort, { color: colors.text_muted }]} numberOfLines={2}>
          {pending.reason}
        </Text>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, { backgroundColor: colors.accent }]}
          onPress={() => acceptPending()}
        >
          <Text style={styles.btnTextPrimary}>Yes, switch to {toName}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary, { borderColor: colors.border }]}
          onPress={() => declinePending()}
        >
          <Text style={[styles.btnTextSecondary, { color: colors.text_primary }]}>Stay with {fromName}</Text>
        </TouchableOpacity>
      </View>

      {!expanded && (
        <TouchableOpacity onPress={() => setExpanded(true)} style={styles.moreBtn}>
          <Text style={[styles.moreText, { color: colors.accent }]}>Tell me more</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 1000,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  portrait: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  headerText: {
    flex: 1,
  },
  from: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  bodyShort: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnPrimary: {},
  btnSecondary: {
    borderWidth: 1,
  },
  btnTextPrimary: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
  },
  btnTextSecondary: {
    fontSize: 13,
    fontWeight: '600',
  },
  moreBtn: {
    alignSelf: 'flex-end',
    marginTop: 8,
    paddingVertical: 4,
  },
  moreText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
