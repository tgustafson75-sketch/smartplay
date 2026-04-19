/**
 * components/CaddiePanel.tsx
 *
 * Caddie advice output panel — displays club, aim direction, hazard warnings,
 * and provides a voice trigger button.
 *
 * Voice output routes through the existing VoiceManager / speakJob pipeline.
 * No expo-speech usage.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { PrecisionDecision, HazardWarning } from '../engine/precisionEngine';

interface CaddiePanelProps {
  decision: PrecisionDecision;
  /** Called when the player taps the voice button */
  onSpeak?: (voiceLine: string) => void;
  /** Whether the voice system is currently speaking */
  isSpeaking?: boolean;
}

function HazardBadge({ warning }: { warning: HazardWarning }) {
  const colorMap: Record<HazardWarning['type'], string> = {
    water:  '#3b82f6',
    bunker: '#f59e0b',
    ob:     '#ef4444',
  };
  return (
    <View style={[styles.hazardBadge, { borderColor: colorMap[warning.type] }]}>
      <Text style={[styles.hazardText, { color: colorMap[warning.type] }]}>
        {warning.message}
      </Text>
    </View>
  );
}

export default function CaddiePanel({
  decision,
  onSpeak,
  isSpeaking = false,
}: CaddiePanelProps) {
  const { club, aimDirection, missPattern, hazardWarnings, voiceLine, confidence } = decision;

  const confidenceLabel =
    confidence >= 0.85 ? 'High' : confidence >= 0.65 ? 'Med' : 'Low';
  const confidenceColor =
    confidence >= 0.85 ? '#4ade80' : confidence >= 0.65 ? '#fbbf24' : '#f87171';

  return (
    <View style={styles.container}>
      {/* Club + aim row */}
      <View style={styles.row}>
        <View style={styles.clubBlock}>
          <Text style={styles.clubLabel}>CLUB</Text>
          <Text style={styles.clubValue}>{club ?? '—'}</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.aimBlock}>
          <Text style={styles.aimLabel}>AIM</Text>
          <Text style={styles.aimValue}>{aimDirection}</Text>
          {missPattern !== 'neutral' && (
            <Text style={styles.missHint}>Miss tendency: {missPattern}</Text>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.confBlock}>
          <Text style={styles.confLabel}>CONF</Text>
          <Text style={[styles.confValue, { color: confidenceColor }]}>{confidenceLabel}</Text>
        </View>
      </View>

      {/* Hazard warnings */}
      {hazardWarnings.length > 0 && (
        <View style={styles.hazardRow}>
          {hazardWarnings.map((w, i) => (
            <HazardBadge key={i} warning={w} />
          ))}
        </View>
      )}

      {/* Voice trigger */}
      {onSpeak && (
        <TouchableOpacity
          style={[styles.voiceBtn, isSpeaking && styles.voiceBtnActive]}
          onPress={() => onSpeak(voiceLine)}
          accessibilityLabel="Play caddie advice"
          activeOpacity={0.7}
        >
          <Text style={styles.voiceBtnText}>
            {isSpeaking ? '🔊 Speaking…' : '🎙 Hear Advice'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0d2818',
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clubBlock: { flex: 1, alignItems: 'center' },
  aimBlock:  { flex: 2, alignItems: 'center' },
  confBlock: { flex: 1, alignItems: 'center' },
  divider: {
    width: 1,
    height: 36,
    backgroundColor: '#1a3d2b',
    marginHorizontal: 8,
  },
  clubLabel: { fontSize: 9, color: '#6b7280', letterSpacing: 1, marginBottom: 2 },
  clubValue: { fontSize: 18, fontWeight: '800', color: '#A7F3D0' },
  aimLabel:  { fontSize: 9, color: '#6b7280', letterSpacing: 1, marginBottom: 2 },
  aimValue:  { fontSize: 15, fontWeight: '700', color: '#e2e8f0', textAlign: 'center' },
  missHint:  { fontSize: 10, color: '#f59e0b', marginTop: 2 },
  confLabel: { fontSize: 9, color: '#6b7280', letterSpacing: 1, marginBottom: 2 },
  confValue: { fontSize: 14, fontWeight: '700' },
  hazardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hazardBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  hazardText: { fontSize: 11, fontWeight: '600' },
  voiceBtn: {
    marginTop: 4,
    backgroundColor: '#14532d',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  voiceBtnActive: {
    backgroundColor: '#166534',
  },
  voiceBtnText: {
    color: '#A7F3D0',
    fontSize: 14,
    fontWeight: '700',
  },
});
