/**
 * 2026-06-07 (audit) — global offline banner.
 *
 * Reads the reactive connectivityStore (inferred from network fetch
 * outcomes — no native module, OTA-safe). Shows a thin banner when the
 * app has decided it's offline so the user understands why analysis /
 * voice are degraded.
 *
 * 2026-06-08 (audit M1) — recovery probe. The only reportOnline paths are
 * successful voice/swing/brain calls; a user who regains signal but makes
 * no such call (just walks the hole on local GPS) would see the banner
 * stuck forever. While offline, this fires a cheap ping on app-foreground
 * and on a slow interval, flipping back online on success.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useConnectivityStore, reportOnline } from '../store/connectivityStore';
import { probeReachability, isProvenOffline } from '../services/reachability';
import { useTranslation } from 'react-i18next';

export function OfflineBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isOnline = useConnectivityStore((s) => s.isOnline);

  useEffect(() => {
    if (isOnline) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /**
     * 2026-10-15 — the recovery check asks the same question that raised the banner: can the phone
     * reach the internet? It used to POST /api/kevin, so a slow or broken backend kept "No signal"
     * on screen for a player whose signal had come back — blaming them for our outage.
     */
    const probe = async () => {
      const r = await probeReachability({ force: true });
      if (!cancelled && !isProvenOffline(r.verdict)) reportOnline();
    };
    // 2026-06-08 (audit #2) — back off the poll so a long offline stretch
    // (e.g. a dead-zone hole) doesn't wake the radio every 20s all round.
    // 20s for the first couple tries, then 45s, then 90s. Foreground
    // returns reset the cadence for a fast reconnect check.
    const schedule = () => {
      const delay = attempts < 2 ? 20_000 : attempts < 5 ? 45_000 : 90_000;
      timer = setTimeout(async () => {
        attempts += 1;
        await probe();
        if (!cancelled) schedule();
      }, delay);
    };
    schedule();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') { attempts = 0; void probe(); }
    });
    return () => { cancelled = true; if (timer) clearTimeout(timer); sub.remove(); };
  }, [isOnline]);

  if (isOnline) return null;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 4 }]} pointerEvents="none">
      <View style={styles.pill}>
        <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
        <Text style={styles.text}>{t('offline_banner.text.no_signal_working_offline')}</Text>
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
