/**
 * Phase T — Handicap impact card for the recap surface.
 *
 * Computes Score Differential from the round's adjusted gross score
 * (capped per-hole at net double bogey via handicapCalculator), shows
 * the differential + plain-language Index impact, and offers an
 * "Update Index?" CTA that appends the differential to the user's
 * recent_differentials list.
 *
 * Hidden entirely when the user hasn't set their Handicap Index — no
 * point teasing handicap features at users who haven't opted in.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import AppIcon from '../AppIcon';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { computeRoundHandicap, estimateNewIndex } from '../../services/handicapCalculator';

/**
 * Phase V — confidence band for the Index estimate. WHS itself doesn't
 * issue a definitive Index until you have 20 rounds; below that the
 * estimate is informational. Surface the confidence so the user reads
 * the number with appropriate trust.
 */
type IndexConfidence = 'low' | 'medium' | 'high';
function confidenceForN(n: number): IndexConfidence {
  if (n >= 10) return 'high';
  if (n >= 5) return 'medium';
  return 'low';
}
const CONFIDENCE_COLORS: Record<IndexConfidence, string> = {
  low: '#fbbf24', medium: '#60a5fa', high: '#00C896',
};
const CONFIDENCE_LABELS: Record<IndexConfidence, string> = {
  low: 'Low confidence — keep posting',
  medium: 'Medium confidence',
  high: 'High confidence',
};

