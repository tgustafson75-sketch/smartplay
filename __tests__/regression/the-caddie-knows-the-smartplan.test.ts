/**
 * 2026-10-01 — Tim: "the caddie and app overall is not aware if I set up a SmartPlan in SwingLab. If
 * I say something like I want to work on my irons this week, that checks against the SmartPlan,
 * updates, and when the app opens give a gentle reminder of the items on this week's plan." And:
 * "it ties to things like saying I want to work on shot shapes or swing speed."
 *
 * What it was: "irons this week" set an 8-hour SESSION focus ("…this session"), the plan never moved;
 * the caddie saw the plan only if notes/ticks/reminders existed, never the days, and counted last
 * week's ticks; finishing a focus session ticked nothing; "what should I work on" ignored the plan;
 * the opener never mentioned it; shot shapes had no plan focus at all.
 */
import { resolvePracticeFocusKeys, parsePlanPeriodDays } from '../../services/practice/planFocus';
import { buildGoalPlan } from '../../services/practice/goalPlan';
import {
  usePracticePlanStore, practicePlanPromptBlock, planNudgeHint, currentWeekPlan, planIsConfigured,
} from '../../store/practicePlanStore';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { useSessionFocusStore } from '../../store/sessionFocusStore';
import { sessionFocusHandler } from '../../services/intents/sessionFocusHandler';
import { queryStatusHandler } from '../../services/intents/queryStatusHandler';
import type { VoiceIntent } from '../../types/voiceIntent';
import * as fs from 'fs';
import * as path from 'path';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

const fresh = () => usePracticePlanStore.setState({
  goal: 'break_90', daysPerWeek: 3, minutesPerSession: 60, location: 'full', narrative: '',
  completed: {}, weekStartMs: null, reminders: [], priorityFocuses: [], lastPlanNudgeDay: null, configuredAt: 0, updatedAt: 0,
});

beforeEach(() => { fresh(); useSessionFocusStore.getState().clearFocus(); });

describe('the words become a plan focus and a period', () => {
  it.each([
    ['I want to work on my irons this week', ['irons'], 7],
    ['shot shapes for the next two weeks', ['shot_shape'], 14],
    ["let's focus on swing speed this month", ['driver_speed'], 30],
    ['I need to sort out my putting this week', ['putting'], 7],
    ['chipping and putting for the next 10 days', ['putting', 'short_game'], 10],
    ['work on hitting a draw this week', ['shot_shape'], 7],
  ])('%s', (said, keys, days) => {
    expect(resolvePracticeFocusKeys(said)).toEqual(keys);
    expect(parsePlanPeriodDays(said)).toBe(days);
  });

  it('today / this session is NOT a plan period — it stays a session focus', () => {
    for (const said of ["let's work on tempo today", 'this session is all about my slice', 'I want to work on my chipping']) {
      expect([said, parsePlanPeriodDays(said)]).toEqual([said, null]);
    }
  });

  it('distance control with wedges is not a driver goal', () => {
    expect(resolvePracticeFocusKeys('distance control with my wedges')).toEqual(['short_game']);
  });
});

describe('a priority reshapes the week', () => {
  it('irons take every other day starting day 1', () => {
    const p = buildGoalPlan({ goal: 'break_90', daysPerWeek: 3, minutesPerSession: 60, location: 'full', priorityFocuses: ['irons'] });
    expect(p.sessions.map((s) => s.focusKey)).toEqual(['irons', 'short_game', 'irons']);
  });

  it('shot shapes can be asked for even though no goal weights them', () => {
    const p = buildGoalPlan({ goal: 'break_90', daysPerWeek: 2, minutesPerSession: 45, location: 'full', priorityFocuses: ['shot_shape'] });
    expect(p.sessions[0].focusKey).toBe('shot_shape');
  });

  it('a priority the location cannot hold is left out and SAID, not silently dropped', () => {
    const p = buildGoalPlan({ goal: 'short_game', daysPerWeek: 3, minutesPerSession: 30, location: 'home', priorityFocuses: ['shot_shape'] });
    expect(p.sessions.some((s) => s.focusKey === 'shot_shape')).toBe(false);
    expect(p.notes.join(' ')).toMatch(/Shot shapes.*at home/);
  });

  it('it lapses on its own — "this week" does not become forever', () => {
    const now = Date.now();
    usePracticePlanStore.getState().setPriorityFocus(['irons'], 7, 'my irons', now);
    expect(currentWeekPlan(now + DAY).sessions[0].focusKey).toBe('irons');
    expect(currentWeekPlan(now + 8 * DAY).sessions[0].focusKey).not.toBe('irons');
  });
});

