import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

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
  const { colors } = useTheme();
  const sorted = [...holes].sort((a, b) => a.hole_number - b.hole_number);
  const parTotal = sorted.reduce((a, h) => a + h.par, 0);
  const ydsTotal = sorted.reduce((a, h) => a + h.yardage, 0);

  // 2026-05-16 — theme-aware. Pre-existing hardcoded dark colors
  // rendered the table as washed-out white cards in light mode (Tim's
  // "dog shit" report). Pull from the active theme palette so the
  // table reads correctly in both light and dark themes.
  const dynamicStyles = useMemo(() => ({
    headerBorder: { borderBottomColor: colors.border },
    header: { color: colors.text_muted },
    cell: { color: colors.text_primary },
    rowBorder: { borderBottomColor: colors.border },
    rowAlt: { backgroundColor: colors.surface },
    note: { color: colors.text_muted },
    noteLoading: { color: colors.text_muted, fontStyle: 'italic' as const, opacity: 0.6 },
    badgeBorder: { borderColor: colors.accent },
    badgeText: { color: colors.text_primary },
    totalBorder: { borderTopColor: colors.border },
    totalLabel: { color: colors.text_muted },
    totalVal: { color: colors.accent },
  }), [colors]);

  return (
    <View style={styles.wrap}>
      <View style={[styles.headerRow, dynamicStyles.headerBorder]}>
        <Text style={[styles.h, dynamicStyles.header, styles.colHole]}>#</Text>
        <Text style={[styles.h, dynamicStyles.header, styles.colPar]}>PAR</Text>
        <Text style={[styles.h, dynamicStyles.header, styles.colYds]}>YDS</Text>
        <Text style={[styles.h, dynamicStyles.header, styles.colNote]}>NOTE</Text>
      </View>
      {sorted.map((h, i) => {
        const parTint =
          h.par === 3 ? 'rgba(0,200,150,0.18)' :
          h.par === 5 ? 'rgba(0,200,150,0.45)' :
                        'rgba(0,200,150,0.30)';
        return (
          <View
            key={h.hole_number}
            style={[styles.row, dynamicStyles.rowBorder, i % 2 === 1 && dynamicStyles.rowAlt]}
          >
            <View style={styles.colHole}>
              <View style={[styles.holeBadge, dynamicStyles.badgeBorder, { backgroundColor: parTint }]}>
                <Text style={[styles.holeBadgeText, dynamicStyles.badgeText]}>{h.hole_number}</Text>
              </View>
            </View>
            <Text style={[styles.cell, dynamicStyles.cell, styles.colPar]}>{h.par}</Text>
            <Text style={[styles.cell, dynamicStyles.cell, styles.colYds]}>
              {h.yardage > 0 ? h.yardage : '—'}
            </Text>
            <Text
              style={[
                styles.cell, styles.colNote, dynamicStyles.note,
                notesLoading && !h.note && dynamicStyles.noteLoading,
              ]}
              numberOfLines={2}
            >
              {h.note ?? (notesLoading ? 'loading…' : '—')}
            </Text>
          </View>
        );
      })}
      <View style={[styles.row, styles.totalRow, dynamicStyles.totalBorder]}>
        <Text style={[styles.cell, styles.colHole, dynamicStyles.totalLabel]}>TOTAL</Text>
        <Text style={[styles.cell, styles.colPar, dynamicStyles.totalVal, styles.totalValSize]}>{parTotal}</Text>
        <Text style={[styles.cell, styles.colYds, dynamicStyles.totalVal, styles.totalValSize]}>{ydsTotal}</Text>
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
  },
  h: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  row: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    alignItems: 'flex-start',
  },
  cell: { fontSize: 13 },
  colHole: { width: 36, alignItems: 'center' },
  holeBadge: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  holeBadgeText: { fontSize: 12, fontWeight: '900' },
  colPar: { width: 36 },
  colYds: { width: 52 },
  colNote: { flex: 1, fontSize: 12, lineHeight: 16 },
  totalRow: {
    borderBottomWidth: 0,
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 4,
  },
  totalValSize: { fontSize: 14, fontWeight: '800' },
});
