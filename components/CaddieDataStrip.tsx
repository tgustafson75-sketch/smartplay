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
  bottomOffset?: number;
  stripLayout?: 'horizontal' | 'grid';
  onPress: () => void;
}

export default function CaddieDataStrip({
  yardage,
  playsLike,
  hole,
  targetDirection,
  stroke,
  visible,
  bottomOffset = 0,
  stripLayout = 'horizontal',
  onPress,
}: CaddieDataStripProps) {
  const mountedOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [isMounted, setIsMounted] = useState(visible);
  const pressScale = useRef(new Animated.Value(1)).current;

  // Dot pulse anims — one per separator (4 dots for horizontal, 2 for grid)
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

  // ── GRID LAYOUT (WIDE mode) ──────────────
  if (stripLayout === 'grid') {
    const row1 = [
      { label: 'HOLE',  value: `${hole.current}/${hole.total}`, dotIdx: 0 },
      { label: 'YARDS', value: yardage   != null ? String(yardage)   : '—', dotIdx: 1 },
      { label: 'PLAYS', value: playsLike != null ? String(playsLike) : '—', dotIdx: null },
    ];
    const row2 = [
      { label: 'TARGET', value: targetDirection, dotIdx: 2 },
      { label: 'STROKE', value: String(stroke),  dotIdx: null },
      null,
    ];

    return (
      <Animated.View
        style={[
          styles.wrapperGrid,
          { opacity: mountedOpacity, transform: [{ scale: pressScale }] },
        ]}
      >
        <Pressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={styles.pressable}
        >
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.tintOverlay]} />

          <View style={styles.gridRow}>
            {row1.map((c, i) => (
              <React.Fragment key={c.label}>
                <View style={styles.gridCell}>
                  <Text style={styles.cellLabel}>{c.label}</Text>
                  <Text style={[styles.cellValue, { fontSize: 16 }]}>{c.value}</Text>
                </View>
                {c.dotIdx !== null && (
                  <Animated.View style={[styles.dot, { opacity: dotAnims[c.dotIdx] }]} />
                )}
              </React.Fragment>
            ))}
          </View>

          <View style={[styles.gridRow, styles.gridRowBorder]}>
            {row2.map((c, i) =>
              c === null ? (
                <View key={i} style={styles.gridCell} />
              ) : (
                <React.Fragment key={c.label}>
                  <View style={styles.gridCell}>
                    <Text style={styles.cellLabel}>{c.label}</Text>
                    <Text style={[styles.cellValue, { fontSize: c.label === 'TARGET' ? 12 : 16 }]}>
                      {c.value}
                    </Text>
                  </View>
                  {c.dotIdx !== null && (
                    <Animated.View style={[styles.dot, { opacity: dotAnims[c.dotIdx] }]} />
                  )}
                </React.Fragment>
              )
            )}
          </View>

          <Ionicons
            name="chevron-up"
            size={11}
            color="rgba(107, 125, 114, 0.5)"
            style={styles.chevronHintGrid}
          />
        </Pressable>
      </Animated.View>
    );
  }

  // ── HORIZONTAL LAYOUT (portrait, default) ─
  const cells = [
    { label: 'HOLE',   value: `${hole.current}/${hole.total}`,      fontSize: 15 },
    { label: 'YARDS',  value: yardage   != null ? String(yardage)   : '—', fontSize: 15 },
    { label: 'PLAYS',  value: playsLike != null ? String(playsLike) : '—', fontSize: 15 },
    { label: 'TARGET', value: targetDirection,                        fontSize: 11 },
    { label: 'STROKE', value: String(stroke),                         fontSize: 15 },
  ];

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { bottom: 32 + bottomOffset, opacity: mountedOpacity, transform: [{ scale: pressScale }] },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.pressable}
      >
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.tintOverlay]} />

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
                <Animated.View style={[styles.dot, { opacity: dotAnims[i] }]} />
              )}
            </React.Fragment>
          ))}

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
  // ── Horizontal (portrait) wrapper ────────
  wrapper: {
    position: 'absolute',
    bottom: 32,
    left: 8,
    right: 8,
    height: 84,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 40, 0.5)',
    overflow: 'hidden',
    zIndex: 5,
  },
  // ── Grid (wide) wrapper ──────────────────
  wrapperGrid: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 40, 0.5)',
    overflow: 'hidden',
  },
  pressable: {
    flex: 1,
  },
  tintOverlay: {
    backgroundColor: 'rgba(13, 26, 13, 0.5)',
    borderRadius: 16,
  },
  // ── Horizontal row ───────────────────────
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Grid rows ────────────────────────────
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  gridRowBorder: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(30, 58, 40, 0.4)',
  },
  gridCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Shared cell text ─────────────────────
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
  chevronHintGrid: {
    position: 'absolute',
    right: 12,
    top: 10,
  },
});
