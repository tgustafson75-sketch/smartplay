/**
 * 2026-09-10 — THE PRACTICE WEEK ROLLED ONLY WHEN YOU TOUCHED SOMETHING.
 *
 * `toggleComplete` rolls a lapsed week as a side effect, and `resetWeek` exists to do it
 * explicitly — and `resetWeek` was called by nothing, anywhere (store-wide orphan sweep). The
 * render read `completed[dayKey]` raw and never consulted `weekStartMs`.
 *
 * So on the Monday of a new week the plan still showed last week's ticks, and the moment the
 * player tapped ANY day every other tick silently vanished — because that tap was what finally
 * rolled the week. Reading through `effectiveCompleted()` makes the read and the write agree about
 * which week it is.
 */
import { usePracticePlanStore } from '../../store/practicePlanStore';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

describe("last week's ticks are not this week's", () => {
  beforeEach(() => {
    usePracticePlanStore.setState({ completed: {}, weekStartMs: null, updatedAt: 0 });
  });

  it('shows this week\'s check-offs while the week is current', () => {
    usePracticePlanStore.setState({
      completed: { mon: Date.now() },
      weekStartMs: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days in
    });
    expect(usePracticePlanStore.getState().effectiveCompleted()).toEqual(
      expect.objectContaining({ mon: expect.any(Number) }),
    );
  });

  it('shows NOTHING once the week has lapsed, before anything is tapped', () => {
    usePracticePlanStore.setState({
      completed: { mon: 1, tue: 2, wed: 3 },
      weekStartMs: Date.now() - (WEEK_MS + 60_000),
    });
    expect(usePracticePlanStore.getState().effectiveCompleted()).toEqual({});
  });

  it('does not blank a plan that has never been started', () => {
    // weekStartMs null = no week has begun; whatever is in `completed` is all there is.
    usePracticePlanStore.setState({ completed: { mon: 1 }, weekStartMs: null });
    expect(usePracticePlanStore.getState().effectiveCompleted()).toEqual({ mon: 1 });
  });

  it('the tap that rolls the week does not silently drop the OTHER ticks from view', () => {
    // The old behaviour: screen showed mon+tue+wed from last week, you tapped thu, and mon/tue/wed
    // vanished in the same frame. Now the screen was already showing none of them.
    usePracticePlanStore.setState({
      completed: { mon: 1, tue: 2, wed: 3 },
      weekStartMs: Date.now() - (WEEK_MS + 60_000),
    });
    const beforeTap = usePracticePlanStore.getState().effectiveCompleted();
    usePracticePlanStore.getState().toggleComplete('thu');
    const afterTap = usePracticePlanStore.getState().effectiveCompleted();

    expect(beforeTap).toEqual({});
    expect(Object.keys(afterTap)).toEqual(['thu']);
  });

  it('the screen reads through the selector, never the raw map', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../app/practice/smartplan.tsx'), 'utf8');
    expect(src).toContain('effectiveCompleted()');
    // the raw store map must not be bound to the name the render uses
    expect(src).not.toMatch(/completed:\s*s\.completed,\s*reminders/);
  });
});
