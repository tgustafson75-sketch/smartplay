/**
 * 2026-05-23 — Pose source status chip.
 *
 * Renders a small inline badge that reflects the most recent
 * estimatePose() call's backend + confidence. Three states:
 *   - On-device • Nms        (lime — MediaPipe path produced a frame)
 *   - Cloud • N%             (amber — fell back to cloud proxy)
 *   - No pose                (neutral — last call returned nothing
 *                             OR no pose call in the last 90s)
 *
 * Renders null when there's been no pose telemetry in this session
 * yet. This keeps surfaces that mount the badge but haven't yet
 * triggered an analysis (e.g. SmartMotion before recording) from
 * showing a "stale 0% conf" chip.
 *
 * Designed to drop next to the existing GlassesStatusBadge in
 * SmartMotion / PuttingLab / SmartVision headers so the player sees
 * BOTH where the camera is coming from (glasses vs phone) AND where
 * the pose math is happening (on-device vs cloud) in one glance.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useLatestPoseTelemetry } from '../services/poseTelemetry';

interface Props {
  onPress?: () => void;
}

export default function PoseSourceBadge({ onPress }: Props) {
  const t = useLatestPoseTelemetry();
  if (t.at === 0) return null; // no pose call yet this session

  const { label, color, dotColor } = (() => {
    if (t.backend === 'mediapipe') {
      const msText = t.inferenceMs ? ` • ${t.inferenceMs}ms` : '';
      return {
        label: `ON-DEVICE${msText}`,
        color: '#86efac',
        dotColor: '#22c55e',
      };
    }
    if (t.backend === 'cloud_proxy' || t.backend === 'cloud_vision_llm') {
      return {
        label: `CLOUD • ${t.confidence}%`,
        color: '#fbbf24',
        dotColor: '#f59e0b',
      };
    }
    return { label: 'NO POSE', color: '#9ca3af', dotColor: '#6b7280' };
  })();

  const inner = (
    <View style={[styles.chip, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) return inner;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Pose source: ${label.toLowerCase()}`}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
});