describe('saying it updates the plan, on every path', () => {
  const intent = (goal: string, raw: string): VoiceIntent => ({
    intent_type: 'set_session_focus', parameters: { goal }, confidence: 'high', follow_up_question: null, raw_text: raw,
  });

  it('"my irons this week" hands-free: the PLAN moves and the caddie answers (no "this session" line)', async () => {
    const r = await sessionFocusHandler.execute(intent('my irons', 'I want to work on my irons this week'), {} as never);
    expect(usePracticePlanStore.getState().activePriorityFocuses().map((f) => f.key)).toEqual(['irons']);
    expect(r.route_to_brain).toBe(true);
    expect(r.success).toBe(false); // the on-screen mic falls through to the brain on non-success
    expect(r.voice_response).toBeNull();
    expect(useSessionFocusStore.getState().activeFocus()).toBeNull();
  });

  it('"tempo today" is still a session focus', async () => {
    const r = await sessionFocusHandler.execute(intent('tempo', "let's work on tempo today"), {} as never);
    expect(r.success).toBe(true);
    expect(useSessionFocusStore.getState().activeFocus()?.goal).toBe('tempo');
    expect(usePracticePlanStore.getState().priorityFocuses).toEqual([]);
  });

  it('the brain can do it too: set_plan_focus is declared, a UI tool, typed and dispatched', () => {
    const read = (f: string) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    expect(read('api/_brainTools.ts')).toMatch(/name: 'set_plan_focus'/);
    expect(read('api/_brainTools.ts')).toMatch(/'set_plan_focus',/);
    expect(read('types/toolAction.ts')).toMatch(/type: 'set_plan_focus'/);
    expect(read('services/voice/conversationalToolDispatch.ts')).toMatch(/case 'set_plan_focus'/);
  });

  it('the dispatched tool updates the plan, and words that name no focus become a reminder, not nothing', () => {
    const { dispatchConversationalToolActions } = require('../../services/voice/conversationalToolDispatch') as typeof import('../../services/voice/conversationalToolDispatch');
    dispatchConversationalToolActions([{ type: 'set_plan_focus', focus: 'swing speed', days: 30 }]);
    expect(usePracticePlanStore.getState().activePriorityFocuses().map((f) => f.key)).toEqual(['driver_speed']);
    dispatchConversationalToolActions([{ type: 'set_plan_focus', focus: 'my pre-shot routine', days: 7 }]);
    expect(usePracticePlanStore.getState().reminders.map((r) => r.text)).toContain('Work on my pre-shot routine');
  });
});

describe('the caddie sees the plan he is meant to steer', () => {
  it('a plan set up with the chips alone is visible, day by day', () => {
    usePracticePlanStore.getState().setConfig({ goal: 'break_90' });
    const block = practicePlanPromptBlock();
    expect(block).toMatch(/SMARTPLAN/);
    expect(block).toMatch(/D1 .*\(left\)/);
    expect(block).toMatch(/set_plan_focus/);
  });

  it('defaults nobody chose are not a plan', () => {
    expect(planIsConfigured()).toBe(false);
    expect(practicePlanPromptBlock()).toBe('');
  });

  it("last week's ticks are not counted as this week's", () => {
    usePracticePlanStore.setState({ updatedAt: 1, completed: { '1_short_game': 1 }, weekStartMs: Date.now() - WEEK - DAY });
    expect(practicePlanPromptBlock()).not.toMatch(/\(done\)/);
  });

  it('stays inside the cap the brain gives it (1200 chars) with a full plan', () => {
    const s = usePracticePlanStore.getState();
    s.setConfig({ daysPerWeek: 5 });
    s.setNarrative('x'.repeat(2000));
    for (let i = 0; i < 6; i++) s.addReminder(`reminder ${i} ${'y'.repeat(40)}`, 'Thursday');
    s.setPriorityFocus(['irons', 'shot_shape'], 14, 'irons and shot shapes');
    expect(practicePlanPromptBlock().length).toBeLessThanOrEqual(1200);
  });

  it('"what should I work on" goes to the caddie when there is a plan', async () => {
    usePracticePlanStore.getState().setConfig({ goal: 'break_80' });
    const r = await queryStatusHandler.execute(
      { intent_type: 'query_status', parameters: { query_topic: 'next_focus' }, confidence: 'high', follow_up_question: null, raw_text: 'what should I work on' } as never,
      {} as never,
    );
    expect(r.route_to_brain).toBe(true);
    expect(r.voice_response ?? '').not.toMatch(/coming soon/i);
  });
});

