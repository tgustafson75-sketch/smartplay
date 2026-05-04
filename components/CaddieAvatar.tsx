import React, { useRef, useEffect, useMemo, useState }
  from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { LinearGradient }
  from 'expo-linear-gradient';

const { height: H } =
  Dimensions.get('window');
const { width: W } =
  Dimensions.get('window');
// 0.45 of viewport leaves room below the avatar for the tools pill, mic button,
// the collapsible tools strip (chevron), and the navRow without the lower
// elements clipping below the bottom tab bar. The W * 16/9 cap keeps the image
// proportional on tall narrow devices.
const AVATAR_HEIGHT = Math.min(W * (16 / 9), H * 0.45);

// ─── IMAGE MAPS ───────────────────────────

const AVATARS = {
  male: require(
    '../assets/avatars/kevin_course.jpg'),
  male_dark: require(
    '../assets/avatars/kevin_dark.jpg'),
  female: require(
    '../assets/avatars/serena_course.png'),
  female_dark: require(
    '../assets/avatars/serena_dark.png'),
};

const BACKGROUNDS = {
  morning: require(
    '../assets/avatars/bg_morning.jpg'),
  afternoon: require(
    '../assets/avatars/bg_afternoon.jpg'),
  evening: require(
    '../assets/avatars/bg_evening.jpg'),
  overcast: require(
    '../assets/avatars/bg_overcast.jpg'),
  indoor: require(
    '../assets/avatars/bg_indoor.jpg'),
};

// ─── HELPERS ──────────────────────────────

const getBackground = (
  isOnCourse: boolean,
  isCageMode: boolean,
) => {
  if (isCageMode || !isOnCourse) {
    return BACKGROUNDS.indoor;
  }
  const hour = new Date().getHours();
  if (hour < 10) return BACKGROUNDS.morning;
  if (hour >= 18) return BACKGROUNDS.evening;
  return BACKGROUNDS.afternoon;
};

const getAvatar = (
  gender: 'male' | 'female',
  isOnCourse: boolean,
  isCageMode: boolean,
) => {
  const isDark = isCageMode || !isOnCourse;
  if (gender === 'female') {
    return isDark
      ? AVATARS.female_dark
      : AVATARS.female;
  }
  return isDark
    ? AVATARS.male_dark
    : AVATARS.male;
};

// ─── TYPES ────────────────────────────────

export type VoiceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking';

interface CaddieAvatarProps {
  gender: 'male' | 'female';
  isOnCourse: boolean;
  isCageMode: boolean;
  voiceState: VoiceState;
  hole: number | null;
  par: number | null;
  yards: number | null;
  wind: { speed: number; direction: 'head' | 'tail' | 'left' | 'right' } | null;
  playsLike: number | null;
  openingPrompt: string;
  caddieResponse: string;
  onTap: () => void;
}

// ─── COMPONENT ────────────────────────────

