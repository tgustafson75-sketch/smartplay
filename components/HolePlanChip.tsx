/**
 * THE PLAN CHIP — one collapsed line of the hole plan, above the data strip.
 *
 * 2026-09-11 (Tim, approved per the layout freeze). services/holePlan computes the plan and the
 * caddie will speak it when asked, but a plan you have to ask for out loud is a plan you forget you
 * have. This puts the shape of the hole where the player can glance at it: "3W → 145 → 8I".
 *
 * ─── WHY IT IS POSITIONED, NOT INSERTED ────────────────────────────────────────────────────────
 *
 * The whole-app layout freeze of 2026-07-29 stands ("BEAUTIFUL", no position change without a
 * per-change OK), and CaddieDataStrip carries its own instruction to sit as LOW as possible —
 * bottom: 0, height 84. So this is absolutely positioned directly above it rather than added to any
 * flow: nothing already on the screen moves by a pixel, whatever this does.
 *
 * ─── IT SHOWS WHAT THE ENGINE SAID, OR IT SHOWS NOTHING ────────────────────────────────────────
 *
 * planHole returns null rather than guessing when the par or the bag is unknown, and this renders
 * nothing at all in that case. No placeholder, no "—", no "calculating". A chip that shows a plan on
 * an unmapped hole would be inventing one, and this is read at a glance and trusted.
 * [[illustration-data-points]] [[no-deferred-wiring-placeholders]]
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import type { HolePlan } from '../services/holePlan';

export interface HolePlanChipProps {
  plan: HolePlan | null;
  /** Shots in hand against the round goal, already composed. Null when there is no goal. */
  budgetLine?: string | null;
  /** Height of the data strip this sits above, so the two never overlap. */
  bottomOffset?: number;
  visible?: boolean;
}

/** "3W → 145 → 8I" — the shape of the hole in one glance. */
export function planShorthand(plan: HolePlan): string {
  const parts: string[] = [];
  for (const s of plan.steps) {
    parts.push(s.club);
    if (s.leavesYards > 0) parts.push(String(s.leavesYards));
  }
  return parts.join(' → ');
}

export default function HolePlanChip({
  plan, budgetLine = null, bottomOffset = 84, visible = true,
}: HolePlanChipProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(false);

  // No plan is a real answer, and the honest one. Render nothing rather than a shell.
  if (!plan || !visible || plan.steps.length === 0) return null;

  const target = plan.playingFor === 'par' ? t('holeplan.par') : `${plan.targetScore}`;

  return (
    <View style={[styles.wrap, { bottom: bottomOffset }]} pointerEvents="box-none">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={[styles.chip, { backgroundColor: c.surface_elevated, borderColor: c.border }]}
        accessibilityRole="button"
        accessibilityLabel={`Hole plan, playing for ${target}. ${planShorthand(plan)}. Tap to ${open ? 'collapse' : 'expand'}.`}
      >
        <View style={styles.headRow}>
          <Text style={[styles.label, { color: c.text_muted }]}>{t('holeplan.label')}</Text>
          <Text style={[styles.target, { color: c.accent }]}>{target}</Text>
          {budgetLine ? (
            <Text style={[styles.budget, { color: c.text_secondary }]} numberOfLines={1}>
              {budgetLine}
            </Text>
          ) : null}
          <Text style={[styles.caret, { color: c.text_muted }]}>{open ? '▴' : '▾'}</Text>
        </View>
        <Text style={[styles.shorthand, { color: c.text_primary }]} numberOfLines={1}>
          {planShorthand(plan)}
        </Text>
        {open ? (
          <View style={styles.expanded}>
            {plan.steps.map((s) => (
              <Text key={s.shot} style={[styles.step, { color: c.text_secondary }]}>
                {s.shot}. {s.club} — {s.why}
                {s.leavesYards > 0 ? `, leaving ${s.leavesYards}` : ''}
              </Text>
            ))}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 4 },
  chip: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignSelf: 'stretch',
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  target: { fontSize: 12, fontWeight: '700' },
  budget: { fontSize: 11, flex: 1 },
  caret: { fontSize: 11, marginLeft: 'auto' },
  shorthand: { fontSize: 15, fontWeight: '600', marginTop: 2 },
  expanded: { marginTop: 6, gap: 3 },
  step: { fontSize: 12, lineHeight: 16 },
});
