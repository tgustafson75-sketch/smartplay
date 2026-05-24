/**
 * 2026-05-24 v1.2 — Share to Instagram / Path A (no backend).
 *
 * Captures the referenced view as a PNG via react-native-view-shot and
 * opens the platform share sheet (expo-sharing). Instagram, Messages,
 * Camera Roll, etc. all surface in the sheet — no Instagram-specific
 * SDK required. OTA-safe (both deps already installed at the time of
 * this commit).
 *
 * Usage:
 *   const myRef = useRef<View>(null);
 *   return <View ref={myRef}>...<ShareToSocial viewRef={myRef} /></View>;
 *
 * The button label localizes via i18n (en + es). Disabled state /
 * loading affordance left out of v1 — the share path is fast (<1s on
 * a snapshot). Errors swallow to console; no toast surface required.
 */

import React, { RefObject, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

interface ShareToSocialProps {
  viewRef: RefObject<View | null>;
  /** Optional inline style override. */
  style?: object;
}

export function ShareToSocial({ viewRef, style }: ShareToSocialProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const shareToInstagram = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const refValue = viewRef.current;
      if (!refValue) {
        console.log('[ShareToSocial] viewRef not mounted yet');
        return;
      }
      const uri = await captureRef(refValue, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: t('buttons.share_swing'),
        });
      } else {
        console.log('[ShareToSocial] sharing unavailable on this device');
      }
    } catch (e) {
      console.log('[ShareToSocial] share failed:', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={shareToInstagram}
      disabled={busy}
      style={[styles.btn, style]}
      accessibilityRole="button"
      accessibilityLabel={t('buttons.share_swing')}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#0d1a0d" />
      ) : (
        <Ionicons name="logo-instagram" size={16} color="#0d1a0d" />
      )}
      <Text style={styles.label}>{t('buttons.share_swing')}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00C896',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  label: { color: '#0d1a0d', fontSize: 13, fontWeight: '900' },
});
