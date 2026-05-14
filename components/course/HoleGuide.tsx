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
      {sorted.map((h, i) => (
        <View key={h.hole_number} style={[styles.row, i % 2 === 1 && styles.rowAlt]}>
          <Text style={[styles.cell, styles.colHole]}>{h.hole_number}</Text>
          <Text style={[styles.cell, styles.colPar]}>{h.par}</Text>
          <Text style={[styles.cell, styles.colYds]}>{h.yardage > 0 ? h.yardage : '—'}</Text>
          <Text
            style={[styles.cell, styles.colNote, styles.note, notesLoading && !h.note && styles.noteLoading]}
            numberOfLines={2}
          >
            {h.note ?? (notesLoading ? 'loading…' : '—')}
          </Text>
        </View>
      ))}
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
  colHole: { width: 28, fontWeight: '700' },
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
