/**
 * 2026-08-23 — Routine save/recall moved from localStatusResponder (which only ran after the brain
 * had already FAILED) into the precheck, which runs BEFORE the brain. That promotion changes what a
 * loose regex costs: in the fallback a false match was harmless, here it INTERCEPTS the caddie.
 *
 * "Tell me a good warm-up routine" is a request FOR a warm-up. It must reach the brain. Only a
 * possessive or demonstrative ("my routine", "save that routine") means the stored one.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const topic = (t: string) =>
  (precheckLocalIntent(t)?.parameters as { query_topic?: string } | undefined)?.query_topic ?? null;

describe('routine precheck claims only the stored routine', () => {
  it('claims the possessive and demonstrative forms', () => {
    expect(topic("what's my routine")).toBe('routine_recall');
    expect(topic('tell me my warm up')).toBe('routine_recall');
    expect(topic('run me through my routine')).toBe('routine_recall');
    expect(topic('save that routine')).toBe('routine_save');
    expect(topic('remember my stretches')).toBe('routine_save');
  });

  it('does NOT intercept a request for a warm-up the caddie should answer', () => {
    expect(topic('tell me a good warm up routine')).not.toBe('routine_recall');
    expect(topic('what is a good pre round routine')).not.toBe('routine_recall');
    expect(topic('give me a warm up')).not.toBe('routine_recall');
    expect(topic('remember to warm up before the round')).not.toBe('routine_save');
    expect(topic('should I do a warm up routine')).not.toBe('routine_recall');
  });
});
