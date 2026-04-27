import React, { useEffect } from 'react';
import { TouchableOpacity, Image, View, StyleSheet } from 'react-native';
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

  const handlePress = () => {
    onTap?.();
    handleMicPress();
  };

  return (
    <View style={[styles.container, { top: insets.top + 12 }]}>
      <Animated.View style={[styles.glow, glowStyle]} />
      <TouchableOpacity
        style={styles.badge}
        onPress={handlePress}
        onLongPress={onLongPress}
        delayLongPress={600}
        activeOpacity={0.85}
      >
        <Image source={BADGE} style={styles.image} resizeMode="contain" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
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
    width: 48,
    height: 48,
  },
});
