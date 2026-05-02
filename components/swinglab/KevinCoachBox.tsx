import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useTrustLevelStore } from '../../store/trustLevelStore';

const KEVIN_BADGE = require('../../assets/avatars/smartplay_caddie_badge.png');

/**
 * Phase I — Kevin's Coach-mode contained-presence card for SwingLab surfaces.
 *
 * - Visible by default at L2/L3/L4. Hidden at L1 (Quiet — respects user pref).
 * - Dismissible per-session via the X button. Local state, not persisted —
 *   re-engages next time the surface is visited.
 * - Tap the body (not X) to fire onTap (consumer wires to expand or replay).
 *
 * Consumer passes the spoken content as `body` (already template-rendered).
 * The component is presentation only; template selection and variable
 * interpolation happen at the consumer site via dialogEngine.
 */

export type KevinCoachBoxAccent = 'coach' | 'psychologist';

type Props = {
  body: string;
  accent?: KevinCoachBoxAccent;   // 'coach' = green, 'psychologist' = amber for Arena
  onTap?: () => void;
  onDismiss?: () => void;
  /** When true, renders as a slim ambient indicator (used during active recording). */
  minimized?: boolean;
};

export default function KevinCoachBox({
  body, accent = 'coach', onTap, onDismiss, minimized,
}: Props) {
  const trustLevel = useTrustLevelStore(s => s.level);
  const [dismissed, setDismissed] = useState(false);

  if (trustLevel === 1 || dismissed) return null;

  const accentColor = accent === 'psychologist' ? '#F5A623' : '#00C896';
  const accentBg = accent === 'psychologist' ? 'rgba(245,166,35,0.06)' : 'rgba(0,200,150,0.06)';

  if (minimized) {
    return (
      <View style={[styles.minimizedRow, { borderColor: accentColor }]}>
        <View style={[styles.minimizedDot, { backgroundColor: accentColor }]} />
        <Text style={[styles.minimizedText, { color: accentColor }]}>
          KEVIN · standing by
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { borderColor: accentColor, backgroundColor: accentBg }]}>
      <TouchableOpacity
        activeOpacity={onTap ? 0.85 : 1}
        onPress={onTap}
        disabled={!onTap}
        style={styles.tapRow}
      >
        <Image source={KEVIN_BADGE} style={styles.avatar} resizeMode="contain" />
        <View style={styles.textCol}>
          <Text style={[styles.label, { color: accentColor }]}>
            {accent === 'psychologist' ? 'KEVIN' : 'COACH KEVIN'}
          </Text>
          <Text style={styles.body}>{body}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => { setDismissed(true); onDismiss?.(); }}
        style={styles.closeBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss Kevin for this session"
      >
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  tapRow: { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  textCol: { flex: 1, paddingRight: 24 },
  label: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4, marginBottom: 4 },
  body: { color: '#e8f5e9', fontSize: 13, lineHeight: 19 },
  closeBtn: {
    position: 'absolute', top: 6, right: 8,
    width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
  },
  closeText: { color: '#9ca3af', fontSize: 16, fontWeight: '700' },

  minimizedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 14,
    paddingHorizontal: 10, paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  minimizedDot: { width: 6, height: 6, borderRadius: 3 },
  minimizedText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
});
