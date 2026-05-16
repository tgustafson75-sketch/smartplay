/**
 * Phase 410B — Sign-in screen.
 *
 * Single "Continue with Google" button. No email, no password, no
 * magic-link roundtrip. Configured for the Android beta audience —
 * every Play Store user has a Google account already.
 *
 * Flow:
 *   - Tap the button → native Google sheet
 *   - Pick account → ID token returned → handed to Supabase
 *   - SIGNED_IN event flips authStore → routing gate moves on
 *
 * If Supabase / Google env vars are missing at runtime, the screen
 * surfaces a "Sign-in is not configured yet" banner instead of
 * silently hanging.
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useAuthStore } from '../store/authStore';
import { supabaseIsConfigured } from '../lib/supabase';

export default function AuthScreen() {
  const { colors, spacing, radii } = useTheme();
  const styles = useMemo(() => makeStyles(colors, spacing, radii), [colors, spacing, radii]);

  const signIn = useAuthStore(s => s.signInWithGoogleAndSupabase);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = supabaseIsConfigured() &&
    (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').length > 0;

  const handlePress = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await signIn();
      switch (result.kind) {
        case 'ok':
          // Routing gate watches the session and moves on automatically.
          break;
        case 'cancelled':
          // User dismissed the sheet — silent no-op.
          break;
        case 'not_configured':
          setError('Sign-in is not configured yet. Please try the next build.');
          break;
        case 'play_services_missing':
          setError('Google Play Services is missing or out of date on this device.');
          break;
        case 'error':
          setError(result.message);
          break;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.brandBlock}>
        <Text style={[styles.title, { color: colors.text_primary }]}>SmartPlay Caddie</Text>
        <Text style={[styles.subtitle, { color: colors.text_muted }]}>
          Sign in so your profile and rounds follow you across devices.
        </Text>
      </View>

      <View style={styles.actionBlock}>
        {!configured && (
          <View style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Ionicons name="warning-outline" size={18} color={colors.text_muted} />
            <Text style={[styles.noticeText, { color: colors.text_muted }]}>
              Sign-in isn&apos;t configured in this build. The next OTA will fix this.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.googleBtn, { borderColor: colors.border, backgroundColor: '#ffffff' }]}
          onPress={handlePress}
          disabled={busy || !configured}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
        >
          {busy ? (
            <ActivityIndicator color="#3c4043" />
          ) : (
            <>
              <Ionicons name="logo-google" size={20} color="#4285F4" />
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        {error && (
          <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
        )}

        <Text style={[styles.fineprint, { color: colors.text_muted }]}>
          By continuing you agree to our terms. We use your Google account only to identify you;
          we never post on your behalf.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(
  c: ReturnType<typeof useTheme>['colors'],
  s: ReturnType<typeof useTheme>['spacing'],
  r: ReturnType<typeof useTheme>['radii'],
) {
  return StyleSheet.create({
    container: {
      flex: 1, backgroundColor: c.background,
      paddingHorizontal: s.lg, justifyContent: 'space-between',
    },
    brandBlock: { marginTop: s.xl * 2 },
    title: { fontSize: 30, fontWeight: '900', letterSpacing: -0.4, lineHeight: 36 },
    subtitle: { fontSize: 15, lineHeight: 21, marginTop: s.sm, maxWidth: 340 },
    actionBlock: { marginBottom: s.xl, gap: s.md },
    notice: {
      flexDirection: 'row', alignItems: 'center', gap: s.sm,
      borderWidth: 1, borderRadius: r.md, padding: s.md,
    },
    noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
    googleBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: s.sm,
      borderWidth: 1, borderRadius: r.lg,
      paddingVertical: 14, paddingHorizontal: s.lg,
    },
    googleBtnText: { color: '#3c4043', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
    error: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
    fineprint: { fontSize: 11, textAlign: 'center', marginTop: s.sm, lineHeight: 16 },
  });
}
