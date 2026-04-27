import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  ImageSourcePropType,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import LivingKevin from './LivingKevin';

// ─── AVATAR MAP ───────────────────────────

const AVATARS = {
  kevin_course:        require('../assets/avatars/kevin_portrait.jpg'),
  kevin_dark:          require('../assets/avatars/kevin_dark.jpg'),
  kevin_nod:           require('../assets/avatars/kevin-idle-001.png'),
  kevin_idle:          require('../assets/avatars/kevin-idle-001.png'),
  kevin_listening:     require('../assets/avatars/kevin-listening-001.png'),
  kevin_explaining:    require('../assets/avatars/kevin-explaining-001.png'),
  kevin_focused:       require('../assets/avatars/kevin-focused-portrait-001.png'),
  kevin_determined:    require('../assets/avatars/kevin-determined-portrait-001.png'),
  kevin_pensive:       require('../assets/avatars/kevin-pensive-portrait-001.png'),
  kevin_inquisitive:   require('../assets/avatars/kevin-inquisitive-portrait-001.png'),
  kevin_mentorship:    require('../assets/avatars/kevin-mentorship-001.png'),
  kevin_humble:        require('../assets/avatars/kevin-humble-portrait-001.png'),
  kevin_supportive:    require('../assets/avatars/kevin-supportive-portrait-001.png'),
  kevin_happy:         require('../assets/avatars/kevin-happy-portrait-001.png'),
  kevin_enthusiastic:  require('../assets/avatars/kevin-enthusiastic-portrait-001.png'),
  kevin_surprised:     require('../assets/avatars/kevin-surprised-portrait-001.png'),
  kevin_celebrating:   require('../assets/avatars/kevin-celebrating-001.png'),
  kevin_confident:     require('../assets/avatars/kevin-confident-001.png'),
  kevin_gameface:      require('../assets/avatars/kevin-gameface-001.png'),
  kevin_curious:       require('../assets/avatars/kevin-curious-001.png'),
  kevin_wincing:       require('../assets/avatars/kevin-wincing-001.png'),
  kevin_self_critical: require('../assets/avatars/kevin-humble-portrait-001.png'),
} as const;

type AvatarKey = keyof typeof AVATARS;

const SERENA = {
  course: require('../assets/avatars/serena_portrait.jpg') as ImageSourcePropType,
  dark:   require('../assets/avatars/serena_dark.jpg')    as ImageSourcePropType,
};

// ─── EMOTION → KEY MAP ────────────────────

const EMOTION_KEY_MAP: Record<string, AvatarKey> = {
  focused:          'kevin_focused',
  determined:       'kevin_determined',
  thinking:         'kevin_pensive',
  pensive:          'kevin_pensive',
  listening:        'kevin_listening',
  speaking:         'kevin_explaining',
  explaining:       'kevin_explaining',
  asking:           'kevin_inquisitive',
  inquisitive:      'kevin_inquisitive',
  encouraging:      'kevin_supportive',
  supportive:       'kevin_supportive',
  reset:            'kevin_supportive',
  happy:            'kevin_happy',
  enthusiastic:     'kevin_enthusiastic',
  surprised:        'kevin_surprised',
  humble:           'kevin_humble',
  teaching:         'kevin_mentorship',
  mentorship:       'kevin_mentorship',
  idle:             'kevin_idle',
  celebrating:      'kevin_celebrating',
  'celebrating-loud': 'kevin_celebrating',
  'celebrating-big':  'kevin_celebrating',
  confident:        'kevin_confident',
  gameface:         'kevin_gameface',
  intense:          'kevin_gameface',
  'locked-in':      'kevin_gameface',
  curious:          'kevin_curious',
  wincing:          'kevin_wincing',
  oops:             'kevin_wincing',
  ouch:             'kevin_wincing',
  self_critical:    'kevin_self_critical',
  'self-critical':  'kevin_self_critical',
  accountable:      'kevin_self_critical',
  'owning-mistake': 'kevin_self_critical',
};

// ─── EMOTION CLASSIFICATION ───────────────

