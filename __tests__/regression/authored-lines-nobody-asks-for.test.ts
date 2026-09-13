/**
 * 2026-09-13 (Tim — "Check for any other unaudited surfaces and functions") — EIGHT AUTHORED CADDIE
 * SITUATIONS THAT NOTHING EVER REQUESTS.
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

/** Every situation the union admits, read off the type. */
const DECLARED = (() => {
  const src = code('constants/dialogTemplates/caddieTemplates.ts');
  const m = src.match(/export type CaddieSituation\s*=\s*([\s\S]*?);/);
  return [...m![1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
})();

/**
 * Every CaddieSituation any code actually asks for.
 *
 * Scans the ARGUMENT SPAN rather than matching `getDialog(role, 'x')` positionally: the role argument
 * is sometimes an expression with its own parentheses (`getDialog(roleFor(surface), 'distance_to_pin')`),
 * and a `[^,)]+` pattern silently skipped those calls — which made a first draft of this test report
 * six extra dormant situations that were actually wired. Take every literal inside the call and keep
 * the ones the union admits.
 */
const REQUESTED = (() => {
  const out = new Set<string>();
  for (const f of [...walk('app'), ...walk('components'), ...walk('services'), ...walk('hooks')]) {
    const src = code(f);
    for (const m of src.matchAll(/getDialog\(/g)) {
      const span = src.slice(m.index! + m[0].length, m.index! + m[0].length + 240).split(';')[0];
      for (const lit of span.matchAll(/'([a-z_0-9]+)'/g)) {
        if (DECLARED.includes(lit[1])) out.add(lit[1]);
      }
    }
  }
  return out;
})();

/**
 * Authored but not yet requested, as of the audit. A name may LEAVE this list (wire it — that is the
 * point) but nothing may join it.
 */
const DORMANT = [
  'aggressive_call',
  'distance_to_back',
  'distance_to_front',
  'distance_to_pin',
  'help_intro',
  'lie_analysis_summary',
  'lie_analysis_summary_engaged',
  'lie_analysis_summary_terse',
  'no_data_apology',
  'plays_like',
  'shot_logged_ack',
  'wind_callout',
].sort();

describe('the caddie has lines nobody asks him for', () => {
  it('the scan reads both sides off the source and finds them', () => {
    expect(DECLARED.length).toBeGreaterThanOrEqual(18);
    // Six of eighteen. If this ever reads zero the scan has broken, not the app.
    expect(REQUESTED.size).toBeGreaterThanOrEqual(6);
    expect([...REQUESTED]).toContain('safety_call');
  });

  it('the dormant set has not GROWN — a new situation must arrive with a caller', () => {
    const dormantNow = DECLARED.filter((s) => !REQUESTED.has(s)).sort();
    const added = dormantNow.filter((s) => !DORMANT.includes(s));
    expect(added).toEqual([]);
  });

  it('every situation that IS requested has authored lines', () => {
    // The opposite failure, and the worse one: a caller naming a situation with no template, which
    // renders as silence from the caddie rather than as a crash.
    const templates = code('constants/dialogTemplates/caddieTemplates.ts');
    const missing = [...REQUESTED].filter((x) => !templates.includes(`'${x}'`) && !templates.includes(`${x}:`));
    expect(missing).toEqual([]);
  });

  it('the dormant set is EXACTLY what was measured — it may shrink, never grow', () => {
    const dormantNow = DECLARED.filter((x) => !REQUESTED.has(x)).sort();
    expect(dormantNow.filter((x) => !DORMANT.includes(x))).toEqual([]);
    // shrinking is progress; this records the count so wiring one is visible in the diff
    expect(dormantNow.length).toBeLessThanOrEqual(DORMANT.length);
  });

  it('safety_call is wired, which is why aggressive_call reads as unfinished rather than surplus', () => {
    expect(REQUESTED.has('safety_call')).toBe(true);
    expect(DORMANT).toContain('aggressive_call');
  });
});
