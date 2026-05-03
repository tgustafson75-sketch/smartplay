import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { PrimaryIssue } from '../../store/cageStore';

/**
 * Phase J — Primary Issue Card.
 *
 * Reserved-slot pattern from Addendum 4. Phase J ships the component with an
 * honest "analysis coming soon" placeholder when issue is null. Phase K
 * populates the field; the component then renders the full card automatically
 * — no consumer-site changes required.
 *
 * Card shape (when populated):
 *   Issue category icon · Issue name (large) · Severity dot
 *   "Detected in N of M swings"
 *   Visual reference (when an asset path is set)
 *   Mechanical breakdown (Coach voice)
 *   Feel cue (Coach voice, distinct treatment)
 */

type Props = {
  issue: PrimaryIssue | null;
  totalShots: number;
};

const CATEGORY_ICON: Record<PrimaryIssue['category'], string> = {
  club_face: '🎯',
  swing_path: '↗️',
  attack_angle: '📐',
  tempo: '🎵',
  setup: '👤',
  other: '🔍',
};

const SEVERITY_COLOR: Record<PrimaryIssue['severity'], string> = {
  minor: '#00C896',
  moderate: '#F5A623',
  significant: '#ef4444',
};

const SEVERITY_LABEL: Record<PrimaryIssue['severity'], string> = {
  minor: 'MINOR',
  moderate: 'MODERATE',
  significant: 'SIGNIFICANT',
};

export default function PrimaryIssueCard({ issue, totalShots }: Props) {
  if (!issue) {
    return (
      <View style={[styles.card, styles.cardPlaceholder]}>
        <Text style={styles.placeholderHeader}>SWING ANALYSIS</Text>
        <Text style={styles.placeholderBody}>
          Detailed swing analysis is coming soon. Once pose detection is on, the primary issue from your session will land here.
        </Text>
      </View>
    );
  }

  // Phase V.6 — tentative-read caveat. When the upload pipeline produced
  // a single-swing or fallback classification with low confidence, prefix
  // the mechanical breakdown so the player understands the read isn't a
  // multi-swing consensus.
  const isTentative = issue.confidence === 'low';
  const breakdown = isTentative
    ? "Tentative read — your swing was hard to read clearly, but " + lowercaseFirst(issue.mechanical_breakdown)
    : issue.mechanical_breakdown;

  return (
    <View style={[styles.card, { borderColor: SEVERITY_COLOR[issue.severity] }]}>
      <View style={styles.headerRow}>
        <Text style={styles.categoryIcon}>{CATEGORY_ICON[issue.category]}</Text>
        <View style={styles.titleCol}>
          <Text style={styles.title}>{issue.name}</Text>
          <Text style={styles.occurrence}>
            Detected in {issue.occurrence_count} of {totalShots} swings
            {isTentative ? ' · tentative' : ''}
          </Text>
        </View>
        <View style={[styles.severityChip, { borderColor: SEVERITY_COLOR[issue.severity] }]}>
          <Text style={[styles.severityText, { color: SEVERITY_COLOR[issue.severity] }]}>
            {SEVERITY_LABEL[issue.severity]}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <Text style={styles.sectionLabel}>WHAT&apos;S HAPPENING</Text>
      <Text style={styles.body}>{breakdown}</Text>

      <Text style={[styles.sectionLabel, styles.feelLabel]}>FEEL CUE</Text>
      <View style={styles.feelBox}>
        <Text style={styles.feelText}>{issue.feel_cue}</Text>
      </View>
    </View>
  );
}

function lowercaseFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0d2418',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#1e3a28',
    padding: 14,
    marginBottom: 14,
  },
  cardPlaceholder: {
    borderStyle: 'dashed',
    borderColor: '#1e3a28',
  },
  placeholderHeader: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  placeholderBody: { color: '#9ca3af', fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  categoryIcon: { fontSize: 26, width: 36, textAlign: 'center' },
  titleCol: { flex: 1 },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  occurrence: { color: '#9ca3af', fontSize: 11, marginTop: 4 },
  severityChip: {
    borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  severityText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  divider: { height: 1, backgroundColor: '#1e3a28', marginVertical: 12 },
  sectionLabel: { color: '#00C896', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 6 },
  feelLabel: { color: '#F5A623', marginTop: 12 },
  body: { color: '#e8f5e9', fontSize: 13, lineHeight: 19 },
  feelBox: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderLeftWidth: 3,
    borderLeftColor: '#F5A623',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 4,
  },
  feelText: { color: '#e8f5e9', fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
});
