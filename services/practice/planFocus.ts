/**
 * 2026-10-01 (Tim — "if at any point I say something like I want to work on my irons this week, that
 * checks against the SmartPlan, updates"; "and it ties to things like saying I want to work on shot
 * shapes or swing speed").
 *
 * Two small readers shared by every path that can change the plan — the classifier handler
 * (sessionFocusHandler) and the brain tool (set_plan_focus) — so the two cannot disagree about what
 * "my irons" or "the next two weeks" means.
 *
 *   resolvePracticeFocusKeys — the player's words → SmartPlan focus keys (services/practice/sessionPlan).
 *   parsePlanPeriodDays      — "this week" / "next two weeks" / "this month" → days, or null when the
 *                              words are about today or this session (that stays a SESSION focus).
 *
 * Pure / sync / never throws.
 */

const FOCUS_PATTERNS: [string, RegExp][] = [
  // Order matters: the more specific reading wins before a broader word inside it.
  ['shot_shape', /\bshot[\s-]?shap|\bshap(e|es|ing)\b|\bdraws?\b|\bfades?\b|\bwork(ing)? the ball\b|\bcurv(e|ing)\b/],
  ['driver_speed', /\bswing speed\b|\bclub ?head speed\b|\bball speed\b|\boverspeed\b|\bspeed\b/],
  ['putting', /\bputt(s|ing)?\b|\bputter\b|\blag putt/],
  ['short_game', /\bshort game\b|\bchip(s|ping)?\b|\bpitch(es|ing)?\b|\bwedges?\b|\bbunkers?\b|\bsand\b|\bscoring zone\b/],
  ['irons', /\birons?\b|\biron play\b|\bapproach(es)?\b/],
  ['contact_lowpoint', /\bcontact\b|\bstrik(e|ing)\b|\bfat\b|\bthin\b|\blow ?point\b|\bdivots?\b/],
  ['hands_transition', /\btempo\b|\btransition\b|\brhythm\b|\btiming\b/],
  ['driver_distance', /\bdriv(er|ing|es)\b|\btee shots?\b|\boff the tee\b|\bdistance\b(?! control)/],
];

/** Every SmartPlan focus the words name, in the order they were checked. Empty when none. */
export function resolvePracticeFocusKeys(text: string | null | undefined): string[] {
  const t = (text ?? '').toLowerCase();
  if (!t.trim()) return [];
  const keys: string[] = [];
  for (const [key, re] of FOCUS_PATTERNS) {
    if (re.test(t)) keys.push(key);
  }
  // "driver speed" is a speed goal, not a second driver-distance one.
  if (keys.includes('driver_speed')) return keys.filter((k) => k !== 'driver_distance');
  return keys;
}

const WORD_NUM: Record<string, number> = { a: 1, one: 1, couple: 2, 'a couple': 2, two: 2, few: 3, 'a few': 3, three: 3, four: 4, five: 5, six: 6 };
const num = (w: string): number | null => (/^\d+$/.test(w) ? Number(w) : WORD_NUM[w] ?? null);

/**
 * Days the player means, or null when they mean today / this session / gave no period. Capped at
 * 60: a plan priority is a stretch of weeks, not a standing goal (that is the plan's GOAL chip).
 */
export function parsePlanPeriodDays(text: string | null | undefined): number | null {
  const t = (text ?? '').toLowerCase();
  if (!t.trim()) return null;
  const m = t.match(/\b(?:next|for the next|over the next|coming|for)\s+((?:a\s+)?(?:couple|few)|\d+|one|two|three|four|five|six)(?:\s+of)?\s+(days?|weeks?|months?)\b/);
  if (m) {
    const n = num(m[1].trim()) ?? 1;
    const unit = m[2].startsWith('day') ? 1 : m[2].startsWith('week') ? 7 : 30;
    return Math.max(1, Math.min(60, n * unit));
  }
  if (/\b(this|next|the|for the|all) month\b/.test(t)) return 30;
  if (/\b(this|next|the|for the|all|rest of the) week\b|\bweekly\b/.test(t)) return 7;
  return null;
}
