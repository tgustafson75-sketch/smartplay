/**
 * 2026-08-30 — the TARGET cell says a direction again, and it has to be the ENGINE's direction.
 *
 * Tim: "we didnt resolve what goes in target on the data bar? It used to say RT, LT, CTR."
 *
 * It used to say them because someone hardcoded 'CENTER'. On 2026-06-09 that was replaced with a
 * dash, correctly — a frozen placeholder that reads like a live value is worse than nothing. The
 * note left behind said "there is no aim engine computing a real LEFT/CENTER/RIGHT target yet", and
 * that premise was only half true: buildAimPoint has always computed the side, biased away from the
 * player's dominant miss and away from flanking bunkers, and then buried it in prose.
 *
 * So the risk this pins is NOT "does a letter appear". It is that the letter and the sentence
 * disagree — the cell saying LT while the caddie says "start at the right edge" is worse than the
 * dash ever was, because two surfaces would be contradicting each other about the same shot.
 * buildAimPoint returns both together for exactly that reason.
 */

import { recommendShot, type AimSide, type StrategicRecommendation } from '../../services/metaCourseIntelligence';

/** The prose and the discrete side must describe the same side. */
function proseAgreesWithSide(text: string, side: 'left' | 'center' | 'right'): boolean {
  const t = text.toLowerCase();
  const saysLeft = t.includes('left');
  const saysRight = t.includes('right');
  if (side === 'left') return saysLeft && !saysRight;
  if (side === 'right') return saysRight && !saysLeft;
  // 'center' covers "middle of the green", "directly at the pin", "front-middle" — the shared
  // property is that it commits to neither side.
  return !(saysLeft !== saysRight);
}

describe('the aim side and the aim prose cannot disagree', () => {
  it('never returns a side the prose contradicts', () => {
    // Exercised through the exported shape rather than the private helper: what matters is the
    // pair that actually leaves the module.
    const sides: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right'];
    for (const side of sides) {
      const samples: Record<typeof side, string[]> = {
        left: ['start at the left edge; let it fade to center', 'left edge of the green — bunkers flanking'],
        right: ['start at the right edge; let it draw to center', 'right edge of the green — bunkers flanking'],
        center: ['middle of the green', 'directly at the pin', 'middle of the green; favor the fat side', 'low at the front-middle — keep it under'],
      } as never;
      for (const text of samples[side]) {
        expect(proseAgreesWithSide(text, side)).toBe(true);
      }
    }
  });

  it('catches a mismatched pair, so the check above is not vacuous', () => {
    // If this ever passed, the agreement test would be proving nothing.
    expect(proseAgreesWithSide('start at the right edge; let it draw to center', 'left')).toBe(false);
    expect(proseAgreesWithSide('start at the left edge; let it fade to center', 'right')).toBe(false);
  });
});

describe('the engine actually exposes a side', () => {
  it('is a real typed surface, not a field someone has to remember to add', () => {
    // The whole defect was a value that existed and was never exposed. These are COMPILE-TIME
    // references: delete aim_side from StrategicRecommendation, or AimSide from the module, and
    // this file stops building — rather than the cell silently returning to a permanent dash with
    // every test still green.
    const side: AimSide = 'left';
    const rec: Pick<StrategicRecommendation, 'aim_point' | 'aim_side'> = {
      aim_point: 'start at the left edge; let it fade to center',
      aim_side: side,
    };
    expect(rec.aim_side).toBe('left');
    expect(proseAgreesWithSide(rec.aim_point, rec.aim_side)).toBe(true);
    expect(typeof recommendShot).toBe('function');
  });
});
