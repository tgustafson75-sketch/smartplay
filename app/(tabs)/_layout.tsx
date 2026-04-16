import { Tabs } from 'expo-router';
import { Image, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import VoiceOverlay from '../../components/VoiceOverlay';
import { useVoiceStore } from '../../store/voiceStore';
import { VoiceController } from '../../services/VoiceController';

const ICON_CADDIE      = require('../../assets/images/logo-transparent.png');
const ICON_PLAY        = require('../../assets/images/icon-clubs-badge.png');
const ICON_PRACTICE    = require('../../assets/images/icon-golf-bag.png');
const ICON_SCORECARD   = require('../../assets/images/icon-golf-1.png');
const ICON_HISTORY     = require('../../assets/images/icon-golf-4.png');
const ICON_RANGEFINDER = require('../../assets/images/icon-rangefinder.png');

const tabIcon = (src: number, focused: boolean) => (
  <Image
    source={src}
    style={{ width: 26, height: 26, opacity: focused ? 1 : 0.45 }}
    resizeMode="contain"
  />
);

const tabIconWithRf = (src: number, focused: boolean) => (
  <View style={rfStyles.wrap}>
    <Image
      source={src}
      style={[rfStyles.main, { opacity: focused ? 1 : 0.45 }]}
      resizeMode="contain"
    />
    {/* Rangefinder badge — solid circle so it's always visible */}
    <View style={[rfStyles.badge, { backgroundColor: focused ? '#A7F3D0' : '#2e5a40' }]}>
      <Image
        source={ICON_RANGEFINDER}
        style={rfStyles.badgeIcon}
        resizeMode="contain"
      />
    </View>
  </View>
);

const rfStyles = StyleSheet.create({
  wrap:      { width: 32, height: 32 },
  main:      { width: 26, height: 26 },
  badge:     {
    position: 'absolute', bottom: -1, right: -1,
    width: 14, height: 14, borderRadius: 7,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#0B3D2E',
  },
  badgeIcon: { width: 10, height: 10, tintColor: '#0B3D2E' },
});

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 62 + insets.bottom;

  const voiceState    = useVoiceStore((s) => s.voiceState);
  const caddieResponse = useVoiceStore((s) => s.caddieResponse);
  const setVoiceState  = useVoiceStore((s) => s.setVoiceState);

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
      }}
    >
      <Tabs.Screen name="caddie"    options={{ title: 'Caddie',    tabBarIcon: ({ focused }) => tabIcon(ICON_CADDIE,    focused) }} />
      <Tabs.Screen name="play"      options={{ title: 'Play',      tabBarIcon: ({ focused }) => tabIconWithRf(ICON_PLAY,      focused) }} />
      <Tabs.Screen name="scorecard" options={{ title: 'Scorecard', tabBarIcon: ({ focused }) => tabIcon(ICON_SCORECARD, focused) }} />
      <Tabs.Screen name="practice"  options={{ title: 'Practice',  tabBarIcon: ({ focused }) => tabIcon(ICON_PRACTICE,  focused) }} />
      <Tabs.Screen name="history"   options={{ title: 'Dashboard', tabBarIcon: ({ focused }) => tabIcon(ICON_HISTORY,   focused) }} />
      <Tabs.Screen name="dashboard" options={{ href: null }} />
    </Tabs>
    </View>
  );
}