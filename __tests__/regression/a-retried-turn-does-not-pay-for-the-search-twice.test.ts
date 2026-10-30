/**
 * 2026-10-29 (Brain review r15, brain-search-web-rerun-on-retry) — A RETRIED TURN DOES NOT PAY FOR
 * THE SAME GROUNDED SEARCH TWICE.
 *
 * The brain retries once when the first attempt fails fast. The retry re-runs the whole model prompt,
 * so a search_web the model already ran in attempt 1 was billed again in attempt 2. The reset in the
 * catch clears tool state but not the search result, so the turn now keeps a per-turn memo of grounded
 * searches keyed by the normalized query. Only grounded answers are memoized, so a failed lookup can
 * still be tried again.
 */
import * as fs from 'fs';
import * as path from 'path';

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

describe('a retried turn does not pay for the search twice', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '../../api/kevin.ts'), 'utf8'));
  const searchStart = src.indexOf("if (name === 'search_web')");
  const searchEnd = src.indexOf("if (name === 'lookup_course')", searchStart);
  const searchBranch = src.slice(searchStart, searchEnd);

  it('the search branch is found', () => {
    expect(searchStart).toBeGreaterThan(0);
    expect(searchEnd).toBeGreaterThan(searchStart);
  });

  it('the memo is declared per turn, before the dispatcher, not at module level', () => {
    const memoDecl = src.indexOf('const searchMemo = new Map<string, string>();');
    const dispatch = src.indexOf('const toolDispatch = async');
    expect(memoDecl).toBeGreaterThan(0);
    expect(memoDecl).toBeLessThan(dispatch);
  });

  it('a memoized query is returned before groundedSearch runs', () => {
    const get = searchBranch.indexOf('searchMemo.get(memoKey)');
    const call = searchBranch.indexOf('groundedSearch(');
    expect(get).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(get);
    expect(searchBranch).toMatch(/if \(memo !== undefined\) return memo;/);
  });

  it('only a grounded answer is stored, and the key is normalized', () => {
    expect(searchBranch).toMatch(/if \(r\.grounded\) searchMemo\.set\(memoKey, out\);/);
    expect(searchBranch).toMatch(/\.trim\(\)\.toLowerCase\(\)\.replace\(\/\\s\+\/g, ' '\)/);
  });

  it('the retry reset leaves the memo alone', () => {
    const catchStart = src.indexOf('lastErr = err;');
    const reset = src.slice(catchStart, src.indexOf('const attemptMs', catchStart));
    expect(reset).toContain('capture.dataToolCalls = 0');
    expect(reset).not.toMatch(/searchMemo/);
  });
});
