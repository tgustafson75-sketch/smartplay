/**
 * 2026-09-13, triple-check — SIXTEEN ORDINARY GOLF QUESTIONS, AND THREE RETRIEVED NOTHING.
 *
 * Written while regression-checking the `norm()` apostrophe fix. It was NOT a regression: reverting the
 * normalizer left the same three empty, so these were pre-existing content gaps, and checking that
 * before reporting is the difference between a finding and a false accusation of my own change.
 *
 *     "what is a fade"      → nothing, though ballFlight has 'draw vs fade' and 'how to hit a fade'
 *     "should I lay up"     → nothing, though courseStrategy has 'lay up or go for the green'
 *     "my irons go right"   → nothing, though fault_library has fault.push, 'straight right', 'block'
 *
 * Each had real curated content sitting one alias away. The cause is the retrieval FLOOR (2): a single
 * keyword overlap does not clear it, and "lay" or "right" alone is a single overlap. The fix is aliases,
 * not a lower floor — dropping the floor would surface noise for every query in the app, which is what
 * the floor exists to prevent.
 *
 * This guard is the sweep made permanent. It asserts only that an ordinary question finds SOMETHING,
 * never which entry, so it cannot become a straitjacket on curation — but a question a golfer would
 * actually ask can no longer come back empty unnoticed.
 */
import fs from 'fs';
import path from 'path';
import { retrieveKB } from '../../services/knowledgeBase/retrieve';

/** Plain questions across the modules, in the words a player would use. */
const QUESTIONS = [
  'how do I stop slicing my driver',
  'what club for 150 yards',
  'how do I hit a flop shot',
  'my putts come up short',
  'what is a fade',
  'how do I get out of a bunker',
  'ball above my feet',
  'should I lay up',
  'my irons go right',
  'how do I warm up',
  'what shaft flex do I need',
  'I top my fairway woods',
  'chipping from tight lies',
  "what's the smart play",
  'downhill lie',
  'how far should I hit my 7 iron',
];

describe('an ordinary golf question retrieves something', () => {
  it.each(QUESTIONS)('"%s"', (q) => {
    const hits = retrieveKB(q, { max: 3 }) as { id: string }[];
    expect(hits.length).toBeGreaterThan(0);
  });

  it('the three that were empty now land on the module that holds the content', () => {
    const moduleFor = (q: string) => (retrieveKB(q, { max: 3 }) as { module: string }[]).map((h) => h.module);
    expect(moduleFor('what is a fade')).toContain('ball_flight');
    /**
     * "should I lay up" lands on course_mgmt, not course_strategy — a bail-out entry there outranks the
     * par-5 lay-up alias, and that is the right answer for a bare "should I lay up" with no hole context.
     * Asserted as EITHER, because which of the two course modules wins is a curation decision and pinning
     * one would make a correct re-rank fail. The requirement is that it is course management at all.
     */
    expect(moduleFor('should I lay up').some((m) => m === 'course_mgmt' || m === 'course_strategy')).toBe(true);
    expect(moduleFor('my irons go right')).toContain('fault_library');
  });

  it('a query with no overlap at all retrieves nothing — never a fabricated answer', () => {
    for (const junk of ['zzzz', 'qwertyuiop asdf', 'the of and to']) {
      expect(retrieveKB(junk, { max: 3 })).toEqual([]);
    }
  });

  it('and the FLOOR is still 2, which is the thing the fix deliberately did not touch', () => {
    /**
     * Stated as a source assertion, honestly, because the behavioural test above does NOT pin it: the
     * scoring loop drops score-0 entries with `if (base <= 0) continue`, so gibberish is excluded before
     * the floor is ever consulted. The floor only separates a score of 1 from 2 — a single keyword
     * overlap — which is exactly what left "should I lay up" empty.
     *
     * Break-testing caught me claiming otherwise: mutating the floor to 0 left all 19 assertions green.
     * The right fix for a thin match is an alias, not a lower floor, because lowering it surfaces a
     * stray-word match for every query in the app.
     */
    const src = fs.readFileSync(path.join(__dirname, '../../services/knowledgeBase/retrieve.ts'), 'utf8');
    expect(src).toMatch(/const FLOOR = opts\.minScore \?\? 2;/);
    expect(src).toMatch(/if \(base <= 0\) continue;/);
  });

  it('and the apostrophe fix stayed additive — both spellings still land together', () => {
    const a = (retrieveKB("what's the smart play", { max: 3 }) as { id: string }[]).map((h) => h.id);
    const b = (retrieveKB('whats the smart play', { max: 3 }) as { id: string }[]).map((h) => h.id);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
