/**
 * 2026-06-15 (Tim — the 20-min "get me ready" routine) — PRE-ROUND PLAN COMPOSER.
 *
 * The adaptive heart of the pre-round warm-up ([[time-constrained-golfer-lens]]):
 * you give it a TIME BUDGET (you actually have) + a focus, and it COMPOSES a
 * sequence that fits — never a fixed regimen. Pure / sync / no I/O / never throws.
 *
 * Principles baked in:
 *   - Time-honest: the plan fits the minutes you picked; tighter time drops the
 *     lower-ROI steps first, it never tells you to "be there an hour early".
 *   - Momentum-first: ALWAYS opens loose (stretch) and ALWAYS ends on a
 *     confidence ball — you walk to the first tee feeling dangerous, not drilled.
 *   - Every step maps to a REAL capability (no decoration): stretch (caddie),
 *     setup check (live), swings (Smart Motion), brief (/api/preround).
 *
 * Readiness is NOT computed here — the screen derives it from steps actually
 * completed (honest), never a fabricated score.
 */

import { ACCENT_GREEN, ACCENT_AMBER, ACCENT_SKY } from '../../theme/tokens';

export type PreroundFocus = 'tempo' | 'contact' | 'power' | 'general';

export type PreroundStepKind = 'stretch' | 'setup' | 'swings' | 'brief' | 'finish';

export interface PreroundStep {
  id: string;
  kind: PreroundStepKind;
  title: string;
  /** One-line focus for the step. */
  focus: string;
  /** Allocated minutes (advisory — adapts to the budget). */
  minutes: number;
  /** Ionicons name for the card. */
  icon: string;
  /** Per-card accent. */
  accent: string;
  /** Club emphasis for swing steps (display only). */
  club?: 'wedge' | '7-iron' | 'driver' | 'your money club';
}

export interface PreroundPlan {
  minutes: number;
  focus: PreroundFocus;
  steps: PreroundStep[];
  /** Sum of allocated step minutes (may differ slightly from the budget). */
  allocated: number;
}

// 2026-06-23 (Tim) — disciplined 3-color brand palette. Retired the prior
// rainbow (cyan/lime/pink/orange/purple/blue/green) down to GREEN / AMBER / SKY.
//   SKY   — prep/read steps (Loosen Up, Setup Check, First-Tee Brief)
//   AMBER — swing/tempo/warmth steps (Wedge, 7-Iron, Driver)
//   GREEN — the anchor/confidence finish (Confidence Ball)
const ACCENT = {
  stretch: ACCENT_SKY,
  setup: ACCENT_SKY,
  wedge: ACCENT_AMBER,
  iron: ACCENT_AMBER,
  driver: ACCENT_AMBER,
  brief: ACCENT_SKY,
  finish: ACCENT_GREEN,
};

/**
 * Compose a pre-round plan for a time budget (minutes) + focus. The sequence is
 * ALWAYS stretch → setup → [swings…] → brief → confidence finish; tighter budgets
 * drop the middle swing steps (lowest ROI under time pressure) but NEVER drop the
 * open-loose or the confidence close. Clamps minutes to [5, 45].
 */
export function composePreroundPlan(input: { minutes: number; focus?: PreroundFocus }): PreroundPlan {
  const minutes = Math.max(5, Math.min(45, Math.round(input.minutes || 20)));
  const focus: PreroundFocus = input.focus ?? 'tempo';

  // Which swing steps survive the budget (ROI order: iron is the core warm-up
  // club, then wedge for contact, then driver for free speed). Focus re-weights
  // which club leads but never removes the iron from anything but the tightest plan.
  const swings: PreroundStep[] = [];
  const pushSwing = (club: 'wedge' | '7-iron' | 'driver', mins: number) => {
    const map = {
      wedge: { id: 'wedge', title: 'Wedge Swings', focus: 'Solid contact, smooth half-swings', icon: 'golf-outline', accent: ACCENT.wedge },
      '7-iron': { id: 'iron', title: '7-Iron Swings', focus: 'Tempo & rhythm — your warm-up club', icon: 'golf-outline', accent: ACCENT.iron },
      driver: { id: 'driver', title: 'Driver Swings', focus: 'Free speed, stay relaxed', icon: 'golf-outline', accent: ACCENT.driver },
    } as const;
    const m = map[club];
    swings.push({ ...m, kind: 'swings', minutes: mins, club });
  };

  if (minutes <= 10) {
    // Tight: just the warm-up club.
    pushSwing('7-iron', 3);
  } else if (minutes <= 20) {
    pushSwing('wedge', 3);
    pushSwing('7-iron', 4);
    pushSwing('driver', 3);
  } else {
    pushSwing('wedge', 5);
    pushSwing('7-iron', 6);
    pushSwing('driver', 5);
  }

  // Focus re-orders the swing emphasis (lead with the focus club) without dropping any.
  const lead: Record<PreroundFocus, string> = { tempo: 'iron', contact: 'wedge', power: 'driver', general: 'iron' };
  swings.sort((a, b) => (a.id === lead[focus] ? -1 : b.id === lead[focus] ? 1 : 0));

  const stretchMin = minutes <= 10 ? 2 : minutes <= 20 ? 3 : 4;
  const finishMin = minutes <= 10 ? 2 : minutes <= 20 ? 3 : 4;

  const steps: PreroundStep[] = [
    { id: 'stretch', kind: 'stretch', title: 'Loosen Up', focus: 'Mobility & rotation — get the body ready', minutes: stretchMin, icon: 'body-outline', accent: ACCENT.stretch },
    { id: 'setup', kind: 'setup', title: 'Setup Check', focus: 'Grip, stance, ball position — fundamentals dialed', minutes: minutes <= 10 ? 1 : 2, icon: 'scan-outline', accent: ACCENT.setup },
    ...swings,
    // Brief only when there's room (>10 min) — it's mental prep, not a swing.
    ...(minutes > 10 ? [{ id: 'brief', kind: 'brief' as const, title: 'First-Tee Brief', focus: 'One focus for today — settle in', minutes: minutes <= 20 ? 2 : 3, icon: 'flag-outline', accent: ACCENT.brief }] : []),
    { id: 'finish', kind: 'finish', title: 'Confidence Ball', focus: 'End on a pure one — take it to the tee', minutes: finishMin, icon: 'sparkles-outline', accent: ACCENT.finish, club: 'your money club' },
  ];

  const allocated = steps.reduce((sum, s) => sum + s.minutes, 0);
  return { minutes, focus, steps, allocated };
}

/** Honest readiness from steps actually completed — NEVER a fabricated score.
 *  Returns 0..1; the screen renders it as a progress ring + "N of M". */
export function preroundReadiness(totalSteps: number, completedSteps: number): number {
  if (totalSteps <= 0) return 0;
  return Math.max(0, Math.min(1, completedSteps / totalSteps));
}
