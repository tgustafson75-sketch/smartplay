// 2026-08-06 (Tim — "the hole-by-hole was awesome but it's thrown at me; we need the prompt: what's the
// read?"). Per-hole reads are now PULL-only (the auto-intro + M12 briefing were removed from
// roundStore.setCurrentHole). This locks the on-demand precheck route: hole-read phrasings -> query_status
// query_topic:'hole_read', while putt/green reads and "what's the play"/"smart play" are NOT hijacked.
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const topic = (t: string) => {
  const i = precheckLocalIntent(t);
  return i?.intent_type === 'query_status' ? String(i?.parameters?.query_topic ?? '') : (i?.intent_type ?? null);
};

describe('hole read is pull-only (offline precheck)', () => {
  it('routes hole-read phrasings to query_topic hole_read', () => {
    for (const t of [
      "what's the read",
      'give me the read',
      'read this hole',
      'give me the briefing',
      'brief me',
      'hole info',
      'give me the rundown',
      'break down this hole',
      'tell me about this hole',
      'walk me through the hole',
    ]) {
      expect(topic(t)).toBe('hole_read');
    }
  });

  it('does NOT hijack putt/green reads', () => {
    for (const t of ["what's the read on this putt", 'read the green', "what's my green read"]) {
      expect(topic(t)).not.toBe('hole_read');
    }
  });

  it('leaves "what\'s the play" as shot_strategy and "smart play" for SmartFinder', () => {
    expect(topic("what's the play")).toBe('shot_strategy');
    expect(topic("what's the smart play")).not.toBe('hole_read');
  });
});
