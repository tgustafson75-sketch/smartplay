// 2026-06-29 (Tim) — REVIEW SCRUBBER. A time-point seek bar for swing playback:
// tap or drag anywhere on the track to scrub to that moment, with the detected
// swing phases (Address / Top / Impact / Finish) shown as ticks so you can scrub
// BY time point. Self-contained (own PanResponder + layout) so it stays isolated
// from the main SmartMotion screen. Brand neon-green fill (#88F700).
import React, { useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';

export type ScrubMoment = { ms: number; label: string };

type Props = {
  positionMs: number;
  durationMs: number;
  moments?: ScrubMoment[];
  onSeek: (ms: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
};

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function ReviewScrubber({ positionMs, durationMs, moments = [], onSeek, onScrubStart, onScrubEnd }: Props) {
  const [width, setWidth] = useState(0);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const widthRef = useRef(0);

  const pos = scrubMs ?? positionMs;
  const pct = durationMs > 0 ? Math.max(0, Math.min(1, pos / durationMs)) : 0;

  const msFromX = (x: number) => {
    const w = widthRef.current;
    if (w <= 0 || durationMs <= 0) return 0;
    return Math.max(0, Math.min(durationMs, (x / w) * durationMs));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        onScrubStart?.();
        const ms = msFromX(e.nativeEvent.locationX);
        setScrubMs(ms);
        onSeek(ms);
      },
      onPanResponderMove: (e) => {
        const ms = msFromX(e.nativeEvent.locationX);
        setScrubMs(ms);
        onSeek(ms);
      },
      onPanResponderRelease: () => {
        setScrubMs(null);
        onScrubEnd?.();
      },
      onPanResponderTerminate: () => {
        setScrubMs(null);
        onScrubEnd?.();
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  return (
    <View style={styles.row}>
      <Text style={styles.time}>{fmt(pos)}</Text>
      <View style={styles.barArea} onLayout={onLayout} {...panResponder.panHandlers}>
        <View style={styles.track} />
        <View style={[styles.fill, { width: pct * width }]} />
        {moments.map((m, i) => {
          const mp = durationMs > 0 ? Math.max(0, Math.min(1, m.ms / durationMs)) : 0;
          return <View key={`${m.label}-${i}`} style={[styles.tick, { left: mp * width }]} />;
        })}
        <View style={[styles.thumb, { left: pct * width - 7 }]} />
      </View>
      <Text style={styles.time}>{fmt(durationMs)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  barArea: { flex: 1, height: 24, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  fill: { position: 'absolute', top: 10, height: 4, borderRadius: 2, backgroundColor: '#88F700' },
  tick: { position: 'absolute', top: 7, width: 2, height: 10, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.6)' },
  thumb: { position: 'absolute', top: 5, width: 14, height: 14, borderRadius: 7, backgroundColor: '#88F700', borderWidth: 2, borderColor: '#06140b' },
});
