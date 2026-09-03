/**
 * 2026-07-06 — Drill video player (Tim — pro-video → drill → measured-improvement
 * loop, see memory pro-video-drill-loop-moat).
 *
 * Plays a pro instruction drill video IN-APP (embedded YouTube, no rail, never
 * leaves the app), DETECTS a full watch via the YouTube IFrame API, awards a small
 * one-time practice-points reward for finishing, then prompts "Want to try this
 * drill?" → hands off to drill-aware Smart Motion with the same params the Drills
 * screen's "Practice in Smart Motion" CTA uses.
 *
 * Honesty: points are awarded ONLY on a real 'ended' event (a genuine full watch),
 * one-time per drill (no farming). The "Try the drill" handoff is always available
 * regardless of watch state. On a build without the native WebView, it falls back
 * to the in-app browser (plays, but can't detect completion → no points).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { youtubePlayerHtml, parsePlayerMessage, isEmbedBlocked } from '../services/youtubeEmbed';
import { openYouTubeSearch } from '../services/youtubeLinks';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '../contexts/ThemeContext';
import { usePracticePointsStore } from '../store/practicePointsStore';
import { useToastStore } from '../store/toastStore';

const HAS_NATIVE_WEBVIEW = !!UIManager.getViewManagerConfig?.('RNCWebView');

/** Pull the 11-char YouTube id out of a watch / youtu.be / embed / shorts URL. */
function extractVideoId(u: string | undefined): string | null {
  if (!u) return null;
  const m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(u) ? u : null);
}

/** IFrame-API player HTML — fires postMessage('ended') on state 0 (ENDED). */

