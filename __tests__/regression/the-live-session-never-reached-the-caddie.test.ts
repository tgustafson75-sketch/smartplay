/**
 * 2026-09-11 (full-app audit) — THE PRACTICE THE CADDIE NEVER HEARD ABOUT.
 *
 * services/videoUpload fires synthesizeCageInsight beside processSwingAnalysis, and its comment
 * states the intent plainly: the note "persists into recentInsights, injected into pre-round
 * briefing so practice meaningfully informs rounds."
 *
 * The LIVE post-session pipeline — app/practice-session/summary, the path most players actually
 * take — ran the relationship engine and stopped there. Found by following the writer chain rather
 * than by reading either screen:
 *
 *     recentInsights  ← addCageInsight (ONE writer)
 *                     ← synthesizeCageInsight (ONE caller)
 *                     ← services/videoUpload ONLY
 *
 * So a player who practises live and never uploads a clip produced ZERO cage insights. Two things
 * broke quietly: `recentCageInsights` reached the brain empty every single turn, and
 * maybeSynthesizePatterns — which refuses to run below three cage insights — was starved of half
 * its input permanently, so the long-term pattern note never synthesized either.
 *
 * [[sweep-the-missing-half-not-the-unused-export]] [[close-the-loop-strategy]]
 */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

describe('both capture paths feed the caddie', () => {
  const live = read('app/practice-session/summary.tsx');
  const upload = read('services/videoUpload.ts');

  it('the upload path still synthesizes a session note', () => {
    expect(upload).toMatch(/synthesizeCageInsight\(\{/);
  });

  it('and so does the LIVE path — this is the half that was missing', () => {
    expect(live).toMatch(/import \{ synthesizeCageInsight \}/);
    expect(live).toMatch(/void synthesizeCageInsight\(\{/);
  });

  it('the live call passes the session it just analysed, not a placeholder', () => {
    const at = live.indexOf('void synthesizeCageInsight({');
    expect(at).toBeGreaterThan(-1);
    const call = live.slice(at, at + 420);
    expect(call).toMatch(/sessionId: session\.id/);
    expect(call).toMatch(/club: session\.club/);
    expect(call).toMatch(/primaryIssueName: issue\.name/);
    expect(call).toMatch(/severity: issue\.severity/);
  });

  it('it is fire-and-forget — a memory note must never block the summary', () => {
    const at = live.indexOf('void synthesizeCageInsight({');
    expect(live.slice(at, at + 500)).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it('it sits inside the SAME `if (issue)` the relationship engine does', () => {
    // Without a classified issue there is nothing to write a note about, and firing anyway would
    // spend a synthesis call to say nothing.
    const at = live.indexOf('void synthesizeCageInsight({');
    const before = live.slice(0, at);
    const lastIf = before.lastIndexOf('if (issue) {');
    const lastEngine = before.lastIndexOf('processSwingAnalysis(');
    expect(lastIf).toBeGreaterThan(-1);
    expect(lastEngine).toBeGreaterThan(lastIf);
  });
});

describe('the chain that made this invisible is still single-owner', () => {
  it('recentInsights has exactly one MUTATING writer, so a third path cannot drift', () => {
    // `recentInsights: []` also appears as the initial state, which is not a writer — counting it
    // was my own first assertion and it was wrong. Count only the spread that appends an entry.
    const store = read('store/swingSessionStore.ts');
    const appends = [...store.matchAll(/recentInsights:\s*\[\s*\n?\s*\.\.\.s\.recentInsights/g)].length;
    expect(appends).toBe(1);
  });

  it('and that writer has exactly one caller', () => {
    const synth = read('services/contextSynthesizer.ts');
    expect(synth).toMatch(/addCageInsight\(args\.sessionId, args\.club, summary\)/);
  });

  it('the pattern synthesis still needs three of them — which is why the gap was total', () => {
    const synth = read('services/contextSynthesizer.ts');
    expect(synth).toMatch(/cageInsights\.length < 3/);
  });
});
