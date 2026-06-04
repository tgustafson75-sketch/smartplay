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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Audit follow-up (2026-05-13) — pull theme tokens so the state ring
// inherits the active palette instead of using hardcoded brand greens.
// Light-mode users were getting the dark-mode shade of green on the
// ring. StyleSheet-level static colors (chip backgrounds, etc.) stay
// hardcoded — they're brand-intentional and changing them risks dark-
// mode regressions we'd need to verify visually.
import { useTheme } from '../contexts/ThemeContext';

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

// Serena counterparts for the same emotion keys. Until per-emotion Serena
// PNGs exist (Tim generates via chatly.ai when scoping permits), most
// emotional states fall back to the studio portrait. The high-res
// caddie-nod covers the "with you" CALM cluster (idle/listening/nod/
// mentorship/supportive). Replace individual entries as new Serena
// assets land — keys mirror AVATARS so swap is one-line per emotion.
const SERENA_AVATARS: Record<AvatarKey, ImageSourcePropType> = {
  kevin_course:        require('../assets/avatars/serena_portrait.jpg'),
  kevin_dark:          require('../assets/avatars/serena_dark.jpg'),
  kevin_nod:           require('../assets/avatars/serena-caddie-nod-001.png'),
  kevin_idle:          require('../assets/avatars/serena-caddie-nod-001.png'),
  kevin_listening:     require('../assets/avatars/serena-caddie-nod-001.png'),
  kevin_mentorship:    require('../assets/avatars/serena-caddie-nod-001.png'),
  kevin_supportive:    require('../assets/avatars/serena-caddie-nod-001.png'),
  kevin_explaining:    require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_focused:       require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_determined:    require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_pensive:       require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_inquisitive:   require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_humble:        require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_happy:         require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_enthusiastic:  require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_surprised:     require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_celebrating:   require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_confident:     require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_gameface:      require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_curious:       require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_wincing:       require('../assets/avatars/serena-studio-portrait-001.png'),
  kevin_self_critical: require('../assets/avatars/serena-studio-portrait-001.png'),
};

// Harry counterparts. Each emotion slot maps to the closest-matching PNG
// from harry_emotions_24.zip. Slots without a perfect match reuse the
// nearest expressive sibling (e.g. kevin_curious reuses attentive).
const HARRY_AVATARS: Record<AvatarKey, ImageSourcePropType> = {
  kevin_course:        require('../assets/avatars/harry_portrait.png'),
  kevin_dark:          require('../assets/avatars/harry_moods_serious.png'),
  kevin_nod:           require('../assets/avatars/harry_expressive_friendly_smile.png'),
  kevin_idle:          require('../assets/avatars/harry_expressive_friendly_smile.png'),
  kevin_listening:     require('../assets/avatars/harry_expressive_attentive.png'),
  kevin_explaining:    require('../assets/avatars/harry_moods_pointing_at_you.png'),
  kevin_focused:       require('../assets/avatars/harry_moods_serious.png'),
  kevin_determined:    require('../assets/avatars/harry_moods_ready.png'),
  kevin_pensive:       require('../assets/avatars/harry_moods_thoughtful.png'),
  kevin_inquisitive:   require('../assets/avatars/harry_expressive_suspicious.png'),
  kevin_mentorship:    require('../assets/avatars/harry_moods_knowing_smile.png'),
  kevin_humble:        require('../assets/avatars/harry_moods_tipping_cap.png'),
  kevin_supportive:    require('../assets/avatars/harry_moods_approving.png'),
  kevin_happy:         require('../assets/avatars/harry_expressive_warm_smile_wide.png'),
  kevin_enthusiastic:  require('../assets/avatars/harry_expressive_laughing.png'),
  kevin_surprised:     require('../assets/avatars/harry_expressive_surprised.png'),
  kevin_celebrating:   require('../assets/avatars/harry_expressive_celebrating.png'),
  kevin_confident:     require('../assets/avatars/harry_moods_knowing_smile.png'),
  kevin_gameface:      require('../assets/avatars/harry_expressive_stern.png'),
  kevin_curious:       require('../assets/avatars/harry_expressive_attentive.png'),
  kevin_wincing:       require('../assets/avatars/harry_expressive_exasperated.png'),
  kevin_self_critical: require('../assets/avatars/harry_moods_downcast.png'),
};

