/**
 * ShotCorrectionPrompt — 3-second auto-hide correction card.
 *
 * Shows after a shot is recorded. Lets the user quickly adjust:
 *   • Distance offset  (-20 / -10 / 0 / +10 / +20 yards)
 *   • Direction offset (Left / Center / Right)
 *
 * Calls onCorrect({ distanceOffset, directionOffset }) immediately on tap.
 * Auto-hides after 3 seconds of no interaction.
 * Pressing any button resets the 3-second timer.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';

interface Correction {
  distanceOffset: number;
  directionOffset: 'left' | 'center' | 'right';
}

interface Props {
  visible: boolean;
  onCorrect: (c: Correction) => void;
  onDismiss: () => void;
}

const DISTANCE_STEPS = [-20, -10, 0, +10, +20];
const DIRECTIONS: Array<{ key: 'left' | 'center' | 'right'; label: string }> = [
  { key: 'left',   label: '← Left'   },
  { key: 'center', label: 'Center'   },
  { key: 'right',  label: 'Right →'  },
];

const AUTO_HIDE_MS = 3000;

export default function ShotCorrectionPrompt({ visible, onCorrect, onDismiss }: Props) {
  const [distOffset,  setDistOffset]  = useState(0);
  const [dirOffset,   setDirOffset]   = useState<'left' | 'center' | 'right'>('center');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Fade in/out
  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      resetTimer();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      clearTimer();
    }
    return clearTimer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const resetTimer = () => {
    clearTimer();
    timerRef.current = setTimeout(onDismiss, AUTO_HIDE_MS);
  };

  const handleDist = (offset: number) => {
    setDistOffset(offset);
    onCorrect({ distanceOffset: offset, directionOffset: dirOffset });
    resetTimer();
  };

  const handleDir = (dir: 'left' | 'center' | 'right') => {
    setDirOffset(dir);
    onCorrect({ distanceOffset: distOffset, directionOffset: dir });
    resetTimer();
  };

  if (!visible) return null;

  return (
    <Animated.View style={[s.container, { opacity: fadeAnim }]}>
      <View style={s.header}>
        <Text style={s.title}>Adjust location?</Text>
        <Pressable onPress={onDismiss} style={s.dismissBtn}>
          <Text style={s.dismissText}>✕</Text>
        </Pressable>
      </View>

      {/* Distance row */}
      <View style={s.row}>
        {DISTANCE_STEPS.map((step) => {
          const active = distOffset === step;
          const label = step === 0 ? 'ON' : step > 0 ? `+${step}` : `${step}`;
          return (
            <Pressable
              key={step}
              style={[s.chip, active && s.chipActive]}
              onPress={() => handleDist(step)}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Direction row */}
      <View style={s.row}>
        {DIRECTIONS.map(({ key, label }) => {
          const active = dirOffset === key;
          return (
            <Pressable
              key={key}
              style={[s.dirChip, active && s.dirChipActive]}
              onPress={() => handleDir(key)}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#0f2218',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#2d5a3e',
    padding: 14,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { color: '#A7F3D0', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  dismissBtn: { padding: 4 },
  dismissText: { color: '#4a7c5e', fontSize: 16 },
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1.5,
    borderColor: '#2d5a3e', backgroundColor: '#122019',
    minWidth: 44, alignItems: 'center',
  },
  chipActive: { backgroundColor: '#16a34a33', borderColor: '#4ade80' },
  dirChip: {
    flex: 1, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1.5,
    borderColor: '#2d5a3e', backgroundColor: '#122019',
    alignItems: 'center',
  },
  dirChipActive: { backgroundColor: '#16a34a33', borderColor: '#4ade80' },
  chipText: { color: '#6b9e7a', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#4ade80', fontWeight: '700' },
});
