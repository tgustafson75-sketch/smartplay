/**
 * VoiceOverlay — shared fullscreen listening/thinking/speaking overlay.
 *
 * States:
 *   listening  → green pulsing ring  → "Listening..."
 *   processing → green steady ring   → "Processing..."
 *   thinking   → blue steady ring    → "Thinking..."
 *   speaking   → yellow pulsing ring → "Speaking..." + optional text card
 *
 * Usage:
 *   <VoiceOverlay
 *     visible={listening || isThinking || isSpeaking}
 *     phase={isSpeaking ? 'speaking' : isThinking ? 'thinking' : listeningPhase}
 *     text={isSpeaking ? caddieMessage : undefined}
 *     onCancel={listening ? stopListening : undefined}
 *   />
 */

import React, { useRef, useEffect } from 'react';
import { View, Text, Pressable, Image, Animated, StyleSheet } from 'react-native';

const LOGO = require('../assets/images/logo.png');

export type VoicePhase = 'listening' | 'processing' | 'thinking' | 'speaking';

interface VoiceOverlayProps {
  visible: boolean;
  phase: VoicePhase;
  /** Text to display in the card below the logo while speaking. */
  text?: string;
  /** If provided, a Cancel button appears (only relevant during listening phase). */
  onCancel?: () => void;
}

const RING_COLORS: Record<VoicePhase, string> = {
  listening:  '#4ade80',
  processing: '#4ade80',
  thinking:   '#60a5fa',
  speaking:   '#facc15',
};

const STATUS_LABELS: Record<VoicePhase, string> = {
  listening:  '🎤 Listening...',
  processing: 'Processing...',
  thinking:   'Thinking...',
  speaking:   '🎙️ Speaking...',
};

export default function VoiceOverlay({ visible, phase, text, onCancel }: VoiceOverlayProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const loopRef   = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!visible) {
      if (loopRef.current) loopRef.current.stop();
      Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      return;
    }

    if (loopRef.current) loopRef.current.stop();
    pulseAnim.setValue(1);

    if (phase === 'listening') {
      // Slow breathe — 600ms per half-cycle
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.18, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0,  duration: 600, useNativeDriver: true }),
        ]),
      );
    } else if (phase === 'speaking') {
      // Fast stutter — mimics speech cadence
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 200, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.96, duration: 200, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 180, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0,  duration: 220, useNativeDriver: true }),
        ]),
      );
    } else {
      // processing / thinking — steady (no scale animation)
      pulseAnim.setValue(1);
    }

    loopRef.current?.start();

    return () => {
      loopRef.current?.stop();
    };
  }, [visible, phase]);

  if (!visible) return null;

  const ringColor = RING_COLORS[phase];
  const label     = STATUS_LABELS[phase];
  const isAnimating = phase === 'listening' || phase === 'speaking';

  return (
    <View style={styles.overlay}>
      {/* Halo ring */}
      <View style={[styles.halo, { borderColor: ringColor, shadowColor: ringColor }]}>
        <Animated.View style={isAnimating ? { transform: [{ scale: pulseAnim }] } : undefined}>
          <Image source={LOGO} style={styles.logo} resizeMode="cover" />
        </Animated.View>
      </View>

      {/* Status label */}
      <Text style={[styles.label, { color: ringColor }]}>{label}</Text>

      {/* Text card (visible during speaking) */}
      {text ? (
        <View style={[styles.textCard, { borderColor: ringColor }]}>
          <Text style={styles.textCardContent}>{text}</Text>
        </View>
      ) : null}

      {/* Cancel button (visible during listening only) */}
      {onCancel ? (
        <Pressable onPress={onCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.93)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
    paddingHorizontal: 28,
  },
  halo: {
    borderRadius: 999,
    padding: 6,
    borderWidth: 3,
    shadowOpacity: 0.95,
    shadowRadius: 32,
    elevation: 16,
  },
  logo: {
    width: 110,
    height: 110,
    borderRadius: 999,
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 22,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  textCard: {
    marginTop: 18,
    backgroundColor: 'rgba(20,83,45,0.88)',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    maxWidth: 340,
  },
  textCardContent: {
    color: '#A7F3D0',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  cancelBtn: {
    marginTop: 32,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  cancelLabel: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '600',
  },
});
