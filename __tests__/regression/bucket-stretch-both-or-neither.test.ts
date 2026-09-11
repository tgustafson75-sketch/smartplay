/**
 * 2026-09-11 — DOES A BUCKET HELP? DOES STRETCHING? THEY ARE DIFFERENT QUESTIONS.
 *
 * Tim: "One of the questions I'm personally trying to answer is, I always feel like sometimes if I
 * hit a bucket, it's very mixed — very mixed on the results and especially how I feel about it. But
 * definitely some differences on whether I stretch before I play, because I showed up just before,
 * like most golfers like me will. I just really want the dashboard to have one comprehensive set of
 * data that shows how all these factors intertwine."
 *
 * AND THIS IS WHY HE COULD NOT ANSWER IT. Earlier the same day, the dashboard's two warm-up cards
 * were found to disagree, and the fix merged them onto ONE list of warm-up events. That made them
 * agree — and it flattened the exact distinction he is asking about, because a bucket and a stretch
 * both became "a warm-up". One rule and one event list was right; discarding the KIND was not.
 *
 * Four buckets — neither, balls, stretch, both — over the SAME window that merge established.
 */
import { composePreRoundFactors, preRoundKindFor } from '../../services/practice/preRoundFactors';
import { WARMUP_WINDOW_MS } from '../../services/practice/warmupPerformance';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const H = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;
/** A round at hour n, with optional pre-round events an hour before it. */
const round = (n: number, scoreVsPar: number, vibe?: string) =>
  ({ startedAt: T0 + n * 24 * H, scoreVsPar, postRoundFeelings: vibe ? { vibe } : null });
const before = (n: number) => T0 + n * 24 * H - H;

describe('a bucket and a stretch are told apart', () => {
  it('buckets a round by what he actually did', () => {
    expect(preRoundKindFor(T0, [T0 - H], [])).toBe('balls');
    expect(preRoundKindFor(T0, [], [T0 - H])).toBe('stretch');
    expect(preRoundKindFor(T0, [T0 - H], [T0 - H])).toBe('both');
    expect(preRoundKindFor(T0, [], [])).toBe('none');
  });

  it('and shares the window the warm-up rule already owns', () => {
    // Outside it, it belongs to no round — same rule, one owner.
    expect(preRoundKindFor(T0, [T0 - WARMUP_WINDOW_MS + 1000], [])).toBe('balls');
    expect(preRoundKindFor(T0, [T0 - WARMUP_WINDOW_MS - 1000], [])).toBe('none');
  });

  it('an event AFTER the tee belongs to no round', () => {
    expect(preRoundKindFor(T0, [T0 + H], [])).toBe('none');
  });
});

describe("it answers Tim's actual question", () => {
  /** Stretching helps him a lot. A bucket is a coin flip. Exactly what he described. */
  const rounds = [
    round(1, 10, 'Solid'), round(2, 9, 'Solid'), round(3, 11, 'Great'),      // stretch only
    round(4, 16, 'Rough'), round(5, 14, 'Solid'), round(6, 17, 'Rough'),     // balls only
    round(7, 15, 'Rough'), round(8, 16, 'Rough'), round(9, 15, 'Solid'),     // neither
  ];
  const factors = composePreRoundFactors({
    rounds,
    ballTimes: [before(4), before(5), before(6)],
    stretchTimes: [before(1), before(2), before(3)],
  });

  it('separates the stretch cohort from the bucket cohort', () => {
    const stretch = factors.buckets.find((b) => b.kind === 'stretch')!;
    const balls = factors.buckets.find((b) => b.kind === 'balls')!;
    expect(stretch.n).toBe(3);
    expect(balls.n).toBe(3);
    expect(stretch.avgVsPar).toBeLessThan(balls.avgVsPar as number);
  });

  it('names the one that actually helps him', () => {
    expect(factors.enough).toBe(true);
    expect(factors.best).toBe('stretch');
    expect(factors.headline).toMatch(/a stretch only/);
  });

  it('and carries HOW HE FELT about each, in his own words', () => {
    // "especially how I feel about it" — the half a scoring average cannot show.
    const balls = factors.buckets.find((b) => b.kind === 'balls')!;
    expect(balls.topVibe).toBe('Rough');
    expect(factors.detail.join(' ')).toMatch(/you mostly called those rounds "rough"/);
  });

  it('every bucket is a pair against the others, not a lone average', () => {
    expect(factors.detail.length).toBeGreaterThanOrEqual(3);
    for (const line of factors.detail) expect(line).toMatch(/over, \d+ rounds?/);
  });
});

