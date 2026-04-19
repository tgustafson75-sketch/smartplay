/**
 * SmartHint — non-intrusive contextual hint strip.
 *
 * Appears as a small fade-in pill near the mic button.
 * Auto-dismisses after 3 s. Never blocks interaction (pointerEvents: 'none').
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

interface SmartHintProps {
  /** The hint text to display. Pass null/undefined to hide. */
  hint: string | null;
}

export default function SmartHint({ hint }: SmartHintProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (hint) {
      // Fade in quickly
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    } else {
      // Fade out
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [hint]);

  // Keep in layout even when invisible so there's no layout shift
  return (
    <Animated.View style={[styles.pill, { opacity }]} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1}>
        {hint ?? ''}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 61, 46, 0.82)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 6,
    maxWidth: 280,
  },
  text: {
    color: '#B8EAD4',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
});
