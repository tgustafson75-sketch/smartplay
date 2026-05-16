/**
 * Global toast view — renders the message held by toastStore. Auto-
 * dismisses after 1.5s. Mounted once at app/_layout.tsx so any surface
 * can flash a short confirmation message.
 *
 * Designed for non-blocking confirmations (mode change, copy-to-
 * clipboard, etc.) — NOT for errors that require user acknowledgment.
 * Use Alert.alert for those.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore } from '../../store/toastStore';

const TOAST_DURATION_MS = 1500;
const FADE_MS = 180;

export function GlobalToast() {
  const insets = useSafeAreaInsets();
  const message = useToastStore((s) => s.message);
  const seq = useToastStore((s) => s.seq);
  const clear = useToastStore((s) => s.clear);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;

  useEffect(() => {
    if (!message) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: FADE_MS, useNativeDriver: true }),
    ]).start();

    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -8, duration: FADE_MS, useNativeDriver: true }),
      ]).start(() => clear());
    }, TOAST_DURATION_MS);

    return () => clearTimeout(t);
    // seq triggers re-fire when consecutive identical messages come in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, seq]);

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          top: insets.top + 8,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

export default GlobalToast;

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 24,
  },
  text: {
    backgroundColor: 'rgba(0, 200, 150, 0.95)',
    color: '#0d1a0d',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: 'hidden',
    shadowColor: '#00C896',
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
});
