/**
 * Permission banner — Caddie tab.
 *
 * 2026-05-16: Reported at Mariners — fresh install didn't get a clean
 * sweep of all required permissions, and the user was dropped on the
 * Caddie tab with GPS silently dead. SmartFinder showed no yardages,
 * shot tracking didn't record, hole transitions froze. The cascade
 * was invisible: nothing on screen told the user the actual problem
 * was a missing permission.
 *
 * This banner sits at the top of the Caddie tab (just above the avatar
 * region) and renders ONLY when foreground location is not granted.
 * Tap = best-effort re-request via expo-location; if the OS already
 * silenced our re-prompts (Android canAskAgain=false / iOS denied),
 * the tap falls through to opening the device Settings page.
 *
 * Polled every 5 seconds while mounted so a grant via OS Settings
 * dismisses the banner without requiring a Caddie tab re-mount. Polling
 * stops automatically when granted.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { hasLocationPermission, requestLocationAgain } from '../services/permissionsManager';

export function PermissionBanner() {
  const [granted, setGranted] = useState<boolean | null>(null); // null = unknown (initial)
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const ok = await hasLocationPermission();
    setGranted(ok);
  }, []);

  useEffect(() => {
    void refresh();
    // Poll while ungranted so a Settings-side grant dismisses us
    // without depending on Caddie tab focus events.
    const id = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleTap = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await requestLocationAgain();
      if (r.granted) {
        setGranted(true);
        return;
      }
      // Couldn't re-prompt (or user denied again). Open OS Settings as
      // the recovery path. Wrapped in try/catch — Linking.openSettings
      // can throw on simulators / unusual Android skins.
      Alert.alert(
        'Location is required',
        "Open Settings → enable Location for SmartPlay Caddie. The app needs this for yardages, shot tracking, and hole detection.",
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => {
              try { void Linking.openSettings(); } catch (e) {
                console.log('[permBanner] openSettings failed', e);
              }
            },
          },
        ],
      );
    } finally {
      setBusy(false);
    }
  };

  if (granted !== false) return null;

  return (
    <Pressable
      onPress={handleTap}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Location is off. Tap to enable so GPS, yardages, and shot tracking can work."
      style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
    >
      <Ionicons name="location-outline" size={18} color="#0d1a0d" />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>GPS off — tap to enable</Text>
        <Text style={styles.body}>Yardages, shot tracking, and SmartFinder need location to work.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#0d1a0d" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginHorizontal: 16,
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: '#F5A623',
  },
  bannerPressed: { opacity: 0.85 },
  title: { color: '#0d1a0d', fontSize: 13, fontWeight: '900', letterSpacing: 0.2 },
  body: { color: '#0d1a0d', fontSize: 11, fontWeight: '600', marginTop: 2, opacity: 0.85 },
});

export default PermissionBanner;
