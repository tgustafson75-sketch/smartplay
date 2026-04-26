import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  ImageSourcePropType,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── IMAGE MAPS ───────────────────────────

const AVATARS: Record<string, ImageSourcePropType> = {
  kevin_course:   require('../assets/avatars/kevin_portrait.jpg'),
  kevin_dark:     require('../assets/avatars/kevin_dark.jpg'),
  kevin_nod:      require('../assets/avatars/kevin_nod.jpg'),
  kevin_walking:  require('../assets/avatars/kevin_walking.jpg'),
  serena_course:  require('../assets/avatars/serena_portrait.jpg'),
  serena_dark:    require('../assets/avatars/serena_dark.jpg'),
  serena_nod:     require('../assets/avatars/serena_nod.jpg'),
};

// ─── HELPERS ──────────────────────────────

const getAvatarKey = (
  gender: 'male' | 'female',
  isOnCourse: boolean,
  isCageMode: boolean,
  isNodding: boolean,
): string => {
  const prefix = gender === 'female' ? 'serena' : 'kevin';

  if (isNodding) {
    return prefix + '_nod';
  }

  const isDark = isCageMode || !isOnCourse;

  return isDark ? prefix + '_dark' : prefix + '_course';
};

// ─── TYPES ────────────────────────────────

export type VoiceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking';

export interface HUDData {
  hole: number | null;
  par: number | null;
  yards: number | null;
  wind: string | null;
  playsLike: number | null;
}

