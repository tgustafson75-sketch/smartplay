/**
 * 2026-06-01 — Fix GL: GPS subscription-health banner.
 *
 * Shows a yellow banner at the top of the app when an active round
 * has unhealthy GPS — i.e. the watch never landed, never ticked, or
 * stopped ticking (Doze without foreground service, OEM kill, etc.).
 * Without this, prior beta rounds went silently dead: the user kept
 * playing while yardages froze and hole-detection stopped, with
 * nothing on screen telling them why.
 *
 * Polls getGpsHealth every 5s while an active round is in flight.
 * Renders nothing when round is inactive OR GPS is healthy OR
 * simulator is active. Tap = best-effort recalibrateGps (drops watch,
 * pulls a fresh high-accuracy fix, restarts subscription).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoundStore } from '../store/roundStore';
import { getGpsHealth, recalibrateGps, type GpsHealth } from '../services/gpsManager';

export function GpsHealthBanner() {
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const [health, setHealth] = useState<GpsHealth>({ state: 'healthy', ageMs: 0, accuracy_m: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isRoundActive) return;
    const tick = () => setHealth(getGpsHealth());
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [isRoundActive]);

  const handleTap = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await recalibrateGps();
      setHealth(getGpsHealth());
    } catch (e) {
      console.log('[gpsHealthBanner] recalibrate failed:', e);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (!isRoundActive) return null;
  if (health.state === 'healthy') return null;

  const msg =
    health.state === 'no_subscription' ? 'GPS not running — tap to retry' :
    health.state === 'never_ticked' ? 'Waiting for first GPS fix — tap to retry' :
    `GPS stopped ${Math.round(health.ageMs / 1000)}s ago — tap to retry`;

  return (
    <Pressable onPress={handleTap} style={styles.row} accessibilityLabel="GPS unhealthy. Tap to retry.">
      <Ionicons name="warning-outline" size={18} color="#1a1a1a" />
      <Text style={styles.text}>{msg}</Text>
      {busy ? <ActivityIndicator size="small" color="#1a1a1a" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#facc15',
    paddingHorizontal: 14,
    paddingVertical: 8,
    paddingTop: 44,
    zIndex: 100,
  },
  text: {
    flex: 1,
    color: '#1a1a1a',
    fontWeight: '600',
    fontSize: 13,
  },
});
