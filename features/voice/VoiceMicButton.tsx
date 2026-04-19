/**
 * VoiceMicButton — tap-to-talk microphone button.
 *
 * Shows a mic icon that pulses/changes colour while listening.
 * Pressing while listening stops the session; pressing while idle starts it.
 *
 * Props:
 *   listening   — true while the mic is active
 *   onPress     — toggle callback (useVoiceController.toggle)
 *   transcript  — optional live transcript to display below button
 *   size        — button diameter in pixels (default 52)
 *   style       — extra ViewStyle applied to the outer container
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

interface VoiceMicButtonProps {
  listening:   boolean;
  onPress:     () => void;
  transcript?: string;
  size?:       number;
  style?:      ViewStyle;
}

export function VoiceMicButton({
  listening,
  onPress,
  transcript,
  size = 52,
  style,
}: VoiceMicButtonProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef  = useRef<Animated.CompositeAnimation | null>(null);

  // Pulse ring while listening
  useEffect(() => {
    if (listening) {
      pulseRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.35, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0,  duration: 600, useNativeDriver: true }),
        ]),
      );
      pulseRef.current.start();
    } else {
      pulseRef.current?.stop();
      Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    }
  }, [listening, pulseAnim]);

  const bg     = listening ? '#16a34a' : 'rgba(20,40,20,0.82)';
  const border = listening ? '#4ade80' : '#1a3a1a';
  const iconColor = listening ? '#fff' : '#4ade80';

  return (
    <View style={[styles.wrapper, style]}>
      {/* Pulse ring — only visible while listening */}
      {listening && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pulseRing,
            { width: size + 20, height: size + 20, borderRadius: (size + 20) / 2 },
            { transform: [{ scale: pulseAnim }] },
          ]}
        />
      )}

      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, borderColor: border },
          pressed && { opacity: 0.75 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Stop listening' : 'Start voice command'}
      >
        <MaterialCommunityIcons
          name={listening ? 'microphone' : 'microphone-outline'}
          size={size * 0.48}
          color={iconColor}
        />
      </Pressable>

      {/* "Listening…" label / partial transcript */}
      {listening && (
        <View style={styles.labelBox}>
          <Text style={styles.labelText} numberOfLines={2}>
            {transcript?.trim() ? transcript : 'Listening…'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  pulseRing: {
    position: 'absolute',
    backgroundColor: 'rgba(74,222,128,0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(74,222,128,0.4)',
  },
  labelBox: {
    marginTop: 6,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 160,
  },
  labelText: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
});
