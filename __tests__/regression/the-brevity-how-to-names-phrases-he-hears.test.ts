/**
 * 2026-10-28 (Brain recheck R8) — the caddie-brevity how-to rides in the brain prompt on every turn
 * (howToForPrompt), so it is the copy Kevin actually SPEAKS when asked "how do I get you to say
 * more?". R7 narrowed the learner's "more" side to phrases about his answers in general, and this
 * entry kept promising "give me more detail" — which the learner no longer hears. A player on learned
 * brief answers said it, nothing moved, and the caddie had just told him there was no setting to hunt
 * for.
 *
 * So every phrase this entry tells him to say must move the style the way the sentence says it does.
 * The copy and the phrase lists cannot drift apart again without this failing.
 */
import { HOW_TO, howToForPrompt } from '../../services/knowledgeBase/howTo';
import { detectStyleSignal } from '../../services/caddieStyle';

const entry = HOW_TO.find((h) => h.id === 'caddie-brevity');

/** Each clause of the steps that quotes something to say, with the direction it promises. */
function promises(steps: string): { said: string; expected: 'briefer' | 'fuller' }[] {
  const out: { said: string; expected: 'briefer' | 'fuller' }[] = [];
  for (const clause of steps.split(/—|\.\s/)) {
    const quoted = [...clause.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (!quoted.length) continue;
    const expected = /open back up/.test(clause) ? 'fuller' : /shorten up/.test(clause) ? 'briefer' : null;
    // A quoted phrase with no stated effect is a promise this test cannot check — make it say one.
    if (!expected) throw new Error(`caddie-brevity quotes ${quoted.join(', ')} without saying what it does`);
    for (const said of quoted) out.push({ said, expected });
  }
  return out;
}

describe('the brevity how-to only promises phrases the learner hears', () => {
  it('is in the prompt Kevin answers from', () => {
    expect(entry).toBeDefined();
    expect(howToForPrompt()).toContain(entry!.steps);
  });

  it('names both directions', () => {
    const p = promises(entry!.steps);
    expect(p.some((x) => x.expected === 'briefer')).toBe(true);
    expect(p.some((x) => x.expected === 'fuller')).toBe(true);
  });

  for (const { said, expected } of entry ? promises(entry.steps) : []) {
    it(`"${said}" → ${expected}`, () => expect(detectStyleSignal(said)).toBe(expected));
  }
});
