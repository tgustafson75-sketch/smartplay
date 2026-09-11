/**
 * 2026-09-11 — THE CADDIE WAS STILL BRIEFING A TEE SHOT TO A MAN IN THE FAIRWAY.
 *
 * services/yardageResolver falls through to `static_card` whenever there is no green geometry —
 * which is every hole of every golfcourseapi course until geometry builds, and any hole where GPS
 * is soft. That tier returns the FULL card length regardless of how many shots have been played;
 * its own `reason` string says "from the tee".
 *
 * api/kevin then rendered, to a man 150 yards out lying one:
 *
 *   "DISTANCE REMAINING RIGHT NOW: 370 yards. This is the shot in front of them.
 *    It is NOT the hole's card length..."
 *
 * Three claims, every one false, about a number that was precisely the card length. The hedge that
 * follows then said "say it plays about this" — so the caddie would tell a man holding a 7-iron
 * that he had about 370. Wrong by the entire tee shot, not merely imprecise.
 *
 * This is the 2026-08-22 Greenhill defect ("a TEE briefing, off the scorecard, to a man standing in
 * the fairway"). currentStroke was added to the payload to fix it, and this one path never consulted
 * it. It was found by DRIVING THE STORES, not by reading source — the source-level assertions all
 * passed straight through it. [[run-the-second-pass-yourself]]
 */
import fs from 'fs';
import path from 'path';

const kevin = fs.readFileSync(path.resolve(__dirname, '../../api/kevin.ts'), 'utf-8');

/** The distance block, isolated so the assertions cannot drift onto some other yardage text. */
const block = (() => {
  const at = kevin.indexOf('const haveNumber = typeof currentYardage');
  expect(at).toBeGreaterThan(-1);
  return kevin.slice(at, at + 6000).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
})();

describe('the card length is the shot in front of them only on the tee', () => {
  it('consults which stroke they are on at all', () => {
    expect(block).toMatch(/const onTheTee = !\(typeof currentStroke === 'number' && currentStroke > 1\)/);
    expect(block).toMatch(/const cardOnly = yi\?\.source === 'static_card'/);
  });

  it('withholds the number entirely once they have hit', () => {
    expect(block).toMatch(/if \(haveNumber && cardOnly && !onTheTee\)/);
    const at = block.indexOf('if (haveNumber && cardOnly && !onTheTee)');
    const branch = block.slice(at, at + 700);
    expect(branch).toMatch(/not established/);
    expect(branch).toMatch(/ALREADY HIT/);
    expect(branch).toMatch(/Do not club off it/);
  });

  it('never tells the caddie a card number is NOT the card', () => {
    /**
     * The specific falsehood. The "It is NOT the hole's card length" sentence is correct and load
     * bearing for a MEASURED number — it stops the caddie quoting a scorecard — so it stays. It must
     * simply never be rendered over a value that came from the card.
     */
    const at = block.indexOf("It is NOT the hole's card length");
    expect(at).toBeGreaterThan(-1);
    // that sentence lives in the NON-card branch of the ternary
    const before = block.slice(Math.max(0, at - 400), at);
    expect(before).toMatch(/cardOnly/);
    expect(before).toMatch(/card length from the tee, which IS the shot in front of them/);
  });

  it('still gives the number on the tee, where it is true', () => {
    // Withholding it there would be the over-strict gate this codebase refuses: a blank is not more
    // honest than the card when the card is exactly right.
    expect(block).toMatch(/because they are still on the tee/);
  });

  it('keeps the hedge for the tee case rather than stating the card flatly', () => {
    expect(block).toMatch(/HEDGE: this is the scorecard yardage, not a live measurement/);
  });
});

describe('the resolver still reports the card honestly — this is a PROMPT fix, not a data change', () => {
  const resolver = fs.readFileSync(path.resolve(__dirname, '../../services/yardageResolver.ts'), 'utf-8');

  it('static_card still says outright that it is from the tee', () => {
    // Changing the resolver would move a number every other surface reads. The defect was that one
    // consumer contradicted it, so the fix belongs at that consumer.
    expect(resolver).toMatch(/using static card \(\$\{hData\.distance\}y from the tee\)/);
    expect(resolver).toMatch(/is_fallback: true,/);
  });
});
