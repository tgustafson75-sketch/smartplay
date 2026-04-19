/**
 * engine/proactiveEngine.ts
 *
 * Proactive Intelligence — surfaces helpful messages without the user asking.
 *
 * Rules:
 *   - Each trigger fires at most once per qualifying condition (caller tracks shown IDs)
 *   - Messages are short and actionable, not chatty
 *   - Priority order: safety/hazard > round state > tendencies > services
 *
 * Usage (PlayScreen):
 *   const triggers = checkProactiveTriggers(context, shownIds);
 *   for (const t of triggers) {
 *     setCaddieMessage(t.message);
 *     addShownId(t.id);
 *   }
 */

import type { FocusContext } from './contextBuilder';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProactiveTrigger {
  /** Stable ID — use to deduplicate so the same message doesn't repeat */
  id: string;
  message: string;
  /** Higher = shown first */
  priority: number;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Returns zero or more proactive messages relevant to the current context.
 *
 * @param context     Current FocusContext snapshot
 * @param shownIds    Set of trigger IDs already shown this round — prevents repeats
 */
export const checkProactiveTriggers = (
  context: FocusContext,
  shownIds: ReadonlySet<string> = new Set(),
): ProactiveTrigger[] => {
  const triggers: ProactiveTrigger[] = [];

  const add = (id: string, message: string, priority: number) => {
    if (!shownIds.has(id)) {
      triggers.push({ id, message, priority });
    }
  };

  const { hole, distance, player, roundState, services, holeNote } = context;

  // ── Hazard / hole note ───────────────────────────────────────────────────
  if (holeNote) {
    add('hazard_note', `Heads up — ${holeNote}.`, 100);
  }

  // ── Round momentum ───────────────────────────────────────────────────────
  if (roundState?.momentum === 'negative') {
    add('momentum_negative', "Let's reset — one smooth swing, pick a small target.", 80);
  }
  if (roundState?.momentum === 'positive') {
    add('momentum_positive', "You're swinging it well — stay with it.", 60);
  }

  // ── Shot streak ──────────────────────────────────────────────────────────
  if (roundState?.streak === 'right') {
    add('streak_right', "Three in a row right — aim left of center here.", 90);
  }
  if (roundState?.streak === 'left') {
    add('streak_left', "Been pulling it left — start this one right of the flag.", 90);
  }

  // ── Pressure holes ───────────────────────────────────────────────────────
  if (hole === 1) {
    add('hole_1', "First hole — pick a conservative target and get into your rhythm.", 70);
  }
  if (hole === 18) {
    add('hole_18', "Last hole — commit to your target and finish strong.", 70);
  }

  // ── Scoring range (inside 100) ───────────────────────────────────────────
  if (distance != null && distance <= 100 && distance > 0) {
    add('scoring_range', `Inside 100 — this is a scoring opportunity. Pick a precise target.`, 75);
  }

  // ── Miss tendency reminder (fire once early in round) ────────────────────
  if (player.tendencies === 'right') {
    add('tendency_right', "You've been leaking right — favor the left side.", 50);
  }
  if (player.tendencies === 'left') {
    add('tendency_left', "You've been pulling it left — start right of the flag.", 50);
  }

  // ── Service reminders ────────────────────────────────────────────────────
  if (hole === 9 && services.food) {
    add('turn_food', `Food available at the turn — ${services.food}.`, 40);
  } else if (hole === 9) {
    add('turn_food_generic', "Food and drinks are available at the turn.", 40);
  }

  if (hole === 9 && services.restrooms.length > 0) {
    add('turn_restroom', "Restrooms at the turn before you head to the back nine.", 35);
  }

  // ── Sort by priority descending ──────────────────────────────────────────
  triggers.sort((a, b) => b.priority - a.priority);

  return triggers;
};
