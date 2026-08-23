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
  // 2026-08-23 — the client had sent this for MONTHS and kevin never destructured it;
  // askGolfFatherHandler.ts even says "exists; not wired". A photographed buried lie produced advice
  // built as if the ball were sitting up in the fairway.
  'pendingLieAnalysis',
];

describe('both brain routes carry the same facts', () => {
  const kevin = R('api/kevin.ts');
  const shim = R('api/_brainShim.ts');
  const body = R('services/caddieRequestBody.ts');

  it.each(FACTS)('kevin destructures %s', (f) => {
    expect(kevin).toMatch(new RegExp(`\\b${f}\\b`));
  });

  it.each(FACTS)('the direct route sends %s', (f) => {
    expect(body).toMatch(new RegExp(`\\b${f}\\b`));
  });

  /**
   * 2026-08-23 — the "pipecat context builds it" case is gone, because services/pipecatContext.ts
   * is gone. That file WAS the second route: a second client payload builder feeding a second brain,
   * and the reason this test needed a per-route case at all.
   *
   * The property it protected is now enforced by construction rather than by assertion — there is
   * one builder, so a fact cannot reach one route and miss another. What replaces it is the check
   * below that no NEW hand-built payload appears (see live-trouble-reaches-the-caddie.test.ts),
   * which is the only way the split could come back.
   */

  it.each(FACTS)('the shim forwards %s to kevin', (f) => {
    expect(shim).toMatch(new RegExp(`\\b${f}\\s*:`));
  });

  it('kevin RENDERS them, not just destructures — sent-and-ignored is the same bug', () => {
    for (const marker of ['HOW THIS ROUND IS GOING', 'PLAYING THEIR STROKE', 'Getting around:',
                          'WHERE THEY ARE STANDING', 'Risk posture:', 'NINE-HOLE round',
                          'THE LIE, LOOKED AT']) {
      expect(kevin).toContain(marker);
    }
  });
});
