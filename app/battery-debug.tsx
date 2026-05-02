/**
 * Pre-beta — battery + GPS discipline debug surface.
 *
 * Shows the live GPS mode, last bump reason/timestamp, audio state, and
 * battery-saver state. Useful for confirming the adaptive-polling state
 * machine transitions correctly during a walk-through.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  getCurrentMode,
  getLastFix,
  getLastBump,
  bumpToActive,
  type GpsMode,
} from '../services/gpsManager';
import { getAudioState } from '../services/audioLifecycle';
import {
  subscribeBattery,
  acceptBatterySaver,
  declineBatterySaver,
  type BatteryState,
} from '../services/batteryMonitor';

export default function BatteryDebugScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const [bs, setBs] = useState<BatteryState | null>(null);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    const unsub = subscribeBattery(setBs);
    return () => { clearInterval(id); unsub(); };
  }, []);

  const mode: GpsMode = getCurrentMode();
  const fix = getLastFix();
  const bump = getLastBump();
  const audio = getAudioState();

  const fmtTs = (ts: number | null) =>
    ts ? new Date(ts).toLocaleTimeString() : '—';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Battery & GPS Debug</Text>

        <Section title="GPS MODE">
          <Row label="current_mode" value={mode} accent />
          <Row label="last_fix_lat" value={fix?.lat?.toFixed(5) ?? '—'} />
          <Row label="last_fix_lng" value={fix?.lng?.toFixed(5) ?? '—'} />
          <Row label="last_fix_accuracy_m" value={fix?.accuracy_m?.toFixed(1) ?? '—'} />
          <Row label="last_fix_ts" value={fmtTs(fix?.timestamp ?? null)} />
          <Row label="last_bump_reason" value={bump.reason ?? '—'} />
          <Row label="last_bump_ts" value={fmtTs(bump.ts)} />
        </Section>

        <Section title="AUDIO ENGINE">
          <Row label="audio_state" value={audio} accent />
        </Section>

        <Section title="BATTERY">
          <Row label="level" value={bs?.level != null ? `${Math.round(bs.level * 100)}%` : '—'} accent />
          <Row label="prompt_visible" value={String(bs?.promptVisible ?? false)} />
          <Row label="saver_active" value={String(bs?.saverActive ?? false)} />
          <Row label="already_prompted_this_round" value={String(bs?.alreadyPromptedThisRound ?? false)} />
        </Section>

        <Text style={styles.section}>Actions</Text>

        <TouchableOpacity style={styles.btn} onPress={() => bumpToActive('debug_button')}>
          <Text style={styles.btnText}>Force bumpToActive('debug_button')</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={acceptBatterySaver}>
          <Text style={styles.btnText}>Accept battery saver</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={declineBatterySaver}>
          <Text style={styles.btnText}>Decline battery saver</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <Text style={styles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{label}</Text>
      <Text style={[styles.v, accent && styles.vAccent]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  content: { padding: 20, paddingBottom: 40 },
  title: { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 18 },
  card: {
    backgroundColor: '#0d2418', borderRadius: 12, padding: 16, gap: 8,
    marginBottom: 18, borderWidth: 1, borderColor: '#1e3a28',
  },
  cardTitle: {
    color: '#6b7280', fontSize: 11, fontWeight: '700',
    letterSpacing: 1.5, marginBottom: 4,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  k: { color: '#6b7280', fontSize: 12, fontFamily: 'monospace', flex: 1 },
  v: { color: '#fff', fontSize: 12, fontFamily: 'monospace', flex: 2, textAlign: 'right' },
  vAccent: { color: '#00C896', fontWeight: '700' },
  section: { color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
  btn: {
    backgroundColor: '#0d2418', borderRadius: 10, paddingVertical: 14,
    paddingHorizontal: 16, marginBottom: 8, borderWidth: 1, borderColor: '#1e3a28',
  },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  closeBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  closeBtnText: { color: '#6b7280', fontSize: 14 },
});
