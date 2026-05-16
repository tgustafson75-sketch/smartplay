import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type HoleRow = {
  hole_number: number;
  par: number;
  yardage: number;
  note?: string;
};

type Props = {
  holes: HoleRow[];
  /** Refinement bundle item 5 — when true, missing notes show "loading…"
   *  instead of "—" so users understand the table is still filling in. */
  notesLoading?: boolean;
};

/**
 * Hole Guide table — the scannable per-hole reference: # | Par | Yds | Note.
 * Closes with a totals row showing par total / yardage total in green accent.
 *
 * Sized for both Fold-closed and Fold-open widths — the Note column flexes
 * while the numeric columns stay fixed.
 */
export default function HoleGuide({ holes, notesLoading }: Props) {
  const sorted = [...holes].sort((a, b) => a.hole_number - b.hole_number);
  const parTotal = sorted.reduce((a, h) => a + h.par, 0);
  const ydsTotal = sorted.reduce((a, h) => a + h.yardage, 0);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={[styles.h, styles.colHole]}>#</Text>
        <Text style={[styles.h, styles.colPar]}>PAR</Text>
        <Text style={[styles.h, styles.colYds]}>YDS</Text>
        <Text style={[styles.h, styles.colNote]}>NOTE</Text>
      </View>
      {sorted.map((h, i) => {
        // Phase 405 — par-tinted hole badge so the eye reads par at a
        // glance. Par 3 = dim teal, Par 4 = mid teal, Par 5 = bright
        // teal. Keeps the column scannable without spelling out par
        // twice (it's already in the next column).
        const parTint =
          h.par === 3 ? 'rgba(0,200,150,0.18)' :
          h.par === 5 ? 'rgba(0,200,150,0.45)' :
                        'rgba(0,200,150,0.30)';
        return (
          <View key={h.hole_number} style={[styles.row, i % 2 === 1 && styles.rowAlt]}>
            <View style={styles.colHole}>
              <View style={[styles.holeBadge, { backgroundColor: parTint }]}>
                <Text style={styles.holeBadgeText}>{h.hole_number}</Text>
              </View>
            </View>
            <Text style={[styles.cell, styles.colPar]}>{h.par}</Text>
            <Text style={[styles.cell, styles.colYds]}>{h.yardage > 0 ? h.yardage : '—'}</Text>
            <Text
              style={[styles.cell, styles.colNote, styles.note, notesLoading && !h.note && styles.noteLoading]}
              numberOfLines={2}
            >
              {h.note ?? (notesLoading ? 'loading…' : '—')}
            </Text>
          </View>
        );
      })}
      <View style={[styles.row, styles.totalRow]}>
        <Text style={[styles.cell, styles.colHole, styles.totalLabel]}>TOTAL</Text>
        <Text style={[styles.cell, styles.colPar, styles.totalVal]}>{parTotal}</Text>
        <Text style={[styles.cell, styles.colYds, styles.totalVal]}>{ydsTotal}</Text>
        <Text style={[styles.cell, styles.colNote]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16 },
  headerRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  h: { color: '#6b7280', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  row: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#0f1f15',
    alignItems: 'flex-start',
  },
  // v3-style alternating row tint — every other row gets a subtle dark
  // band so the eye can track left→right across 18 holes without losing
  // place. Tim 2026-05-14: "look at v3 course info ... it was beautiful."
  rowAlt: {
    backgroundColor: '#0a1612',
  },
  cell: { color: '#e8f5e9', fontSize: 13 },
  // Phase 405 — colHole now hosts a circular badge instead of bare
  // text. Width widened a touch (32 -> 36 inc padding) so the 2-digit
  // hole-numbers (10-18) don't crowd the badge.
  colHole: { width: 36, alignItems: 'center' },
  holeBadge: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,200,150,0.45)',
  },
  holeBadgeText: { color: '#e8f5e9', fontSize: 12, fontWeight: '900' },
  colPar: { width: 36 },
  colYds: { width: 52 },
  colNote: { flex: 1 },
  note: { color: '#9ca3af', fontSize: 12, lineHeight: 16 },
  noteLoading: { color: '#4b5563', fontStyle: 'italic' },
  totalRow: {
    borderBottomWidth: 0,
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
    paddingTop: 10,
    marginTop: 4,
  },
  totalLabel: { color: '#6b7280', fontSize: 10, letterSpacing: 1.2 },
  totalVal: { color: '#00C896', fontSize: 14, fontWeight: '800' },
});
