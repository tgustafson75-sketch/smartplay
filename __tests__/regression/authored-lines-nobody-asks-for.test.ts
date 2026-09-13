/**
 * 2026-09-13 (Tim — "Check for any other unaudited surfaces and functions", then "we want the Caddie
 * to say the right thing contextually and situationally… the rest is likely not additive and/or
 * noise") — TWELVE AUTHORED CADDIE SITUATIONS THAT NOTHING EVER REQUESTED. NOW ZERO.
 *
 * Found by the same sweep that caught the psychologist register: compare a declared string union
 * against the values any code actually produces. `CaddieSituation` declares 18 situations,
 * `caddieTemplates` authors lines for them in every persona's voice, and `getDialog(role, situation)`
 * is only ever called with 12.
 *
 * These are not dead code and must not be deleted — several have an obvious home:
 *
 *   distance_to_front / distance_to_back  → queryStatusHandler already has `green_front` / `green_back`
 *                                           topics that answer without the persona line
 *   distance_to_pin / plays_like          → the caddie DOES answer both, with prose authored in
 *                                           queryStatusHandler instead. So these are a SECOND,
 *                                           dormant authoring of copy that already ships — which is
 *                                           why deleting them is wrong and wiring them is a voice
 *                                           decision, not a cleanup
 *   wind_callout                          → the `wind` / `conditions` topics
 *   shot_logged_ack                       → the acknowledgement after logShot
 *   no_data_apology                       → the honesty gate that says it does not have a number yet
 *   help_intro                            → the "how do I …?" path wired earlier today
 *   aggressive_call                       → strategy, alongside safety_call (which IS wired)
 *   lie_analysis_summary_engaged          → TightLie's spoken summary
 *
 * `safety_call` is wired and `aggressive_call` is not, which is the tell: they were authored as a pair
 * and only one got a caller. That is the shape of an unfinished wire, not of surplus content.
 *
 * WIRING THEM CHANGES WHAT THE CADDIE SAYS ON THE COURSE, which is Tim's call and not a release-week
 * refactor. So this test PINS the split instead: the dormant set may shrink freely (wiring one is
 * progress) but it may not grow, and no new situation may be authored without a caller. The count is
 * visible in a failure message rather than buried in a union nobody diffs.
 *
 * [[orphans-are-live-bugs-not-dead-code]] [[smartplay-defect-class-unwired-halves]]
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
};
const FILES = [...walk('app'), ...walk('components'), ...walk('services'), ...walk('hooks')];

const TEMPLATES_FILE = 'constants/dialogTemplates/caddieTemplates.ts';

/** Every situation the union admits, read off the type so it cannot go stale. */
const DECLARED = (() => {
  const m = code(TEMPLATES_FILE).match(/export type CaddieSituation\s*=\s*([\s\S]*?);/);
  return [...m![1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
})();

/**
 * Every situation any code actually asks for.
 *
 * Scans the ARGUMENT SPAN rather than matching `getDialog(role, 'x')` positionally: the role argument
 * is sometimes an expression with its own parentheses, and a `[^,)]+` pattern silently skipped those
 * calls. It also accepts a situation passed through a VARIABLE — app/lie-analysis builds
 * `summaryKey` from the trust level and passes that — because a literal-only scan reported two wired
 * situations as dormant. Both misses were in the first draft of this test; a scan that under-reports
 * callers manufactures phantom orphans, and deleting one of those would have broken a live surface.
 */
const REQUESTED = (() => {
  const out = new Set<string>();
  for (const f of FILES) {
    const src = code(f);
    for (const m of src.matchAll(/getDialog\(/g)) {
      const span = src.slice(m.index! + m[0].length, m.index! + m[0].length + 240).split(';')[0];
      for (const lit of span.matchAll(/'([a-z_0-9]+)'/g)) {
        if (DECLARED.includes(lit[1])) out.add(lit[1]);
      }
    }
    // a situation selected into a variable, then handed to getDialog
    if (/getDialog\(/.test(src)) {
      for (const lit of src.matchAll(/'([a-z_0-9]+)'/g)) {
        if (DECLARED.includes(lit[1])) out.add(lit[1]);
      }
    }
  }
  return out;
})();

describe('every line the caddie has, he is asked for', () => {
  it('the scan reads both sides off the source and finds real calls', () => {
    expect(DECLARED.length).toBeGreaterThanOrEqual(9);
    expect(REQUESTED.size).toBeGreaterThanOrEqual(9);
    expect([...REQUESTED]).toContain('safety_call');
  });

  it('NOTHING is authored without a caller — the dormant set is empty and stays empty', () => {
    /**
     * This replaced a pinned debt list. Twelve of eighteen situations were dormant; eleven of those
     * were a second authoring of copy a live owner already shipped (queryStatusHandler's resolved
     * yardages, its SPECIFIC refusals, caddieAckLines' "Got it." pre-rendered in the persona's real
     * voice), and one — lie_analysis_summary_engaged — was a leftover of the L4 trust level collapsed
     * on 2026-06-04. They were removed rather than wired: wiring them would have created the
     * two-owners split, and in the no_data_apology case would have made the caddie LESS honest.
     */
    const dormant = DECLARED.filter((x) => !REQUESTED.has(x));
    expect(dormant).toEqual([]);
  });

  it('every requested situation has authored lines', () => {
    // The opposite failure, and the worse one: a caller naming a situation with no template renders
    // as SILENCE from the caddie rather than as a crash.
    const templates = code(TEMPLATES_FILE);
    const missing = [...REQUESTED].filter((x) => !new RegExp(`\\b${x}:`).test(templates));
    expect(missing).toEqual([]);
  });

  it('the aggressive call is spoken when the aggressive line is on', () => {
    /**
     * The one genuine missing wire of the twelve. app/lie-analysis read
     * `conservative_call ? safety_call : ''`, so with a required boolean false — the model saying the
     * line is open — the caddie said NOTHING on the one call a player most wants backed. safety_call
     * and aggressive_call were authored together in the same voice; surplus content does not arrive
     * in matched pairs.
     */
    const lie = code('app/lie-analysis.tsx');
    expect(lie).toMatch(/a\.conservative_call \? 'safety_call' : 'aggressive_call'/);
    expect(lie).not.toMatch(/conservative_call\s*\?\s*' ' \+ getDialog\('caddie', 'safety_call'\)\s*:\s*''/);
  });

  it('the removed situations stay removed — no copy may return without a caller', () => {
    const templates = code(TEMPLATES_FILE);
    for (const gone of [
      'shot_logged_ack', 'distance_to_pin', 'distance_to_front', 'distance_to_back',
      'wind_callout', 'plays_like', 'no_data_apology', 'help_intro', 'lie_analysis_summary_engaged',
    ]) {
      expect(templates).not.toMatch(new RegExp(`\\b${gone}:`));
    }
  });

  it('the live owners that replaced them still say the thing', () => {
    // If these regress, the removals above become real losses rather than de-duplication.
    const h = code('services/intents/queryStatusHandler.ts');
    expect(h).toMatch(/\$\{value\} to the \$\{which\}/);                       // distance_to_front/back/pin
    expect(h).toMatch(/miles per hour out of the/);                              // wind_callout
    expect(h).toMatch(/I don.{0,3}t have green coordinates for the \$\{which\}/); // a SPECIFIC refusal
    expect(code('services/caddieAckLines.ts')).toMatch(/Got it\./);              // shot_logged_ack
    expect(code('services/knowledgeBase/howTo.ts')).toMatch(/HOW_TO/);            // help_intro
  });
});
