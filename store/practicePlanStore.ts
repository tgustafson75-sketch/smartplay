/**
 * 2026-07-04 (Tim — "SmartPlan should guide the week in terms of Caddie guidance;
 * expand the plan, set reminders verbally, add a narrative box for goals + challenges
 * the Caddie considers").
 *
 * SmartPlan was ephemeral (local useState, reset every visit, invisible to the caddie).
 * This persists the active weekly plan + the player's free-text goals/challenges + which
 * days they've completed + verbal reminders — and it's fed into the caddie's context so
 * the caddie GUIDES the week toward these goals, not just answers one-offs.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { PracticeGoal, PracticeLocation, GoalPlan } from '../services/practice/goalPlan';
import { PRACTICE_GOALS, buildGoalPlan } from '../services/practice/goalPlan';
import { getFocus } from '../services/practice/sessionPlan';
import { resolvePracticeFocusKeys } from '../services/practice/planFocus';

export interface PlanReminder {
  id: string;
  /** What to be reminded of ("work on putting", "range session before Saturday"). */
  text: string;
  /** Optional natural-language "when" the player said ("Thursday", "tomorrow morning"). */
  whenText: string | null;
  /** Optional resolved timestamp if we can schedule it (future OS-notification hook). */
  whenMs: number | null;
  createdAt: number;
  done: boolean;
}

/**
 * 2026-10-01 (Tim — "I want to work on my irons this week" should check against the SmartPlan and
 * update it). A focus the player asked for, for a stretch of days. It reshapes the week
 * (buildGoalPlan priorityFocuses) and lapses on its own, so "this week" does not become forever.
 */
export interface PlanPriorityFocus {
  /** A SmartPlan focus key (services/practice/sessionPlan). */
  key: string;
  /** What they said, kept for the caddie ("my irons", "shot shapes"). */
  said: string;
  untilMs: number;
  setAt: number;
}

interface PracticePlanState {
  // ── The active SmartPlan config (persisted so it's "this week's plan") ──
  goal: PracticeGoal;
  daysPerWeek: number;
  minutesPerSession: number;
  location: PracticeLocation;
  // ── Free-text goals + challenges the caddie should consider all week ──
  narrative: string;
  // ── Check-off: focusKey -> completedAt (this week) ──
  completed: Record<string, number>;
  weekStartMs: number | null;
  // ── Verbal / manual reminders ──
  reminders: PlanReminder[];
  priorityFocuses: PlanPriorityFocus[];
  /** Local day (YYYY-MM-DD) the app-open opener last mentioned the plan — once a day, not every launch. */
  lastPlanNudgeDay: string | null;
  updatedAt: number;

