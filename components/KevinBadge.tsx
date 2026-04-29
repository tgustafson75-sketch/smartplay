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
  }, [isThinking, isSpeaking]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const isOnCaddie = pathname === '/(tabs)/caddie';

  const handlePress = () => {
    onTap?.();
    handleMicPress();
  };

  const handleGoToCaddie = () => {
    onLongPress?.();
    router.push('/(tabs)/caddie' as never);
  };

  return (
    <View style={[styles.container, { top: insets.top + 12 }]}>
      <Animated.View style={[styles.glow, glowStyle]} />
      <TouchableOpacity
        style={styles.badge}
        onPress={handlePress}
        activeOpacity={0.85}
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
