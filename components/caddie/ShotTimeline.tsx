/**
 * 2026-05-25 — Fix X: in-round shot timeline for the Caddie tab.
 *
 * Tim's note from tonight's Palms round: "the dashboard did show me
 * what my recorded shots were that I said... this was very cool and
 * needs to show cleanly on the caddie tab. v1 of the app months ago
 * would show shot by shot and worked well for analysis using icons
 * with and numbers."
 *
 * This component renders a compact scrolling timeline of round shots,
 * newest first, with one row per shot:
 *   [club icon] [hole #] [club label] [distance] [outcome chip]
 *
 * Pulls from roundStore.shots directly so it stays in sync with voice-
 * logged + scorecard-logged shots without prop drilling. Hides itself
 * when there are zero shots logged (no empty section noise during a
 * fresh round).
 *
 * Filtering: defaults to ALL shots in the active round (cap MAX_ROWS so
 * the strip doesn't dominate the Caddie tab on a long round). Can be
 * narrowed to current-hole-only via the optional `holeOnly` prop if
 * we want a per-hole variant later.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoundStore, type ShotResult } from '../../store/roundStore';

interface Props {
  /** Optional cap on rows rendered. Default 8 — enough to see the
   *  current hole's shots plus a couple from the prior hole at a
   *  glance without overwhelming the Caddie tab. */
  maxRows?: number;
  /** When true, only show shots from the current hole. */
  holeOnly?: boolean;
}

const DEFAULT_MAX_ROWS = 8;

// Club → icon mapping. Wood/iron/wedge/putter each gets a distinct
// glyph so the user can scan the column at a glance.
function clubIcon(club: string | null): keyof typeof Ionicons.glyphMap {
  if (!club) return 'help-outline';
  const c = club.toLowerCase();
  if (c.includes('putter') || c === 'p') return 'flag-outline';
  if (c.includes('wedge') || /\b(sw|pw|gw|lw|aw)\b/.test(c)) return 'leaf-outline';
  if (c.includes('driver') || c === 'd' || c === '1w') return 'rocket-outline';
  if (c.includes('wood') || /\b\dw\b/.test(c)) return 'flash-outline';
  return 'golf-outline'; // iron / hybrid / default
}

// Outcome → { label, color }. Penalties get amber/red; clean gets green.
function outcomeChip(outcome: ShotResult['outcome'] | null | undefined): {
  label: string;
  color: string;
  bg: string;
} | null {
  if (!outcome || outcome === 'clean') return null;
  switch (outcome) {
    case 'water':
      return { label: 'water', color: '#60a5fa', bg: '#1e3a8a44' };
    case 'ob':
      return { label: 'OB', color: '#ef4444', bg: '#7f1d1d44' };
    case 'hazard_drop':
      return { label: 'hazard', color: '#f59e0b', bg: '#78350f44' };
    case 'unplayable':
      return { label: 'unplayable', color: '#f59e0b', bg: '#78350f44' };
    case 'lost':
      return { label: 'lost', color: '#ef4444', bg: '#7f1d1d44' };
    default:
      return { label: String(outcome), color: '#9ca3af', bg: '#37415144' };
  }
}

// Compact direction badge: hooks/slices/etc. Returns null when straight
// or absent so we don't clutter the row.
function directionTag(direction: ShotResult['direction'] | null | undefined): string | null {
  if (!direction || direction === 'straight') return null;
  return String(direction);
}

export default function ShotTimeline({ maxRows = DEFAULT_MAX_ROWS, holeOnly = false }: Props) {
  const shots = useRoundStore(s => s.shots);
  const currentHole = useRoundStore(s => s.currentHole);

  const rows = useMemo(() => {
    const pool = holeOnly ? shots.filter(s => s.hole === currentHole) : shots;
    return [...pool].slice(-maxRows).reverse();
  }, [shots, currentHole, holeOnly, maxRows]);

  if (rows.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>SHOTS</Text>
        <Text style={styles.headerCount}>{rows.length} of {shots.length}</Text>
      </View>
      <ScrollView
        horizontal={false}
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: 240 }}
      >
        {rows.map((shot, i) => {
          const icon = clubIcon(shot.club);
          const dist = shot.distance_yards;
          const dir = directionTag(shot.direction);
          const oc = outcomeChip(shot.outcome);
          return (
            <View key={shot.id ?? i} style={styles.row}>
              <View style={styles.iconCol}>
                <Ionicons name={icon} size={18} color="#00C896" />
                <Text style={styles.holeBadge}>{shot.hole}</Text>
              </View>
              <View style={styles.clubCol}>
                <Text style={styles.clubLabel} numberOfLines={1}>{shot.club ?? '—'}</Text>
                {dir ? <Text style={styles.dirLabel}>{dir}</Text> : null}
              </View>
              <View style={styles.distCol}>
                <Text style={styles.distValue}>{dist != null ? `${dist}` : '—'}</Text>
                <Text style={styles.distUnit}>yds</Text>
              </View>
              {oc ? (
                <View style={[styles.chip, { backgroundColor: oc.bg, borderColor: oc.color }]}>
                  <Text style={[styles.chipLabel, { color: oc.color }]}>{oc.label}</Text>
                </View>
              ) : (
                <View style={styles.chip} />
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#0d2418',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 12,
    marginHorizontal: 12,
    marginTop: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLabel: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  headerCount: { color: '#64748b', fontSize: 11, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1e3a28',
    gap: 10,
  },
  iconCol: { width: 36, alignItems: 'center' },
  holeBadge: { color: '#94a3b8', fontSize: 10, fontWeight: '700', marginTop: 2 },
  clubCol: { flex: 1 },
  clubLabel: { color: '#f8fafc', fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  dirLabel: { color: '#94a3b8', fontSize: 11, marginTop: 1 },
  distCol: { width: 50, alignItems: 'flex-end' },
  distValue: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  distUnit: { color: '#64748b', fontSize: 9 },
  chip: {
    minWidth: 60,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  chipLabel: { fontSize: 10, fontWeight: '700' },
});