// Tank counterparts. 2026-05-16 — fully migrated to the clean tank_v2_*
// set. The legacy tank_emotions_*.png and tank_expressive_*.png images
// have a text label baked into the bottom of the image itself ("Relief",
// "Facepalm", "Confusion" etc) — Tim reported them visible on Caddie tab
// while testing with Tank as the active persona. The v2 set has no
// baked-in labels, so this map now exclusively uses v2. Some emotion
// slots reuse the same v2 image because we have 22 emotion keys but
// only ~11 v2 portraits; that's fine — the slot mapping is best-fit by
// character feel, not 1:1 unique imagery.
const TANK_AVATARS: Record<AvatarKey, ImageSourcePropType> = {
  kevin_course:        require('../assets/avatars/tank_v2_portrait.png'),
  kevin_dark:          require('../assets/avatars/tank_v2_lets_go_marine.png'),
  kevin_nod:           require('../assets/avatars/tank_v2_here_we_go.png'),
  kevin_idle:          require('../assets/avatars/tank_v2_here_we_go.png'),
  // Listening / pensive both read as "attentive default" — the
  // neutral portrait is the most honest Tank-listening pose.
  kevin_listening:     require('../assets/avatars/tank_v2_portrait.png'),
  kevin_explaining:    require('../assets/avatars/tank_v2_you_got_this.png'),
  kevin_focused:       require('../assets/avatars/tank_v2_lets_go_marine.png'),
  kevin_determined:    require('../assets/avatars/tank_v2_lets_go.png'),
  kevin_pensive:       require('../assets/avatars/tank_v2_portrait.png'),
  kevin_inquisitive:   require('../assets/avatars/tank_v2_questioning.png'),
  kevin_mentorship:    require('../assets/avatars/tank_v2_you_got_this.png'),
  // Humble — softer mentor moment. "You got this" carries it without
  // any v1 fallback. Could also use encouraging; you-got-this is more
  // post-good-shot acknowledgment, which fits humble's vibe.
  kevin_humble:        require('../assets/avatars/tank_v2_you_got_this.png'),
  kevin_supportive:    require('../assets/avatars/tank_v2_encouraging.png'),
  kevin_happy:         require('../assets/avatars/tank_v2_happy.png'),
  kevin_enthusiastic:  require('../assets/avatars/tank_v2_excited.png'),
  kevin_surprised:     require('../assets/avatars/tank_v2_wtf.png'),
  kevin_celebrating:   require('../assets/avatars/tank_v2_semper_fi.png'),
  kevin_confident:     require('../assets/avatars/tank_v2_semper_fi.png'),
  kevin_gameface:      require('../assets/avatars/tank_v2_lets_go.png'),
  kevin_curious:       require('../assets/avatars/tank_v2_questioning.png'),
  // Wincing + self-critical — "wtf" reads as the displeased reaction
  // beat without a labeled bottom strip. Both share for now; if Tim
  // wants a distinct self-critical pose later we can add a v2 image.
  kevin_wincing:       require('../assets/avatars/tank_v2_wtf.png'),
  kevin_self_critical: require('../assets/avatars/tank_v2_wtf.png'),
};

type Persona = 'kevin' | 'serena' | 'harry' | 'tank';

function getAvatarSet(persona: Persona): Record<AvatarKey, ImageSourcePropType> {
  switch (persona) {
    case 'serena': return SERENA_AVATARS;
    case 'harry':  return HARRY_AVATARS;
    case 'tank':   return TANK_AVATARS;
    case 'kevin':
    default:       return AVATARS;
  }
}

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
  persona: Persona,
  emotion: string | null | undefined,
  isOnCourse: boolean,
  isCageMode: boolean,
): ImageSourcePropType {
  const key = getAvatarKey(emotion, isOnCourse, isCageMode);
  return getAvatarSet(persona)[key];
}

// voiceState → emotion used when no explicit emotion prop is passed
const VOICE_EMOTION: Record<string, string> = {
  idle:      'idle',
  listening: 'listening',
  thinking:  'thinking',
  speaking:  'speaking',
};

