/**
 * HighlightReel
 *
 * Simulated 30-second highlight reel.
 *
 * Each clip plays for ~4 s then fades (300 ms) to the next.
 * If a shot has a frameTag video URI it plays via expo-av Video.
 * If no video is available it shows an animated stat card instead.
 *
 * Background music: ambiance-course.mp3 at 0.2 volume, looping.
 * Logo watermark always visible in bottom-right.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Audio } from 'expo-av';
import { speak as vmSpeak, stop as vmStop, PRIORITY } from '../../core/voice/VoiceManager';
import { MaterialCommunityIcons as MCIcon } from '@expo/vector-icons';

import { Palette } from '../../constants/theme';
import { useRoundStore } from '../../store/roundStore';
import { COURSE_DB } from '../../data/courses';
import { getHighlights } from './HighlightEngine';
import type { ScoredShot } from './HighlightEngine';
import { generateCommentary } from './CommentaryEngine';
import { useShareReel } from '../../core/hooks/useShareReel';

// ── Assets ───────────────────────────────────────────────────────────────────
const LOGO   = require('../../assets/images/logo-transparent.png') as number;
const MUSIC  = require('../../assets/sounds/ambiance-course.mp3')  as number;

// Seconds allocated per clip (~ 30 s reel ÷ 5 clips = 6 s max, capped at 5 s)
const CLIP_DURATION_MS = 5000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function resultLabel(r: string): string {
  if (r === 'center') return 'On Target ✓';
  if (r === 'left')   return 'Pulled Left';
  if (r === 'right')  return 'Pushed Right';
  if (r === 'short')  return 'Came Up Short';
  if (r === 'long')   return 'Flew Long';
  return r;
}
function resultColor(r: string): string {
  if (r === 'center') return Palette.positive;
  if (r === 'left' || r === 'right') return Palette.warn;
  return '#60a5fa';
}

// ── StatCard — shown when a clip has no video ─────────────────────────────────
function StatCard({ shot, courseIdx }: { shot: ScoredShot; courseIdx: number }) {
  const courseData = COURSE_DB[courseIdx];
  const holeImage: any = courseData?.holes[shot.hole - 1]?.fullImage;
  const dist = shot.gpsDistance ?? shot.distance ?? 0;

  return (
    <ImageBackground
      source={holeImage ?? undefined}
      style={StyleSheet.absoluteFill}
      resizeMode="cover"
    >
      {/* Dim overlay so text is readable on any background */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />

      {/* Hole badge */}
      <View style={sc.holeBadge}>
        <Text style={sc.holeNum}>Hole {shot.hole}</Text>
      </View>

      {/* Shot stats centred */}
      <View style={sc.statBlock}>
        <Text style={sc.club}>{shot.club}</Text>
        <Text style={[sc.dist, { color: resultColor(shot.result) }]}>{dist} yds</Text>
        <Text style={sc.result}>{resultLabel(shot.result)}</Text>
        {shot.highlightScore >= 80 && (
          <Text style={sc.starBadge}>⭐ Highlight</Text>
        )}
      </View>
    </ImageBackground>
  );
}

