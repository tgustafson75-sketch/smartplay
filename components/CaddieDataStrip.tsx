import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

export interface CaddieDataStripProps {
  yardage: number | null;
  playsLike: number | null;
  hole: { current: number; total: number };
  targetDirection: string;
  stroke: number;
  visible: boolean;
  onPress: () => void;
}

export default function CaddieDataStrip({
  yardage,
  playsLike,
  hole,
  targetDirection,
  stroke,
  visible,
  onPress,
}: CaddieDataStripProps) {
  const mountedOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [isMounted, setIsMounted] = useState(visible);
  const pressScale = useRef(new Animated.Value(1)).current;

  // Dot pulse anims — one per separator (4 dots)
  const dotAnims = useRef([
    new Animated.Value(0.7),
    new Animated.Value(0.7),
    new Animated.Value(0.7),
    new Animated.Value(0.7),
  ]).current;

  // Prev values for change-detect pulses
  const prevYardage   = useRef(yardage);
  const prevPlaysLike = useRef(playsLike);
  const prevHole      = useRef(hole.current);
  const prevStroke    = useRef(stroke);

  // ── Visibility animation ─────────────────
  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      Animated.timing(mountedOpacity, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(mountedOpacity, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => setIsMounted(false));
    }
  }, [visible]);

  // ── Idle dot pulse loop ──────────────────
  useEffect(() => {
    const loops = dotAnims.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(anim, {
            toValue: 0.9,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.4,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      )
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, []);

  // ── Flash a dot when value changes ──────
  const flashDot = (anim: Animated.Value) => {
    Animated.sequence([
      Animated.timing(anim, { toValue: 1.0, duration: 180, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0.7, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  useEffect(() => {
    if (yardage !== prevYardage.current) { flashDot(dotAnims[1]); prevYardage.current = yardage; }
  }, [yardage]);

  useEffect(() => {
    if (playsLike !== prevPlaysLike.current) { flashDot(dotAnims[2]); prevPlaysLike.current = playsLike; }
  }, [playsLike]);

  useEffect(() => {
    if (hole.current !== prevHole.current) { flashDot(dotAnims[0]); prevHole.current = hole.current; }
  }, [hole.current]);

  useEffect(() => {
    if (stroke !== prevStroke.current) { flashDot(dotAnims[3]); prevStroke.current = stroke; }
  }, [stroke]);

  // ── Press scale animation ────────────────
  const handlePressIn = () => {
    Animated.timing(pressScale, {
      toValue: 0.98,
      duration: 80,
      useNativeDriver: true,
    }).start();
  };
  const handlePressOut = () => {
    Animated.timing(pressScale, {
      toValue: 1.0,
      duration: 100,
      useNativeDriver: true,
    }).start();
  };

  if (!isMounted) return null;

  const cells = [
    { label: 'HOLE',   value: `${hole.current}/${hole.total}`,      fontSize: 17 },
    { label: 'YARDS',  value: yardage   != null ? String(yardage)   : '—', fontSize: 17 },
    { label: 'PLAYS',  value: playsLike != null ? String(playsLike) : '—', fontSize: 17 },
    { label: 'TARGET', value: targetDirection,                        fontSize: 13 },
    { label: 'STROKE', value: String(stroke),                         fontSize: 17 },
  ];

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { opacity: mountedOpacity, transform: [{ scale: pressScale }] },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.pressable}
      >
        {/* Blur layer */}
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />

        {/* Green-tint overlay */}
        <View style={[StyleSheet.absoluteFill, styles.tintOverlay]} />

        {/* Content row */}
        <View style={styles.row}>
          {cells.map((cell, i) => (
            <React.Fragment key={cell.label}>
              <View style={styles.cell}>
                <Text style={styles.cellLabel}>{cell.label}</Text>
                <Text style={[styles.cellValue, { fontSize: cell.fontSize }]}>
                  {cell.value}
                </Text>
              </View>
              {i < cells.length - 1 && (
                <Animated.View
                  style={[styles.dot, { opacity: dotAnims[i] }]}
                />
              )}
            </React.Fragment>
          ))}

          {/* Tap affordance */}
          <Ionicons
            name="chevron-up"
            size={12}
            color="rgba(107, 125, 114, 0.5)"
            style={styles.chevronHint}
          />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 40, 0.5)',
    overflow: 'hidden',
    zIndex: 5,
  },
  pressable: {
    flex: 1,
  },
  tintOverlay: {
    backgroundColor: 'rgba(13, 26, 13, 0.5)',
    borderRadius: 38,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellLabel: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.2,
    color: 'rgba(107, 125, 114, 0.9)',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  cellValue: {
    fontWeight: '700',
    letterSpacing: -0.5,
    color: '#ffffff',
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#00C896',
  },
  chevronHint: {
    position: 'absolute',
    right: 16,
    top: '50%',
    marginTop: -6,
  },
});