  setConfig: (patch: Partial<Pick<PracticePlanState, 'goal' | 'daysPerWeek' | 'minutesPerSession' | 'location'>>) => void;
  setNarrative: (text: string) => void;
  toggleComplete: (focusKey: string) => void;
  resetWeek: () => void;
  /** This week's check-offs — empty once the week has lapsed. Always read through this. */
  effectiveCompleted: () => Record<string, number>;
  addReminder: (text: string, whenText?: string | null, whenMs?: number | null) => PlanReminder;
  toggleReminderDone: (id: string) => void;
  removeReminder: (id: string) => void;
  /** Make these focuses the priority for `days` days (replaces an earlier priority on the same key). */
  setPriorityFocus: (keys: string[], days: number, said: string, now?: number) => void;
  /** Drop one priority, or all of them. */
  clearPriorityFocus: (key?: string) => void;
  activePriorityFocuses: (now?: number) => PlanPriorityFocus[];
  /**
   * A practice session on `focusKey` was finished: tick the first open day this week with that focus.
   * Returns false when the plan has no open day for it (nothing ticked).
   */
  markFocusPracticed: (focusKey: string, now?: number) => boolean;
  notePlanNudged: (now?: number) => void;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export const usePracticePlanStore = create<PracticePlanState>()(
  persist(
    (set, get) => ({
      goal: 'break_90',
      daysPerWeek: 3,
      minutesPerSession: 60,
      location: 'full',
      narrative: '',
      completed: {},
      weekStartMs: null,
      reminders: [],
      priorityFocuses: [],
      lastPlanNudgeDay: null,
      updatedAt: 0,

      setConfig: (patch) => set({ ...patch, updatedAt: Date.now() }),
      setNarrative: (text) => set({ narrative: text, updatedAt: Date.now() }),
      toggleComplete: (focusKey) =>
        set((s) => {
          // Roll the week if the current one has lapsed (fresh check-offs).
          const now = Date.now();
          const weekStartMs = s.weekStartMs && now - s.weekStartMs < WEEK_MS ? s.weekStartMs : now;
          const completed = { ...(weekStartMs === s.weekStartMs ? s.completed : {}) };
          if (completed[focusKey]) delete completed[focusKey];
          else completed[focusKey] = now;
          return { completed, weekStartMs, updatedAt: now };
        }),
      resetWeek: () => set({ completed: {}, weekStartMs: Date.now(), updatedAt: Date.now() }),

      /**
       * 2026-09-10 — THE WEEK ROLLED ONLY WHEN YOU TOUCHED SOMETHING.
       *
       * `toggleComplete` rolls a lapsed week, and `resetWeek` exists to do it explicitly — and
       * `resetWeek` was called by nothing, anywhere (store-wide orphan sweep). The render read
       * `completed[dayKey]` raw and never looked at `weekStartMs`. So on the Monday of a new week
       * the plan still showed last week's ticks, and the instant the player tapped ANY day, every
       * other tick silently vanished — because that tap is what finally rolled the week.
       *
       * Reading through here makes the READ and the WRITE agree about which week it is, which is
       * the actual invariant. The stale map is still in the store until the next write; nothing
       * may read it directly. [[two-owners-is-the-root-cause]]
       */
      effectiveCompleted: () => {
        const s = get();
        if (!s.weekStartMs) return s.completed;
        return Date.now() - s.weekStartMs < WEEK_MS ? s.completed : {};
      },

      addReminder: (text, whenText = null, whenMs = null) => {
        const r: PlanReminder = {
          id: `rem_${Date.now()}_${Math.floor(Math.random() * 1e6).toString(36)}`,
          text: text.trim(),
          whenText: whenText?.trim() || null,
          whenMs: whenMs ?? null,
          createdAt: Date.now(),
          done: false,
        };
        set((s) => ({ reminders: [...s.reminders, r].slice(-50), updatedAt: Date.now() }));
        return r;
      },
      toggleReminderDone: (id) =>
        set((s) => ({ reminders: s.reminders.map((r) => (r.id === id ? { ...r, done: !r.done } : r)), updatedAt: Date.now() })),
      removeReminder: (id) =>
        set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id), updatedAt: Date.now() })),

      setPriorityFocus: (keys, days, said, now = Date.now()) => {
        const valid = keys.filter((k) => !!getFocus(k));
        if (valid.length === 0) return;
        const untilMs = now + Math.max(1, Math.min(60, Math.round(days))) * DAY_MS;
        set((s) => ({
          priorityFocuses: [
            ...s.priorityFocuses.filter((p) => !valid.includes(p.key) && p.untilMs > now),
            ...valid.map((key) => ({ key, said: said.trim().slice(0, 80), untilMs, setAt: now })),
          ].slice(-3),
          updatedAt: now,
        }));
      },
      clearPriorityFocus: (key) =>
        set((s) => ({
          priorityFocuses: key ? s.priorityFocuses.filter((p) => p.key !== key) : [],
          updatedAt: Date.now(),
        })),
      activePriorityFocuses: (now = Date.now()) => get().priorityFocuses.filter((p) => p.untilMs > now),

