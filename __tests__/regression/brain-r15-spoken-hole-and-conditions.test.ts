// 2026-10-29 (Brain recheck r15, batch 1). Four live defects in the offline precheck, all of which
// answered or wrote before Kevin's brain heard the question:
//  - brain-1: a score said with an ordinal or a number-word hole ("on the 2nd", "on 12", "hole six") carried
//    no hole, so the stroke was written to the lowest unscored hole, not the one he named.
//  - brain-2: score, putts, par, GIR and distance questions that NAME a hole were answered for the current
//    hole or the round total.
//  - brain-3: a club or yardage question with a condition (wind, slope, rough, lie, "if") was answered with
//    the bare number that ignores the condition.
//  - brain-4: "what was my score last round" was deflected as "You're not in a round yet".
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { parseSpokenHole } from '../../services/spokenHole';

const type = (t: string) => precheckLocalIntent(t)?.intent_type ?? null;

describe('spoken hole reader (brain-1)', () => {
  it('reads an ordinal, a bare number after "on", and number words', () => {
    expect(parseSpokenHole('I got a 4 on the 12th')).toBe(12);
    expect(parseSpokenHole('I made a 6 on 12')).toBe(12);
    expect(parseSpokenHole('I made a 6 on the 2nd')).toBe(2);
    expect(parseSpokenHole('I shot a 5 on the 7th')).toBe(7);
    expect(parseSpokenHole('I got a 4 on number 12')).toBe(12);
    expect(parseSpokenHole('I made a six on hole six')).toBe(6);
    expect(parseSpokenHole('what is the par on the twelfth')).toBe(12);
    expect(parseSpokenHole('the twelfth hole')).toBe(12);
    expect(parseSpokenHole('on hole 7')).toBe(7);
  });

  it('refuses a count that is not a hole, and anything out of 1..18', () => {
    expect(parseSpokenHole('I made a 4 with 2 putts')).toBeNull();
    expect(parseSpokenHole('I made a 4 on 2 putts')).toBeNull();
    expect(parseSpokenHole('I hit it 150 yards on the way')).toBeNull();
    expect(parseSpokenHole('on hole 19')).toBeNull();
    expect(parseSpokenHole('I got a 4 on the 0th')).toBeNull();
  });
});

describe('a named hole is written to the hole he named (brain-1)', () => {
  it.each([
    ['I got a 4 on the 12th', 12],
    ['I made a 6 on 12', 12],
    ['I made a 6 on the 2nd', 2],
    ['I shot a 5 on the 7th', 7],
    ['I got a 4 on number 12', 12],
  ])('"%s" carries hole %i into log_score', (utterance, hole) => {
    const i = precheckLocalIntent(utterance);
    expect(i?.intent_type).toBe('log_score');
    expect(i?.parameters?.hole_number).toBe(hole);
  });

  it('still writes a bare score with no hole named as a bare score', () => {
    const i = precheckLocalIntent('I made a 6');
    expect(i?.intent_type).toBe('log_score');
    expect(i?.parameters?.hole_number).toBeUndefined();
  });
});

describe('a named hole is asked of the caddie, not answered for the current hole (brain-2)', () => {
  it.each([
    "what's my score on hole 7",
    'how many putts on hole 7',
    "what's the par on the 12th",
    "what's the yardage on the 12th hole",
    'how far is it to the green on the 12th',
    'how many greens did I hit on hole 9',
  ])('"%s" reaches the brain', (utterance) => {
    expect(type(utterance)).toBe('conversational');
  });

  it('still answers the same questions locally when no hole is named', () => {
    expect(type("what's my score")).toBe('query_status');
    expect(type('how many putts did I have')).toBe('query_status');
    expect(type("what's the par")).toBe('query_status');
    expect(type("what's the yardage to the pin")).toBe('query_status');
  });
});

describe('a condition on the shot reaches the caddie (brain-3)', () => {
  it.each([
    'how far do I hit my 7 iron into the wind',
    "what's my 8 iron, I'm in the rough",
    "what's my 7 iron if it's uphill",
    'how far do I hit my 6 iron, the lie is bad',
    "what's the yardage to the pin, it's downhill",
    'how many yards to the pin with the wind behind me',
  ])('"%s" reaches the brain', (utterance) => {
    expect(type(utterance)).toBe('conversational');
  });

  it('still answers a plain club or yardage question locally', () => {
    expect(type('how far do I hit my 7 iron')).toBe('query_status');
    expect(type("what's my 8 iron")).toBe('query_status');
    expect(type('how many yards to the pin')).toBe('query_status');
    expect(type('how many yards into the green')).not.toBe('conversational');
  });
});

describe('a past-round score reaches the caddie (brain-4)', () => {
  it.each(['what was my score last round', 'what was my score yesterday', 'what was my score the last time'])(
    '"%s" reaches the brain',
    (utterance) => {
      expect(type(utterance)).toBe('conversational');
    },
  );

  it('keeps the putts from last round on the local answer', () => {
    expect(type('how many putts did I have last round')).toBe('query_status');
  });
});
