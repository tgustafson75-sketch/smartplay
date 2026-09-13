/**
 * 2026-09-13 (Tim) — "Part of the app's tutorial logic is a user can ask 'how do I ...?' and the app
 * can answer. Make sure this is the truth."
 *
 * IT WAS TRUE OF THE KNOWLEDGE AND FALSE OF THE ROUTE.
 *
 * `services/knowledgeBase/howTo` holds 29 entries of real, current steps, and `howToForPrompt()` is
 * injected into api/kevin's CACHED block unconditionally — so the caddie genuinely knows how to do
 * these things. But a question only reaches the brain if `precheckLocalIntent` lets it past, and for
 * three of the asks most likely to be asked it did not:
 *
 *   "how do I change my handicap" → handicap_query      — answered with what it IS, not how to change it
 *   "how do I add a course"       → open_tool{add_course} — yanked to a screen, no explanation
 *   "how do I use SmartFinder"    → open_tool{smartfinder}
 *
 * The first is the worst: the player asked how to do something and got a number back. All three break
 * the precheck's own documented rule — it matches COMMANDS, and "how do I …?" is a question by
 * construction. A question intercepted before the brain is a question the caddie never heard.
 *
 * The guard lives on the DISPATCHER, above every pattern, not as a lookahead on the three that bit —
 * otherwise the next pattern someone adds bites too.
 * [[smartplay-defect-class-unwired-halves]] [[two-owners-is-the-root-cause]]
 */
import fs from 'fs';
import path from 'path';
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { HOW_TO, howToForPrompt } from '../../services/knowledgeBase/howTo';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

/** null means "the precheck declined it", which is how an utterance reaches the brain. */
const reachesTheBrain = (u: string) => precheckLocalIntent(u) === null;

describe('an instructional question is never intercepted', () => {
  const ASKS = [
    'how do I import my GHIN',
    'how do I import my old scores',
    'how do I change my handicap',
    'how do I add a course',
    'how do I use SmartFinder',
    'how do I set up my bag',
    'how do I record a swing',
    'how do I turn off auto shot detection',
    'how do I change my caddie',
    'how do I share a round',
    'how do I make you talk less',
    'how can I see my practice history',
    'how would I pack my bag',
    'how does this work',
    'how does the scorecard work',
    'show me how to log a shot',
    'teach me how to read a green',
    'where do I change my handicap',
    'where can I find my clips',
    'hey Kevin, how do I add a course',
  ];

  it.each(ASKS)('"%s" reaches the brain', (u) => {
    expect(reachesTheBrain(u)).toBe(true);
  });

  it('"walk me through the hole" still belongs to the hole read — a local, offline answer', () => {
    /**
     * The first version of this guard claimed every "walk me through …", which took that phrasing
     * away from hole_read. A guard must not steal a phrasing from a feature that already answers it
     * correctly, and an instructional question that matches no pattern reaches the brain regardless.
     */
    expect(precheckLocalIntent('walk me through the hole')?.parameters?.query_topic).toBe('hole_read');
    expect(reachesTheBrain('walk me through starting a round')).toBe(true);
  });

  it('the three that used to be hijacked are named, so the fix cannot be partial', () => {
    // Regression-specific: each of these had a CONCRETE wrong destination before the guard.
    expect(precheckLocalIntent('how do I change my handicap')).toBeNull();
    expect(precheckLocalIntent('how do I add a course')).toBeNull();
    expect(precheckLocalIntent('how do I use SmartFinder')).toBeNull();
    // ...while the bare COMMAND forms still work, because those really are commands.
    expect(precheckLocalIntent('add a course')?.intent_type).toBe('open_tool');
    expect(precheckLocalIntent('open SmartFinder')?.intent_type).toBe('open_tool');
    expect(precheckLocalIntent("what's my handicap")?.intent_type).toBe('handicap_query');
  });

  it('the guard is on the dispatcher, not bolted onto the patterns that happened to bite', () => {
    const src = code('services/localIntentPrecheck.ts');
    const guardAt = src.indexOf('INSTRUCTIONAL_QUESTION_RX.test(t)');
    const firstPatternUse = src.indexOf('for (const p of PATTERNS)') >= 0
      ? src.indexOf('for (const p of PATTERNS)')
      : src.indexOf('PATTERNS');
    expect(guardAt).toBeGreaterThan(-1);
    expect(src).toMatch(/if \(INSTRUCTIONAL_QUESTION_RX\.test\(t\)\) return null;/);
    // it must run before ANY dispatch decision inside precheckLocalIntent
    const fnAt = src.indexOf('export function precheckLocalIntent');
    expect(guardAt).toBeGreaterThan(fnAt);
    expect(guardAt).toBeLessThan(src.indexOf('isSmartMotionActive()', fnAt));
    void firstPatternUse;
  });
});

describe('a measurement question is still answered locally, offline', () => {
  const LOCAL: [string, string][] = [
    ['how far do I hit my 7 iron', 'query_status'],
    ['how far is the pin', 'query_status'],
    ['how far to the green', 'query_status'],
    ['how many putts so far', 'query_status'],
    ['how many greens have I hit', 'query_status'],
    ["what's my score", 'query_status'],
    ["what's the smart play", 'query_status'],
    ['longest putt', 'query_status'],
  ];

  it.each(LOCAL)('"%s" stays local (%s)', (u, type) => {
    expect(precheckLocalIntent(u)?.intent_type).toBe(type);
  });

  it('"how FAR/MANY/MUCH/LONG/OLD …" is never mistaken for "how DO I …"', () => {
    /**
     * The distinguishing word is the one DIRECTLY after "how" — the frame needs an auxiliary there.
     * Getting this wrong would take the club-distance answer offline, which is the most-asked local
     * question in the app. Asserted phrase by phrase rather than trusting one example.
     */
    expect(precheckLocalIntent('how far do I hit my driver')?.parameters?.query_topic).toBe('club_distance');
    for (const u of ['how far do I hit my 7 iron', 'how many putts so far', 'how far to the green']) {
      expect(reachesTheBrain(u)).toBe(false);
    }
  });
});

describe('the caddie actually holds the answers', () => {
  it('there are real how-to entries, each with asks and steps', () => {
    expect(HOW_TO.length).toBeGreaterThanOrEqual(25);
    for (const h of HOW_TO) {
      expect(h.id).toMatch(/\S/);
      expect(h.asks.length).toBeGreaterThan(0);
      expect(h.steps.length).toBeGreaterThan(30);
    }
  });

  it('the block names itself as the how-to answer source', () => {
    const block = howToForPrompt();
    expect(block).toMatch(/how do i/i);
    for (const h of HOW_TO) expect(block).toContain(h.steps);
  });

  it('it reaches the CACHED prompt unconditionally — not gated on a guess about the question', () => {
    /**
     * The old `appHelp` gate was derived from the message, which made the cached block volatile and
     * doubled the prompt bill. It is stable bytes now, and it must stay unconditional: gating it
     * would both break the cache and leave the caddie unable to answer.
     */
    const kevin = code('api/kevin.ts');
    expect(kevin).toMatch(/howToForPrompt \} = await import\('\.\.\/services\/knowledgeBase\/howTo'\)/);
    expect(kevin).toMatch(/\+ `\\n\\n\$\{howToForPrompt\(\)\}`/);
    // not wrapped in an appHelp conditional
    expect(kevin).not.toMatch(/appHelp \? `[^`]*\$\{howToForPrompt/);
  });
});
