/**
 * 2026-05-23 — Native module health diagnostic surface.
 *
 * Owner-only screen that lists the load outcome of each native
 * bridge (Meta Wearables DAT, MediaPipe Pose). When a native
 * module fails to register at boot, the JS-side bridge collapses
 * to no-op fallback paths — this screen makes that state visible
 * so debugging doesn't require adb logcat.
 *
 * Add to the Owner-Tools menu by routing `/native-modules-debug`.
 * The route gating in `app/_layout.tsx`'s DEBUG_ROUTES set will
 * auto-protect it from non-owner navigation.
 *
 * Pure read surface — no destructive actions. Refresh button
 * re-probes the modules (some loaders are lazy).
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Share, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useCaptureEngineStore } from '../store/captureEngineStore';
import { PREFERRED_CAPTURE_FPS } from '../services/capture/captureFlags';
import {
  getAllNativeModuleHealth,
  recordNativeModuleHealth,
  dumpNativeModuleHealth,
  type NativeModuleHealth,
} from '../services/nativeModuleHealth';

export default function NativeModulesDebug() {
  const router = useRouter();
  const { colors } = useTheme();
  // useState seed forces a re-render on refresh; the records are
  // module-level so we just bump a counter to re-pull.
  const [_, setBump] = useState(0);
  const records = getAllNativeModuleHealth();
  const useVisionCamera = useCaptureEngineStore((s) => s.useVisionCamera);
  const setUseVisionCamera = useCaptureEngineStore((s) => s.setUseVisionCamera);

  const refresh = () => {
    // Re-probe each known native module so lazy loaders that landed
    // after the initial import are picked up.
    recordNativeModuleHealth('MetaWearablesFrame');
    recordNativeModuleHealth('MediaPipePose');
    setBump((n) => n + 1);
  };

  const shareDump = async () => {
    try {
      await Share.share({ message: dumpNativeModuleHealth() });
    } catch { /* user cancelled */ }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Native Modules</Text>
        <TouchableOpacity onPress={refresh} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="refresh" size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={[styles.hint, { color: colors.text_muted }]}>
          A failed load means the bridge collapsed to JS fallback (cloud
          pose, voice-only glasses). Tap a row to copy details. Share
          icon top-right exports the full snapshot.
        </Text>

        {/* SmartTrace capture-engine A/B toggle — flip the swing camera between
            expo-camera and vision-camera (high-fps) live, to compare on a real
            phone within ONE build. Only effective in a vision-camera build. */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.dot, { backgroundColor: useVisionCamera ? '#22c55e' : colors.text_muted }]} />
            <Text style={[styles.cardTitle, { color: colors.text_primary }]}>Swing capture engine</Text>
            <Switch value={useVisionCamera} onValueChange={setUseVisionCamera} />
          </View>
          <Text style={[styles.cardMeta, { color: colors.text_muted }]}>
            {useVisionCamera
              ? `Vision-camera (SmartTrace, up to ${PREFERRED_CAPTURE_FPS}fps) · video-only, acoustic mic untouched`
              : 'Expo-camera (default, ~30fps) · the proven path'}
          </Text>
          <Text style={[styles.cardReason, { color: colors.text_secondary }]}>
            Only effective in a build that linked vision-camera. Record a swing on each, compare, confirm strike detection still fires.
          </Text>
        </View>

        {records.length === 0 ? (
          <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.emptyTitle, { color: colors.text_primary }]}>No probes yet</Text>
            <Text style={[styles.emptyBody, { color: colors.text_muted }]}>
              Native modules probe on first JS import. Open SmartMotion or
              the Glasses Settings toggle, then return here to see the
              health snapshot.
            </Text>
          </View>
        ) : (
          records.map((r) => <HealthCard key={r.id} record={r} colors={colors} />)
        )}

        <TouchableOpacity
          style={[styles.shareBtn, { backgroundColor: colors.accent }]}
          onPress={shareDump}
          accessibilityRole="button"
          accessibilityLabel="Share native module health snapshot"
        >
          <Ionicons name="share-outline" size={18} color="#0a1410" />
          <Text style={styles.shareBtnText}>Share snapshot</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function HealthCard({ record, colors }: {
  record: NativeModuleHealth;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const ok = record.loaded;
  const accent = ok ? '#22c55e' : '#ef4444';
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: accent }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={[styles.cardTitle, { color: colors.text_primary }]}>{record.id}</Text>
        <Text style={[styles.cardStatus, { color: accent }]}>
          {ok ? 'LOADED' : 'MISSING'}
        </Text>
      </View>
      <Text style={[styles.cardMeta, { color: colors.text_muted }]}>
        Platform: {record.platform} · Probed: {new Date(record.probedAt).toLocaleTimeString()}
      </Text>
      {record.reason ? (
        <Text style={[styles.cardReason, { color: colors.text_secondary }]}>
          {record.reason}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '900' },
  hint: { fontSize: 12, lineHeight: 17, fontStyle: 'italic' },
  emptyCard: {
    padding: 16, borderRadius: 14, borderWidth: 1, gap: 6, alignItems: 'center',
  },
  emptyTitle: { fontSize: 14, fontWeight: '800' },
  emptyBody: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
  card: {
    padding: 12, borderRadius: 12, borderWidth: 1, gap: 4,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  cardStatus: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  cardMeta: { fontSize: 11 },
  cardReason: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: 10,
  },
  shareBtnText: { color: '#0a1410', fontWeight: '900', fontSize: 13, letterSpacing: 0.4 },
});
