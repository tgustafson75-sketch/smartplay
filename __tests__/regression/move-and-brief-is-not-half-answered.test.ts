/**
 * 2026-08-23 — "Next hole, give me the briefing" is TWO acts: move me, then tell me about where I
 * am. The precheck could only ever do one of them, and whichever pattern sat higher in the file won.
 * hole_read sat at line 272 and next_hole at 343, so the player was briefed — accurately, in detail,
 * about the hole they had just walked off. Accurate and about the wrong hole is the worst failure
 * this app can have: it is indistinguishable from working.
 *
 * A single deterministic command still answers locally and instantly. A compound one belongs to the
 * caddie, who can call declare_hole and brief in the same turn.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const route = (t: string) => {
  const i = precheckLocalIntent(t);
  if (!i) return 'BRAIN';
  const topic = (i.parameters as { query_topic?: string; direction?: string } | undefined);
  return `${i.intent_type}/${topic?.query_topic ?? topic?.direction ?? ''}`;
};

describe('a move and a briefing are not half-answered', () => {
  it('keeps the bare commands local and instant', () => {
    expect(route('next hole')).toBe('navigate/next_hole');
    expect(route("let's move on to the next hole")).toBe('navigate/next_hole');
    expect(route('give me the briefing')).toBe('query_status/hole_read');
    expect(route('brief me on this hole')).toBe('query_status/hole_read');
  });

  it('hands a COMPOUND move-and-brief to the caddie, who can do both', () => {
    for (const t of [
      'next hole, give me the briefing',
      'next hole and walk me through it',
      "on to the next hole, what's the read",
      'next tee, give me the rundown',
    ]) {
      expect(route(t)).toBe('BRAIN');
    }
  });

  it('never briefs a hole the player has already left', () => {
    // The specific regression: a move phrase present must stop hole_read claiming the utterance.
    expect(route('next hole, brief me')).not.toBe('query_status/hole_read');
  });
});
