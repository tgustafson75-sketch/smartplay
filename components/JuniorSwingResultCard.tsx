/**
 * 2026-05-22 — Junior swing result card.
 *
 * Atomic display of one JuniorSwingAnalysis. Renders:
 *   - Header: member name + emoji + age band + timestamp + overallScore
 *   - Wins (lead, lime/green chips — confidence is the goal)
 *   - One next-focus line (amber accent)
 *   - Optional fun-drill (purple — game-ified for younger bands)
 *   - Fundamentals grid (grip / stance / head / tempo / balance)
 *   - vs_previous chip (improved / same / regressed)
 *   - coachComment quote — the persona-aware spoken summary
 *
 * Used by the Family Library member roll-up + the side-by-side compare.
 * Compact + expanded variants — caller picks via prop.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useFamilyStore, ageBand } from '../store/familyStore';
import type { JuniorSwingAnalysis } from '../services/juniorSwingAnalyzer';

export interface JuniorSwingResultCardProps {
  analysis: JuniorSwingAnalysis;
  /** Compact variant collapses fundamentals + coach comment to a
   *  single line + score badge. Default false. */
  compact?: boolean;
  /** Optional tap target — typically navigates to a detail surface. */
  onPress?: () => void;
}

const BAND_BG: Record<string, string> = {
  tiny: '#fcd34d',
  junior: '#86efac',
  teen: '#93c5fd',
  adult: '#cbd5e1',
};