// 2026-05-27 — Fix EM: persona display name (capitalized first letter).
// Used in the proactive-state badge so EVERY persona reads its own name
// instead of the hardcoded "Kevin." Defaults to 'Kevin' if persona is
// somehow null/unknown — same fallback the rest of the file uses.
function personaDisplayName(persona: Persona | undefined | null): string {
  switch (persona) {
    case 'kevin':  return 'Kevin';
    case 'serena': return 'Serena';
    case 'tank':   return 'Tank';
    case 'harry':  return 'Harry';
    default:       return 'Kevin';
  }
}

// ─── TYPES ────────────────────────────────

export type VoiceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'proactive';

export interface HUDData {
  hole: number | null;
  par: number | null;
  yards: number | null;
  wind: string | null;
  playsLike: number | null;
}

interface CaddieAvatarProps {
  gender: 'male' | 'female';
  /** Persona ID — when provided, drives avatar set selection (4-way:
   *  kevin/serena/harry/tank). When omitted, falls back to gender-based
   *  selection for back-compat with older call sites (gender 'male' →
   *  Kevin, 'female' → Serena). New call sites should pass persona. */
  persona?: 'kevin' | 'serena' | 'harry' | 'tank';
  isOnCourse: boolean;
  isCageMode: boolean;
  voiceState: VoiceState;
  hud: HUDData;
  openingPrompt: string;
  caddieResponse: string;
  onTap: () => void;
  emotion?: string | null;
  fillMode?: 'cover' | 'contain';
  isThinking?: boolean;
  /** Phase R Component 14 — idle breathing animation intensity per
   *  Trust Spectrum level. L1 = none (Kevin not visible), L2 subtle,
   *  L3 standard, L4 most pronounced. Defaults to 3 (standard). */
  trustLevel?: 1 | 2 | 3;
  /** Phase BI — when set, overrides the persona avatar set with the
   *  user-generated portrait. Renders that single image with no
   *  emotion-driven crossfades. Pass raw base64 (no data: prefix). */
  customPortraitB64?: string | null;
  /** When true, the avatar suppresses its internal text overlay (opening
   *  prompt + response text). Use this when the caller renders the
   *  caddie's text in its own card above/below the avatar so the user
   *  doesn't see the same text twice. */
  hideInternalText?: boolean;
}

// ─── COMPONENT ────────────────────────────