export default function DrillVideo() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    url?: string; videoId?: string; title?: string; instructor?: string;
    drillId?: string; drillName?: string; drillShots?: string; drillFocus?: string;
    drillShotType?: string; angle?: string; drillSwingPercents?: string;
  }>();
  const videoId = params.videoId || extractVideoId(params.url);
  const W = Dimensions.get('window').width;
  const playerH = Math.round((W * 9) / 16);
  const [finished, setFinished] = useState(false);
  const [playerError, setPlayerError] = useState<{ code: number; reason: string } | null>(null);

  // No native player → open the clean embed in the in-app browser (can't detect
  // completion there, so no watch points), then pop back.
  useEffect(() => {
    if (videoId && !HAS_NATIVE_WEBVIEW) {
      const embed = `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&autoplay=1&fs=1`;
      void WebBrowser.openBrowserAsync(embed).catch(() => undefined).finally(() => router.back());
    }
  }, [videoId, router]);

  const onFinished = () => {
    if (finished) return;
    setFinished(true);
    if (params.drillId) {
      const granted = usePracticePointsStore.getState().awardVideoWatch(
        params.drillId, params.drillName ?? params.title ?? null, Date.now(),
      );
      if (granted > 0) {
        try { useToastStore.getState().show(`+${granted} for finishing the video`); } catch { /* non-fatal */ }
      }
    }
  };

  /**
   * 2026-09-03 — the player now reports FAILURE, not just completion.
   *
   * There was no onError on the YT.Player, so codes 100 (removed/private) and 101/150 (owner
   * disallows embedding) rendered YouTube's own error inside the WebView, posted nothing, and left
   * the screen on a black rectangle. The drill videos are hardcoded ids nothing filters for
   * embeddability, so a rights-holder flipping that switch would have looked like our bug.
   */
  const onMessage = (e: WebViewMessageEvent) => {
    const msg = parsePlayerMessage(e.nativeEvent.data);
    if (!msg) return;
    if (msg.kind === 'ended') { onFinished(); return; }
    if (msg.kind === 'error') {
      console.log('[drill-video] player error', msg.code, msg.reason);
      setPlayerError(msg);
    }
  };

  const tryDrill = () => {
    if (!params.drillId) { router.back(); return; }
    // Same handoff the Drills screen's "Practice in Smart Motion" CTA uses.
    router.replace({
      pathname: '/swinglab/smartmotion',
      params: {
        drillId: params.drillId,
        drillName: params.drillName ?? '',
        drillShots: params.drillShots ?? '3',
        drillFocus: params.drillFocus ?? '',
        drillShotType: params.drillShotType ?? 'full',
        angle: params.angle ?? 'face_on',
        /**
         * 2026-09-01 — THE LADDER WAS DROPPED ON THIS ROUTE.
         *
         * The Drills screen forwards drillSwingPercents because of a 07-09 audit: "flagship
         * TEMPO x SWING% drill dropped its ladder". That fix went onto the "Practice in Smart Motion"
         * button and not onto this one, so a player who watched the pro video FIRST — the whole point
         * of the video-to-drill loop — practised the flagship drill with no 50/75/100 reps and no
         * sign anything was missing.
         *
         * The comment at the top of this file already claimed it handed off "with the same params the
         * Drills screen" uses. It now does. [[no-half-fixes-enforce-every-surface]]
         */
        drillSwingPercents: params.drillSwingPercents ?? '',
      },
    });
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: '#000' }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-down" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{params.title || 'Drill Video'}</Text>
        <View style={{ width: 28 }} />
      </View>

      {videoId && HAS_NATIVE_WEBVIEW && playerError ? (
        /* The video exists but will not play here. Say which of those it is, and hand the player
           somewhere that works — the drill CTA below stays available either way. */
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.emptyText, { color: colors.text_secondary }]}>{playerError.reason}</Text>
          {isEmbedBlocked(playerError.code) && (
            <TouchableOpacity
              style={styles.errorAction}
              onPress={() => { void openYouTubeSearch(params.title || 'golf drill'); }}
              accessibilityRole="button"
            >
              <Ionicons name="logo-youtube" size={18} color="#88F700" />
              <Text style={styles.errorActionText}>Find it on YouTube</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : videoId && HAS_NATIVE_WEBVIEW ? (
        <View style={{ width: W, height: playerH, backgroundColor: '#000' }}>
          <WebView
            source={{ html: youtubePlayerHtml(videoId), baseUrl: 'https://www.youtube.com' }}
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
      ) : videoId ? (
        <View style={styles.empty}>
          <Ionicons name="play-circle" size={40} color="#88F700" />
          <Text style={[styles.emptyText, { color: colors.text_secondary }]}>Opening the video…</Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.emptyText, { color: colors.text_secondary }]}>Couldn’t load this video.</Text>
        </View>
      )}

      {/* Instructor + the always-available "try the drill" handoff. After a full
          watch, the CTA highlights and the finished note appears. */}
      {videoId && HAS_NATIVE_WEBVIEW && (
        <View style={styles.deck}>
          {params.instructor ? (
            <Text style={styles.instructor} numberOfLines={1}>{params.instructor}</Text>
          ) : null}
          {finished && (
            <View style={styles.finishedRow}>
              <Ionicons name="checkmark-circle" size={16} color="#88F700" />
              <Text style={styles.finishedText}>Nice — watched it through. Ready to groove it?</Text>
            </View>
          )}
          {params.drillId ? (
            <TouchableOpacity
              onPress={tryDrill}
              activeOpacity={0.85}
              style={[styles.tryBtn, { backgroundColor: finished ? '#88F700' : 'rgba(136,247,0,0.18)', borderColor: '#88F700' }]}
              accessibilityRole="button"
              accessibilityLabel="Try this drill in Smart Motion"
            >
              <Ionicons name="videocam-outline" size={18} color={finished ? '#06140b' : '#88F700'} />
              <Text style={[styles.tryBtnText, { color: finished ? '#06140b' : '#88F700' }]}>
                {finished ? 'Try this drill now' : 'Try this drill in Smart Motion'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      <View style={styles.footer}>
        <Ionicons name="shield-checkmark-outline" size={13} color="#88F700" />
        <Text style={styles.footerText}>Clean player · finish it for practice points</Text>
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
  deck: { paddingHorizontal: 20, paddingTop: 18, gap: 12 },
  instructor: { color: '#88F700', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  finishedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  finishedText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  tryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1,
  },
  tryBtnText: { fontSize: 15, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorAction: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16,
    borderWidth: 1, borderColor: '#88F700', borderRadius: 999,
    paddingVertical: 10, paddingHorizontal: 16,
  },
  errorActionText: { color: '#88F700', fontSize: 14, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, marginTop: 'auto' },
  footerText: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
});
