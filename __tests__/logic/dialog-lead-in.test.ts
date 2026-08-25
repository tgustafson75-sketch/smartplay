/**
 * 2026-08-24 (Tim's on-course screenshot) — the caddie said:
 *
 *     "Looks like Ball is on a patchy lie with some sticks and debris, 114 yards to the middle…"
 *
 * The template is "Looks like {situation} {advice}" and `situation` arrived as a complete sentence
 * starting with a capital. Gluing them produced a capital mid-sentence and a missing article. Small,
 * and exactly the seam that stops the caddie sounding like a person, which is the north star.
 */
import { getDialog } from '../../services/dialogEngine';

describe('a lead-in and a clause read as one sentence', () => {
  const say = (ctx: Record<string, string>) => {
    // Sample enough times to see every variation the engine can pick.
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) seen.add(getDialog('caddie', 'lie_analysis_summary', ctx));
    return [...seen];
  };

  it('never leaves a capitalised word mid-sentence after a lead-in', () => {
    for (const line of say({ situation: 'Ball is on a patchy lie.', advice: 'Take a 9 iron.' })) {
      expect(line).not.toMatch(/\b(?:like|and|but|so|then)\s+[A-Z][a-z]/);
    }
  });

  it('leaves a slot that OPENS the sentence capitalised', () => {
    // "{situation} {advice}" style templates must not be lowercased into nonsense.
    const out = getDialog('caddie', 'lie_analysis_summary', { situation: 'Ball is buried.', advice: 'Wedge out.' });
    expect(out.charAt(0)).toBe(out.charAt(0).toUpperCase());
  });

  it('leaves a club or acronym alone — "your PW", never "your pW"', () => {
    for (const line of say({ situation: 'PW is plenty here.', advice: 'Smooth it.' })) {
      expect(line).not.toMatch(/\bpW\b/);
    }
  });

  it('never throws and always returns something sayable', () => {
    expect(typeof getDialog('caddie', 'lie_analysis_summary', {})).toBe('string');
  });
});