describe('and it stays honest', () => {
  it('says "keep logging" rather than nothing, before there is enough', () => {
    const f = composePreRoundFactors({
      rounds: [round(1, 10), round(2, 11)], ballTimes: [], stretchTimes: [],
    });
    expect(f.enough).toBe(false);
    expect(f.best).toBeNull();
    expect(f.headline).toMatch(/Keep logging/);
    expect(f.detail).toEqual([]);
  });

  it('needs at least two buckets with real numbers — one cohort is not a comparison', () => {
    const f = composePreRoundFactors({
      rounds: [round(1, 10), round(2, 11), round(3, 12), round(4, 13)],
      ballTimes: [], stretchTimes: [],
    });
    expect(f.enough).toBe(false);
  });

  it('calls a sub-stroke spread what it is — no difference', () => {
    const f = composePreRoundFactors({
      rounds: [
        round(1, 12), round(2, 12), round(3, 13),
        round(4, 12), round(5, 13), round(6, 12),
      ],
      ballTimes: [before(1), before(2), before(3)], stretchTimes: [],
    });
    expect(f.enough).toBe(true);
    expect(f.best).toBeNull();
    expect(f.headline).toMatch(/No real difference/);
  });

  it('drops rounds with no known par rather than treating them as level', () => {
    const f = composePreRoundFactors({
      rounds: [round(1, 10), { startedAt: T0, scoreVsPar: null }] as never,
      ballTimes: [], stretchTimes: [],
    });
    expect(f.buckets.reduce((a, b) => a + b.n, 0)).toBe(1);
  });

  it('survives nothing at all', () => {
    const f = composePreRoundFactors({ rounds: [], ballTimes: [], stretchTimes: [] });
    expect(f.enough).toBe(false);
    expect(f.buckets).toHaveLength(4);
  });
});

describe('one card on the dashboard, and it says what it is', () => {
  const dash = code('app/(tabs)/dashboard.tsx');

  it('the dashboard composes it', () => {
    expect(dash).toMatch(/composePreRoundFactors\(/);
  });

  it('it splits the events the warm-up union deliberately merges', () => {
    expect(dash).toMatch(/const ballTimes = useMemo\(/);
    expect(dash).toMatch(/const stretchTimes = useMemo\(/);
    expect(dash).toMatch(/'preround_warmup'/);
  });

  /**
   * Splitting for this card must not un-fix this morning's disagreement, where the two older cards
   * used different events and could call the same round warmed and cold.
   *
   * My first version matched `warmups: warmupEvents.map(` once — which passes while only ONE of the
   * two cards still uses the merged list, the exact half-fix it claims to prevent. Break-testing
   * caught it. Both call sites are named now.
   */
  it('and BOTH older cards still read the merged warm-up list', () => {
    expect(dash).toMatch(/const warmupEvents = useMemo\(/);
    expect(dash).toMatch(/warmups: warmupEvents\.map\(\(t\) => \(\{ startedAt: t \}\)\)/);
    expect(dash).toMatch(/warmups: warmupEvents\.map\(\(t\) => \(\{ completedAt: t \}\)\)/);
    expect((dash.match(/warmups: warmupEvents\.map\(/g) || []).length).toBe(2);
  });

  it('the card states it is an association, not a cause', () => {
    // The sentence lives in the locale file — my own i18n guardrail blocked the commit for having
    // it inline, correctly: a Japanese player would have read it in English.
    expect(dash).toMatch(/dashboard\.text\.preround_association_note/);
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/locales/en.json'), 'utf8'));
    expect(en.dashboard.text.preround_association_note).toMatch(/Association, not cause/);
    expect(en.dashboard.text.preround_association_note).toMatch(/arrived early for/);
  });
});
