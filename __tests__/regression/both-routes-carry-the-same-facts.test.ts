import * as fs from 'fs';
import * as path from 'path';
const R = (f: string) => fs.readFileSync(path.resolve(__dirname, '../../', f), 'utf-8');

/**
 * 2026-08-23 — Tim: "I'm betting dollars to donuts that fifty percent of the work is fifty percent
 * done." He was right.
 *
 * Seven fields added to the kevin path on 08-22/23 (currentStroke, roundStats, transportMode,
 * currentLocationType, riskMode, currentTeeBox, nineHoleMode) reached ONE brain and not the other —
 * the exact two-payload split that made the caddie change character mid-round, reintroduced by the
 * very work meant to fix it. The pipecat route is TURN ONE, so the first question of every round got
 * the thinner half.
 *
 * This forbids the shape: a fact kevin reads must reach kevin on BOTH routes.
 */
const FACTS = [
  'currentStroke', 'roundStats', 'transportMode',
  'currentLocationType', 'riskMode', 'currentTeeBox', 'nineHoleMode',
];

describe('both brain routes carry the same facts', () => {
  const kevin = R('api/kevin.ts');
  const shim = R('api/_brainShim.ts');
  const ctx = R('services/pipecatContext.ts');
  const body = R('services/caddieRequestBody.ts');

  it.each(FACTS)('kevin destructures %s', (f) => {
    expect(kevin).toMatch(new RegExp(`\\b${f}\\b`));
  });

  it.each(FACTS)('the direct route sends %s', (f) => {
    expect(body).toMatch(new RegExp(`\\b${f}\\b`));
  });

  it.each(FACTS)('the pipecat context builds %s', (f) => {
    expect(ctx).toMatch(new RegExp(`\\b${f}\\b`));
  });

  it.each(FACTS)('the shim forwards %s to kevin', (f) => {
    expect(shim).toMatch(new RegExp(`\\b${f}\\s*:`));
  });

  it('kevin RENDERS them, not just destructures — sent-and-ignored is the same bug', () => {
    for (const marker of ['HOW THIS ROUND IS GOING', 'PLAYING THEIR STROKE', 'Getting around:',
                          'WHERE THEY ARE STANDING', 'Risk posture:', 'NINE-HOLE round']) {
      expect(kevin).toContain(marker);
    }
  });
});
