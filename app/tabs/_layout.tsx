import { Tabs, useRouter } from 'expo-router';
import { View, Image, StyleSheet, useWindowDimensions } from 'react-native';
import { useEffect, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../../hooks/useTranslation';
import VoiceOverlay from '../../components/VoiceOverlay';
import { useVoiceStore } from '../../store/voiceStore';
import { VoiceController } from '../../services/voice';
import { useRoundStore } from '@/store/roundStore';
import {
  PlayIcon,
  ScorecardIcon,
  SwingLabIcon,
  HistoryIcon,
  RangeIcon,
} from '../../components/icons/IconBase';
import { Palette, Type } from '../../constants/theme';

const LOGO = require('../../assets/images/logo-transparent.png');

const caddieTabIcon = (focused: boolean) => (
  <Image
    source={LOGO}
    style={{ width: 28, height: 28, opacity: focused ? 1 : 0.5 }}
    resizeMode="contain"
  />
);

const tabIcon = (
  IconComponent: React.ComponentType<{ active?: boolean; size?: number }>,
  focused: boolean,
) => <IconComponent active={focused} size={26} />;

const tabIconWithRf = (focused: boolean) => (
  <View style={rfStyles.wrap}>
    <PlayIcon active={focused} size={26} />
    {/* Rangefinder badge */}
    <View style={[rfStyles.badge, { backgroundColor: focused ? Palette.positiveFaint : Palette.border }]}>
      <RangeIcon active={false} size={10} />
    </View>
  </View>
);

const rfStyles = StyleSheet.create({
  wrap:  { width: 32, height: 32 },
  badge: {
    position: 'absolute', bottom: -1, right: -1,
    width: 14, height: 14, borderRadius: 7,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: Palette.brandDeep,
    overflow: 'hidden',
  },
});

export default function TabLayout() {
  const { width } = useWindowDimensions();
  const compactTabs = width < 390;
  const ultraCompactTabs = width < 360;
  const insets = useSafeAreaInsets();
  const tabBarHeight = (compactTabs ? 58 : 62) + insets.bottom;
  const router = useRouter();
  const { t } = useTranslation();

  const voiceState     = useVoiceStore((s) => s.voiceState);
  const caddieResponse = useVoiceStore((s) => s.caddieResponse);
  const setVoiceState  = useVoiceStore((s) => s.setVoiceState);

  const isRoundActive  = useRoundStore((s: any) => s.isRoundActive);
  const prevActiveRef  = useRef(isRoundActive);

  // Phase-driven navigation:
  //  false → true  : round started  → go to Caddie tab
  //  true  → false : round ended    → go to Play tab
  useEffect(() => {
    const prev = prevActiveRef.current;
    if (!prev && isRoundActive) {
      router.replace('/tabs/caddie');
    } else if (prev && !isRoundActive) {
      router.replace('/tabs/play');
    }
    prevActiveRef.current = isRoundActive;
  }, [isRoundActive]);

  const overlayPhase = voiceState === 'SPEAKING'   ? 'speaking'
                     : voiceState === 'LISTENING'  ? 'listening'
                     : voiceState === 'PROCESSING' ? 'processing'
                     : 'listening';

  return (
    <View style={{ flex: 1 }}>
    {/* Global Voice Overlay — driven by voiceStore, shared across all tabs */}
    <VoiceOverlay
      visible={voiceState !== 'IDLE'}
      phase={overlayPhase}
      text={voiceState === 'SPEAKING' ? caddieResponse : undefined}
      onCancel={voiceState === 'LISTENING' ? () => VoiceController.cancel(setVoiceState) : undefined}
    />
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Palette.brandDeep,
          borderTopColor: Palette.border,
          borderTopWidth: 1,
          height: tabBarHeight + 2,
          paddingTop: compactTabs ? 4 : 6,
          paddingBottom: (compactTabs ? 8 : 10) + insets.bottom,
        },
        tabBarActiveTintColor: Palette.positiveFaint,
        tabBarInactiveTintColor: Palette.textMuted,
        tabBarLabelStyle: {
          fontSize: compactTabs ? 10 : Type.xs,
          fontWeight: Type.semibold,
          letterSpacing: compactTabs ? 0 : 0.2,
        },
        tabBarItemStyle: { paddingHorizontal: compactTabs ? 0 : 2 },
        tabBarIconStyle: { marginBottom: 0 },
      }}
    >
      <Tabs.Screen name="caddie"    options={{ title: compactTabs ? 'Caddie' : t('caddie'),    tabBarIcon: ({ focused }) => caddieTabIcon(focused) }} />
      <Tabs.Screen name="play"      options={{ title: compactTabs ? 'Play' : t('play'),      tabBarIcon: ({ focused }) => tabIconWithRf(focused) }} />
      <Tabs.Screen name="scorecard" options={{ title: compactTabs ? 'Score' : t('scorecard'), tabBarIcon: ({ focused }) => tabIcon(ScorecardIcon, focused) }} />
      <Tabs.Screen name="swinglab"  options={{ title: ultraCompactTabs ? 'Swing' : compactTabs ? 'SwingLab' : t('swingLab'),  tabBarIcon: ({ focused }) => tabIcon(SwingLabIcon, focused) }} />
      <Tabs.Screen name="history"        options={{ href: null }} />
      <Tabs.Screen name="dashboard" options={{ title: compactTabs ? 'Dash' : t('dashboard'), tabBarIcon: ({ focused }) => tabIcon(HistoryIcon, focused) }} />
    </Tabs>
    </View>
  );
}