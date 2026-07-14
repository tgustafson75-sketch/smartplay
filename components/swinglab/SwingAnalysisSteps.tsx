import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * 2026-07-14 (Tim — "these status updates are on-brand, use them in the full app") — the staged
 * analysis-progress display, ported from SmartPlay Light. Replaces the flat "Analyzing…" spinner
 * with the same green stepped read-out: each phase lights up as the pipeline advances, past phases
 * stay lit, upcoming phases sit dim. While a real read is in flight we advance on a gentle timer
 * (the server pass is one call, so the steps narrate what it's doing); pass `done` when the read
 * lands to complete every step at once. Honest: the steps describe the actual pipeline stages
 * (locate swing → body mechanics → clubhead trace → tempo/contact), not fabricated progress.
 */

const DEFAULT_STEPS = [
  'Finding your swing in the clip…',
  'Tracking body mechanics…',
  'Tracing the clubhead…',
  'Reading tempo & contact…',
];

type Props = {
  /** Override the phase labels (defaults to the four SmartMotion stages). */
  steps?: string[];
  /** Ms between auto-advancing to the next phase while the read is in flight. */
  intervalMs?: number;
  /** When true, every step shows complete (call once the read returns). */
  done?: boolean;
};

export default function SwingAnalysisSteps({ steps = DEFAULT_STEPS, intervalMs = 1400, done = false }: Props) {
  const { colors } = useTheme();
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (done) return;
    timer.current = setInterval(() => {
      // Hold on the last step until `done` lands — never claim finished early.
      setActive((a) => (a < steps.length - 1 ? a + 1 : a));
    }, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [done, intervalMs, steps.length]);

  return (
    <View style={styles.wrap} accessibilityLabel="Analyzing your swing">
      {steps.map((label, i) => {
        const state = done || i < active ? 'done' : i === active ? 'active' : 'pending';
        const lit = state !== 'pending';
        return (
          <View key={i} style={styles.row}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: lit ? colors.accent : 'transparent',
                  borderColor: lit ? colors.accent : colors.border,
                },
              ]}
            />
            <Text
              style={[
                styles.label,
                {
                  color: state === 'active' ? colors.accent : state === 'done' ? colors.accent : colors.text_muted,
                  opacity: state === 'pending' ? 0.5 : state === 'done' ? 0.85 : 1,
                  fontWeight: state === 'active' ? '700' : '600',
                },
              ]}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  label: { fontSize: 15, letterSpacing: 0.2, flexShrink: 1 },
});
