/**
 * 2026-05-23 — SmartVision Live Strategy card.
 *
 * Drops onto the SmartVision screen to render a real-time
 * "see what you see" strategic read composed from the unified
 * vision context (GPS + hole + green geometry + live vision + last
 * shot pattern). The card consumes `useUnifiedVisionContext` so it
 * re-renders every time a new Ray-Ban Meta frame lands OR the
 * player moves enough to change yardages.
 *
 * Designed to feel ambient — it shows up only when the unified
 * context has something useful to say (rich === true), stays small,
 * and disappears cleanly when the player walks off the hole or
 * outside reliable GPS.
 *
 * What the card surfaces (when present):
 *   - Yardages chip: F/M/B to the green (from the unified ydg pre-
 *     computation in unifiedVisionContext.ts).
 *   - Hazard awareness: "1 hazard on this hole — N yards" when
 *     geometry has at least one hazard within carry range.
 *   - Vision chip: "Glasses POV live" when DAT is streaming AND the
 *     detected mode is something tactical (lie / green_read / swing).
 *   - Last-shot grounding: "Last: 7i pull (135y)" when there's a
 *     recent shot — helps the player thread the pattern of THIS round.
 *
 * Tone is informational, not prescriptive — the brain (api/kevin)
 * already does the prescriptive reads; this card is a glance-able
 * status, not a competing coach. Tappable card opens the Caddie
 * surface for a deeper read.
 *
 * Defensive: when the hook returns null (warming up) OR
 * `rich === false`, renders null. No layout impact on the SmartVision
 * surface until there's actually something to say.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useUnifiedVisionContext } from '../hooks/useUnifiedVisionContext';

interface Props {
  /** Optional tap handler — typically opens the Caddie surface for a
   *  deeper "what should I hit here?" read. Omit for a pure status
   *  card. */
  onPress?: () => void;
  /** When true, the card stays mounted even with sparse context so
   *  designers can preview the layout. Default false — production
   *  uses the rich-context gate. */
  alwaysShow?: boolean;
}

export default function SmartVisionLiveStrategy({ onPress, alwaysShow = false }: Props) {
  const ctx = useUnifiedVisionContext();
  if (!ctx) return null;
  if (!alwaysShow && !ctx.rich) return null;

  const yardages = ctx.geometry.yardagesFromPlayer;
  const last = ctx.recentShots[ctx.recentShots.length - 1] ?? null;
  const visionLive =
    ctx.vision.streaming &&
    (ctx.vision.mode === 'lie' || ctx.vision.mode === 'green_read' || ctx.vision.mode === 'swing');

  const inner = (
    <View style={styles.card}>
      {/* Yardages row — primary signal */}
      {(yardages.front != null || yardages.middle != null || yardages.back != null) ? (
        <View style={styles.yardageRow}>
          <YardageChip label="F" value={yardages.front} />
          <YardageChip label="M" value={yardages.middle} primary />
          <YardageChip label="B" value={yardages.back} />
        </View>
      ) : null}

      {/* Secondary signals row */}
      <View style={styles.signalRow}>
        {ctx.geometry.hazards.length > 0 ? (
          <View style={[styles.signal, { borderColor: '#fbbf24' }]}>
            <Text style={[styles.signalText, { color: '#fbbf24' }]} numberOfLines={1}>
              ⚠ {ctx.geometry.hazards.length} hazard{ctx.geometry.hazards.length === 1 ? '' : 's'}
            </Text>
          </View>
        ) : null}
        {visionLive ? (
          <View style={[styles.signal, { borderColor: '#86efac' }]}>
            <Text style={[styles.signalText, { color: '#86efac' }]} numberOfLines={1}>
              👁 Glasses · {ctx.vision.mode.replace('_', ' ')}
            </Text>
          </View>
        ) : null}
        {last && (last.club || last.distanceYards != null) ? (
          <View style={[styles.signal, { borderColor: '#9ca3af' }]}>
            <Text style={[styles.signalText, { color: '#cbd5e1' }]} numberOfLines={1}>
              ← {last.club ?? 'last'}{last.direction ? ` ${last.direction}` : ''}{last.distanceYards != null ? ` (${last.distanceYards}y)` : ''}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Player-tendency tail — only when meaningful */}
      {ctx.player.dominantMiss ? (
        <Text style={styles.tendency} numberOfLines={1}>
          Watch: dominant miss {ctx.player.dominantMiss}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) return inner;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Live strategy — tap for caddie's read"
    >
      {inner}
    </Pressable>
  );
}

function YardageChip({ label, value, primary = false }: { label: string; value: number | null; primary?: boolean }) {
  const color = primary ? '#00C896' : '#cbd5e1';
  return (
    <View style={[styles.yardageChip, primary && { borderColor: color, borderWidth: 1.5 }]}>
      <Text style={[styles.yardageLabel, { color }]}>{label}</Text>
      <Text style={[styles.yardageValue, { color }]}>{value != null ? value : '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: 10,
    gap: 8,
    alignSelf: 'flex-start',
    maxWidth: '92%',
  },
  yardageRow: { flexDirection: 'row', gap: 8 },
  yardageChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  yardageLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  yardageValue: { fontSize: 16, fontWeight: '800' },
  signalRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  signal: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  signalText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  tendency: {
    color: '#fbbf24',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 2,
  },
});
