/**
 * 2026-09-13 (Tim) — "A day doing work is a Session." And: "if there was a focus that day which we
 * built caddie context for — like if I am working on irons or tempo or driver — a quick focus and
 * analysis of the session. Then make sure this context is discoverable by the brain."
 *
 * TWO PROBLEMS, ONE ROOT.
 *
 * practiceSessionStore opens a session per BOUT of work, and the Dashboard listed that store
 * straight — so an afternoon at the range where he ran three analyses produced three rows, all
 * carrying the same date and each holding a third of the day's balls. The practice ledger read like
 * a shot log. Nobody practises in bouts; they practise on a day.
 *
 * And `PracticeSession.focus` — irons, wedges, driver_speed, tempo — had been recorded since the
 * session runner shipped and reached the caddie NOWHERE. The only practice data in the prompt was
 * `practiceImpactBlock`, which maps each session to `{ startedAt, balls }` and discards the rest. So
 * the app knew he spent Tuesday on tempo, drew it on a dashboard row, and could not be asked about
 * it. Measured, stored, displayed, unaskable — the half that keeps being missing.
 * [[smartplay-defect-class-unwired-halves]] [[two-owners-is-the-root-cause]]
 */
import fs from 'fs';
import path from 'path';
import {
  groupPracticeByDay,
  describePracticeDay,
  buildPracticeFocusBlock,
  prettyFocus,
} from '../../services/practice/practiceFocus';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

/** Three bouts on one afternoon, then a separate day. */
const AT = (d: number, h: number) => new Date(2026, 8, d, h, 0, 0).getTime();
const SESSIONS = [
  { startedAt: AT(10, 9), swingCount: 20, focus: 'irons' },
  { startedAt: AT(10, 11), swingCount: 15, focus: 'tempo' },
  { startedAt: AT(10, 16), swingCount: 25, focus: 'irons' },
  { startedAt: AT(8, 10), swingCount: 40, focus: 'driver_speed' },
];

describe('a day of work is one session', () => {
  it('three bouts on one afternoon are ONE day, with the balls summed', () => {
    const days = groupPracticeByDay(SESSIONS);
    expect(days).toHaveLength(2);
    expect(days[0].balls).toBe(60);
    expect(days[0].bouts).toBe(3);
  });

  it('newest day first', () => {
    const days = groupPracticeByDay(SESSIONS);
    expect(days[0].at).toBeGreaterThan(days[1].at);
  });

  it('the day carries every DISTINCT focus worked, once each', () => {
    const [day] = groupPracticeByDay(SESSIONS);
    expect(day.focuses).toEqual(['Irons', 'Tempo']);
  });

  it('a stored focus reads like a person wrote it', () => {
    expect(prettyFocus('driver_speed')).toBe('Driver Speed');
  });

  it('sessions with no usable timestamp are dropped, not grouped under NaN', () => {
    expect(groupPracticeByDay([{ swingCount: 10 }, { startedAt: Number.NaN, swingCount: 5 }])).toEqual([]);
  });

  it('the day line says what it was and what it came to', () => {
    const [day] = groupPracticeByDay(SESSIONS);
    expect(describePracticeDay(day)).toBe('Irons · Tempo — 60 balls, 3 goes');
  });
});

describe('the focus is discoverable by the brain', () => {
  it('the block names the focus, not just the volume', () => {
    const block = buildPracticeFocusBlock(SESSIONS)!;
    /**
     * Pin the DAY LINE, not the presence of the word. The first version checked /Irons/ anywhere in
     * the block and survived a mutation that stripped the focus out of every line — the word was
     * still sitting in the summary sentence underneath. A guard the mutation cannot fail is not a
     * guard. [[break-test-every-guard-you-write]]
     */
    expect(block).toMatch(/^- .+: Irons · Tempo — 60 balls, 3 goes$/m);
    expect(block).toMatch(/^- .+: Driver Speed — 40 balls, one go$/m);
  });

  it('it counts the thread instead of inferring one', () => {
    const repeated = [
      { startedAt: AT(10, 9), swingCount: 10, focus: 'wedges' },
      { startedAt: AT(9, 9), swingCount: 10, focus: 'wedges' },
      { startedAt: AT(8, 9), swingCount: 10, focus: 'irons' },
    ];
    expect(buildPracticeFocusBlock(repeated)).toMatch(/come back to Wedges on 2 of the last 3/);
  });

  it('it never claims the practice worked — that is practiceImpact\'s job, and it measures it', () => {
    const block = buildPracticeFocusBlock(SESSIONS)!;
    /**
     * Target the CLAIM, not the word. The first version forbade /improv|working/ outright and
     * failed on the block's own instruction not to claim improvement — a guard that cannot tell a
     * rule from the thing it forbids. What must never appear is an assertion that the reps produced
     * a result, which is a measurement this block does not make.
     */
    // "working" is not a claim word — "what he has been WORKING ON" is a statement of fact about
    // reps. "paying off" and "improving" are claims about RESULTS, which is the measurement this
    // block deliberately does not make.
    expect(block).not.toMatch(/\b(is|are|has been|have been)\s+(paying off|improving)\b/i);
    expect(block).not.toMatch(/\byou(?:'ve| have)?\s+improved\b/i);
    expect(block).not.toMatch(/\bgetting better\b/i);
    expect(block).toMatch(/do not congratulate him on improvement you have not measured/);
  });

  it('nothing logged means NO block — a heading with no days teaches the model he never practises', () => {
    expect(buildPracticeFocusBlock([])).toBeNull();
  });

  it('it actually reaches the payload and the prompt', () => {
    expect(code('services/caddieRequestBody.ts')).toMatch(/practiceFocusBlock: safe\(/);
    const kevin = code('api/kevin.ts');
    expect(kevin).toMatch(/practiceFocusBlock = null,/);
    expect(kevin).toMatch(/_practiceFocus: string \| null = capOrNull\(practiceFocusBlock/);
    expect(kevin).toMatch(/\$\{_practiceFocus \? /);
  });

  it('the screen and the prompt group days the SAME way', () => {
    // A dashboard that grouped differently from the block would answer "what did I do Tuesday"
    // two ways on one device.
    expect(code('app/(tabs)/dashboard.tsx')).toMatch(/groupPracticeByDay\(practiceHistory, 6\)/);
    expect(code('app/(tabs)/dashboard.tsx')).toMatch(/describePracticeDay\(day\)/);
  });
});