export default function CaddieAvatar({
  gender,
  persona,
  isOnCourse,
  isCageMode,
  voiceState,
  hud,
  openingPrompt,
  caddieResponse,
  onTap,
  emotion,
  fillMode,
  isThinking = false,
  trustLevel = 3,
  customPortraitB64,
  hideInternalText = false,
}: CaddieAvatarProps) {
  // Resolve persona: explicit prop wins, else fall back to gender → kevin/serena.
  const resolvedPersona: Persona = persona ?? (gender === 'female' ? 'serena' : 'kevin');
  const fill = fillMode ?? 'contain';
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const themeColors = useTheme().colors;

  const aspectRatio = H / W;
  const isFolded = aspectRatio > 1.6;

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  LOCKED: Kevin photoreal portrait layout (Phase AU)          ║
  // ║  Canonical reference: commit 19165fb (2026-04-26 12:43 PDT)  ║
  // ║  "Fix Caddie screen: avatar framing..."                      ║
  // ║                                                              ║
  // ║  Kevin renders via plain resizeMode='cover' on a natural     ║
  // ║  9:16 frame (W × W·16/9) anchored top:0 left:0 by the        ║
  // ║  parent in app/(tabs)/caddie.tsx. NO horizontal shift, NO    ║
  // ║  vertical shift, NO scale multiplier, NO aspect-ratio        ║
  // ║  branches at this layer. Cover-mode + the 9:16 parent frame  ║
  // ║  is what produces the canonical composition on every device. ║
  // ║                                                              ║
  // ║  Earlier Phase-AT iteration added a recompose pipeline       ║
  // ║  (PORTRAIT_OFFSET_F, baseShiftFraction, kevinShiftFraction,  ║
  // ║  kevinShiftYFraction, kevinScaleMul, PORTRAIT_EXTRA_SHIFT)   ║
  // ║  that drifted Kevin user-left on Fold open and clipped his   ║
  // ║  hat. Removed in Phase AU. DO NOT reintroduce.               ║
  // ║                                                              ║
  // ║  If Kevin appears off-center on a new device, the fix is to  ║
  // ║  audit the PARENT container in caddie.tsx (frame size,       ║
  // ║  position) — NOT to add transforms here.                     ║
  // ╚══════════════════════════════════════════════════════════════╝

  const controlsHeight = 180;
  const availableHeight = H - insets.top - insets.bottom - controlsHeight;

  const AVATAR_HEIGHT = Math.min(
    availableHeight,
    isFolded
      ? Math.round(W * 1.1)
      : Math.round(H * 0.52),
  );

  // ── Derived emotion ─────────────────────
  const effectiveEmotion = emotion ?? VOICE_EMOTION[voiceState] ?? null;
  // Phase BI — custom portrait override. When the user has generated a
  // personal caddie and turned the toggle on, the resolved source is the
  // single base64 portrait for every emotion + state. Crossfade still
  // works because the source object is stable across renders.
  const customSource: ImageSourcePropType | null = customPortraitB64
    ? { uri: `data:image/png;base64,${customPortraitB64}` }
    : null;
  const targetSource: ImageSourcePropType = customSource
    ?? computeSource(resolvedPersona, effectiveEmotion, isOnCourse, isCageMode);
  // All four personas have per-emotion assets now (Kevin/Serena/Harry/Tank),
  // so the same key resolution applies to all. Each persona's avatar map
  // re-keys to its own PNG set.
  const effectiveKey: AvatarKey = getAvatarKey(effectiveEmotion, isOnCourse, isCageMode);

  // Phase AU — recompose pipeline removed. See LOCK comment above.

  // ── Animation refs ──────────────────────
  const breatheAnim    = useRef(new Animated.Value(1)).current;
  const breatheTransY  = useRef(new Animated.Value(0)).current;
  const glowAnim       = useRef(new Animated.Value(0)).current;
  const nodAnim        = useRef(new Animated.Value(0)).current;
  const scanAnim       = useRef(new Animated.Value(0)).current;
  const hudFlash       = useRef(new Animated.Value(1)).current;
  const responseFade   = useRef(new Animated.Value(1)).current;
  const idleHintAnim   = useRef(new Animated.Value(0)).current;
  const driftX         = useRef(new Animated.Value(0)).current;
  const driftY         = useRef(new Animated.Value(0)).current;

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
     
    const frozenFade = (fadeAnim as any).__getValue() as number;
    const currentVisible =
      frozenFade >= 0.5 ? frontSourceRef.current : backSourceRef.current;

    // Compute config using the key BEFORE this update. Same transition
    // rules apply to every persona — the breath-stage intermediate uses
    // the active persona's idle PNG (resolved a few lines down).
    const config: TransitionConfig = getTransitionConfig(currentKeyRef.current, effectiveKey);

    // Advance tracking
    currentSourceRef.current = targetSource;
    currentKeyRef.current = effectiveKey;

    if (config.useBreath) {
      // ── 3-stage breath sequence ────────────
      // Use the active persona's idle PNG as the breath intermediate so
      // a Tank → Tank or Harry → Harry transition doesn't flash Kevin's
      // face mid-breath.
      const breathSrc: ImageSourcePropType = getAvatarSet(resolvedPersona)['kevin_idle'];

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSource]);

  const prevVoiceState = useRef<VoiceState>('idle');

  const displayText = caddieResponse || openingPrompt;
  const [displayedText, setDisplayedText] = useState(displayText);
  const isFirstRender = useRef(true);

  // ── Phase R Component 14 — Idle breathing ─────────────
  // Lifelike resting respiration (~15 breaths/min). Trust-level intensity:
  //   L2 subtle (1% scale, 1px translate) · L3 standard (1.5%, 2px) · L4 most (2%, 2px)
  // Pauses during speech / thinking / listening so existing Phase F glow
  // and pulse animations own those state cues. Resumes smoothly on idle.
  // L1 hides Kevin entirely — animation never visible there.
  useEffect(() => {
    const isIdle = voiceState === 'idle' && !isThinking;
    // 2026-06-04 — L4 collapsed; L3 inherits the prior L4 max-intensity values.
    const intensity =
      trustLevel === 3 ? { scale: 1.020, translate: -2 } :
                         { scale: 1.010, translate: -1 };  // L2 (and L1 fallback)

    if (!isIdle) {
      // Settle to resting position when not idle; the active-state cues
      // (glow / pulse / badge) take over the visual focus.
      Animated.parallel([
        Animated.timing(breatheAnim,   { toValue: 1, duration: 400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breatheTransY, { toValue: 0, duration: 400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]).start();
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        // Inhale — 1.8s, scale up + slight upward translate
        Animated.parallel([
          Animated.timing(breatheAnim,   { toValue: intensity.scale,    duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breatheTransY, { toValue: intensity.translate, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        // Exhale — 2.2s, scale + translate return
        Animated.parallel([
          Animated.timing(breatheAnim,   { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breatheTransY, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState, isThinking, trustLevel]);

  // ── Micro-drift on front layer ──────────
  useEffect(() => {
    // X: 0→0.4→-0.3→0 over 7000ms
    const loopX = Animated.loop(
      Animated.sequence([
        Animated.timing(driftX, { toValue:  0.4, duration: 2333, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(driftX, { toValue: -0.3, duration: 2333, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(driftX, { toValue:  0,   duration: 2334, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    // Y: 0→-0.3→0.4→0 over 5500ms (different period keeps drift non-repeating)
    const loopY = Animated.loop(
      Animated.sequence([
        Animated.timing(driftY, { toValue: -0.3, duration: 1833, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(driftY, { toValue:  0.4, duration: 1833, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(driftY, { toValue:  0,   duration: 1834, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loopX.start();
    loopY.start();
    return () => { loopX.stop(); loopY.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Nod animation ──────────────────────
  const triggerNod = () => {
    Animated.sequence([
      Animated.timing(nodAnim, {
        toValue: 4,
        duration: 300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(nodAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  };

  // ── Nod on open ────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => triggerNod(), 1800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Nod when speaking → idle ────────────
  useEffect(() => {
    if (prevVoiceState.current === 'speaking' && voiceState === 'idle') {
      const timer = setTimeout(() => triggerNod(), 300);
      prevVoiceState.current = voiceState;
      return () => clearTimeout(timer);
    }
    prevVoiceState.current = voiceState;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState]);

  // ── Glow — voice state + isThinking ───────────────────
  useEffect(() => {
    const isActive = voiceState !== 'idle' || isThinking;
    if (!isActive) {
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start();
      return;
    }
    const speed =
      voiceState === 'speaking'   ? 300 :
      voiceState === 'proactive'  ? 400 :
      voiceState === 'listening'  ? 600 : 1200;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState, isThinking]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState]);

  // Audit follow-up (2026-05-13) — state-ring color now uses
  // colors.accent so light-mode users see the light-mode accent shade
  // instead of the dark-mode-baked '#00C896'. The 'proactive'/'thinking'
  // gold (#F5A623) stays literal — no warning token exists in
  // ThemeTokens yet; add one and switch this when ready.
  const ringColor =
    voiceState === 'proactive'               ? '#F5A623' :
    (voiceState === 'thinking' || isThinking) ? '#F5A623' : themeColors.accent;

  // 2026-05-27 — Fix EM: the 'proactive' label was hardcoded to
  // "Kevin" — visible as "◆ Kevin" on EVERY persona's avatar AND on
  // the user's Personal Caddie portrait (where the face is the user's
  // own stylized photo, not Kevin's). Tim's external-tester screenshot:
  // female Personal Caddie portrait with "Kevin" label = instantly
  // confusing. Now derives from the active persona, and when the user
  // is running a Personal Caddie (customPortraitB64 set), drops the
  // persona name entirely and shows a neutral "Your Caddie" so the
  // name no longer mismatches the visible face.
  const proactiveLabel = customPortraitB64
    ? '◆ Your Caddie'
    : '◆ ' + personaDisplayName(persona);
  const stateText =
    voiceState === 'listening'             ? '● Listening' :
    (voiceState === 'thinking' || isThinking) ? '◌ Thinking'  :
    voiceState === 'speaking'              ? '▶ Speaking'  :
    voiceState === 'proactive'             ? proactiveLabel : '';

  const hudItems = [
    { label: 'HOLE',  value: hud.hole      !== null ? String(hud.hole)      : '—' },
    { label: 'PAR',   value: hud.par       !== null ? String(hud.par)       : '—' },
    { label: 'YARDS', value: hud.yards     !== null ? String(hud.yards)     : '—' },
    { label: 'WIND',  value: hud.wind      ?? '—' },
    { label: 'PLAYS', value: hud.playsLike !== null ? String(hud.playsLike) : '—' },
  ];

  // === LOCKED: Kevin photoreal portrait transforms ===
  // Canonical from commit 19165fb (2026-04-26 12:43 PDT).
  // DO NOT add static scale, translate, or aspect-ratio branches here.
  // Animated values (breath, nod, drift) only.
  // ===================================================
  const backTransform = [
    { scale: breatheAnim },
    { translateY: breatheTransY },
    { translateY: nodAnim },
  ];

  const frontTransform = [
    { scale: breatheAnim },
    { translateY: breatheTransY },
    { translateY: nodAnim },
    { translateX: driftX },
    { translateY: driftY },
  ];

  return (
    <View style={fill === 'cover' ? styles.wrapperFull : styles.wrapper}>

      {/* ── AVATAR FRAME ──────────────── */}
      <TouchableOpacity
        style={fill === 'cover' ? styles.frameFull : [styles.frame, { height: AVATAR_HEIGHT }]}
        onPress={onTap}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Tap to talk to your caddie"
        accessibilityHint="Starts recording. Tap again to stop."
        // Audit follow-up (2026-05-13) — accessibilityState communicates
        // listening / thinking / speaking to screen readers so a
        // VoiceOver / TalkBack user knows the caddie is mid-response
        // without having to wait for audio cues.
        accessibilityState={{
          busy: voiceState === 'listening' || voiceState === 'thinking' || voiceState === 'speaking',
        }}
      >
        {/* Phase AT — Kevin recompose. Source portraits have the subject
            offset right-of-center within the JPG canvas (face occupies
            the right half). With resizeMode='cover' RN center-crops, so
            the visible result is Kevin shifted right with green dead
            space on the left. Shift the image left by ~12% of width
            via translateX so Kevin's face lands at viewport center. */}
        {/* === LOCKED: Kevin photoreal portrait — canonical render ===
            Plain cover-mode crossfade. NO static top/left/transform
            offsets. Composition is controlled entirely by the parent
            container's frame size in caddie.tsx (canonical: full W ×
            W·16/9 anchored top:0 left:0). =========================== */}
        {/* Tank v2 portraits are taller than the frame aspect (Tim's
            authored set has Tank's head near the top of the canvas).
            With resizeMode='cover' the head gets cropped on wide
            frames (Z Fold open). For Tank we use 'contain' so the
            full portrait shows even with letterbox. Other personas
            keep cover-mode (their portraits are pre-fitted to 9:16).
            TODO: re-crop tank_v2_*.png assets to 9:16 to remove this
            override. Until then, contain prevents the head crop. */}
        <Animated.Image
          source={backSource}
          style={[styles.avatarImage, { transform: backTransform, opacity: backOpacity }]}
          resizeMode={resolvedPersona === 'tank' ? 'contain' : fill}
        />

        <Animated.Image
          source={frontSource}
          style={[styles.avatarImage, { transform: frontTransform, opacity: fadeAnim }]}
          resizeMode={resolvedPersona === 'tank' ? 'contain' : fill}
        />

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
        {(voiceState !== 'idle' || isThinking) && (
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
        {(voiceState !== 'idle' || isThinking) && (
          <View style={[styles.stateTag, { top: insets.top + 60 }]}>
            <Text style={[styles.stateTagText, { color: ringColor }]}>
              {stateText}
            </Text>
          </View>
        )}

      </TouchableOpacity>

      {/* ── RESPONSE TEXT ───────────────
          Hidden when the caller renders the text itself (see
          hideInternalText prop) OR when there is nothing to say —
          prevents the same line from showing both overlaid on the
          avatar AND in a separate top card, and stops empty text
          blocks from holding visual real estate. */}
      {fill === 'contain' && !hideInternalText && displayedText !== '' && (
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
    backgroundColor: '#060f09',
  },
  frame: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#060f09',
    paddingTop: 8,
  },
  frameFull: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#060f09',
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
    // Phase BS-followup Issue 1 — clears wordmark + topnav + trial pill
    // band when the avatar is in full-screen cover mode (L4 + pre-round
    // thinking on Fold-open). 2026-05-24 — top moved to inline style as
    // `insets.top + 60` so iPhones with Dynamic Island (~59pt inset)
    // push the badge down accordingly instead of colliding. Z Fold
    // (insets.top ≈ 24) still renders at top ≈ 84 — visual no-op on
    // the reference device.
    position: 'absolute',
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
