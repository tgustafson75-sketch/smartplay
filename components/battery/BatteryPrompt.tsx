/**
 * Pre-beta — low-battery honest prompt.
 *
 * Mounts at the app root. Subscribes to the batteryMonitor; renders a one-tap
 * Yes/No card when the prompt fires. Suppressed if Trust = Quiet (a banner
 * is shown instead so the user can act without Kevin speaking over them).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  subscribeBattery,
  acceptBatterySaver,
  declineBatterySaver,
  type BatteryState,
} from '../../services/batteryMonitor';
import { useTrustLevelStore } from '../../store/trustLevelStore';
import { useSettingsStore } from '../../store/settingsStore';
import { speak } from '../../services/voiceService';

export default function BatteryPrompt() {
  const insets = useSafeAreaInsets();
  const trustLevel = useTrustLevelStore(s => s.level);
  const { voiceGender, language, voiceEnabled } = useSettingsStore();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const [bs, setBs] = useState<BatteryState | null>(null);

  useEffect(() => subscribeBattery(setBs), []);

  useEffect(() => {
    if (!bs?.promptVisible) return;
    if (trustLevel === 1 || !voiceEnabled) return;
    void speak(
      "Phone's at 20%. Want me to slow down TightLie and stretch the battery?",
      voiceGender, language, apiUrl,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bs?.promptVisible, trustLevel, voiceEnabled]);

  if (!bs?.promptVisible) return null;

  // Quiet trust → render as a banner instead of a modal so we don't speak
  // over a player who explicitly asked for silence.
  if (trustLevel === 1) {
    return (
      <View style={[styles.banner, { top: insets.top + 88 }]}>
        <Ionicons name="battery-half-outline" size={18} color="#fbbf24" />
        <Text style={styles.bannerText}>Phone at 20%. Save battery this round?</Text>
        <TouchableOpacity onPress={acceptBatterySaver} style={styles.bannerYes}>
          <Text style={styles.bannerYesText}>Yes</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={declineBatterySaver} style={styles.bannerNo}>
          <Text style={styles.bannerNoText}>No</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={declineBatterySaver}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { marginTop: insets.top + 80 }]}>
          <View style={styles.headerRow}>
            <Ionicons name="battery-half-outline" size={22} color="#fbbf24" />
            <Text style={styles.headerTitle}>Battery at 20%</Text>
          </View>
          <Text style={styles.body}>
            Want me to slow down TightLie and stretch the battery for the rest of the round?
          </Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.btnYes]} onPress={acceptBatterySaver}>
              <Text style={styles.btnYesText}>Yes, save battery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={declineBatterySaver}>
              <Text style={styles.btnText}>Keep going</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center' },
  card: {
    width: '88%', backgroundColor: '#0d1a0d', borderRadius: 16,
    borderWidth: 1, borderColor: '#fbbf24', padding: 18, gap: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { color: '#fbbf24', fontSize: 14, fontWeight: '900', letterSpacing: 1.2 },
  body: { color: '#d1d5db', fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', alignItems: 'center',
  },
  btnYes: { backgroundColor: '#3a2a08', borderColor: '#fbbf24' },
  btnYesText: { color: '#fbbf24', fontSize: 13, fontWeight: '800' },
  btnText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  banner: {
    position: 'absolute', left: 16, right: 16, zIndex: 30,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0d1a0d', borderColor: '#fbbf24', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  bannerText: { color: '#fbbf24', fontSize: 12, flex: 1, fontWeight: '600' },
  bannerYes: { backgroundColor: '#3a2a08', borderColor: '#fbbf24', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  bannerYesText: { color: '#fbbf24', fontSize: 12, fontWeight: '800' },
  bannerNo: { paddingHorizontal: 8, paddingVertical: 6 },
  bannerNoText: { color: '#9ca3af', fontSize: 12, fontWeight: '700' },
});
