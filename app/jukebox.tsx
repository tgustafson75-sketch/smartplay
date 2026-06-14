/**
 * 2026-06-13 — Jukebox: the clean in-app music player (Tim/Cecily).
 *
 * Plays JUST the requested song in an embedded YouTube player — no comments, no
 * suggested-video rail, never leaves the app. The "play [song]" intent searches via
 * services/songPortal (server-side, safeSearch=strict) and navigates here with the
 * videoId. Embed params keep it clean: rel=0 (no cross-channel related), modestbranding,
 * playsinline, autoplay. Honest empty state when no song resolved.
 *
 * See memory: youtube-song-portal. Needs react-native-webview (native build).
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '../contexts/ThemeContext';

// 2026-06-13 — OTA-safe: react-native-webview is a NATIVE module. On a build that
// predates it (the current installed APK), render-then-crash isn't acceptable, so we
// detect the native view manager and fall back to the in-app browser. The next native
// build gets the true embedded player; older builds still play the clean embed.
const HAS_NATIVE_WEBVIEW = !!UIManager.getViewManagerConfig?.('RNCWebView');

export default function Jukebox() {
  const router = useRouter();
  const { colors } = useTheme();
  const { videoId, title } = useLocalSearchParams<{ videoId?: string; title?: string }>();
  const W = Dimensions.get('window').width;
  const playerH = Math.round((W * 9) / 16);

  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&autoplay=1&fs=1`
    : null;

  // No native player in this build → open the clean embed in the in-app browser, then
  // pop back so we don't leave an empty Jukebox screen behind.
  useEffect(() => {
    if (embedUrl && !HAS_NATIVE_WEBVIEW) {
      void WebBrowser.openBrowserAsync(embedUrl).catch(() => undefined).finally(() => router.back());
    }
  }, [embedUrl, router]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: '#000' }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-down" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Now Playing'}</Text>
        <View style={{ width: 28 }} />
      </View>

      {embedUrl && HAS_NATIVE_WEBVIEW ? (
        <View style={{ width: W, height: playerH, backgroundColor: '#000' }}>
          <WebView
            source={{ uri: embedUrl }}
            style={{ flex: 1, backgroundColor: '#000' }}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo
            javaScriptEnabled
            domStorageEnabled
          />
        </View>
      ) : embedUrl ? (
        <View style={styles.empty}>
          <Ionicons name="musical-notes" size={40} color="#88F700" />
          <Text style={[styles.emptyText, { color: colors.text_secondary }]}>Opening {title || 'your song'}…</Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <Ionicons name="musical-notes-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.emptyText, { color: colors.text_secondary }]}>
            Couldn’t find that song. Try asking again with the artist too.
          </Text>
        </View>
      )}

      <View style={styles.footer}>
        <Ionicons name="shield-checkmark-outline" size={13} color="#88F700" />
        <Text style={styles.footerText}>Clean player · just the song</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  headerTitle: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center', marginHorizontal: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  footerText: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
});
