/**
 * 2026-05-25 — Planned vs Outcome card.
 *
 * Per-hole side-by-side of what the player PLANNED (HolePlan.markers —
 * club_intent for tee/approach/pin, set during pre-round briefing) vs
 * what they ACTUALLY HIT (ShotResult — club, direction, outcome,
 * end_location). Reads HoleComparison.matched_shots (already built by
 * recapGenerator) so this component is a pure render — no matching
 * logic, no math.
 *
 * Empty/missing handling:
 *   - No plan for the hole       → renders a single "No plan recorded" row
 *   - Plan exists but no shots   → caller shouldn't render the card; if
 *                                  it does anyway, returns null
 *   - Plan + shots but a given marker has no club_intent → "—" in plan col
 *   - Missing distance_from_intended (GPS gap) → omit the delta line
 *
 * Visual contract: green accent for on-plan, amber for missed-left/right
 * /short/long, red for off-plan. Matches the recap row variance palette.
 *
 * Lives below the HoleShotMap on the per-hole recap screen so the user
 * sees their intent immediately after the visual shot trace. Also a
 * potential embed in app/recap/[round_id].tsx hole expansion if Tim
 * wants it on the round overview.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { HoleComparison, MatchedShot } from '../../types/plan';

interface Props {
  comparison: HoleComparison;
}

const MARKER_LABEL: Record<MatchedShot['plan_marker'], string> = {
  tee: 'Tee',
  approach: 'Approach',
  pin: 'To pin',
};

const RESULT_LABEL: Record<MatchedShot['result'], string> = {
  on_plan: 'on plan',
  missed_left: 'left',
  missed_right: 'right',
  long: 'long',
  short: 'short',
  off_plan: 'off plan',
};

function resultColor(r: MatchedShot['result']): string {
  if (r === 'on_plan') return '#00C896';
  if (r === 'off_plan') return '#ef4444';
  return '#f59e0b';
}

export default function PlannedVsOutcomeCard({ comparison }: Props) {
  if (comparison.matched_shots.length === 0) return null;
  const plan = comparison.plan;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>PLANNED VS OUTCOME</Text>

      {!plan ? (
        <Text style={styles.empty}>No plan was recorded for this hole.</Text>
      ) : (
        <View style={styles.rows}>
          {comparison.matched_shots.map((m, i) => {
            const markerPlan =
              m.plan_marker === 'tee' ? plan.markers.tee :
              m.plan_marker === 'approach' ? plan.markers.approach :
              plan.markers.pin;
            const plannedClub = markerPlan?.club_intent ?? '—';
            const shot = m.actual_shot;
            const actualClub = shot.club ?? '—';
            const dir = shot.direction ?? null;
            const outcome = shot.outcome ?? null;
            const distFromIntended = m.distance_from_intended;

            return (
              <View key={i} style={styles.row}>
                <View style={styles.markerCol}>
                  <Text style={styles.markerLabel}>{MARKER_LABEL[m.plan_marker]}</Text>
                  <Text style={styles.shotIdx}>Shot {i + 1}</Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.colHead}>PLANNED</Text>
                  <Text style={styles.colValue}>{plannedClub}</Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.colHead}>ACTUAL</Text>
                  <Text style={styles.colValue}>
                    {actualClub}
                    {dir ? ' · ' + dir : ''}
                  </Text>
                  {outcome && outcome !== 'clean' ? (
                    <Text style={styles.outcomeText}>{outcome}</Text>
                  ) : null}
                </View>
                <View style={styles.verdictCol}>
                  <Text style={[styles.verdict, { color: resultColor(m.result) }]}>
                    {RESULT_LABEL[m.result]}
                  </Text>
                  {distFromIntended != null && (
                    <Text style={styles.delta}>{Math.round(distFromIntended)}y off</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0d2418',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 14,
    marginTop: 12,
    marginHorizontal: 12,
  },
  title: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 10 },
  empty: { color: '#94a3b8', fontSize: 13, fontStyle: 'italic' },
  rows: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1e3a28',
    gap: 8,
  },
  markerCol: { width: 70 },
  markerLabel: { color: '#f8fafc', fontSize: 13, fontWeight: '700' },
  shotIdx: { color: '#64748b', fontSize: 11, marginTop: 2 },
  col: { flex: 1 },
  colHead: { color: '#64748b', fontSize: 9, fontWeight: '700', letterSpacing: 0.6, marginBottom: 2 },
  colValue: { color: '#f8fafc', fontSize: 13, fontWeight: '600' },
  outcomeText: { color: '#f59e0b', fontSize: 11, marginTop: 2 },
  verdictCol: { width: 70, alignItems: 'flex-end' },
  verdict: { fontSize: 12, fontWeight: '700' },
  delta: { color: '#94a3b8', fontSize: 10, marginTop: 2 },
});