export default function JuniorSwingResultCard({
  analysis, compact = false, onPress,
}: JuniorSwingResultCardProps) {
  const { colors } = useTheme();
  const member = useFamilyStore((s) => s.getMember(analysis.memberId));
  const dateStr = formatTimestamp(analysis.timestamp);
  const bandColor = BAND_BG[analysis.ageBand] ?? '#86efac';

  const inner = (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Text style={styles.headerAvatar}>{member?.avatar_emoji ?? '🌟'}</Text>
        <View style={styles.headerText}>
          <Text style={[styles.headerName, { color: colors.text_primary }]} numberOfLines={1}>
            {member?.firstName ?? 'Family member'}
            {analysis.club ? (
              <Text style={[styles.headerClub, { color: colors.text_muted }]}>{`  ·  ${analysis.club}`}</Text>
            ) : null}
          </Text>
          <Text style={[styles.headerMeta, { color: colors.text_muted }]}>
            {dateStr}
            <Text style={[styles.bandPill, { color: '#0a1410', backgroundColor: bandColor }]}>
              {`  ${analysis.ageBand.toUpperCase()}  `}
            </Text>
          </Text>
        </View>
        <ScoreBadge value={analysis.overallScore} estimated={analysis.scoreEstimated === true} />
      </View>

      {!compact && analysis.wins.length > 0 && (
        <View style={styles.winsRow}>
          {analysis.wins.map((w, i) => (
            <View key={i} style={[styles.winChip, { borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.10)' }]}>
              <Text style={styles.winChipText} numberOfLines={2}>✓  {w}</Text>
            </View>
          ))}
        </View>
      )}

      {!compact && analysis.next_focus && (
        <View style={[styles.focusBox, { borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)' }]}>
          <Text style={[styles.focusLabel, { color: '#fbbf24' }]}>NEXT TIME</Text>
          <Text style={[styles.focusBody, { color: colors.text_primary }]}>{analysis.next_focus}</Text>
        </View>
      )}

      {!compact && analysis.fun_drill && (
        <View style={[styles.focusBox, { borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.10)' }]}>
          <Text style={[styles.focusLabel, { color: '#c4b5fd' }]}>TRY THIS GAME</Text>
          <Text style={[styles.focusBody, { color: colors.text_primary }]}>{analysis.fun_drill}</Text>
        </View>
      )}

      {!compact && (
        <View style={styles.fundRow}>
          <FundItem label="Grip" value={analysis.fundamentals.grip} colors={colors} />
          <FundItem label="Stance" value={analysis.fundamentals.stance} colors={colors} />
          <FundItem label="Head" value={analysis.fundamentals.head_movement} colors={colors} />
          <FundItem label="Tempo" value={analysis.fundamentals.tempo} colors={colors} />
          <FundItem label="Balance" value={analysis.fundamentals.balance} colors={colors} />
        </View>
      )}

      {analysis.vs_previous && (
        <View style={styles.diffRow}>
          <View
            style={[
              styles.diffChip,
              {
                borderColor: diffColor(analysis.vs_previous.direction),
                backgroundColor: diffBg(analysis.vs_previous.direction),
              },
            ]}
          >
            <Text style={[styles.diffChipText, { color: diffColor(analysis.vs_previous.direction) }]}>
              {diffArrow(analysis.vs_previous.direction)}  {analysis.vs_previous.summary}
            </Text>
          </View>
        </View>
      )}

      {!compact && analysis.coachComment && (
        <Text style={[styles.coachQuote, { color: colors.text_secondary }]}>
          &quot;{analysis.coachComment}&quot;
        </Text>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button">
        {inner}
      </Pressable>
    );
  }
  return inner;
}

// ─── Subcomponents ──────────────────────────────────────────────────────

function ScoreBadge({ value, estimated = false }: { value: number; estimated?: boolean }) {
  const tier = value >= 80 ? 'gold' : value >= 60 ? 'good' : value >= 40 ? 'fair' : 'work';
  const tierColor = tier === 'gold' ? '#fde047' : tier === 'good' ? '#86efac' : tier === 'fair' ? '#fbbf24' : '#f87171';
  // 2026-06-23 (honesty) — when the score is a placeholder/default (not a real
  // graded score) present it as an ESTIMATE: muted color + tilde + "EST" label,
  // never as a confident graded number on a child-facing surface.
  const color = estimated ? '#94a3b8' : tierColor;
  return (
    <View style={[styles.scoreBadge, { borderColor: color }]}>
      <Text style={[styles.scoreValue, { color }]}>{estimated ? `~${value}` : value}</Text>
      <Text style={[styles.scoreLabel, { color }]}>{estimated ? 'EST' : 'SCORE'}</Text>
    </View>
  );
}

function FundItem({
  label, value, colors,
}: {
  label: string; value: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const known = value !== 'unknown';
  return (
    <View style={[styles.fundItem, { borderColor: colors.border }]}>
      <Text style={[styles.fundLabel, { color: colors.text_muted }]}>{label}</Text>
      <Text style={[styles.fundValue, { color: known ? colors.text_primary : colors.text_muted, fontStyle: known ? 'normal' : 'italic' }]}>
        {known ? value.replace(/_/g, ' ') : '—'}
      </Text>
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
  return d.toLocaleDateString();
}

function diffColor(d: 'improved' | 'same' | 'regressed'): string {
  return d === 'improved' ? '#86efac' : d === 'regressed' ? '#fbbf24' : '#cbd5e1';
}
function diffBg(d: 'improved' | 'same' | 'regressed'): string {
  return d === 'improved' ? 'rgba(34, 197, 94, 0.12)'
    : d === 'regressed' ? 'rgba(251, 191, 36, 0.12)'
    : 'rgba(148, 163, 184, 0.12)';
}
function diffArrow(d: 'improved' | 'same' | 'regressed'): string {
  return d === 'improved' ? '↑' : d === 'regressed' ? '↓' : '→';
}

// Suppress age-band coloring unused warning (we use it directly above).
void ageBand;

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderRadius: 16, borderWidth: 1, padding: 14, gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { fontSize: 28 },
  headerText: { flex: 1, gap: 2 },
  headerName: { fontSize: 16, fontWeight: '800' },
  headerClub: { fontSize: 12, fontWeight: '600' },
  headerMeta: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  bandPill: { fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },

  scoreBadge: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  scoreValue: { fontSize: 20, fontWeight: '900', lineHeight: 22 },
  scoreLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 1.4, marginTop: 1 },

  winsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  winChip: {
    borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, maxWidth: '100%',
  },
  winChipText: { fontSize: 11, color: '#86efac', fontWeight: '700' },

  focusBox: {
    borderRadius: 10, borderWidth: 1, padding: 10, gap: 4,
  },
  focusLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  focusBody: { fontSize: 13, lineHeight: 18, fontWeight: '600' },

  fundRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fundItem: {
    flexGrow: 1, minWidth: '30%', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6,
  },
  fundLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  fundValue: { fontSize: 12, fontWeight: '700', marginTop: 2 },

  diffRow: { flexDirection: 'row' },
  diffChip: {
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  diffChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  coachQuote: {
    fontSize: 13, fontStyle: 'italic', lineHeight: 19,
  },
});
