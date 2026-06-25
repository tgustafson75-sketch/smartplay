/**
 * 2026-06-25 — GreenHeatCard: Grint-style putting heat map — HONEST v1.
 *
 * Renders ONLY real collected putt data (services/putting/greenHeat.ts via
 * hooks/useGreenHeat). Until enough real putts exist (GREEN_HEAT_MIN_HOLES),
 * it shows an honest "collecting your putts…" state with a progress count —
 * NEVER a fabricated/illustrative heat map.
 *
 * Because positional putt data (ball start/finish on the green) is NOT captured
 * today, this is an honest DISTANCE/REGION heat — a one-putt-conversion grid by
 * putting class (approach vs scramble) and putts-per-hole distribution — not a
 * faked 2D green density. When/if real green rolls accumulate (greenRollStore),
 * the model's rollSignal surfaces the genuine break + make read; we show it only
 * when it's real.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useGreenHeat } from '../hooks/useGreenHeat';
import {
  heatColorForRate,
  GREEN_HEAT_MIN_HOLES,
  type PuttBucketStat,
  type PuttClass,
} from '../services/putting/greenHeat';

const CLASS_META: Record<PuttClass, { label: string; sub: string }> = {
  approachPutt: { label: 'Approach', sub: 'green hit in reg' },
  scramblePutt: { label: 'Scramble', sub: 'green missed' },
};

export interface GreenHeatCardProps {
  /** 'career' (default) = all rounds; 'round' = the active/last round only. */
  scope?: 'career' | 'round';
  style?: object;
}

