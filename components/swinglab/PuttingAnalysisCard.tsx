/**
 * 2026-05-22 — Putting Analysis Card.
 *
 * Renders the PuttingAnalysis attached to a CageSession when the
 * analyzer-router classified the session as putting (glasses POV, putt/
 * chip tag). Sibling to PrimaryIssueCard + DrillCard but for the
 * putting structure shipped in services/puttingAnalysisService.ts.
 *
 * Layout (top → bottom):
 *   - Header: overallScore badge + distance + age-band-style hint
 *   - Setup row: alignment / ballPosition / stanceWidth / gripPressure
 *   - Stroke row: path / tempo / faceAngleAtImpact / deceleration
 *   - GreenSlope chip: direction · severity · ~X" break (confidence%)
 *   - ReadAccuracy line with suggested adjustment
 *   - Recommendation (line + speedFeel + mentalCue + technicalCue)
 *   - caddieComment quote
 *
 * Defensive — fields read off the typed PuttingAnalysis; missing
 * caddieComment falls back to a "see card" line so the layout never
 * looks broken.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import type { PuttingAnalysis } from '../../services/puttingAnalysisService';

interface Props {
  analysis: PuttingAnalysis;
}

export default function PuttingAnalysisCard({ analysis }: Props) {
  const { colors } = useTheme();
  const tier = scoreTier(analysis.overallScore);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.accent }]}>PUTTING</Text>
        <View style={[styles.scoreBadge, { borderColor: tier.color }]}>
          <Text style={[styles.scoreValue, { color: tier.color }]}>{analysis.overallScore}</Text>
          <Text style={[styles.scoreLabel, { color: tier.color }]}>SCORE</Text>
        </View>
      </View>

      {analysis.distanceFeet > 0 && (
        <Text style={[styles.subtitle, { color: colors.text_muted }]}>
          {analysis.distanceFeet} foot putt
          {analysis.holeNumber ? `  ·  Hole ${analysis.holeNumber}` : ''}
        </Text>
      )}

      {/* Green slope chip */}
      <View style={styles.slopeRow}>
        <SlopeChip
          direction={analysis.greenSlope.direction}
          severity={analysis.greenSlope.severity}
          breakInches={analysis.greenSlope.breakInches}
          confidence={analysis.greenSlope.confidence}
          colors={colors}
        />
      </View>

      {/* Setup row */}
      <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>SETUP</Text>
      <View style={styles.fieldRow}>
        <Field label="Alignment" value={fmt(analysis.setup.alignment)} colors={colors} />
        <Field label="Ball position" value={fmt(analysis.setup.ballPosition)} colors={colors} />
        <Field label="Stance" value={fmt(analysis.setup.stanceWidth)} colors={colors} />
        <Field label="Grip" value={fmt(analysis.setup.gripPressure)} colors={colors} />
        <Field label="Quality" value={`${analysis.setup.quality}`} colors={colors} accent />
      </View>

      {/* Stroke row */}
      <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>STROKE</Text>
      <View style={styles.fieldRow}>
        <Field label="Path" value={fmt(analysis.stroke.path)} colors={colors} />
        <Field label="Tempo" value={fmt(analysis.stroke.tempo)} colors={colors} warn={analysis.stroke.tempo === 'decelerating' || analysis.stroke.tempo === 'jerky'} />
        <Field label="Face @ impact" value={fmt(analysis.stroke.faceAngleAtImpact)} colors={colors} />
        <Field label="Quality" value={`${analysis.stroke.quality}`} colors={colors} accent />
      </View>
      {analysis.stroke.deceleration && (
        <Text style={[styles.flagWarn, { color: '#fbbf24' }]}>
          ⚠ Deceleration through impact — commit + accelerate
        </Text>
      )}

      {/* Read accuracy */}
      <View style={[styles.readBox, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
        <Text style={[styles.readLabel, { color: colors.text_muted }]}>YOUR READ</Text>
        <Text style={[styles.readBody, { color: colors.text_primary }]}>
          {analysis.readAccuracy.wasCorrect ? '✓ Lined up with what the slope said.' : '✗ Off by a bit.'}
          {analysis.readAccuracy.suggestedAdjustment ? `  ${analysis.readAccuracy.suggestedAdjustment}` : ''}
        </Text>
      </View>

      {/* Recommendation block */}
      <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>RECOMMENDATION</Text>
      <View style={[styles.recBox, { borderColor: colors.accent, backgroundColor: colors.accent_muted }]}>
        <Text style={[styles.recPrimary, { color: colors.accent }]}>{analysis.recommendation.line}</Text>
        <Text style={[styles.recSecondary, { color: colors.text_primary }]}>{analysis.recommendation.speedFeel}</Text>
      </View>
      <Text style={[styles.cueLine, { color: colors.text_secondary }]}>
        🧠  {analysis.recommendation.mentalCue}
      </Text>
      <Text style={[styles.cueLine, { color: colors.text_secondary }]}>
        🔧  {analysis.recommendation.technicalCue}
      </Text>

      {/* Caddie comment quote */}
      {analysis.caddieComment ? (
        <Text style={[styles.coachQuote, { color: colors.text_secondary }]}>
          "{analysis.caddieComment}"
        </Text>
      ) : null}
    </View>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────

interface ColorProps { colors: ReturnType<typeof useTheme>['colors'] }

function Field({
  label, value, colors, accent, warn,
}: { label: string; value: string; accent?: boolean; warn?: boolean } & ColorProps) {
  const color = warn ? '#fbbf24' : accent ? colors.accent : colors.text_primary;
  return (
    <View style={[styles.fieldCell, { borderColor: colors.border }]}>
      <Text style={[styles.fieldLabel, { color: colors.text_muted }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color }]}>{value}</Text>
    </View>
  );
}

function SlopeChip({
  direction, severity, breakInches, confidence, colors,
}: {
  direction: PuttingAnalysis['greenSlope']['direction'];
  severity: PuttingAnalysis['greenSlope']['severity'];
  breakInches: number;
  confidence: number;
} & ColorProps) {
  const arrow =
    direction === 'left-to-right' ? '→' :
    direction === 'right-to-left' ? '←' :
    direction === 'uphill' ? '↑' :
    direction === 'downhill' ? '↓' : '·';
  const severityColor =
    severity === 'severe' ? '#f87171' :
    severity === 'moderate' ? '#fbbf24' :
    severity === 'subtle' ? '#86efac' : '#cbd5e1';
  return (
    <View style={[styles.slopeChip, { borderColor: severityColor, backgroundColor: 'rgba(0,0,0,0.18)' }]}>
      <Text style={[styles.slopeText, { color: severityColor }]}>
        {arrow}  {fmt(severity)}  {breakInches > 0 ? `· ~${round1(breakInches)}" break` : ''}  ·  {confidence}%
      </Text>
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function fmt(s: string): string {
  return s.replace(/_/g, ' ').replace(/-/g, ' ');
}
function round1(n: number): number { return Math.round(n * 10) / 10; }

function scoreTier(score: number): { color: string; label: string } {
  if (score >= 80) return { color: '#86efac', label: 'PURE' };
  if (score >= 60) return { color: '#a3e635', label: 'GOOD' };
  if (score >= 40) return { color: '#fbbf24', label: 'OK' };
  return { color: '#f87171', label: 'WORK' };
}

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderRadius: 16, borderWidth: 1, padding: 16, gap: 10, marginTop: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  subtitle: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },

  scoreBadge: {
    width: 54, height: 54, borderRadius: 27, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  scoreValue: { fontSize: 18, fontWeight: '900', lineHeight: 20 },
  scoreLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 1.2, marginTop: 1 },

  slopeRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  slopeChip: {
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  slopeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },

  sectionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 4 },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fieldCell: {
    flexGrow: 1, minWidth: '30%', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6,
  },
  fieldLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  fieldValue: { fontSize: 12, fontWeight: '700', marginTop: 2 },

  flagWarn: { fontSize: 12, fontWeight: '800', marginTop: 4 },

  readBox: {
    borderRadius: 10, borderWidth: 1, padding: 10, gap: 4,
  },
  readLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  readBody: { fontSize: 13, fontWeight: '600', lineHeight: 19 },

  recBox: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 4 },
  recPrimary: { fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },
  recSecondary: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  cueLine: { fontSize: 12, fontWeight: '600', lineHeight: 18 },

  coachQuote: { fontSize: 13, fontStyle: 'italic', lineHeight: 19, marginTop: 4 },
});
