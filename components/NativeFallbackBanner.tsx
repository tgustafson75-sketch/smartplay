/**
 * 2026-05-23 — Native fallback banner.
 *
 * When any critical native bridge fails to load (Meta Wearables DAT,
 * MediaPipe Pose), render a single persistent banner so the player
 * understands which features are unavailable + that the app has
 * fallen back to cloud paths. The brain still works (cloud pose +
 * cloud lie analysis); glasses streaming + on-device pose don't.
 *
 * Mounted globally in _layout.tsx. Hidden when all native bridges
 * report `loaded: true` OR when no probes have run yet (no
 * decision can be made until at least one bridge has tried to
 * initialize). Tappable to dismiss for the session.
 *
 * Tone is informational, not alarming. The cloud paths produce
 * usable analysis; on-device is just the speed-up.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getAllNativeModuleHealth,
  type NativeModuleHealth,
} from '../services/nativeModuleHealth';

export default function NativeFallbackBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [records, setRecords] = useState<NativeModuleHealth[]>(() => getAllNativeModuleHealth());

  // Re-probe periodically for the first 30s in case lazy-loaded
  // bridges land after first render. Stop polling once we've
  // settled or the user dismisses.
  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    let iterations = 0;
    const tick = () => {
      if (cancelled) return;
      const next = getAllNativeModuleHealth();
      setRecords(next);
      iterations += 1;
      if (iterations < 15) setTimeout(tick, 2000);
    };
    setTimeout(tick, 2000);
    return () => { cancelled = true; };
  }, [dismissed]);

  if (dismissed) return null;
  // Don't render until at least one probe has reported — otherwise
  // we'd flash the banner during cold boot before the bridges run.
  if (records.length === 0) return null;
  // Only show when at least one bridge is MISSING.
  const missing = records.filter((r) => !r.loaded);
  if (missing.length === 0) return null;

  const missingLabels = missing.map((m) =>
    m.id === 'MetaWearablesFrame' ? 'Glasses live stream' :
    m.id === 'MediaPipePose'      ? 'On-device pose' :
                                    m.id,
  );

  return (
    <View style={styles.banner}>
      <Ionicons name="cloud-outline" size={14} color="#fbbf24" style={{ marginRight: 6 }} />
      <Text style={styles.text} numberOfLines={2}>
        Cloud mode — {missingLabels.join(' + ')} unavailable on this build.
      </Text>
      <Pressable
        onPress={() => setDismissed(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss native fallback banner"
      >
        <Ionicons name="close" size={14} color="#fbbf24" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251,191,36,0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(251,191,36,0.35)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  text: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    flex: 1,
  },
});