      markFocusPracticed: (focusKey, now = Date.now()) => {
        // A player who never set a plan up has no plan to tick — and a tick would make the defaults
        // look "configured", so the caddie would start talking about a plan nobody chose.
        if (!planIsConfigured(now)) return false;
        const s = get();
        const plan = currentWeekPlan(now);
        const done = s.effectiveCompleted();
        const day = plan.sessions.find((d) => d.focusKey === focusKey && !done[`${d.day}_${d.focusKey}`]);
        if (!day) return false;
        // Same week-roll rule as toggleComplete, so a tick never lands in a lapsed week.
        const weekStartMs = s.weekStartMs && now - s.weekStartMs < WEEK_MS ? s.weekStartMs : now;
        const completed = { ...(weekStartMs === s.weekStartMs ? s.completed : {}), [`${day.day}_${day.focusKey}`]: now };
        set({ completed, weekStartMs, updatedAt: now });
        return true;
      },
      notePlanNudged: (now = Date.now()) => set({ lastPlanNudgeDay: localDay(now) }),
    }),
    // NOTE: practicePlanPromptBlock (below, outside persist) feeds this into the caddie.
    {
      name: 'practice-plan-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      version: 1,
      migrate: (p) => p as PracticePlanState,
    },
  ),
);

/**
 * This week's plan, exactly as the SmartPlan screen draws it — the goal chips, the location and any
 * priority the player asked for. The ONE builder for the screen, the caddie and the auto-tick, so
 * the three can never disagree about what day 2 is.
 */
export function currentWeekPlan(now = Date.now()): GoalPlan {
  const p = usePracticePlanStore.getState();
  return buildGoalPlan({
    goal: p.goal,
    daysPerWeek: p.daysPerWeek,
    minutesPerSession: p.minutesPerSession,
    location: p.location,
    priorityFocuses: p.activePriorityFocuses(now).map((f) => f.key),
  });
}

/**
 * The player has actually set a plan up (touched a chip, a day, the notes, a reminder or a priority).
 * The defaults alone are not a plan anyone chose, and the caddie should not talk about one.
 */
export function planIsConfigured(now = Date.now()): boolean {
  const p = usePracticePlanStore.getState();
  return p.updatedAt > 0 || p.activePriorityFocuses(now).length > 0;
}

