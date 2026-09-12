/**
 * 2026-09-11 (Tim — "triple check plays like and its relationship to the user's bag") —
 * THE CADDIE COULD RECOMMEND A CLUB IN THE GARAGE.
 *
 * The Sunday-bag work that morning scoped the LOCAL club pick to carriedList(): cnsShotRead will
 * never choose a club he left at home. services/caddieRequestBody was not moved with it and still
 * sent bagList() — everything registered — under a prompt block headed "[CLUBS IN THE BAG]" whose
 * own text says "You may name one of these".
 *
 * So the two halves of one decision disagreed. Worse, the brain met TWO lists both headed "THE
 * BAG": fourteen clubs of carry distances, and four clubs actually present. The longer, more
 * specific one wins every time.
 *
 * My own half-fix, found by auditing my own morning's work rather than by a gate.
 */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the inventory the brain is given', () => {
  const body = strip(read('services/caddieRequestBody.ts'));

  it('is the CARRIED bag, not everything he owns', () => {
    expect(body).toMatch(/bagClubs: safe\(\(\) => \{[\s\S]{0,240}carriedList\(\)/);
  });

  it('no longer sends the full registered list as the bag', () => {
    const at = body.indexOf('bagClubs: safe(');
    expect(at).toBeGreaterThan(-1);
    expect(body.slice(at, at + 260)).not.toMatch(/bagList\(\)/);
  });

  it('but the CARRY DISTANCES stay unscoped — how far he hits a club is true wherever it is', () => {
    // "How far do I hit my 3 wood" deserves an answer even on a day he left it at home.
    expect(body).toMatch(/clubDistances: safe\(\(\) => \{[\s\S]{0,160}bagDistances\(\)/);
  });
});

describe('the two blocks can no longer contradict each other', () => {
  const kevin = read('api/kevin.ts');

  it('the distance block calls itself a reference, not the bag', () => {
    expect(kevin).toMatch(/\[CARRY DISTANCES — how far this player FLIES each club he owns/);
    expect(kevin).toMatch(/A reference, NOT what is with him today/);
  });

  it('the old ambiguous "THE BAG" heading on the distance block is gone', () => {
    expect(kevin).not.toMatch(/\[THE BAG — real CARRY distances/);
  });

  it('the inventory block is stated as authoritative', () => {
    expect(kevin).toMatch(/the ONLY clubs available this round; never recommend one that is not here/);
  });

  it('and names what was left behind, so an absent club can be explained not ignored', () => {
    expect(kevin).toMatch(/NOT with him today/);
    expect(kevin).toMatch(/do not recommend hitting it/);
  });

  it('the left-behind line is derived from the two lists, never hardcoded', () => {
    expect(kevin).toMatch(/const leftAtHome = measuredList\.filter\(\(c\) => !registered\.includes\(c\)\)/);
  });
});

describe('a player who never touches the pack screen is unaffected', () => {
  it('carriedList falls back to the whole registered bag when no subset is set', () => {
    const store = strip(read('store/clubBagStore.ts'));
    // empty carriedToday means carrying everything — so both lists match and leftAtHome is empty.
    expect(store).toMatch(/if \(!carried \|\| carried\.length === 0\) return all;/);
  });
});
