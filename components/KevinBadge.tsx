import React, { useEffect } from 'react';
import { TouchableOpacity, Image, View, StyleSheet, Text } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { useKevinPresence } from '../contexts/KevinPresenceContext';
import { useVoiceCaddie } from '../hooks/useVoiceCaddie';
// 2026-06-04 — Lock during in-flight session. Subscribe to the
// listening-session store for reactive re-renders; call the getter
// at render time for the live flag value. Mirrors CaddieMicBadge's
// dim behavior so both tap surfaces honor the same lock.
import { isSessionInFlight } from '../services/listeningSession';
import { useListeningSessionStore } from '../store/listeningSessionStore';

const BADGE = require('../assets/avatars/smartplay_caddie_badge.png');

interface KevinBadgeProps {
  onTap?: () => void;
  onLongPress?: () => void;
}

export default function KevinBadge({ onTap, onLongPress }: KevinBadgeProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { isThinking, isSpeaking, setIsThinking } = useKevinPresence();
  // 2026-06-04 — Subscribe to listening-session state so this badge
  // re-renders when the lock state changes. The getter is the source
  // of truth; the subscription just forces React to look at it again.
  useListeningSessionStore((s) => s.state);
  const isLocked = isSessionInFlight();

  const glowOpacity = useSharedValue(0);

  const { handleMicPress } = useVoiceCaddie({
    onVoiceStateChange: (state) => {
      setIsThinking(state === 'thinking' || state === 'listening');
    },
    onResponseReceived: () => {},
  });

  useEffect(() => {
    if (isThinking) {
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      );
    } else if (isSpeaking) {
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: 600, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 600, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      );
    } else {
      cancelAnimation(glowOpacity);
      glowOpacity.value = withTiming(0, { duration: 300 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThinking, isSpeaking]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const isOnCaddie = pathname === '/(tabs)/caddie';

  const handlePress = () => {
    if (isLocked) return;
    onTap?.();
    handleMicPress();
  };

  const handleGoToCaddie = () => {
    onLongPress?.();
    router.push('/(tabs)/caddie' as never);
  };

  return (
    <View style={[styles.container, { top: insets.top + 12, opacity: isLocked ? 0.4 : 1 }]}>
      <Animated.View style={[styles.glow, glowStyle]} />
      <TouchableOpacity
        style={styles.badge}
        onPress={handlePress}
        activeOpacity={0.85}
        disabled={isLocked}
      >
        <Image source={BADGE} style={styles.image} resizeMode="contain" />
      </TouchableOpacity>
      {!isOnCaddie && (
        <TouchableOpacity
          style={styles.navChip}
          onPress={handleGoToCaddie}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.navChipText}>›</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    zIndex: 100,
    width: 60,
    height: 60,
  },
  glow: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#00C896',
    backgroundColor: 'transparent',
  },
  badge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(6,15,9,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.35)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: 40,
    height: 40,
  },
  navChip: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#00C896',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navChipText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 17,
    marginTop: -1,
  },
});
