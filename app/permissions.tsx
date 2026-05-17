/**
 * One-time core permissions pre-flight.
 *
 * Tim's complaint that prompted this: every camera-using surface was
 * asking for permission individually, and tapping "Allow" silently
 * failed in some Android states. Result: stuck on a permission screen
 * with no way out.
 *
 * Fix: ONE friendly screen at first launch (after the intro video,
 * before onboarding) that requests every permission the app needs in
 * one batch. After that, every tool checks the granted state and uses
 * it directly — no per-tool dialog.
 *
 * Defensive design: every state has a "Skip for now" button so this
 * screen can never strand the user. Skipping is fine — individual tools
 * still have their own per-call permission UX as a fallback. The
 * tutorialsSeen flag flips on EITHER Allow All or Skip so we don't
 * re-ask on the next cold launch.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { requestCorePermissions, getCorePermissionsState, corePermissionsRequested, type CorePermissionsResult } from '../services/permissionsManager';
import { useSettingsStore } from '../store/settingsStore';

const PERMISSIONS = [
  {
    icon: 'camera-outline' as const,
    label: 'Camera',
    why: 'For SmartVision hole reads, swing recordings in Cage Mode, lie analysis, SmartFinder, and round photos.',
  },
  {
    icon: 'mic-outline' as const,
    label: 'Microphone',
    why: 'For voice-mode caddie conversations and auto-detecting swings in Cage Mode.',
  },
  {
    icon: 'location-outline' as const,
    label: 'Location',
    why: 'For GPS yardages, hole detection, SmartFinder, and shot tracking. Required for almost everything during a round.',
  },
  {
    icon: 'walk-outline' as const,
    label: 'Background Location',
    why: 'So GPS keeps working when your phone is in your pocket between shots. Without this, yardages freeze when the screen turns off.',
  },
  {
    icon: 'images-outline' as const,
    label: 'Photo Library',
    why: 'For Space Scan and Tutorial Upload when you pick a photo or video instead of capturing one fresh.',
  },
];

export default function PermissionsScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CorePermissionsResult | null>(null);

  // If the user has already been through this screen on a prior launch,
  // skip straight to the next step — never re-prompt unless reset.
  useEffect(() => {
    if (corePermissionsRequested()) {
      void exit('already-asked');
      return;
    }
    // Fetch current state so the UI shows what's already granted (e.g.
    // user manually granted in Settings before reaching this screen).
    void getCorePermissionsState().then(setResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single exit point — flips the tutorial flag (so we never re-ask
  // automatically) and routes back through index for the next step.
  // Using router.replace so the user can't swipe back into this screen.
  const exit = async (reason: 'allowed' | 'skipped' | 'already-asked') => {
    try { useSettingsStore.getState().markTutorialSeen('core_permissions_requested'); } catch {}
    console.log('[permissions] exit:', reason);
    try { router.replace('/'); } catch {}
  };

  const handleAllowAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await requestCorePermissions();
      setResult(r);
      // Wait a beat so the user sees the green checks before we route
      // away. Then exit. Partial grants are still a valid finish state —
      // individual tools handle their own re-prompts if needed.
      setTimeout(() => { void exit('allowed'); }, 500);
    } catch (e) {
      console.log('[permissions] requestCorePermissions threw', e);
      // Still exit so user is never stuck. Tools fall back to per-call
      // permission UX.
      void exit('allowed');
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = () => {
    void exit('skipped');
  };

  const renderStateIcon = (granted: boolean | undefined) => {
    if (granted === true) return <Ionicons name="checkmark-circle" size={20} color="#00C896" />;
    return <Ionicons name="ellipse-outline" size={20} color="#6b7280" />;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Ionicons name="shield-checkmark-outline" size={36} color="#00C896" />
          <Text style={styles.title}>Quick setup</Text>
          <Text style={styles.subtitle}>
            We only ask once. Allow what you want — every tool below uses these grants.
          </Text>
        </View>

        <View style={styles.list}>
          {PERMISSIONS.map((p, i) => {
            const granted = result
              ? (i === 0 ? result.camera.granted
                : i === 1 ? result.microphone.granted
                : i === 2 ? result.location.granted
                : i === 3 ? result.backgroundLocation.granted
                : result.mediaLibrary.granted)
              : undefined;
            return (
              <View key={p.label} style={styles.row}>
                <View style={styles.iconWrap}>
                  <Ionicons name={p.icon} size={22} color="#00C896" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{p.label}</Text>
                  <Text style={styles.rowWhy}>{p.why}</Text>
                </View>
                {renderStateIcon(granted)}
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.allowBtn, busy && styles.allowBtnBusy]}
          onPress={handleAllowAll}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Allow camera, microphone, location, and photo library permissions"
        >
          <Text style={styles.allowBtnText}>{busy ? 'Asking…' : 'Allow all'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip for now — set up permissions later in Settings"
        >
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => Linking.openSettings()}
          accessibilityRole="button"
          accessibilityLabel="Open device Settings to manage permissions manually"
        >
          <Text style={styles.linkText}>Open Settings</Text>
        </TouchableOpacity>

        <Text style={styles.foot}>You can change any of this later in Settings.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  scroll: { padding: 24, gap: 18 },
  header: { alignItems: 'center', gap: 8, marginTop: 12 },
  title: { color: '#ffffff', fontSize: 24, fontWeight: '900', marginTop: 8 },
  subtitle: { color: '#9ca3af', fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 12 },
  list: { gap: 12, marginTop: 12 },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 12, padding: 14,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: 'rgba(0,200,150,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  rowWhy: { color: '#9ca3af', fontSize: 12, marginTop: 4, lineHeight: 17 },
  allowBtn: {
    backgroundColor: '#00C896', borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', marginTop: 6,
  },
  allowBtnBusy: { opacity: 0.6 },
  allowBtnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '900' },
  skipBtn: { paddingVertical: 12, alignItems: 'center' },
  skipText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  linkBtn: { paddingVertical: 8, alignItems: 'center' },
  linkText: { color: '#00C896', fontSize: 12, fontWeight: '700' },
  foot: { color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 12 },
});
