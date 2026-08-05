// 2026-08-05 (Tim — CORE bug: "I told the caddie my score and he didn't log it or ask putts").
// Scoring had NO local precheck, so it depended entirely on the network classifier; a cold/slow
// classifier or a drift to the chat brain meant the score silently never logged. These patterns route
// clear score REPORTS straight to log_score. This test locks the precision so the rule can't rot into
// hijacking club/putt/distance utterances or score QUERIES.
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const type = (t: string) => precheckLocalIntent(t)?.intent_type ?? null;

describe('voice score reports route to log_score (offline precheck)', () => {
  it('logs clear spoken score reports', () => {
    for (const t of [
      'I got a 5',
      'I made a five',
      'I shot a 7',
      'put me down for a 4',
      'score me a six',
      'card me a 5',
      'I took an 8',
      'I had a 6 on this hole',
      'I bogeyed',
      'I birdied this hole',
      'I got a 5 on hole 7',
    ]) {
      expect(type(t)).toBe('log_score');
    }
  });

  it('captures an explicit hole number when stated', () => {
    const i = precheckLocalIntent('score me a 5 on hole 7');
    expect(i?.intent_type).toBe('log_score');
    expect(i?.parameters?.hole_number).toBe(7);
  });

  it('does NOT hijack clubs, putts, distances, or hole counts', () => {
    for (const t of [
      'I got a 5 iron',
      'I had a 3 putt',
      'I two putted',
      'I hit a 5 degree',
      '5 holes left',
      'I have 5 holes left',
      'I got a new driver',
      'I made a good swing',
    ]) {
      expect(type(t)).not.toBe('log_score');
    }
  });

  it('leaves score QUERIES as query_status, not log_score', () => {
    expect(type("what's my score")).toBe('query_status');
    expect(type('how am I doing')).toBe('query_status');
  });
});
