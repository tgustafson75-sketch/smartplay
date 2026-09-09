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
 *
 * 2026-09-09 — this screen carried the same dead HAS_NATIVE_WEBVIEW guard as /drill-video, so the
 * embedded player was never mounted here either. See the long note in app/drill-video.tsx for why
 * `UIManager.getViewManagerConfig('RNCWebView')` is permanently null under the New Architecture.
 * Fixed on both surfaces at once. [[no-half-fixes-enforce-every-surface]]
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { youtubePlayerHtml, parsePlayerMessage, isEmbedBlocked } from '../services/youtubeEmbed';
import { openYouTubeSearch } from '../services/youtubeLinks';
import { useTheme } from '../contexts/ThemeContext';

export default function Jukebox() {
  const router = useRouter();
  const { colors } = useTheme();
  const { videoId, title } = useLocalSearchParams<{ videoId?: string; title?: string }>();
  /**
   * 2026-09-03 — this screen could not detect a failed play AT ALL.
   *
   * It loaded the raw youtube.com/embed URL, so there was no IFrame API and no error events to
   * miss — a song the owner blocks from embedding rendered YouTube's error inside the WebView and
   * the app never knew. The song search route filters on videoEmbeddable, so this is mostly
   * protected by construction, but "mostly" is doing real work in that sentence: music is the
   * category where rights-holders disable embedding most often, and the filter is applied at search
   * time rather than at play time.
   */
  const [playerError, setPlayerError] = useState<{ code: number; reason: string } | null>(null);
  const onMessage = (e: WebViewMessageEvent) => {
    const msg = parsePlayerMessage(e.nativeEvent.data);
    if (msg?.kind === 'error') {
      console.log('[jukebox] player error', msg.code, msg.reason);
      setPlayerError(msg);
    }
  };
  const W = Dimensions.get('window').width;
  const playerH = Math.round((W * 9) / 16);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: '#000' }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-down" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Now Playing'}</Text>
        <View style={{ width: 28 }} />
      </View>

      {videoId && playerError ? (
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.emptyText, { color: colors.text_secondary }]}>{playerError.reason}</Text>
          {isEmbedBlocked(playerError.code) && (
            <TouchableOpacity
              style={styles.errorAction}
              onPress={() => { void openYouTubeSearch(title || 'song'); }}
              accessibilityRole="button"
            >
              <Ionicons name="logo-youtube" size={18} color="#88F700" />
              <Text style={styles.errorActionText}>Find it on YouTube</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : videoId ? (
        <View style={{ width: W, height: playerH, backgroundColor: '#000' }}>
          <WebView
            source={{ html: youtubePlayerHtml(videoId as string), baseUrl: 'https://www.youtube.com' }}
            style={{ flex: 1, backgroundColor: '#000' }}
            originWhitelist={['*']}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo
            javaScriptEnabled
            domStorageEnabled
            onMessage={onMessage}
          />
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
  errorAction: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16,
    borderWidth: 1, borderColor: '#88F700', borderRadius: 999,
    paddingVertical: 10, paddingHorizontal: 16,
  },
  errorActionText: { color: '#88F700', fontSize: 14, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  footerText: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
});