interface CaddieAvatarProps {
  gender: 'male' | 'female';
  isOnCourse: boolean;
  isCageMode: boolean;
  voiceState: VoiceState;
  hud: HUDData;
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
  hud,
  openingPrompt,
  caddieResponse,
  onTap,
}: CaddieAvatarProps) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const aspectRatio = H / W;
  const isFolded = aspectRatio > 1.6;

  const controlsHeight = 180;
  const availableHeight = H - insets.top - insets.bottom - controlsHeight;

  const AVATAR_HEIGHT = Math.min(
    availableHeight,
    isFolded
      ? Math.round(W * 1.1)
      : Math.round(H * 0.52),
  );

  const breatheAnim = useRef(new Animated.Value(1)).current;
  const glowAnim   = useRef(new Animated.Value(0)).current;
  const nodAnim    = useRef(new Animated.Value(0)).current;
  const scanAnim   = useRef(new Animated.Value(0)).current;

  // ── Breathing — always runs ─────────────
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, {
          toValue: 1.008,
          duration: 3500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breatheAnim, {
          toValue: 1.0,
          duration: 3500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // ── Scan line on mount ──────────────────
  useEffect(() => {
    Animated.timing(scanAnim, {
      toValue: 1,
      duration: 900,
      delay: 300,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, []);

  const [isNodding, setIsNodding] = useState(false);

  // ── Nod animation ──────────────────────
  const triggerNod = () => {
    setIsNodding(true);
    Animated.sequence([
      Animated.timing(nodAnim, {
        toValue: 6,
        duration: 220,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(nodAnim, {
        toValue: -2,
        duration: 180,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(nodAnim, {
        toValue: 0,
        duration: 160,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIsNodding(false);
    });
  };

  // ── Nod on open ────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => triggerNod(), 1800);
    return () => clearTimeout(timer);
  }, []);

  // ── Nod after speaking ─────────────────
  useEffect(() => {
    if (voiceState === 'idle') {
      const timer = setTimeout(() => triggerNod(), 400);
      return () => clearTimeout(timer);
    }
  }, [voiceState]);

  // ── Glow — voice state ─────────────────
  useEffect(() => {
    if (voiceState === 'idle') {
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start();
      return;
    }
    const speed =
      voiceState === 'speaking'   ? 350 :
      voiceState === 'listening'  ? 500 : 900;
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
    voiceState === 'thinking' ? '#F5A623' : '#00C896';

  const stateText =
    voiceState === 'listening' ? '● Listening' :
    voiceState === 'thinking'  ? '◌ Thinking'  :
    voiceState === 'speaking'  ? '▶ Speaking'  : '';

  const avatarSource = AVATARS[getAvatarKey(gender, isOnCourse, isCageMode, isNodding)];

  const hudItems = [
    { label: 'HOLE',  value: hud.hole     !== null ? String(hud.hole)     : '—' },
    { label: 'PAR',   value: hud.par      !== null ? String(hud.par)      : '—' },
    { label: 'YARDS', value: hud.yards    !== null ? String(hud.yards)    : '—' },
    { label: 'WIND',  value: hud.wind     ?? '—' },
    { label: 'PLAYS', value: hud.playsLike !== null ? String(hud.playsLike) : '—' },
  ];

  const displayText = caddieResponse || openingPrompt;

  return (
    <View style={styles.wrapper}>

      {/* ── AVATAR FRAME ──────────────── */}
      <TouchableOpacity
        style={[styles.frame, { height: AVATAR_HEIGHT }]}
        onPress={onTap}
        activeOpacity={0.97}
      >
        {/* Layer 1 — Kevin/Serena avatar (fills frame) */}
        <Animated.Image
          source={avatarSource}
          style={[
            styles.avatarImage,
            {
              transform: [
                { scale: breatheAnim },
                { translateY: nodAnim },
              ],
            },
          ]}
          resizeMode="contain"
        />

        {/* Layer 3 — Bottom gradient */}
        <LinearGradient
          colors={['transparent', 'transparent', 'rgba(6,15,9,0.3)', 'rgba(6,15,9,0.75)']}
          locations={[0, 0.45, 0.75, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Layer 4 — Scan line boot */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.scanLine,
            {
              transform: [{
                translateY: scanAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-AVATAR_HEIGHT, AVATAR_HEIGHT],
                }),
              }],
              opacity: scanAnim.interpolate({
                inputRange: [0, 0.8, 1],
                outputRange: [0.6, 0.6, 0],
              }),
            },
          ]}
        />

        {/* Layer 5 — Floating HUD */}
        {hud.hole !== null && (
          <View style={styles.hud}>
            {hudItems.map((item, i) => (
              <React.Fragment key={item.label}>
                <View style={styles.hudItem}>
                  <Text style={styles.hudLabel}>{item.label}</Text>
                  <Text style={styles.hudValue}>{item.value}</Text>
                </View>
                {i < hudItems.length - 1 && (
                  <View style={styles.hudDot} />
                )}
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Layer 6 — Voice ring */}
        {voiceState !== 'idle' && (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderWidth: 3,
                borderColor: ringColor,
                opacity: glowAnim,
              },
            ]}
          />
        )}

        {/* Layer 7 — State label */}
        {voiceState !== 'idle' && (
          <View style={styles.stateTag}>
            <Text style={[styles.stateTagText, { color: ringColor }]}>
              {stateText}
            </Text>
          </View>
        )}

      </TouchableOpacity>

      {/* ── RESPONSE TEXT ─────────────── */}
      <View style={styles.responseArea}>
        <Text
          style={caddieResponse ? styles.responseText : styles.openingText}
          numberOfLines={3}
        >
          {displayText}
        </Text>
      </View>

    </View>
  );
}

// ─── STYLES ───────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    flexShrink: 0,
    backgroundColor: '#060f09',
  },
  frame: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#060f09',
    paddingTop: 8,
  },
  avatarImage: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    top: 0,
    left: 0,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#00C896',
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
    paddingBottom: 12,
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
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  hudValue: {
    color: '#ffffff',
    fontSize: 20,
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
    marginBottom: 8,
  },
  stateTag: {
    position: 'absolute',
    top: 14,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  stateTagText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    overflow: 'hidden',
  },
  responseArea: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    minHeight: 56,
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
