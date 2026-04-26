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

const BACKGROUNDS: Record<string, ImageSourcePropType> = {
  morning:   require('../assets/avatars/kevin_portrait.jpg'),
  afternoon: require('../assets/avatars/kevin_portrait.jpg'),
  evening:   require('../assets/avatars/kevin_dark.jpg'),
  indoor:    require('../assets/avatars/kevin_dark.jpg'),
};

const SERENA: Record<string, ImageSourcePropType> = {
  course: require('../assets/avatars/serena_portrait.jpg'),
  dark:   require('../assets/avatars/serena_dark.jpg'),
};

// ─── HELPERS ──────────────────────────────

const getBackground = (
  isOnCourse: boolean,
  isCageMode: boolean,
): ImageSourcePropType => {
  if (isCageMode || !isOnCourse) {
    return BACKGROUNDS.indoor;
  }
  const hour = new Date().getHours();
  if (hour < 10) return BACKGROUNDS.morning;
  if (hour >= 18) return BACKGROUNDS.evening;
  return BACKGROUNDS.afternoon;
};

const getAvatarSource = (
  gender: 'male' | 'female',
  isOnCourse: boolean,
  isCageMode: boolean,
): ImageSourcePropType => {
  if (gender === 'female') {
    return (isCageMode || !isOnCourse) ? SERENA.dark : SERENA.course;
  }
  return getBackground(isOnCourse, isCageMode);
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

  const breatheAnim  = useRef(new Animated.Value(1)).current;
  const glowAnim     = useRef(new Animated.Value(0)).current;
  const nodAnim      = useRef(new Animated.Value(0)).current;
  const scanAnim     = useRef(new Animated.Value(0)).current;
  const hudFlash     = useRef(new Animated.Value(1)).current;
  const responseFade = useRef(new Animated.Value(1)).current;
  const idleHintAnim = useRef(new Animated.Value(0)).current;

  const prevVoiceState = useRef<VoiceState>('idle');

  const displayText = caddieResponse || openingPrompt;
  const [displayedText, setDisplayedText] = useState(displayText);
  const isFirstRender = useRef(true);

  // ── Breathing — always runs ─────────────
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, {
          toValue: 1.012,
          duration: 4000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breatheAnim, {
          toValue: 1.0,
          duration: 4000,
          easing: Easing.inOut(Easing.sin),
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

  // ── Nod animation ──────────────────────
  const triggerNod = () => {
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
    ]).start();
  };

  // ── Nod on open ────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => triggerNod(), 1800);
    return () => clearTimeout(timer);
  }, []);

  // ── Nod only when speaking → idle ──────
  useEffect(() => {
    if (prevVoiceState.current === 'speaking' && voiceState === 'idle') {
      const timer = setTimeout(() => triggerNod(), 300);
      prevVoiceState.current = voiceState;
      return () => clearTimeout(timer);
    }
    prevVoiceState.current = voiceState;
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
      voiceState === 'speaking'  ? 300 :
      voiceState === 'listening' ? 600 : 1200;
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

  // ── HUD flash on data change ────────────
  useEffect(() => {
    if (hud.hole === null) return;
    Animated.sequence([
      Animated.timing(hudFlash, {
        toValue: 0.3,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(hudFlash, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [hud.hole, hud.yards]);

  // ── Response text fade on change ────────
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      setDisplayedText(displayText);
      return;
    }
    Animated.timing(responseFade, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setDisplayedText(displayText);
      Animated.timing(responseFade, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
  }, [displayText]);

  const ringColor =
    voiceState === 'thinking' ? '#F5A623' : '#00C896';

  const stateText =
    voiceState === 'listening' ? '● Listening' :
    voiceState === 'thinking'  ? '◌ Thinking'  :
    voiceState === 'speaking'  ? '▶ Speaking'  : '';

  // ── Idle hint pulse ─────────────────────
  useEffect(() => {
    if (voiceState !== 'idle') {
      idleHintAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(idleHintAnim, {
          toValue: 0.3,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(idleHintAnim, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [voiceState]);

  const avatarSource = getAvatarSource(gender, isOnCourse, isCageMode);

  const hudItems = [
    { label: 'HOLE',  value: hud.hole     !== null ? String(hud.hole)     : '—' },
    { label: 'PAR',   value: hud.par      !== null ? String(hud.par)      : '—' },
    { label: 'YARDS', value: hud.yards    !== null ? String(hud.yards)    : '—' },
    { label: 'WIND',  value: hud.wind     ?? '—' },
    { label: 'PLAYS', value: hud.playsLike !== null ? String(hud.playsLike) : '—' },
  ];

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
          <Animated.View style={[styles.hud, { opacity: hudFlash }]}>
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
          </Animated.View>
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

        {/* Layer 6b — Idle tap hint */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderWidth: 1,
              borderColor: '#00C896',
              opacity: idleHintAnim,
            },
          ]}
        />

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
      <Animated.View style={[styles.responseArea, { opacity: responseFade }]}>
        <Text
          style={caddieResponse ? styles.responseText : styles.openingText}
          numberOfLines={3}
        >
          {displayedText}
        </Text>
      </Animated.View>

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
