/**
 * 2026-09-12 (Tim) — THE APP KNEW WHICH BALL HE PLAYED AND COULD NOT USE IT.
 *
 * "I've been actually using different balls and seeing different results. And so being able to say,
 *  listen, I'm gonna tee off here with a Chromesoft, and just ingest that data."
 *
 * `playerProfileStore.currentBall` had existed for months. It was written in exactly ONE place —
 * typing into a text field on app/ball-fit — and read by services/cnsBallFitting and nothing else.
 * The caddie payload never carried it, so the caddie could not know the ball even after being told,
 * and it was a single global string with no history, so nothing could ever compare one ball to
 * another. That comparison is the actual question. [[sweep-the-missing-half-not-the-unused-export]]
 */
import fs from 'fs';
import path from 'path';
import { compareBalls, MIN_ROUNDS_PER_BALL, MEANINGFUL_STROKES } from '../../services/ballPerformance';
import type { RoundRecord } from '../../store/roundStore';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const round = (ball: string | null, scoreVsPar: number | null): RoundRecord =>
  ({ ball, scoreVsPar } as RoundRecord);

describe('the ball reaches the caddie', () => {
  it('rides the payload', () => {
    expect(code('services/caddieRequestBody.ts')).toMatch(/currentBall: safe\(\(\) => p\.currentBall/);
  });

  it('rides the MESSAGE side of the brain, not the cached system block', () => {
    const kevin = code('api/kevin.ts');
    expect(kevin).toContain('currentBall = null,');
    // it is pushed into the per-turn `lines`, which is the message-side list
    expect(kevin).toMatch(/if \(typeof currentBall === 'string' && currentBall\.trim\(\)\) \{\s*lines\.push/);
  });

  it('tells the caddie NOT to volunteer ball opinions — he mentioned it in passing', () => {
    expect(code('api/kevin.ts')).toMatch(/Do NOT offer a ball recommendation unless they ask/);
  });
});

describe('the ball is stamped on the round, which is what makes comparison possible', () => {
  it('every live record-build path stamps it, including the abandoned-round preserve', () => {
    const store = code('store/roundStore.ts');
    expect(store).toMatch(/ball\?: string \| null;/);
    // two live builds: end-of-round, and preserve-on-startRound. Both read the profile.
    expect((store.match(/usePlayerProfileStore\.getState\(\)\.currentBall/g) ?? []).length).toBe(2);
  });
});

describe('comparing balls is honest or it says nothing', () => {
  it('says it has nothing when no round carries a ball', () => {
    const c = compareBalls([round(null, 5), round(null, 8)]);
    expect(c.better).toBeNull();
    expect(c.say).toMatch(/not got a ball recorded/);
  });

  it('will not compare until each ball has enough rounds', () => {
    const c = compareBalls([
      round('Chrome Soft', 2), round('Chrome Soft', 3),
      round('Pro V1', 9), round('Pro V1', 10), round('Pro V1', 11),
    ]);
    expect(c.better).toBeNull();
    expect(c.say).toMatch(new RegExp(`about ${MIN_ROUNDS_PER_BALL} rounds`));
  });

  it('names a winner only when the gap clears the noise floor', () => {
    const clear = compareBalls([
      round('Chrome Soft', 3), round('Chrome Soft', 4), round('Chrome Soft', 2),
      round('Pro V1', 9), round('Pro V1', 10), round('Pro V1', 8),
    ]);
    expect(clear.better?.ball).toBe('Chrome Soft');
    expect(clear.say).toMatch(/Chrome Soft, by about/);
  });

  it('calls a small gap level rather than inventing a winner', () => {
    const noisy = compareBalls([
      round('Chrome Soft', 5), round('Chrome Soft', 5), round('Chrome Soft', 5),
      round('Pro V1', 5), round('Pro V1', 6), round('Pro V1', 5),
    ]);
    expect(noisy.better).toBeNull();
    expect(noisy.say).toMatch(/Honestly, level/);
    // and the gap really is under the floor, so the test is checking the rule not the wording
    const gap = noisy.splits[1].avgVsPar - noisy.splits[0].avgVsPar;
    expect(gap).toBeLessThan(MEANINGFUL_STROKES);
  });

  it('treats spellings of one ball as one ball', () => {
    const c = compareBalls([
      round('Chromesoft', 3), round('Chrome Soft', 4), round('CHROMESOFT', 2),
      round('Pro V1', 9), round('Pro V1', 10), round('Pro V1', 8),
    ]);
    expect(c.splits.find((s) => /chrome/i.test(s.ball))?.rounds).toBe(3);
  });

  it('ignores rounds with no known par — a zero there would favour whichever ball it used', () => {
    const c = compareBalls([
      round('Chrome Soft', 3), round('Chrome Soft', 4), round('Chrome Soft', 2), round('Chrome Soft', null),
      round('Pro V1', 9), round('Pro V1', 10), round('Pro V1', 8),
    ]);
    expect(c.splits.find((s) => /chrome/i.test(s.ball))?.rounds).toBe(3);
  });

  it('compares vs-par, never raw total — a nine-hole round would win every time', () => {
    expect(code('services/ballPerformance.ts')).not.toMatch(/totalScore/);
    expect(code('services/ballPerformance.ts')).toContain('scoreVsPar');
  });
});

describe('declaring a ball by voice', () => {
  const handler = code('services/intents/setBallHandler.ts');

  it('is registered in the router', () => {
    expect(code('services/intents/index.ts')).toContain('registerHandler(setBallHandler)');
  });

  it('writes the SAME field the ball-fit screen writes — one owner', () => {
    expect(handler).toContain('setCurrentBall');
    expect(code('app/ball-fit.tsx')).toContain('setCurrentBall');
  });

  it('does not whitelist ball names — the ball he is testing is the newest one', () => {
    expect(handler).not.toMatch(/KNOWN_BALLS|BALL_LIST|\['Pro V1'/);
  });
});