type EmotionCategory = 'CALM' | 'POSITIVE' | 'REACTIVE' | 'INTENSE';

const EMOTION_CATEGORY: Record<AvatarKey, EmotionCategory> = {
  kevin_course:        'CALM',
  kevin_dark:          'CALM',
  kevin_nod:           'CALM',
  kevin_idle:          'CALM',
  kevin_listening:     'CALM',
  kevin_mentorship:    'CALM',
  kevin_humble:        'CALM',
  kevin_supportive:    'CALM',
  kevin_pensive:       'CALM',
  kevin_self_critical: 'CALM',
  kevin_explaining:    'INTENSE',
  kevin_focused:       'INTENSE',
  kevin_determined:    'INTENSE',
  kevin_inquisitive:   'INTENSE',
  kevin_curious:       'INTENSE',
  kevin_gameface:      'INTENSE',
  kevin_happy:         'POSITIVE',
  kevin_enthusiastic:  'POSITIVE',
  kevin_confident:     'POSITIVE',
  kevin_celebrating:   'POSITIVE',
  kevin_surprised:     'REACTIVE',
  kevin_wincing:       'REACTIVE',
};

function getEmotionCategory(key: AvatarKey): EmotionCategory {
  return EMOTION_CATEGORY[key];
}

// ─── TRANSITION CONFIG ────────────────────

interface TransitionConfig {
  duration: number;
  easing: (t: number) => number;
  useBreath: boolean;
}

function getTransitionConfig(from: AvatarKey, to: AvatarKey): TransitionConfig {
  const catFrom = getEmotionCategory(from);
  const catTo   = getEmotionCategory(to);

  const isStrongPositive = to === 'kevin_celebrating' || to === 'kevin_enthusiastic';

  const useBreath =
    (catFrom === 'CALM' && catTo === 'REACTIVE') ||
    (catFrom === 'CALM' && isStrongPositive) ||
    (catFrom === 'REACTIVE' && catTo === 'POSITIVE') ||
    (catFrom === 'INTENSE' && catTo === 'POSITIVE');

  if (catFrom === 'REACTIVE' || catTo === 'REACTIVE') {
    return { duration: 180, easing: Easing.out(Easing.quad), useBreath };
  }
  if (catFrom === 'CALM' && catTo === 'CALM') {
    return { duration: 600, easing: Easing.inOut(Easing.cubic), useBreath };
  }
  if (catFrom === 'INTENSE' || catTo === 'INTENSE') {
    return { duration: 320, easing: Easing.inOut(Easing.quad), useBreath };
  }
  if (catFrom === 'POSITIVE' || catTo === 'POSITIVE') {
    return { duration: 380, easing: Easing.out(Easing.cubic), useBreath };
  }
  return { duration: 280, easing: Easing.inOut(Easing.quad), useBreath };
}

// ─── AVATAR KEY + SOURCE ──────────────────

function getAvatarKey(
  emotion: string | null | undefined,
  isOnCourse: boolean,
  isCageMode: boolean,
): AvatarKey {
  if (isOnCourse && !isCageMode && !emotion) return 'kevin_course';
  if (emotion) {
    const mapped = EMOTION_KEY_MAP[emotion];
    if (mapped) return mapped;
  }
  return isOnCourse && !isCageMode ? 'kevin_course' : 'kevin_dark';
}

function computeSource(
  gender: 'male' | 'female',
  emotion: string | null | undefined,
  isOnCourse: boolean,
  isCageMode: boolean,
): ImageSourcePropType {
  if (gender === 'female') {
    return (isCageMode || !isOnCourse) ? SERENA.dark : SERENA.course;
  }
  return AVATARS[getAvatarKey(emotion, isOnCourse, isCageMode)];
}

