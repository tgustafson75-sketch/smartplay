/**
 * 2026-09-11 — SUNNY AND HOT vs RAINY AND COLD, AND THE BAG TALKING BOTH WAYS.
 *
 * Tim: "Sunny and hot should factor vs rainy and/or cold. Helps qualify the tie in. I know a lot of
 * people that can't play well or consistently cold, especially in California. Maybe there are
 * mitigation or at least mindset strategies we can derive." And: "make sure this works both ways
 * with fit profile in dashboard."
 *
 * THREE THINGS WERE WRONG.
 *
 * RAINY was not an option on the post-round screen at all, so the one condition a golfer will always
 * remember about a round had no box to tick and could never be measured.
 *
 * COLD does two separate things and the app knew ONE. It makes the ball fly shorter — physics, and
 * utils/playsLike has modelled it correctly for months. And it makes the PLAYER worse: cold hands,
 * no turn, four layers, and in California nobody is adapted to it. The app lengthened the yardage
 * correctly and said nothing about the round being harder.
 *
 * AND THE FIT PROFILE ONLY TALKED ONE WAY. playProfile has had a measured weakness line for bag gaps
 * — "N real gaps in your set" — and `bagGapCount` had NO WRITER anywhere. The dashboard computed the
 * gaps; the caddie could never see them, so that branch could not fire. Same shape as
 * distanceControl: a reader with no writer.
 */
import { conditionFindings, conditionPlay, playForToday } from '../../services/roundConditions';
import { composeFitProfile } from '../../services/practice/fitProfile';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const r = (scoreVsPar: number, weather: string) => ({ scoreVsPar, postRoundFeelings: { weather } });
/** A Californian who cannot play in the cold. */
const COLD_PLAYER = [
  r(20, 'Cold'), r(21, 'Cold'), r(19, 'Cold'), r(22, 'Cold'),
  r(12, 'Sunny'), r(11, 'Sunny'), r(13, 'Sunny'), r(12, 'Sunny'),
];

describe('rain can be recorded at all now', () => {
  it('the post-round screen offers it', () => {
    expect(code('app/recap/feelings.tsx')).toMatch(/'Sunny', 'Cloudy', 'Windy', 'Rainy', 'Hot', 'Cold'/);
  });

  it('and the app can measure it live, from the conditions the weather service already returns', () => {
    const b = code('services/caddieDecision.ts');
    expect(b).toMatch(/rain\|drizzle\|shower\|thunderstorm/);
    expect(b).toMatch(/return 'Rainy'/);
  });

  it('rain and cold are checked BEFORE wind — they change the ball and the player', () => {
    const b = code('services/caddieDecision.ts');
    const rain = b.indexOf("return 'Rainy'");
    const cold = b.indexOf("return 'Cold'");
    const wind = b.indexOf("return 'Windy'");
    expect(rain).toBeLessThan(wind);
    expect(cold).toBeLessThan(wind);
  });
});

describe('a condition that costs THIS player gets a play', () => {
  const cold = conditionFindings(COLD_PLAYER).find((f) => f.value === 'Cold')!;

  it('the finding is real before anything is offered', () => {
    expect(cold).toBeTruthy();
    expect(cold.deltaStrokes).toBeGreaterThan(5);
  });

  it('tells him what the app ALREADY did, so he does not club up twice', () => {
    // The single most valuable line: a golfer in the cold clubs up by feel, and plays-like has
    // already added the yards. No generic tip sheet can tell him that.
    const p = conditionPlay(cold)!;
    expect(p.alreadyHandled).toMatch(/already/i);
    expect(p.alreadyHandled).toMatch(/flies shorter|plays-like/i);
  });

  it('gives mitigations that are golf, not platitudes', () => {
    const p = conditionPlay(cold)!;
    expect(p.mitigations.length).toBeGreaterThan(0);
    expect(p.mitigations.join(' ')).toMatch(/hands warm|smoother/i);
  });

  it('and MOVES THE TARGET, which is the mindset half', () => {
    /**
     * A player grinding against a fair-weather number in the cold is the spiral this app exists to
     * interrupt. Smart bogey golf measures the round against what is achievable today.
     */
    const p = conditionPlay(cold)!;
    expect(p.mindset).toMatch(/not today going wrong/i);
    expect(p.mindset).toMatch(/good round, not a bad one/i);
  });

  it('rain, heat and wind each get their own real answer', () => {
    for (const w of ['Rainy', 'Hot', 'Windy']) {
      const rounds = [
        r(20, w), r(21, w), r(19, w),
        r(12, 'Sunny'), r(11, 'Sunny'), r(13, 'Sunny'),
      ];
      const f = conditionFindings(rounds).find((x) => x.value === w)!;
      const p = conditionPlay(f)!;
      expect(p.mitigations.length).toBeGreaterThan(0);
      expect(p.mindset).toBeTruthy();
    }
  });
});

