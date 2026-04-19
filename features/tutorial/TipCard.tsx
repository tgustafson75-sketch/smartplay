/**
 * TipCard — non-blocking contextual tip bubble.
 *
 * Floats above content at bottom of screen, fades in/out, never blocks touch.
 * Dismissible with "Got it" or auto-dismisses after `autoDismissMs` (default 7s).
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

interface TipCardProps {
  text: string;
  onDismiss: () => void;
  /** Auto-dismiss after N ms. 0 = no auto-dismiss. Default: 7000 */
  autoDismissMs?: number;
  /** Vertical offset from bottom. Default: 120 */
  bottomOffset?: number;
}

const TipCard: React.FC<TipCardProps> = ({
  text,
  onDismiss,
  autoDismissMs = 7000,
  bottomOffset = 120,
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fade in on mount
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();

    if (autoDismissMs > 0) {
      timerRef.current = setTimeout(() => handleDismiss(), autoDismissMs);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDismiss = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    Animated.timing(opacity, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(onDismiss);
  };

  return (
    <Animated.View
      style={[styles.card, { bottom: bottomOffset, opacity }]}
      pointerEvents="box-none"
    >
      {/* Icon + text row */}
      <View style={styles.row}>
        <Text style={styles.icon}>💡</Text>
        <Text style={styles.text}>{text}</Text>
      </View>

      {/* Dismiss */}
      <Pressable onPress={handleDismiss} hitSlop={10} style={styles.dismissBtn}>
        <Text style={styles.dismissTxt}>Got it</Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 18,
    right: 18,
    backgroundColor: 'rgba(10, 10, 10, 0.88)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.25)',
    // Shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  icon: {
    fontSize: 16,
    lineHeight: 22,
  },
  text: {
    flex: 1,
    color: '#f0f0f0',
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  dismissBtn: {
    marginTop: 8,
    alignSelf: 'flex-end',
  },
  dismissTxt: {
    color: '#4ADE80',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export default TipCard;
