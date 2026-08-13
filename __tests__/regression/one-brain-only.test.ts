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

  it('the deprecated brain endpoint and its dev twin are GONE, not just unused', () => {
    expect(fs.existsSync(path.join(API, 'brain.ts'))).toBe(false);
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'app', 'api', 'brain+api.ts'))).toBe(false);
  });

  it('nothing points at the deleted endpoint any more — including comments', () => {
    for (const p of ['services/holeContextResolver.ts', 'services/localStatusResponder.ts']) {
      expect(read(p)).not.toContain('api/brain.ts');
    }
  });
});
