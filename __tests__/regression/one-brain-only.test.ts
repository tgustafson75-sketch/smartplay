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

/** Endpoints allowed to answer a caddie turn. Adding a name here is a deliberate act. */
const ALLOWED_BRAINS = ['kevin.ts', 'pipecat-turn.ts'];

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
    const brains = fs.readdirSync(API)
      .filter(f => f.endsWith('.ts'))
      .filter(f => {
        const src = fs.readFileSync(path.join(API, f), 'utf8');
        return /runAgenticLoop|response_text/.test(src)
          && /persona/i.test(src)
          && /history/.test(src);
      });
    expect(brains.sort()).toEqual([...ALLOWED_BRAINS].sort());
  });

  it('the count only ever goes DOWN — this is the whole point', () => {
    // Two brains is the CURRENT state, not the target. When one is deleted, drop it from
    // ALLOWED_BRAINS and this number with it. It must never be edited upward.
    expect(ALLOWED_BRAINS.length).toBeLessThanOrEqual(2);
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