export function GreenHeatCard({ scope = 'career', style }: GreenHeatCardProps) {
  const theme = useTheme();
  const c = theme.colors;
  const model = useGreenHeat(scope);

  const pct = (v: number | null): string => (v == null ? '—' : `${Math.round(v * 100)}%`);

  // Progress toward the render threshold (collecting state).
  const progress = useMemo(
    () => Math.max(0, Math.min(1, model.totalHoles / GREEN_HEAT_MIN_HOLES)),
    [model.totalHoles],
  );

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: c.text_primary }]}>Green Heat</Text>
        <Text style={[styles.titleSub, { color: c.text_muted }]}>
          {scope === 'round' ? 'this round' : 'putting map'}
        </Text>
      </View>

      {!model.ready ? (
        /* ── HONEST COLLECTING STATE — never a fabricated heat ── */
        <View style={styles.collecting}>
          <Text style={[styles.collectingTitle, { color: c.text_primary }]}>
            Collecting your putts
          </Text>
          <Text style={[styles.collectingBody, { color: c.text_muted }]}>
            Your green map fills in as you play. Log putts on each hole and the heat
            builds from your real makes and misses — no made-up data.
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: c.accent, width: `${Math.round(progress * 100)}%` },
              ]}
            />
          </View>
          <Text style={[styles.progressLabel, { color: c.text_muted }]}>
            {model.totalHoles} of {GREEN_HEAT_MIN_HOLES} putt-holes logged
            {model.remaining > 0 ? ` · ${model.remaining} to go` : ''}
          </Text>
        </View>
      ) : (
        <>
          {/* ── HEAT GRID — one cell per putting class, colored by 1-putt rate ── */}
          <View style={styles.grid}>
            {(['approachPutt', 'scramblePutt'] as PuttClass[]).map((cls) => {
              const b: PuttBucketStat = model.byClass[cls];
              const meta = CLASS_META[cls];
              const hasData = b.holes > 0;
              const cellColor = hasData ? heatColorForRate(b.onePuttRate) : '#2a2f3a';
              return (
                <View key={cls} style={[styles.cell, { backgroundColor: cellColor }]}>
                  <Text style={styles.cellLabel}>{meta.label}</Text>
                  <Text style={styles.cellSub}>{meta.sub}</Text>
                  {hasData ? (
                    <>
                      <Text style={styles.cellBig}>{pct(b.onePuttRate)}</Text>
                      <Text style={styles.cellBigSub}>1-putt rate</Text>
                      <Text style={styles.cellMeta}>
                        {b.avgPutts != null ? b.avgPutts.toFixed(2) : '—'} avg · {b.holes} hole
                        {b.holes === 1 ? '' : 's'}
                      </Text>
                      {b.threePlus > 0 && (
                        <Text style={styles.cellLeak}>
                          {pct(b.threePuttRate)} 3-putt+
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text style={styles.cellEmpty}>no holes yet</Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* ── PUTTS-PER-HOLE distribution (overall, real) ── */}
          <View style={styles.distRow}>
            <DistPill label="1-putt" value={model.overall.onePutt} color="#22c55e" c={c} />
            <DistPill label="2-putt" value={model.overall.twoPutt} color="#f59e0b" c={c} />
            <DistPill label="3+ putt" value={model.overall.threePlus} color="#ef4444" c={c} />
          </View>

          {/* ── REAL green-roll break signal — only when measured rolls exist ── */}
          {model.rollSignal && model.rollSignal.rolls > 0 && (
            <Text style={[styles.rollSignal, { color: c.text_muted }]}>
              Reads: breaks{' '}
              <Text style={{ color: c.text_primary }}>{model.rollSignal.dominantBreak}</Text>
              {' · '}
              {Math.round(model.rollSignal.makeRate * 100)}% made over{' '}
              {model.rollSignal.rolls} measured roll{model.rollSignal.rolls === 1 ? '' : 's'}
            </Text>
          )}

          {/* ── HONEST LEGEND ── */}
          <View style={styles.legendRow}>
            <Text style={[styles.legendLabel, { color: c.text_muted }]}>cold</Text>
            <View style={styles.legendBar}>
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <View
                  key={t}
                  style={[styles.legendChip, { backgroundColor: heatColorForRate(t) }]}
                />
              ))}
            </View>
            <Text style={[styles.legendLabel, { color: c.text_muted }]}>hot</Text>
          </View>
          <Text style={[styles.legendCaption, { color: c.text_muted }]}>
            Color = your 1-putt conversion (higher = hotter). From {model.totalHoles} real
            putt-holes.
          </Text>
        </>
      )}
    </View>
  );
}

function DistPill({
  label,
  value,
  color,
  c,
}: {
  label: string;
  value: number;
  color: string;
  c: { surface_elevated?: string; border: string; text_primary: string; text_muted: string };
}) {
  return (
    <View style={[styles.distPill, { backgroundColor: c.surface_elevated ?? 'transparent', borderColor: c.border }]}>
      <View style={[styles.distDot, { backgroundColor: color }]} />
      <Text style={[styles.distValue, { color: c.text_primary }]}>{value}</Text>
      <Text style={[styles.distLabel, { color: c.text_muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '700' },
  titleSub: { fontSize: 12 },

  collecting: { paddingVertical: 4 },
  collectingTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  collectingBody: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: 8, borderRadius: 4 },
  progressLabel: { fontSize: 12 },

  grid: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  cell: { flex: 1, borderRadius: 12, padding: 12, minHeight: 110, justifyContent: 'flex-start' },
  cellLabel: { fontSize: 13, fontWeight: '700', color: '#fff' },
  cellSub: { fontSize: 10, color: 'rgba(255,255,255,0.75)', marginBottom: 6 },
  cellBig: { fontSize: 26, fontWeight: '800', color: '#fff' },
  cellBigSub: { fontSize: 10, color: 'rgba(255,255,255,0.8)' },
  cellMeta: { fontSize: 10, color: 'rgba(255,255,255,0.85)', marginTop: 6 },
  cellLeak: { fontSize: 10, color: 'rgba(255,255,255,0.95)', marginTop: 2, fontWeight: '600' },
  cellEmpty: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 8 },

  distRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  distPill: { flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, gap: 6 },
  distDot: { width: 8, height: 8, borderRadius: 4 },
  distValue: { fontSize: 16, fontWeight: '700' },
  distLabel: { fontSize: 11 },

  rollSignal: { fontSize: 12, marginBottom: 10, lineHeight: 17 },

  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendLabel: { fontSize: 11 },
  legendBar: { flex: 1, flexDirection: 'row', borderRadius: 4, overflow: 'hidden' },
  legendChip: { flex: 1, height: 8 },
  legendCaption: { fontSize: 11, marginTop: 6, lineHeight: 15 },
});

export default GreenHeatCard;
