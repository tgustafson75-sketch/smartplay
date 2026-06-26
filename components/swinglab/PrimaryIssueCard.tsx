import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  // 2026-05-24 — Progressive-disclosure state for layman_explanation.
  // Collapsed by default per spec; the expert term stays the always-
  // visible headline (trust), and the plain-language line is revealed
  // beneath via an explicit "What does this mean?" affordance. Hooks
  // must be declared unconditionally — keep this above the !issue
  // early return.
  const [explainOpen, setExplainOpen] = useState(false);

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

  // 2026-05-24 — Hide the "What does this mean?" affordance entirely
  // when the server didn't produce a translation (legacy deploy,
  // 'none'/invalid issue, or the putt synthesizer which doesn't
  // produce layman_explanation yet — that's the parallel follow-up).
  const layman = (issue.layman_explanation ?? '').trim();
  const hasLayman = layman.length > 0;

  // 2026-06-14 (Tim) — "we go fault, fault, fault, but never say what you did
  // well." Lead the card with the model's genuinely-observed strengths (setup
  // fundamentals + finish balance, often carrying a causal rule-out). Hidden
  // entirely until /api/swing-analysis `strengths` deploys (back-compat).
  const strengths = (issue.strengths ?? []).filter((s) => typeof s === 'string' && s.trim().length > 0);
  const hasStrengths = strengths.length > 0;

  // 2026-06-24 — Causal first-domino framing. When the multi-swing consensus
  // led with the ROOT cause and there are downstream symptoms, surface the
  // growth-coaching line so the player gets ONE thing to work on (encouraging)
  // and understands the rest settle down once the root is fixed. The card
  // headline (issue.name) IS already the root; this block names the symptoms.
  // Honest framing only — "likely settle down", never a measurement claim.
  // Absent on single-issue / null-mapped / pre-deploy sessions → block hidden.
  const downstreamSymptoms = (issue.downstream_symptoms ?? []).filter(
    (s) => typeof s === 'string' && s.trim().length > 0,
  );
  const hasCausalFraming = downstreamSymptoms.length > 0;
  const symptomsList =
    downstreamSymptoms.length === 1
      ? downstreamSymptoms[0]
      : downstreamSymptoms.length === 2
        ? `${downstreamSymptoms[0]} and ${downstreamSymptoms[1]}`
        : downstreamSymptoms.slice(0, -1).join(', ') + ', and ' + downstreamSymptoms[downstreamSymptoms.length - 1];

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

      {hasLayman && (
        <TouchableOpacity
          onPress={() => setExplainOpen(open => !open)}
          style={styles.explainToggle}
          accessibilityRole="button"
          accessibilityLabel={explainOpen ? 'Hide plain-language explanation' : 'Show plain-language explanation'}
          accessibilityState={{ expanded: explainOpen }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons
            name={explainOpen ? 'information-circle' : 'information-circle-outline'}
            size={15}
            color="#7dd3a8"
            style={{ marginRight: 5 }}
          />
          <Text style={styles.explainToggleText}>
            {explainOpen ? 'Hide explanation' : 'What does this mean?'}
          </Text>
          <Ionicons
            name={explainOpen ? 'chevron-up' : 'chevron-down'}
            size={13}
            color="#7dd3a8"
            style={{ marginLeft: 4 }}
          />
        </TouchableOpacity>
      )}

      {hasLayman && explainOpen && (
        <View style={styles.laymanBox}>
          <Text style={styles.laymanText}>{layman}</Text>
        </View>
      )}

      <View style={styles.divider} />

      {hasStrengths && (
        <View style={styles.strengthsBox}>
          <Text style={styles.strengthsLabel}>WHAT&apos;S WORKING</Text>
          {strengths.map((s, i) => (
            <View key={i} style={styles.strengthRow}>
              <Ionicons name="checkmark-circle" size={15} color="#3FB950" style={{ marginRight: 6, marginTop: 1 }} />
              <Text style={styles.strengthText}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 2026-06-24 — Causal first-domino block. The headline above IS the
          root; this names the downstream symptoms and gives the growth line:
          fix this one thing and the rest settle down. Honest framing (the
          consensus ranked these as the EARLIEST-causal of the detected faults
          — coaching, not a measured link). Only rendered when the session
          surfaced 2+ distinct mapped issues. */}
      {hasCausalFraming && (
        <View style={styles.firstDominoBox}>
          <View style={styles.firstDominoHeader}>
            <Ionicons name="git-branch-outline" size={14} color="#00C896" style={{ marginRight: 6 }} />
            <Text style={styles.firstDominoLabel}>START HERE — FIRST DOMINO</Text>
          </View>
          <Text style={styles.firstDominoText}>
            Work on <Text style={styles.firstDominoEmph}>{issue.name.toLowerCase()}</Text> first. Fix this one thing and {symptomsList.toLowerCase()} should settle down with it.
          </Text>
        </View>
      )}

      {/* 2026-05-24 — GolfFix #1 + S1.1 structured render. Branch order
          matters:
          - 'inconclusive' → honest "footage unreadable" callout. No
            cause/fix/drill (server forces empty).
          - 'no_dominant_fault' → readable swing but no dominant fault.
            Render the structured payload (strongest area to refine /
            genuine strength) WITHOUT alarming severity language.
          - diagnostic fault with fix + drill → EVIDENCE → CAUSE → FIX →
            DRILL. Evidence is the S1.1 calibration gate — surface the
            frame-specific cue so the player sees WHY the call was made.
          - legacy / putt fallback → original mechanical_breakdown +
            feel_cue layout (no primary_fault present). */}
      {issue.primary_fault === 'inconclusive' ? (
        <View style={styles.inconclusiveBox}>
          <Text style={styles.sectionLabel}>NOT ENOUGH TO READ YET</Text>
          <Text style={styles.body}>
            I couldn&apos;t read this recording clearly. Try a clearer angle (down-the-line from behind, or face-on from the front) so I can give you a specific fix.
          </Text>
        </View>
      ) : issue.primary_fault === 'no_dominant_fault' && issue.fix && issue.drill ? (
        <>
          <View style={styles.noDominantBox}>
            <Text style={styles.sectionLabel}>NO DOMINANT FAULT</Text>
            <Text style={styles.body}>
              I read the swing — nothing dominant jumped out. Here&apos;s the strongest area to work on next.
            </Text>
          </View>

          {issue.evidence ? (
            <>
              <Text style={[styles.sectionLabel, styles.evidenceLabel]}>EVIDENCE</Text>
              <View style={styles.evidenceBox}>
                <Text style={styles.evidenceText}>{issue.evidence}</Text>
              </View>
            </>
          ) : null}

          {issue.cause ? (
            <>
              <Text style={styles.sectionLabel}>OBSERVED</Text>
              <Text style={styles.body}>{issue.cause}</Text>
            </>
          ) : null}

          <Text style={[styles.sectionLabel, styles.fixLabel]}>WORK ON</Text>
          <View style={styles.fixBox}>
            <Text style={styles.fixText}>{issue.fix}</Text>
          </View>

          <Text style={[styles.sectionLabel, styles.drillLabel]}>DRILL</Text>
          <View style={styles.drillBox}>
            <Text style={styles.drillText}>{issue.drill}</Text>
          </View>
        </>
      ) : issue.fix && issue.drill ? (
        <>
          {issue.evidence ? (
            <>
              <Text style={[styles.sectionLabel, styles.evidenceLabel]}>EVIDENCE</Text>
              <View style={styles.evidenceBox}>
                <Text style={styles.evidenceText}>{issue.evidence}</Text>
              </View>
            </>
          ) : null}

          <Text style={styles.sectionLabel}>CAUSE</Text>
          <Text style={styles.body}>{issue.cause || breakdown}</Text>

          <Text style={[styles.sectionLabel, styles.fixLabel]}>FIX</Text>
          <View style={styles.fixBox}>
            <Text style={styles.fixText}>{issue.fix}</Text>
          </View>

          <Text style={[styles.sectionLabel, styles.drillLabel]}>DRILL</Text>
          <View style={styles.drillBox}>
            <Text style={styles.drillText}>{issue.drill}</Text>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.sectionLabel}>WHAT&apos;S HAPPENING</Text>
          <Text style={styles.body}>{breakdown}</Text>

          <Text style={[styles.sectionLabel, styles.feelLabel]}>FEEL CUE</Text>
          <View style={styles.feelBox}>
            <Text style={styles.feelText}>{issue.feel_cue}</Text>
          </View>
        </>
      )}
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
  // 2026-05-24 — GolfFix #1 structured-card styles. Distinct visual
  // treatments for CAUSE (informational, no chrome), FIX (actionable
  // accent, like the existing feel_cue but green), and DRILL (a
  // separate box with a play icon-color tint so users can tell at a
  // glance "this is what I should DO at the range").
  fixLabel: { color: '#00C896', marginTop: 12 },
  fixBox: {
    backgroundColor: 'rgba(0,200,150,0.07)',
    borderLeftWidth: 3,
    borderLeftColor: '#00C896',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 4,
  },
  fixText: { color: '#e8f5e9', fontSize: 13, lineHeight: 19, fontWeight: '600' },
  drillLabel: { color: '#7dd3a8', marginTop: 12 },
  drillBox: {
    backgroundColor: 'rgba(125,211,168,0.06)',
    borderLeftWidth: 3,
    borderLeftColor: '#7dd3a8',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 4,
  },
  drillText: { color: '#e8f5e9', fontSize: 13, lineHeight: 19 },
  inconclusiveBox: {
    backgroundColor: 'rgba(156,163,175,0.06)',
    borderLeftWidth: 3,
    borderLeftColor: '#9ca3af',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 4,
  },
  noDominantBox: {
    backgroundColor: 'rgba(125,211,168,0.05)',
    borderLeftWidth: 3,
    borderLeftColor: '#7dd3a8',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 4,
    marginBottom: 8,
  },
  // 2026-05-24 S1.1 — Evidence label + box. Subtle grey treatment so it
  // reads as a citation under the fault headline, not as another
  // actionable section. "Frame N: <cue>" — the proof the fault wasn't
  // a default guess.
  evidenceLabel: { color: '#9ca3af', marginTop: 8 },
  evidenceBox: {
    backgroundColor: 'rgba(156,163,175,0.05)',
    borderLeftWidth: 2,
    borderLeftColor: '#9ca3af',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    marginBottom: 4,
  },
  evidenceText: { color: '#d1d5db', fontSize: 12, lineHeight: 17, fontStyle: 'italic' },
  // 2026-05-24 — Progressive-disclosure affordance for the
  // layman_explanation. Inline button beneath the headline; tapping
  // toggles the laymanBox below. No fixed heights — text wraps so
  // Z Fold / narrow-screen layouts breathe.
  explainToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  explainToggleText: {
    color: '#7dd3a8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  laymanBox: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 6,
    backgroundColor: 'rgba(0,200,150,0.06)',
    borderLeftWidth: 3,
    borderLeftColor: '#00C896',
  },
  laymanText: { color: '#e8f5e9', fontSize: 13, lineHeight: 20 },
  // 2026-06-14 (Tim) — strengths block. Green, leads the structured body so
  // the player hears what's working before the fault. Distinct from the
  // amber/teal fault treatments.
  strengthsBox: {
    backgroundColor: 'rgba(63,185,80,0.07)',
    borderLeftWidth: 3,
    borderLeftColor: '#3FB950',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 4,
    marginBottom: 12,
  },
  strengthsLabel: { color: '#3FB950', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 6 },
  strengthRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 2 },
  strengthText: { color: '#e8f5e9', fontSize: 13, lineHeight: 19, flex: 1, fontWeight: '600' },
  // 2026-06-24 — first-domino / causal-root block. Teal accent, sits above the
  // structured fault body so the player sees the ONE thing to start with.
  firstDominoBox: {
    backgroundColor: 'rgba(0,200,150,0.07)',
    borderLeftWidth: 3,
    borderLeftColor: '#00C896',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 4,
    marginBottom: 12,
  },
  firstDominoHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  firstDominoLabel: { color: '#00C896', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  firstDominoText: { color: '#e8f5e9', fontSize: 13, lineHeight: 20 },
  firstDominoEmph: { color: '#fff', fontWeight: '800' },
});
