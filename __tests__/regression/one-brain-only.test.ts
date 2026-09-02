/**
 * 2026-08-13 (Tim, having asked for a unified brain more times than I want to count) — a GUARD, not
 * another unify commit.
 *
 * The pattern this exists to end: an answering brain gets added, the old one is never deleted, and
 * then every subsequent "unify" commit reconciles BEHAVIOUR between them by hand — forever. That is
 * maintaining a divergence, not removing one. api/brain.ts sat deprecated for 11 weeks returning 410
 * while its dev-server twin sat next to it.
 *
 * This test fails the build when the count goes UP. It cannot be satisfied by making two brains agree
 * — only by there being fewer of them.
 */
import fs from 'fs';
import path from 'path';

const API = path.join(__dirname, '..', '..', 'api');
const APP_API = path.join(__dirname, '..', '..', 'app', 'api');
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

/**
 * Endpoints allowed to answer a caddie turn. Adding a name here is a deliberate act.
 *
 * 2026-08-24 — DOWN TO ONE. This guard was written on 08-13 to fail when the count goes UP, with the
 * note that it "cannot be satisfied by making two brains agree — only by there being fewer of them."
 * Today it went red for the right reason: api/pipecat-turn stopped classifying as a brain, because
 * its 744-line implementation was replaced by a pass-through to kevin. It no longer runs the agentic
 * loop, knows nothing about personas, and carries no history of its own.
 *
 * That is the whole point of the guard arriving, so the list shrinks. It may not grow again.
 */
const ALLOWED_BRAINS = ['kevin.ts'];