describe('and it stays quiet when it has no business speaking', () => {
  /**
   * My first version used 'Sunny', which has no branch at all — so it returned null whatever the
   * delta was, and passed even with the "only when it costs him" guard deleted. Break-testing found
   * it. This uses WINDY, which HAS a branch, on a player who scores BETTER in it.
   */
  it('says nothing for a condition he plays BETTER in, even one it has advice for', () => {
    const windIsFine = [
      r(10, 'Windy'), r(11, 'Windy'), r(9, 'Windy'),
      r(16, 'Sunny'), r(17, 'Sunny'), r(15, 'Sunny'),
    ];
    const windy = conditionFindings(windIsFine).find((f) => f.value === 'Windy')!;
    expect(windy.deltaStrokes).toBeLessThan(0);       // better, not worse
    expect(conditionPlay(windy)).toBeNull();
  });

  it('and nothing for a condition with no real answer', () => {
    const sunny = conditionFindings(COLD_PLAYER).find((f) => f.value === 'Sunny')!;
    expect(conditionPlay(sunny)).toBeNull();
  });

  it('says nothing about focus or vibe — this is weather advice', () => {
    const focus = [
      r(20, 'Cold'), r(21, 'Cold'), r(19, 'Cold'),
      r(12, 'Sunny'), r(11, 'Sunny'), r(13, 'Sunny'),
    ].map((x, i) => ({ ...x, postRoundFeelings: { ...x.postRoundFeelings, focus: i < 3 ? 'Off' : 'Locked In' } }));
    const f = conditionFindings(focus).find((x) => x.key === 'focus')!;
    expect(conditionPlay(f)).toBeNull();
  });

  it('says nothing at all with no findings', () => {
    expect(conditionPlay(null)).toBeNull();
    expect(playForToday([], { weather: 'Cold' })).toBeNull();
  });

  it('only speaks when TODAY is the condition', () => {
    const all = conditionFindings(COLD_PLAYER);
    expect(playForToday(all, { weather: 'Cold' })).not.toBeNull();
    expect(playForToday(all, { weather: 'Sunny' })).toBeNull();
    expect(playForToday(all, { weather: null })).toBeNull();
  });
});

describe('the fit profile talks to the caddie', () => {
  it('the bag gaps finally have a writer', () => {
    const b = code('services/caddieDecision.ts');
    expect(b).toMatch(/composeFitProfile\(/);
    expect(b).toMatch(/bagGapCount,/);
  });

  it('and playProfile can now actually say it', () => {
    expect(code('services/playProfile.ts')).toMatch(/real gaps in your set/);
  });
});

describe('and the caddie talks back to the fit profile', () => {
  const pair = (uses: [number, number]) => composeFitProfile([
    { club: '5W', yards: 185, measured: true, uses: uses[0] },
    { club: '5H', yards: 182, measured: true, uses: uses[1] },
  ] as never);

  it('names the club he never swings as the bench candidate', () => {
    const p = pair([30, 1]);
    expect(p.overlaps[0].benchCandidate).toBe('5H');
  });

  it('and the other way round, so it is the usage deciding', () => {
    expect(pair([1, 30]).overlaps[0].benchCandidate).toBe('5W');
  });

  it('says nothing when he uses both — two similar clubs is not a recommendation', () => {
    expect(pair([20, 18]).overlaps[0].benchCandidate).toBeNull();
  });

  it('says nothing on thin volume — a club swung twice is not evidence', () => {
    expect(pair([3, 0]).overlaps[0].benchCandidate).toBeNull();
  });

  it('says nothing when usage is UNKNOWN rather than guessing', () => {
    const p = composeFitProfile([
      { club: '5W', yards: 185, measured: true },
      { club: '5H', yards: 182, measured: true },
    ] as never);
    expect(p.overlaps[0].benchCandidate).toBeNull();
  });

  it('the screen supplies the usage the store now collects', () => {
    expect(code('app/practice/fit-profile.tsx')).toMatch(/uses: st\.repsFor\(c\)/);
  });
});

describe('it reaches the caddie', () => {
  it('the payload carries the play', () => {
    expect(code('services/caddieRequestBody.ts')).toMatch(/play: d\.conditionPlay/);
  });

  it('and the caddie is told to frame the round, not lecture', () => {
    const k = code('api/kevin.ts');
    expect(k).toMatch(/Tell him this if he talks about clubbing for it/);
    expect(k).toMatch(/Frame the round like this/);
    expect(k).toMatch(/It is a frame for the round, not a lecture/);
  });
});
