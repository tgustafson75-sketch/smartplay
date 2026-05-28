import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

type HoleRow = {
  hole_number: number;
  par: number;
  yardage: number;
  note?: string;
  // 2026-05-28 — Fix FT: longer per-hole preview + source marker.
  // Tapping a row toggles a description card below it. Source is
  // surfaced as a subtle attribution so the player knows the confidence
  // level ("from public data, not field-verified" vs pro-contributed).
  description?: string;
  description_source?: 'public_synthesis' | 'pro_contributed' | 'field_verified';
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
 *
 * 2026-05-28 — Fix FT: rows are now tappable when a longer description
 * is available. Tap expands an inline card with the 2-3 sentence
 * preview for first-time players on the course. Trust marker below
 * the copy makes the data source visible.
 */
export default function HoleGuide({ holes, notesLoading }: Props) {
  const { colors } = useTheme();
  const sorted = [...holes].sort((a, b) => a.hole_number - b.hole_number);
  const parTotal = sorted.reduce((a, h) => a + h.par, 0);
  const ydsTotal = sorted.reduce((a, h) => a + h.yardage, 0);
  // 2026-05-28 — Fix FT: expanded row state. Set of hole_numbers
  // currently expanded. Empty by default — the table reads as a
  // scannable scorecard, descriptions surface only when the user
  // asks for them.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (h: number) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(h)) next.delete(h); else next.add(h);
    return next;
  });

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
    descCard: { backgroundColor: colors.surface, borderColor: colors.border },
    descBody: { color: colors.text_primary },
    descSource: { color: colors.text_muted },
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
        const hasDescription = (h.description ?? '').trim().length > 0;
        const isOpen = expanded.has(h.hole_number);
        const sourceLabel =
          h.description_source === 'pro_contributed' ? 'from a pro who played this course' :
          h.description_source === 'field_verified' ? 'field-verified by players' :
          'from public data — not field-verified';
        return (
          <React.Fragment key={h.hole_number}>
            <Pressable
              onPress={hasDescription ? () => toggle(h.hole_number) : undefined}
              style={({ pressed }) => [
                styles.row,
                dynamicStyles.rowBorder,
                i % 2 === 1 && dynamicStyles.rowAlt,
                hasDescription && pressed && { opacity: 0.75 },
              ]}
              accessibilityRole={hasDescription ? 'button' : undefined}
              accessibilityLabel={
                hasDescription
                  ? `Hole ${h.hole_number}, par ${h.par}, ${h.yardage} yards. ${isOpen ? 'Hide' : 'Show'} description.`
                  : undefined
              }
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
              <View style={[styles.colNote, styles.noteCellWrap]}>
                <Text
                  style={[
                    styles.cell, dynamicStyles.note,
                    notesLoading && !h.note && dynamicStyles.noteLoading,
                  ]}
                  numberOfLines={2}
                >
                  {h.note ?? (notesLoading ? 'loading…' : '—')}
                </Text>
                {hasDescription && (
                  <Text style={[styles.descToggleHint, { color: colors.accent }]}>
                    {isOpen ? 'Hide ▲' : 'Tap for preview ▼'}
                  </Text>
                )}
              </View>
            </Pressable>
            {hasDescription && isOpen && (
              <View style={[styles.descCard, dynamicStyles.descCard]}>
                <Text style={[styles.descBody, dynamicStyles.descBody]}>
                  {h.description}
                </Text>
                <Text style={[styles.descSource, dynamicStyles.descSource]}>
                  {sourceLabel}
                </Text>
              </View>
            )}
          </React.Fragment>
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
  noteCellWrap: { flexDirection: 'column' },
  descToggleHint: { fontSize: 10, fontWeight: '700', marginTop: 3, letterSpacing: 0.5 },
  descCard: {
    marginHorizontal: 8,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  descBody: { fontSize: 13, lineHeight: 18 },
  descSource: { fontSize: 10, fontStyle: 'italic', marginTop: 6, letterSpacing: 0.3 },
  totalRow: {
    borderBottomWidth: 0,
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 4,
  },
  totalValSize: { fontSize: 14, fontWeight: '800' },
});