describe('there is a fixed, shrinking set of answering brains', () => {
  it('no NEW answering endpoint appears without a decision', () => {
    /**
     * An answering BRAIN — not just any AI route. The distinguishing trio: it runs the agentic loop
     * (or returns the turn contract), it knows about PERSONAS, and it carries conversation HISTORY.
     * That is what makes something a caddie you talk to, rather than a one-shot AI feature endpoint
     * like lie-analysis or course-content, which legitimately use the same provider.
     *
     * Verified to select exactly kevin.ts + pipecat-turn.ts today.
     */
    /**
     * 2026-08-23 — two corrections, both found by this guard going red on a change that was not a
     * new brain.
     *
     * 1. CLASSIFY ON CODE, NOT PROSE. The heuristic ran over the raw file, so a COMMENT containing
     *    the word "persona" was enough to make a file look like a brain. It flagged _aiProvider.ts
     *    the moment a comment there mentioned the persona spec. This codebase has now been bitten
     *    by comment-matching guards four separate times — three on 08-22 alone, where guards
     *    matched the author's own note describing the bug they were guarding. Strip comments and
     *    string literals FIRST, always. [[grep-guards-cant-see-dead-code]]
     *
     * 2. A BRAIN IS AN ENDPOINT. _aiProvider.ts is the provider library — it DEFINES
     *    runAgenticLoop; it cannot answer a turn because nothing can call it over HTTP. What makes
     *    a file capable of answering a player is a Vercel handler, so require one. This is a
     *    property, not an allow-list entry: a genuine new brain endpoint necessarily has one.
     */
    /**
     * Comments only. An earlier version of this also stripped string literals, which on a TypeScript
     * file full of template literals and regex literals swallowed enormous spans and made EVERY file
     * look like a non-brain — a guard that had stopped being able to fail. Comment-stripping plus
     * the handler requirement below is sufficient and cannot misfire that way.
     */
    const stripped = (src: string) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    const brains = fs.readdirSync(API)
      .filter(f => f.endsWith('.ts'))
      .filter(f => {
        const src = stripped(fs.readFileSync(path.join(API, f), 'utf8'));
        // Only something reachable over HTTP can answer a player.
        if (!/export default async function handler/.test(src)) return false;
        return /runAgenticLoop|response_text/.test(src)
          && /persona/i.test(src)
          && /history/.test(src);
      });
    /**
     * 2026-08-21 — _brainShim.ts is an ADAPTER, not a brain, and this test correctly flagged it: it
     * mentions personas, history and response_text because it TRANSLATES them. What makes it not a
     * brain is that it never asks a model anything.
     *
     * So it is not allow-listed on my say-so — it is excluded only while it PROVES it cannot answer
     * a turn. The moment anyone adds a model call to it, it stops qualifying for this exclusion and
     * this test fails, which is the property that matters. An allow-list entry would have been a
     * place to hide a third brain.
     */
    const adapters = brains.filter(f => {
      const src = stripped(fs.readFileSync(path.join(API, f), 'utf8'));
      const invokesAModel = /runAgenticLoop\(|completeText\(|\.chat\.completions|generateContent/.test(src);
      return f === '_brainShim.ts' && !invokesAModel;
    });
    expect(brains.filter(f => !adapters.includes(f)).sort()).toEqual([...ALLOWED_BRAINS].sort());
  });

  it('the SHIM IS GONE — the adapter outlived the divergence it was bridging', () => {
    /**
     * 2026-09-01 (Tim: "I believe we deleted the shim because it was just a Band Aid between
     * different paths, but double check that"). It had NOT been deleted, and he was right that it
     * should have been.
     *
     * api/_brainShim translated the pipecat request/response contract onto kevin, and api/pipecat-turn
     * was a 118-line pass-through using it. Nothing had called that route since 08-23 —
     * services/voiceWarmup says so in its own comment, and a sweep of the client found only comments
     * mentioning it. So 373 lines existed to serve a contract with no callers, while making every
     * reader (me included, twice this session) reason about "two brains" that no longer existed.
     *
     * This guard used to say the shim may never grow a model call. The stronger statement is that it
     * is not there at all.
     */
    expect(fs.existsSync(path.join(API, '_brainShim.ts'))).toBe(false);
    expect(fs.existsSync(path.join(API, 'pipecat-turn.ts'))).toBe(false);
    /**
     * api/pipecat-tool went with them. It was the bridge a PYTHON Pipecat server called to run data
     * tools — and that server has not fronted the brain since the unification. Three things agreed it
     * was dead: no client or sim guard touched it, QA/model/voice-flow records its shared secret as
     * "effectively unenforced in prod", and it returned FUNCTION_INVOCATION_FAILED on EVERY call for
     * months without anyone reporting a broken feature. An unauthenticated endpoint that writes shots
     * and scores, which nothing calls and which never worked, is not something to carry into a release.
     */
    expect(fs.existsSync(path.join(API, 'pipecat-tool.ts'))).toBe(false);
  });

  it('and no client can still be pointing at the retired route', () => {
    const offenders: string[] = [];
    for (const dir of ['services', 'app', 'store', 'components']) {
      const walk = (d: string) => {
        const abs = path.resolve(__dirname, '../../', d);
        if (!fs.existsSync(abs)) return;
        for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
          const rel = `${d}/${e.name}`;
          if (e.isDirectory()) walk(rel);
          else if (/\.tsx?$/.test(e.name)) {
            const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
            if (/pipecat-turn/.test(code)) offenders.push(rel);
          }
        }
      };
      walk(dir);
    }
    expect(offenders).toEqual([]);
  });

  it('the count only ever goes DOWN — this is the whole point', () => {
    // Two brains is the CURRENT state, not the target. When one is deleted, drop it from
    // ALLOWED_BRAINS and this number with it. It must never be edited upward.
    // 2026-09-01 — was <= 2 while the shim's route still existed. One brain, one entry.
    expect(ALLOWED_BRAINS.length).toBe(1);
  });

  /**
   * 2026-08-13 — Tim: "no fucking way you just fixed that. I'll bet you find shit you missed."
   * He was right. The first version of this guard scanned api/ ONLY, and there is a WHOLE SECOND
   * DIRECTORY of endpoints: app/api/*+api.ts, the Expo Router dev-server twins. 11 files, 2,591
   * lines — including app/api/kevin+api.ts, a 620-line duplicate of the canonical brain whose own
   * header LISTED six behavioural drifts (missing lookup tools, no vision, no tier classifier, no
   * prompt caching, no OpenAI fallback, extra open_url action) and left them open since 2026-05-26.
   *
   * It was dev-only — getApiBaseUrl() returns PRIMARY_HOST when EXPO_PUBLIC_API_URL is empty, so prod
   * never reached it. That is precisely why it rotted: unreachable in prod, so nobody fixed the drift,
   * while every LOCAL test of the caddie silently exercised a different brain than the one shipped.
   *
   * A guard that only looks where you remember to look is not a guard. This one scans both trees.
   */
  /**
   * 2026-08-13, second bet, also lost — "I'll bet you did it again." I had.
   *
   * I deleted the ONE drifted twin I'd been shown and left TEN more of the identical pattern sitting
   * beside it, every one of them drifted from its canonical:
   *
   *     meta-voice 188 vs 692 · putting-analysis 221 vs 527 · parse-shot 139 vs 268
   *     voice-intent 475 vs 714 · preround 166 vs 93 (the TWIN was bigger)
   *
   * api/voice-intent.ts even carried the instruction "Before committing, diff both files" — manual
   * synchronisation of two copies, adopted as written policy. That is the disease, not a workaround.
   *
   * They were dev-server-only, which is exactly why they rotted: unreachable in prod so nobody fixed
   * them, while every LOCAL test ran against different code than ships. All deleted. Dev already
   * reaches the real API (getApiBaseUrl returns PRIMARY_HOST when EXPO_PUBLIC_API_URL is empty), so
   * nothing was keeping them alive but habit.
   *
   * This guard forbids the SHAPE, not the ten files. A twin cannot come back one at a time.
   */
  it('the dev-server twin pattern is gone and cannot return', () => {
    const twins = fs.existsSync(APP_API)
      ? fs.readdirSync(APP_API).filter(f => f.endsWith('+api.ts'))
      : [];
    expect(twins).toEqual([]);
  });

  it('the deprecated brain endpoint and its dev twins are GONE, not just unused', () => {
    expect(fs.existsSync(path.join(APP_API, 'kevin+api.ts'))).toBe(false);
    expect(fs.existsSync(path.join(API, 'brain.ts'))).toBe(false);
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'app', 'api', 'brain+api.ts'))).toBe(false);
  });

  it('nothing points at the deleted endpoint any more — including comments', () => {
    for (const p of ['services/holeContextResolver.ts', 'services/localStatusResponder.ts']) {
      expect(read(p)).not.toContain('api/brain.ts');
    }
  });
});