const sc = StyleSheet.create({
  holeBadge:  { position: 'absolute', top: 60, left: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Palette.positive },
  holeNum:    { color: Palette.positive, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  statBlock:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  club:       { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: 0.5 },
  dist:       { fontSize: 52, fontWeight: '900', letterSpacing: -1 },
  result:     { color: 'rgba(255,255,255,0.8)', fontSize: 17, fontWeight: '600' },
  starBadge:  { marginTop: 8, color: '#fcd34d', fontSize: 14, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
});

// ── HighlightReel ─────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function HighlightReel({ onClose }: Props) {
  const shots             = useRoundStore((s) => s.shots);
  const selectedCourseIdx = useRoundStore((s) => s.selectedCourseIdx);
  const courseData        = COURSE_DB[selectedCourseIdx] ?? COURSE_DB[0];

  const clips   = getHighlights(shots, 5);
  const [index, setIndex]           = useState(0);
  const [playing, setPlaying]       = useState(true);
  const [commentary, setCommentary] = useState(true);

  const { handleShare, shareToast } = useShareReel();

  // Fade animation between clips
  const fadeAnim      = useRef(new Animated.Value(1)).current;
  const musicRef      = useRef<import('expo-av').Audio.Sound | null>(null);
  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Background music ───────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: false, staysActiveInBackground: false });
        const { sound } = await Audio.Sound.createAsync(MUSIC, {
          isLooping: true,
          volume: 0.2,
          shouldPlay: true,
        });
        if (mounted) musicRef.current = sound;
      } catch {
        // Audio is non-critical — fail silently
      }
    })();
    return () => {
      mounted = false;
      musicRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  // ── Auto-advance timer ─────────────────────────────────────────────────────
  const advance = useCallback(() => {
    if (!playing || clips.length === 0) return;
    // Fade out current clip
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setIndex((i) => (i + 1) % clips.length);
      // Fade in next clip
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    });
  }, [playing, clips.length, fadeAnim]);

  useEffect(() => {
    if (!playing) return;
    timerRef.current = setTimeout(advance, CLIP_DURATION_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [index, playing, advance]);

  // ── Commentary: speak on each clip change ───────────────────────────────
  useEffect(() => {
    if (!commentary || !clips[index]) return;
    // Stop any in-progress speech immediately
    vmStop();
    if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
    const text = generateCommentary(clips[index]);
    // Delay 800 ms so the clip fade-in lands before the voice line starts
    speechTimerRef.current = setTimeout(() => {
      void vmSpeak(text, PRIORITY.AMBIENT);
    }, 800);
    return () => {
      if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, commentary]);

  // ── Close: stop music + speech ────────────────────────────────────────────
  const handleClose = useCallback(() => {
    musicRef.current?.stopAsync().catch(() => {});
    vmStop();
    if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
    onClose();
  }, [onClose]);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (clips.length === 0) {
    return (
      <View style={s.container}>
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>No Highlights Yet</Text>
          <Text style={s.emptyBody}>Log shots during a round to generate highlights.</Text>
          <Pressable style={s.pill} onPress={handleClose}>
            <Text style={s.pillTxt}>Close</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const clip = clips[index];
  if (!clip) return null;

  const hasVideo = !!clip.frameTag;
  // Strip media-fragment suffix to get bare URI for Video component
  const videoUri = clip.frameTag?.split('#')[0];

  return (
    <View style={s.container}>
      {/* ── Full-screen clip area ──────────────────────────────────────── */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]}>
        {hasVideo && videoUri ? (
          <Video
            source={{ uri: videoUri }}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            shouldPlay={playing}
            isLooping
            isMuted
          />
        ) : (
          <StatCard shot={clip} courseIdx={selectedCourseIdx} />
        )}
      </Animated.View>

      {/* ── Always-on logo watermark ───────────────────────────────────── */}
      <Image
        source={LOGO}
        style={s.logo}
        resizeMode="contain"
      />

      {/* ── Title bar ─────────────────────────────────────────────────── */}
      <View style={s.titleBar} pointerEvents="none">
        <Text style={s.titleText}>Round Highlights</Text>
        <Text style={s.titleSub}>{courseData?.name ?? 'SmartPlay Caddie'}</Text>
      </View>

      {/* ── Commentary caption ────────────────────────────────────────── */}
      {commentary && clips[index] && (
        <Animated.View style={[s.captionWrap, { opacity: fadeAnim }]} pointerEvents="none">
          <Text style={s.captionText}>{generateCommentary(clips[index])}</Text>
        </Animated.View>
      )}

      {/* ── Clip progress dots ────────────────────────────────────────── */}
      <View style={s.dots} pointerEvents="none">
        {clips.map((_, i) => (
          <View
            key={i}
            style={[s.dot, i === index && s.dotActive]}
          />
        ))}
      </View>

      {/* ── Controls overlay ──────────────────────────────────────────── */}
      <View style={s.controls}>
        <Pressable style={s.ctrlBtn} onPress={() => { setIndex((i) => (i - 1 + clips.length) % clips.length); }} >
          <MCIcon name="skip-previous" size={22} color="#fff" />
        </Pressable>
        <Pressable
          style={[s.ctrlBtn, { borderColor: Palette.positive }]}
          onPress={() => setPlaying((p) => !p)}
        >
          <MCIcon name={playing ? 'pause' : 'play'} size={22} color={Palette.positive} />
        </Pressable>
        <Pressable style={s.ctrlBtn} onPress={() => { setIndex((i) => (i + 1) % clips.length); }}>
          <MCIcon name="skip-next" size={22} color="#fff" />
        </Pressable>
        <Pressable
          style={[s.ctrlBtn, { marginLeft: 8, borderColor: commentary ? Palette.positive : 'rgba(255,255,255,0.2)' }]}
          onPress={() => { vmStop(); setCommentary((c) => !c); }}
        >
          <MCIcon name={commentary ? 'microphone' : 'microphone-off'} size={20} color={commentary ? Palette.positive : Palette.muted} />
        </Pressable>
        <Pressable
          style={[s.ctrlBtn, { marginLeft: 8, borderColor: Palette.positive, backgroundColor: 'rgba(46,204,113,0.18)' }]}
          onPress={() => handleShare(clip, courseData?.name, shots.length, clips)}
        >
          <MCIcon name="share-variant" size={20} color={Palette.positive} />
        </Pressable>
        <Pressable style={[s.ctrlBtn, { marginLeft: 8 }]} onPress={handleClose}>
          <MCIcon name="close" size={20} color={Palette.muted} />
        </Pressable>
      </View>

      {/* ── Share toast ───────────────────────────────────────────────── */}
      {shareToast && (
        <View style={s.shareToast} pointerEvents="none">
          <MCIcon name="check-circle" size={15} color={Palette.positive} />
          <Text style={s.shareToastTxt}>{shareToast}</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  logo: {
    position: 'absolute', bottom: 90, right: 16,
    width: 60, height: 60, opacity: 0.88,
  },

  titleBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 52, paddingHorizontal: 20, paddingBottom: 16,
  },
  titleText: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.4 },
  titleSub:  { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginTop: 2 },

  dots: {
    position: 'absolute', top: 44, right: 16,
    flexDirection: 'row', gap: 5, alignItems: 'center',
  },
  dot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: Palette.positive, width: 16 },

  controls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  ctrlBtn: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },

  shareToast: {
    position: 'absolute', top: 130, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
    borderWidth: 1, borderColor: Palette.positive,
  },
  shareToastTxt: { color: '#fff', fontSize: 13, fontWeight: '600' },

  captionWrap: {
    position: 'absolute', bottom: 100, left: 16, right: 80,
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
    borderLeftWidth: 3, borderLeftColor: Palette.positive,
  },
  captionText: { color: '#fff', fontSize: 15, fontWeight: '600', lineHeight: 21 },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 36 },
  emptyTitle: { color: Palette.positive, fontSize: 20, fontWeight: '700' },
  emptyBody:  { color: Palette.muted, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  pill:       { backgroundColor: 'rgba(46,204,113,0.12)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 28, borderWidth: 1, borderColor: Palette.positive },
  pillTxt:    { color: Palette.positive, fontWeight: '700', fontSize: 14 },
});
