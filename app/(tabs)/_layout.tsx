import { Tabs, useRouter } from 'expo-router';
import { View, Image, StyleSheet } from 'react-native';
import { useEffect, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import VoiceOverlay from '../../components/VoiceOverlay';
import { useVoiceStore } from '../../store/voiceStore';
import { VoiceController } from '../../services/VoiceController';
import { useRoundStore } from '../../store/roundStore';
import {
  PlayIcon,
  ScorecardIcon,
  PracticeIcon,
  HistoryIcon,
  RangeIcon,
} from '../../components/icons/IconBase';

const LOGO = require('../../assets/images/logo-transparent.png');

const caddieTabIcon = (focused: boolean) => (
  <Image
    source={LOGO}
    style={{ width: 28, height: 28, opacity: focused ? 1 : 0.45 }}
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
    <View style={[rfStyles.badge, { backgroundColor: focused ? '#A7F3D0' : '#2e5a40' }]}>
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
    borderWidth: 1, borderColor: '#0B3D2E',
    overflow: 'hidden',
  },
});

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 62 + insets.bottom;
  const router = useRouter();

  const voiceState     = useVoiceStore((s) => s.voiceState);
  const caddieResponse = useVoiceStore((s) => s.caddieResponse);
  const setVoiceState  = useVoiceStore((s) => s.setVoiceState);

  const isRoundActive  = useRoundStore((s) => s.isRoundActive);
  const prevActiveRef  = useRef(isRoundActive);

  // Phase-driven navigation:
  //  false → true  : round started  → go to Caddie tab
  //  true  → false : round ended    → go to Play tab
  useEffect(() => {
    const prev = prevActiveRef.current;
    if (!prev && isRoundActive) {
      router.replace('/(tabs)/caddie');
    } else if (prev && !isRoundActive) {
      router.replace('/(tabs)/play');
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
          backgroundColor: '#0B3D2E',
          borderTopColor: '#1a5e30',
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarActiveTintColor: '#A7F3D0',
        tabBarInactiveTintColor: '#4a7c5e',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarItemStyle: { paddingHorizontal: 0 },
        tabBarIconStyle: { marginBottom: -2 },
      }}
    >
      <Tabs.Screen name="caddie"    options={{ title: 'Caddie',    tabBarIcon: ({ focused }) => caddieTabIcon(focused) }} />
      <Tabs.Screen name="play"      options={{ title: 'Play',      tabBarIcon: ({ focused }) => tabIconWithRf(focused) }} />
      <Tabs.Screen name="scorecard" options={{ title: 'Scorecard', tabBarIcon: ({ focused }) => tabIcon(ScorecardIcon, focused) }} />
      <Tabs.Screen name="practice"  options={{ title: 'Practice',  tabBarIcon: ({ focused }) => tabIcon(PracticeIcon, focused) }} />
      <Tabs.Screen name="history"   options={{ title: 'Dashboard', tabBarIcon: ({ focused }) => tabIcon(HistoryIcon, focused) }} />
      <Tabs.Screen name="dashboard"      options={{ href: null }} />
      <Tabs.Screen name="dev"            options={{ href: null }} />
    </Tabs>
    </View>
  );
}