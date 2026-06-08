/**
 * 2026-06-07 (audit) — global offline banner.
 *
 * Reads the reactive connectivityStore (inferred from network fetch
 * outcomes — no native module, OTA-safe). Shows a thin banner when the
 * app has decided it's offline so the user understands why analysis /
 * voice are degraded. Auto-hides on the next successful network call.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useConnectivityStore } from '../store/connectivityStore';

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const isOnline = useConnectivityStore((s) => s.isOnline);
  if (isOnline) return null;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 4 }]} pointerEvents="none">
      <View style={styles.pill}>
        <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
        <Text style={styles.text}>No signal — working offline</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 9999 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(120,53,15,0.95)',
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
  },
  text: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