function labelsOf(keys: string[]): string {
  const labels = [...new Set(keys)].map((k) => getFocus(k)?.label ?? k);
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * 2026-07-04 (Tim — "SmartPlan should guide the week in terms of Caddie guidance") — the plan as the
 * caddie sees it. Read via getState() so it is safe to call from services.
 *
 * 2026-10-01 (Tim — "the caddie and app overall is not aware if I set up a SmartPlan"). It was
 * empty unless the player had written notes, ticked a day or left a reminder — setting the goal
 * chips alone was invisible — and it named the goal but never the DAYS, so the caddie could not say
 * what was left this week. It also counted last week's ticks (raw `completed`). Now: the whole week
 * day by day, through effectiveCompleted, plus any priority the player asked for.
 *
 * It rides the CACHED prompt (api/kevin.ts), so nothing here may change turn to turn: no "minutes
 * ago", only things that move when the plan itself moves.
 */
export function practicePlanPromptBlock(now = Date.now()): string {
  try {
    const p = usePracticePlanStore.getState();
    const openReminders = p.reminders.filter((r) => !r.done).slice(0, 4);
    if (!planIsConfigured(now) && openReminders.length === 0) return '';
    const parts: string[] = [];
    const plan = currentWeekPlan(now);
    parts.push(`Goal "${plan.goalLabel}", ${p.daysPerWeek} days/wk, ${p.minutesPerSession} min/session, ${p.location.replace('_', ' ')}.`);
    const priorities = p.activePriorityFocuses(now);
    if (priorities.length > 0) {
      parts.push(`Priority they asked for: ${priorities.map((f) => `${getFocus(f.key)?.label ?? f.key} ("${f.said}", until ${shortDate(f.untilMs)})`).join('; ')}.`);
    }
    if (plan.sessions.length > 0) {
      const done = p.effectiveCompleted();
      parts.push(`This week: ${plan.sessions.map((d) => `D${d.day} ${d.focusLabel} ${done[`${d.day}_${d.focusKey}`] ? '(done)' : '(left)'}`).join(' · ')}.`);
    }
    // Location caveats and priorities the location cannot hold — not the generic framing line.
    const caveats = plan.notes.filter((n) => !/No promises|Consistency over cramming/.test(n));
    if (caveats.length > 0) parts.push(caveats.join(' '));
    parts.push('When they say they want to work on something for a stretch ("my irons this week", "shot shapes for the next two weeks", "swing speed this month"), call set_plan_focus and tell them what it changes in this plan. Today-only is set_session_focus. "What should I work on" is answered from this plan first.');
    if (openReminders.length > 0) {
      parts.push(`Open reminders: ${openReminders.map((r) => r.text.slice(0, 60) + (r.whenText ? ` (${r.whenText.slice(0, 20)})` : '')).join('; ')}.`);
    }
    // Free text last: the brain caps this block at 1200 (api/kevin.ts capOrNull), and what must survive
    // the cut is the plan and the instruction, not the end of a long note.
    if (p.narrative.trim()) parts.push(`Player's goals & challenges (weigh these): ${p.narrative.trim().slice(0, 300)}`);
    return `THE PLAYER'S SMARTPLAN (their practice plan in SwingLab — steer practice and coaching toward it; reference it naturally, never recite it):\n${parts.join('\n')}`.slice(0, 1200);
  } catch {
    return '';
  }
}

/**
 * 2026-10-01 (Tim — "when app opens give gentle reminder of the items on this week's plan").
 *
 * A HINT for the brain's opener (services/conversationalBrain.generateProactiveOpener), never a line
 * of its own — the opener writes the words, so nothing canned is spoken. Once a day, only for a plan
 * the player set up, and silent when this week's work is done.
 */
export function planNudgeHint(now = Date.now()): string | null {
  try {
    const p = usePracticePlanStore.getState();
    if (!planIsConfigured(now)) return null;
    if (p.lastPlanNudgeDay === localDay(now)) return null;
    const plan = currentWeekPlan(now);
    const done = p.effectiveCompleted();
    const left = plan.sessions.filter((d) => !done[`${d.day}_${d.focusKey}`]);
    if (left.length === 0) return null;
    const priorities = p.activePriorityFocuses(now);
    const priorityText = priorities.length > 0
      ? ` They asked to focus on ${labelsOf(priorities.map((f) => f.key))} until ${shortDate(Math.max(...priorities.map((f) => f.untilMs)))}.`
      : '';
    return `Their SmartPlan in SwingLab has ${left.length} of ${plan.sessions.length} practice session${plan.sessions.length === 1 ? '' : 's'} left this week: ${labelsOf(left.map((d) => d.focusKey))}.${priorityText} Mention it gently in one short clause, as something waiting for them when they are ready — not a list, not a to-do, no guilt.`;
  } catch {
    return null;
  }
}

/**
 * 2026-10-01 — the ONE way the player's words become a plan priority, shared by the brain tool
 * (set_plan_focus) and the classifier path (sessionFocusHandler), so "my irons this week" means the
 * same thing however it was said. Returns the focus keys applied; empty when the words name no plan
 * focus (the caller decides what to do with those — nothing is silently dropped).
 */
export function applyPlanFocusWords(words: string, days: number, now = Date.now()): string[] {
  const keys = resolvePracticeFocusKeys(words);
  if (keys.length === 0) return [];
  usePracticePlanStore.getState().setPriorityFocus(keys, days, words, now);
  return keys;
}

/** Labels for a toast or a reply: "Irons", "Irons and Putting". */
export function planFocusLabels(keys: string[]): string {
  return labelsOf(keys);
}