describe('2026-10-03 review fixes', () => {
  it("adding a priority mid-week keeps the days already done (ticks count by focus)", () => {
    const s = usePracticePlanStore.getState();
    s.setConfig({ goal: 'break_90', daysPerWeek: 3 });
    const before = currentWeekPlan();
    const firstFocus = before.sessions[0].focusKey;
    s.toggleComplete(`1_${firstFocus}`);
    s.setPriorityFocus(['irons'], 7, 'my irons');
    expect(practicePlanPromptBlock()).toMatch(/\(done\)/);
  });

  it('a reminder alone is not a plan', () => {
    usePracticePlanStore.getState().addReminder('hit the range', 'Thursday');
    expect(planIsConfigured()).toBe(false);
    expect(planNudgeHint()).toBeNull();
  });

  it('"putting today, tournament next week" stays a session focus', async () => {
    const r = await sessionFocusHandler.execute(
      { intent_type: 'set_session_focus', parameters: { goal: 'putting' }, confidence: 'high', follow_up_question: null, raw_text: "let's work on putting today, tournament next week" } as never, {} as never,
    );
    expect(r.success).toBe(true);
    expect(usePracticePlanStore.getState().priorityFocuses).toEqual([]);
  });

  it('green speed is not driver speed; driving range is not driver distance; fading putts is not shaping', () => {
    expect(resolvePracticeFocusKeys('speed of the greens')).toEqual([]);
    expect(resolvePracticeFocusKeys('my driving range sessions')).toEqual([]);
    expect(resolvePracticeFocusKeys('fade the putts')).toEqual(['putting']);
  });
});

describe('practising ticks the plan', () => {
  it('finishing an irons session ticks the first open irons day', () => {
    usePracticePlanStore.getState().setPriorityFocus(['irons'], 7, 'my irons');
    const ps = usePracticeSessionStore.getState();
    ps.startSession('focus', { focus: 'irons', targetReps: 10, environment: 'range' });
    ps.recordSwing({} as never);
    ps.endSession();
    expect(usePracticePlanStore.getState().effectiveCompleted()).toEqual({ '1_irons': expect.any(Number) });
  });

  it('a session with no swings ticks nothing, and a plan nobody set up is never ticked', () => {
    const ps = usePracticeSessionStore.getState();
    ps.startSession('focus', { focus: 'putting', targetReps: 10, environment: 'range' });
    ps.endSession();
    ps.recordCompletedSession({ kind: 'focus', focus: 'putting', swingCount: 12 } as never);
    expect(usePracticePlanStore.getState().effectiveCompleted()).toEqual({});
    expect(planIsConfigured()).toBe(false);
  });
});

describe('the app-open reminder is a hint for the caddie, once a day', () => {
  it('names what is left this week, and the priority', () => {
    usePracticePlanStore.getState().setPriorityFocus(['shot_shape'], 14, 'shot shapes');
    const hint = planNudgeHint();
    expect(hint).toMatch(/3 of 3 practice sessions left/);
    expect(hint).toMatch(/Shot shapes/);
  });

  it('says nothing twice in a day, nothing for an unset plan, nothing when the week is done', () => {
    expect(planNudgeHint()).toBeNull(); // not set up
    usePracticePlanStore.getState().setConfig({ daysPerWeek: 2 });
    expect(planNudgeHint()).not.toBeNull();
    usePracticePlanStore.getState().notePlanNudged();
    expect(planNudgeHint()).toBeNull();
    usePracticePlanStore.setState({ lastPlanNudgeDay: null });
    for (const d of currentWeekPlan().sessions) usePracticePlanStore.getState().toggleComplete(`${d.day}_${d.focusKey}`);
    expect(planNudgeHint()).toBeNull();
  });

  it('the opener takes it as a hint for the brain — no canned line', () => {
    const tab = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
    expect(tab).toMatch(/generateProactiveOpener\(\{ gapHint: planHint \?\? gap\?\.hint \}\)/);
  });
});