// voiceState → emotion used when no explicit emotion prop is passed
const VOICE_EMOTION: Record<string, string> = {
  idle:      'idle',
  listening: 'listening',
  thinking:  'thinking',
  speaking:  'speaking',
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
  emotion?: string | null;
  fillMode?: 'cover' | 'contain';
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
  emotion,
  fillMode,
}: CaddieAvatarProps) {
  const fill = fillMode ?? 'contain';
  const { height: H } = useWindowDimensions();
  const FRAME_HEIGHT = Math.round(H * 0.55);

  // ── Derived emotion ─────────────────────
  const effectiveEmotion = emotion ?? VOICE_EMOTION[voiceState] ?? null;
  const targetSource = computeSource(gender, effectiveEmotion, isOnCourse, isCageMode);
  const effectiveKey: AvatarKey = gender === 'female'
    ? 'kevin_idle'
    : getAvatarKey(effectiveEmotion, isOnCourse, isCageMode);

  // ── Animation refs ──────────────────────
  const glowAnim     = useRef(new Animated.Value(0)).current;
  const scanAnim     = useRef(new Animated.Value(0)).current;
  const hudFlash     = useRef(new Animated.Value(1)).current;
  const responseFade = useRef(new Animated.Value(1)).current;
  const idleHintAnim = useRef(new Animated.Value(0)).current;

  // ── Crossfade state ─────────────────────
  const [backSource,  setBackSource]  = useState<ImageSourcePropType>(targetSource);
  const [frontSource, setFrontSource] = useState<ImageSourcePropType>(targetSource);
  const fadeAnim          = useRef(new Animated.Value(1)).current;
  const currentSourceRef  = useRef<ImageSourcePropType>(targetSource);
  const currentKeyRef     = useRef<AvatarKey>(effectiveKey);
  const frontSourceRef    = useRef<ImageSourcePropType>(targetSource);
  const backSourceRef     = useRef<ImageSourcePropType>(targetSource);
  const currentAnimRef    = useRef<Animated.CompositeAnimation | null>(null);
  const breathTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backOpacity = fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  useEffect(() => {
    if (targetSource === currentSourceRef.current) return;

    // ── Interruption: cancel any in-flight animation ──
    if (currentAnimRef.current) {
      currentAnimRef.current.stop();
      currentAnimRef.current = null;
    }
    if (breathTimeoutRef.current) {
      clearTimeout(breathTimeoutRef.current);
      breathTimeoutRef.current = null;
    }

    // Read current opacity to determine which layer is more visible
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const frozenFade = (fadeAnim as any).__getValue() as number;
    const currentVisible =
      frozenFade >= 0.5 ? frontSourceRef.current : backSourceRef.current;

    // Compute config using the key BEFORE this update
    const config: TransitionConfig = gender === 'female'
      ? { duration: 280, easing: Easing.inOut(Easing.quad), useBreath: false }
      : getTransitionConfig(currentKeyRef.current, effectiveKey);

    // Advance tracking
    currentSourceRef.current = targetSource;
    currentKeyRef.current = effectiveKey;

    if (config.useBreath) {
      // ── 3-stage breath sequence ────────────
      const breathSrc: ImageSourcePropType = AVATARS['kevin_idle'];

      // Stage 1: currentVisible → idle
      backSourceRef.current  = currentVisible;
      frontSourceRef.current = breathSrc;
      setBackSource(currentVisible);
      setFrontSource(breathSrc);
      fadeAnim.setValue(0);

      const stage1 = Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      });
      currentAnimRef.current = stage1;

      stage1.start(({ finished }) => {
        if (!finished) return;
        currentAnimRef.current = null;

        // Stage 2: 80ms settle, then Stage 3: idle → target
        breathTimeoutRef.current = setTimeout(() => {
          breathTimeoutRef.current = null;
          backSourceRef.current  = breathSrc;
          frontSourceRef.current = targetSource;
          setBackSource(breathSrc);
          setFrontSource(targetSource);
          fadeAnim.setValue(0);

          const stage3 = Animated.timing(fadeAnim, {
            toValue: 1,
            duration: config.duration,
            easing: config.easing,
            useNativeDriver: true,
          });
          currentAnimRef.current = stage3;
          stage3.start(() => { currentAnimRef.current = null; });
        }, 80);
      });

    } else {
      // ── Direct crossfade ───────────────────
      backSourceRef.current  = currentVisible;
      frontSourceRef.current = targetSource;
      setBackSource(currentVisible);
      setFrontSource(targetSource);
      fadeAnim.setValue(0);

      const anim = Animated.timing(fadeAnim, {
        toValue: 1,
        duration: config.duration,
        easing: config.easing,
        useNativeDriver: true,
      });
      currentAnimRef.current = anim;
      anim.start(() => { currentAnimRef.current = null; });
    }
  }, [targetSource]);

  const displayText = caddieResponse || openingPrompt;
  const [displayedText, setDisplayedText] = useState(displayText);
  const isFirstRender = useRef(true);

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

  // ── Idle tap hint ───────────────────────
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

  const ringColor =
    voiceState === 'thinking' ? '#F5A623' : '#00C896';

  const stateText =
    voiceState === 'listening' ? '● Listening' :
    voiceState === 'thinking'  ? '◌ Thinking'  :
    voiceState === 'speaking'  ? '▶ Speaking'  : '';

  const hudItems = [
    { label: 'HOLE',  value: hud.hole      !== null ? String(hud.hole)      : '—' },
    { label: 'PAR',   value: hud.par       !== null ? String(hud.par)       : '—' },
    { label: 'YARDS', value: hud.yards     !== null ? String(hud.yards)     : '—' },
    { label: 'WIND',  value: hud.wind      ?? '—' },
    { label: 'PLAYS', value: hud.playsLike !== null ? String(hud.playsLike) : '—' },
  ];

  return (
    <View style={fill === 'cover' ? styles.wrapperFull : styles.wrapper}>

      {/* ── AVATAR FRAME ──────────────── */}
      <TouchableOpacity
        style={fill === 'cover' ? styles.frameFull : [styles.frame, { height: FRAME_HEIGHT }]}
        onPress={onTap}
        activeOpacity={0.97}
      >
        {/* Layer 1a — Back (fading out) */}
        <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: backOpacity }]}>
          <LivingKevin source={backSource} resizeMode={fill} voiceState={voiceState} />
        </Animated.View>

        {/* Layer 1b — Front (fading in), living animations on UI thread */}
        <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: fadeAnim }]}>
          <LivingKevin source={frontSource} resizeMode={fill} voiceState={voiceState} />
        </Animated.View>

        {/* Layer 2 — Bottom gradient */}
        <LinearGradient
          colors={['transparent', 'transparent', 'rgba(6,15,9,0.3)', 'rgba(6,15,9,0.75)']}
          locations={[0, 0.45, 0.75, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Layer 3 — Scan line boot */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.scanLine,
            {
              transform: [{
                translateY: scanAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-2000, 2000],
                }),
              }],
              opacity: scanAnim.interpolate({
                inputRange: [0, 0.8, 1],
                outputRange: [0.6, 0.6, 0],
              }),
            },
          ]}
        />

        {/* Layer 4 — Floating HUD */}
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

        {/* Layer 5 — Voice ring */}
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

        {/* Layer 5b — Idle tap hint */}
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

        {/* Layer 6 — State label */}
        {voiceState !== 'idle' && (
          <View style={styles.stateTag}>
            <Text style={[styles.stateTagText, { color: ringColor }]}>
              {stateText}
            </Text>
          </View>
        )}

      </TouchableOpacity>

      {/* ── RESPONSE TEXT ─────────────── */}
      {fill === 'contain' && !!displayedText && (
        <Animated.View style={[styles.responseArea, { opacity: responseFade }]}>
          <Text
            style={caddieResponse ? styles.responseText : styles.openingText}
            numberOfLines={3}
          >
            {displayedText}
          </Text>
        </Animated.View>
      )}

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
  wrapperFull: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#060f09',
    padding: 12,
  },
  frame: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#060f09',
    paddingTop: 8,
  },
  frameFull: {
    flex: 1,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#060f09',
    borderWidth: 1,
    borderColor: 'rgba(0, 200, 150, 0.35)',
    borderRadius: 24,
    shadowColor: '#00C896',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
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
