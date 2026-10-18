/**
 * 2026-10-18 (Tim) — 3D Holes, owner test surface.
 *
 * "Maybe put this in owners tools for now while I test in Caddie." The 3D hole engine lives in the
 * SmartBay repo (packages/hole-engine) and its demo page is smartbay-ai.vercel.app/holes: real Menifee
 * Palms #1 built from USGS lidar + OpenStreetMap, plus holes designed from a prompt and the golfer's
 * own numbers. This screen opens that page full-screen so it can be judged on the phone in the hand.
 *
 * Nothing in Caddie reads from it yet: no course engine, SmartVision or SmartFinder wiring until Tim
 * has played with it and says it's right. Owner-only at the route (DEBUG_ROUTES) and at the render.
 * On a build without the native WebView it opens in the in-app browser instead.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '../contexts/ThemeContext';
import { safeBack } from '../services/safeBack';
import { hasNativeWebView } from '../services/youtubeEmbed';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';

const HOLE_LAB_URL = 'https://smartbay-ai.vercel.app/holes';
const HAS_NATIVE_WEBVIEW = hasNativeWebView(WebView);

export default function HoleLabScreen() {
  const { colors } = useTheme();
  const isOwner = isOwnerEmail(usePlayerProfileStore((s) => s.email));
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isOwner && !HAS_NATIVE_WEBVIEW) {
      void WebBrowser.openBrowserAsync(HOLE_LAB_URL).catch(() => undefined).finally(() => safeBack());
    }
  }, [isOwner]);

  if (!isOwner) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <Text style={{ color: colors.text_muted }}>Owner tools only.</Text>
          <TouchableOpacity onPress={() => safeBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={{ color: colors.accent, marginTop: 12 }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>3D Holes · test</Text>
        <View style={styles.headerBtn} />
      </View>
      {HAS_NATIVE_WEBVIEW && (
        <View style={styles.container}>
          <WebView
            key={attempt}
            source={{ uri: HOLE_LAB_URL }}
            style={[styles.web, { backgroundColor: colors.background }]}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['https://*']}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
            onHttpError={() => {
              setLoading(false);
              setFailed(true);
            }}
          />
          {loading && (
            <View style={styles.overlay} pointerEvents="none">
              <ActivityIndicator color={colors.accent} />
            </View>
          )}
          {failed && (
            <View style={styles.overlay}>
              <Text style={[styles.fail, { color: colors.text_muted }]}>Could not load the hole page. Check the connection and try again.</Text>
              <TouchableOpacity
                onPress={() => {
                  setFailed(false);
                  setLoading(true);
                  setAttempt((n) => n + 1);
                }}
                accessibilityRole="button"
                accessibilityLabel="Try again"
              >
                <Text style={{ color: colors.accent, marginTop: 14, fontWeight: '600' }}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 44 },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '600' },
  web: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24 },
  fail: { textAlign: 'center' },
});