export default function HandicapImpactCard({ roundId }: { roundId: string | null }) {
  const router = useRouter();
  const handicapIndex = usePlayerProfileStore(s => s.handicap_index);
  const recentDifferentials = usePlayerProfileStore(s => s.recent_differentials);
  const pushDifferential = usePlayerProfileStore(s => s.pushDifferential);
  const setHandicapIndex = usePlayerProfileStore(s => s.setHandicapIndex);

  const round = useRoundStore(s => s.roundHistory.find(r => r.id === roundId) ?? null);
  const courseHoles = useRoundStore(s => s.courseHoles);

  const [posted, setPosted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // 2026-06-06 — Phase 6.1 followup: when the viewed round is 9-hole,
  // scale par + AGS × 2 to produce the 18-hole-equivalent differential.
  // Without this, the recap card showed differential ≈ −15 next to the
  // already-correct Index (endRound + rebuild were scaled in 5b722ca
  // but this card was a separate push path that the audit missed).
  // Tapping "Update Index?" then pushed the wrong unscaled diff AGAIN.
  const is9Hole = round?.holesPlayed === 9;
  // 2026-06-16 (Tim — recap showed a -33.0 differential on an 8-hole round) — a
  // Score Differential is only valid for a COMPLETE 9- or 18-hole round. A partial
  // round (e.g. 8 holes) compared the partial AGS against the FULL 18-hole rating
  // → a wildly-negative bogus differential that also craters the Index estimate.
  // Only postable rounds compute a differential; partials show an honest message.
  const holesPlayed = round ? (round.holesPlayed ?? Object.keys(round.scores ?? {}).length) : 0;
  const isPostable = holesPlayed === 9 || holesPlayed === 18;
  const result = useMemo(() => {
    if (handicapIndex == null || !round || !isPostable) return null;
    // Best-available rating + slope. Phase Q.5b's getHoleGeometry would be
    // the upgraded path; for v1.0 we read whatever's on the courseHoles
    // record (may be missing — fall back to neutral 113 / par-as-rating).
    const tee = courseHoles[0] as ({ course_rating?: number; slope_rating?: number } | undefined);
    const par = courseHoles.reduce((a, h) => a + h.par, 0) || 72;
    const rating = tee?.course_rating ?? par;
    const slope = tee?.slope_rating ?? 113;

    const holes = Object.entries(round.scores).map(([h, score]) => ({
      hole_number: Number(h),
      par: courseHoles.find(c => c.hole === Number(h))?.par ?? 4,
      score,
      hole_stroke_index: Number(h),
    }));

    // 9-hole scaling: use 18-hole-equivalent par for course-handicap
    // math; the computeRoundHandicap helper internally computes AGS
    // from the 9 holes and a differential from that AGS, so we need
    // to post-scale the differential AND adjusted-gross-score by ×2
    // (and the raw_score for the display only — actual user score
    // stays as-is in the round record).
    const equivalentPar = is9Hole ? par * 2 : par;
    const out = computeRoundHandicap({
      handicapIndex,
      courseRating: rating,
      slopeRating: slope,
      par: equivalentPar,
      holes,
      recentDifferentials,
    });
    if (is9Hole) {
      return {
        ...out,
        adjusted_gross_score: out.adjusted_gross_score * 2,
        score_differential: Math.round(((113 / slope) * ((out.adjusted_gross_score * 2) - rating)) * 10) / 10,
      };
    }
    return out;
  }, [handicapIndex, round, courseHoles, recentDifferentials, is9Hole, isPostable]);

  // Sim-report gap #4 — when the player hasn't set their Handicap Index
  // yet, render a small invitation card instead of hiding the surface.
  // Mike-style users never discover the handicap features otherwise.
  if (handicapIndex == null) {
    if (dismissed) return null;
    return (
      <View style={[styles.card, styles.cardSetup]}>
        <View style={styles.headerRow}>
          <AppIcon name="stats-chart-outline" size={18} color="#00C896" />
          <Text style={styles.headerTitle}>Track Your Index</Text>
        </View>
        <Text style={styles.impact}>
          Set your Handicap Index once and SmartPlay tracks it automatically after each round — Score Differential, Course Handicap, the works.
        </Text>
        <View style={styles.ctaRow}>
          <TouchableOpacity
            style={[styles.cta, styles.ctaPrimary]}
            onPress={() => router.push('/settings' as never)}
          >
            <Text style={styles.ctaPrimaryText}>Set Index</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cta} onPress={() => setDismissed(true)}>
            <Text style={styles.ctaText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  if (!round) return null;
  if (dismissed) return null;
  // Incomplete round — honest message, no bogus differential.
  if (!isPostable) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <AppIcon name="stats-chart-outline" size={18} color="#00C896" />
          <Text style={styles.headerTitle}>Handicap Impact</Text>
        </View>
        <Text style={styles.impact}>
          {holesPlayed} {holesPlayed === 1 ? 'hole' : 'holes'} in the books — finish 9 or 18 to post a Score Differential to your Index. The round&apos;s saved either way.
        </Text>
      </View>
    );
  }
  if (!result) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <AppIcon name="stats-chart-outline" size={18} color="#00C896" />
        <Text style={styles.headerTitle}>Handicap Impact</Text>
      </View>

      <View style={styles.statsRow}>
        <Stat label="DIFFERENTIAL" value={result.score_differential.toFixed(1)} accent />
        {result.adjusted_gross_score !== result.raw_score && (
          <Stat label="ADJUSTED" value={String(result.adjusted_gross_score)} sub={`raw ${result.raw_score}`} />
        )}
        <Stat label="COURSE HCP" value={String(result.course_handicap)} />
      </View>

      <Text style={styles.impact}>{result.estimated_index_impact}</Text>

      {/* Phase V — confidence band tied to differential count */}
      {(() => {
        const n = recentDifferentials.length + (posted ? 1 : 0);
        const conf = confidenceForN(n);
        return (
          <View style={[styles.confidenceRow, { borderColor: CONFIDENCE_COLORS[conf] }]}>
            <View style={[styles.confidenceDot, { backgroundColor: CONFIDENCE_COLORS[conf] }]} />
            <Text style={[styles.confidenceText, { color: CONFIDENCE_COLORS[conf] }]}>
              {CONFIDENCE_LABELS[conf]} · {n} round{n === 1 ? '' : 's'} on file
            </Text>
          </View>
        );
      })()}

      {!posted ? (
        <View style={styles.ctaRow}>
          <TouchableOpacity
            style={[styles.cta, styles.ctaPrimary]}
            onPress={() => {
              // Phase V — append differential AND auto-update profile Index
              // so all downstream math (Course Handicap, briefing, voice
              // queries) uses the latest estimate. Stale Index was the
              // top opportunity surfaced by the 10-round walkthrough.
              pushDifferential(result.score_differential);
              const updatedDiffs = [...recentDifferentials, result.score_differential];
              const est = estimateNewIndex(updatedDiffs);
              if (est.newIndex != null) {
                setHandicapIndex(est.newIndex);
              }
              setPosted(true);
            }}
          >
            <Text style={styles.ctaPrimaryText}>Post to my Index</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cta} onPress={() => setDismissed(true)}>
            <Text style={styles.ctaText}>Just save the round</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.posted}>
          <AppIcon name="checkmark-circle" size={16} color="#00C896" />
          <Text style={styles.postedText}>Posted. Your Index updated.</Text>
        </View>
      )}
    </View>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16, marginTop: 14, padding: 14,
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 14,
  },
  cardSetup: { borderColor: '#00C896', backgroundColor: '#0d2418' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  headerTitle: { color: '#00C896', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  stat: { alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statValueAccent: { color: '#00C896' },
  statLabel: { color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  statSub: { color: '#6b7280', fontSize: 10, marginTop: 1 },
  impact: { color: '#d1d5db', fontSize: 13, lineHeight: 19, marginVertical: 8 },
  ctaRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  cta: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderColor: '#1e3a28', borderWidth: 1, alignItems: 'center',
  },
  ctaPrimary: { backgroundColor: '#003d20', borderColor: '#00C896' },
  ctaPrimaryText: { color: '#00C896', fontSize: 13, fontWeight: '800' },
  ctaText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  posted: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 6, paddingVertical: 8,
  },
  postedText: { color: '#00C896', fontSize: 13, fontWeight: '700' },
  // Phase V — confidence band
  confidenceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderRadius: 8, marginVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  confidenceDot: { width: 8, height: 8, borderRadius: 4 },
  confidenceText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
});
