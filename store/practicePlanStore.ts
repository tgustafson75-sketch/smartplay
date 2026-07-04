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
import type { PracticeGoal, PracticeLocation } from '../services/practice/goalPlan';
import { PRACTICE_GOALS } from '../services/practice/goalPlan';

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
  updatedAt: number;

  setConfig: (patch: Partial<Pick<PracticePlanState, 'goal' | 'daysPerWeek' | 'minutesPerSession' | 'location'>>) => void;
  setNarrative: (text: string) => void;
  toggleComplete: (focusKey: string) => void;
  resetWeek: () => void;
  addReminder: (text: string, whenText?: string | null, whenMs?: number | null) => PlanReminder;
  toggleReminderDone: (id: string) => void;
  removeReminder: (id: string) => void;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
 * 2026-07-04 (Tim — "SmartPlan should guide the week in terms of Caddie guidance") —
 * a compact prompt block the caddie sees, so its coaching + practice suggestions steer
 * toward the player's stated goals + challenges all week. Empty when there's nothing set.
 * Read via getState() so it's safe to call from services (buildPipecatContext, kevin).
 */
export function practicePlanPromptBlock(): string {
  try {
    const p = usePracticePlanStore.getState();
    const parts: string[] = [];
    const goalLabel = PRACTICE_GOALS.find((g) => g.key === p.goal)?.label ?? p.goal;
    parts.push(`This week's practice plan: goal "${goalLabel}", ${p.daysPerWeek} days/wk, ${p.minutesPerSession} min/session, ${p.location.replace('_', ' ')}.`);
    if (p.narrative.trim()) parts.push(`Player's goals & challenges (weigh these in your guidance): ${p.narrative.trim().slice(0, 600)}`);
    const doneCount = Object.keys(p.completed).length;
    if (doneCount > 0) parts.push(`${doneCount} plan session(s) done this week so far.`);
    const openReminders = p.reminders.filter((r) => !r.done).slice(0, 6);
    if (openReminders.length > 0) {
      parts.push(`Open reminders: ${openReminders.map((r) => r.text + (r.whenText ? ` (${r.whenText})` : '')).join('; ')}.`);
    }
    // Only surface when the player has actually engaged the plan (narrative, done, or reminders).
    const engaged = p.narrative.trim().length > 0 || doneCount > 0 || openReminders.length > 0;
    if (!engaged) return '';
    return `THE PLAYER'S WEEKLY PLAN (steer coaching + practice suggestions toward these goals; reference naturally, don't recite):\n${parts.join('\n')}`;
  } catch {
    return '';
  }
}