export default function CaddieAvatar({
  gender,
  isOnCourse,
  isCageMode,
  voiceState,
  hole,
  par,
  yards,
  wind,
  playsLike,
  openingPrompt,
  caddieResponse,
  onTap,
}: CaddieAvatarProps) {
  const avatarSource = useMemo(
    () => getAvatar(gender, isOnCourse, isCageMode),
    [gender, isOnCourse, isCageMode]
  );

  const breatheAnim = useRef(
    new Animated.Value(1)
  ).current;
  const glowAnim = useRef(
    new Animated.Value(0)
  ).current;

  // Breathing — always runs
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, {
          toValue: 1.008,
          duration: 3500,
          useNativeDriver: true,
        }),
        Animated.timing(breatheAnim, {
          toValue: 1.0,
          duration: 3500,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Glow — based on voice state
  useEffect(() => {
    if (voiceState === 'idle') {
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
      return;
    }
    const speed =
      voiceState === 'speaking' ? 350
      : voiceState === 'listening' ? 500
      : 900;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: speed,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.2,
          duration: speed,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [voiceState]);

  const ringColor =
    voiceState === 'thinking'
      ? '#F5A623' : '#00C896';

  const stateLabel =
    voiceState === 'listening'
      ? '● Listening'
      : voiceState === 'thinking'
      ? '◌ Thinking'
      : voiceState === 'speaking'
      ? '▶ Speaking'
      : '';

  const hudData = [
    { label: 'HOLE',
      value: hole !== null
        ? String(hole) : '—' },
    { label: 'PAR',
      value: par !== null
        ? String(par) : '—' },
    { label: 'YARDS',
      value: yards !== null
        ? String(yards) : '—' },
    { label: 'WIND',
      value: wind
        ? `${wind.direction === 'head' ? '↓' : wind.direction === 'tail' ? '↑' : wind.direction === 'left' ? '→' : '←'}${wind.speed}`
        : '—' },
    { label: 'PLAYS',
      value: playsLike !== null
        ? String(playsLike) : '—' },
  ];

  return (
    <View style={styles.wrapper}>

      {/* ── AVATAR FRAME ─────────────── */}
      <TouchableOpacity
        style={styles.avatarFrame}
        onPress={onTap}
        activeOpacity={0.97}
      >

        {/* Layer 1 — Background */}
        <Image
          source={getBackground(
            isOnCourse, isCageMode)}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />

        {/* Layer 2 — Caddie portrait
            Serena's framing sits a touch higher in the source asset, so nudge
            her down ~8% so the head lands in the same vertical band Kevin uses. */}
        <Animated.Image
          source={avatarSource}
          style={[
            {
              position: 'absolute',
              width: '100%',
              height: '130%',
              top: gender === 'female' ? '-7%' : '-15%',
              left: 0,
              right: 0,
              transform: [{ scale: breatheAnim }],
            },
          ]}
          resizeMode="cover"
        />

        {/* Layer 3 — Bottom gradient */}
        <LinearGradient
          colors={[
            'transparent',
            'transparent',
            'rgba(6,15,9,0.35)',
            'rgba(6,15,9,0.72)',
          ]}
          locations={[0, 0.48, 0.75, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Layer 4 — Floating data HUD */}
        {hole !== null && (
          <View style={styles.hud}>
            {hudData.map((item, i) => (
              <React.Fragment key={item.label}>
                <View style={styles.hudItem}>
                  <Text style={styles.hudLabel}>
                    {item.label}
                  </Text>
                  <Text style={styles.hudValue}>
                    {item.value}
                  </Text>
                </View>
                {i < hudData.length - 1 && (
                  <View style={styles.hudDot} />
                )}
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Layer 5 — Voice state ring */}
        {voiceState !== 'idle' && (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderWidth: 3,
                borderColor: ringColor,
                opacity: glowAnim,
              }
            ]}
          />
        )}

        {/* Layer 6 — Voice state label */}
        {voiceState !== 'idle' && (
          <View style={styles.stateTag}>
            <Text style={[
              styles.stateTagText,
              { color: ringColor }
            ]}>
              {stateLabel}
            </Text>
          </View>
        )}

      </TouchableOpacity>

      {/* ── RESPONSE TEXT ────────────── */}
      <View style={styles.responseArea}>
        <Text
          style={
            caddieResponse
              ? styles.responseText
              : styles.openingText
          }
          numberOfLines={3}
        >
          {caddieResponse || openingPrompt}
        </Text>
      </View>

    </View>
  );
}

// ─── STYLES ───────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    alignSelf: 'center',
    backgroundColor: '#060f09',
  },
  avatarFrame: {
    width: W,
    height: AVATAR_HEIGHT,
    overflow: 'hidden',
    backgroundColor: '#060f09',
  },
  hud: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-evenly',
    paddingHorizontal: 8,
    paddingBottom: 14,
  },
  hudItem: {
    alignItems: 'center',
    gap: 3,
  },
  hudLabel: {
    color: 'rgba(210,210,210,0.8)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  hudValue: {
    color: '#ffffff',
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  hudDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#00C896',
    marginBottom: 9,
  },
  stateTag: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  stateTagInner: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  stateTagText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  responseArea: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    minHeight: 54,
    justifyContent: 'center',
    backgroundColor: '#060f09',
  },
  responseText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
    textAlign: 'center',
  },
  openingText: {
    color: '#6b7280',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
