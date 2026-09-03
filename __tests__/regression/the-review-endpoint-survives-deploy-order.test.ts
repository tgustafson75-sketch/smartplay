/**
 * 2026-09-01 — I shipped a client change ahead of the server route it depends on.
 *
 * Renaming /api/cage-review to /api/swing-review for the release build was right, and keeping the old
 * path as an alias was right. Pointing the app at the NEW path in an OTA before confirming the server
 * answered it was not: every swing review would have 404'd until a deploy landed, to buy a nicer name.
 * The live probe caught it — the app was already calling a path the host still returned 404 for.
 *
 * The fix is not better timing, it is removing the dependency on timing.
 */
// The module memoises which path this server answers to, so each case re-imports it fresh rather
// than the module exporting a reset hook that only a test would ever call.
type Mod = typeof import('../../services/swingReviewEndpoint');
const freshModule = (): Mod => {
  let m!: Mod;
  jest.isolateModules(() => { m = require('../../services/swingReviewEndpoint') as Mod; });
  return m;
};

const okRes = (status = 200) => ({ ok: status < 400, status }) as Response;

describe('the client does not depend on which server it is talking to', () => {
  let calls: string[] = [];
  const mockFetch = (plan: Record<string, number>) => {
    calls = [];
    global.fetch = jest.fn(async (url: string) => {
      calls.push(url);
      return okRes(plan[url] ?? 200);
    }) as unknown as typeof fetch;
  };


  it('prefers the new path', async () => {
    mockFetch({});
    await freshModule().fetchSwingReview('https://h', {});
    expect(calls).toEqual(['https://h/api/swing-review']);
  });

  it('THE BUG: a 404 on the new path falls back to the old one', async () => {
    mockFetch({ 'https://h/api/swing-review': 404 });
    const res = await freshModule().fetchSwingReview('https://h', {});
    expect(calls).toEqual(['https://h/api/swing-review', 'https://h/api/cage-review']);
    expect(res.ok).toBe(true);
  });

  it('remembers, so a session pays the probe at most once', async () => {
    mockFetch({ 'https://h/api/swing-review': 404 });
    const mod = freshModule();
    await mod.fetchSwingReview('https://h', {});
    await mod.fetchSwingReview('https://h', {});
    // second call goes straight to the remembered path — the probe is paid once
    expect(calls.filter((c) => c.endsWith('/api/swing-review'))).toHaveLength(1);
  });

  /**
   * 2026-09-03 — 429 MOVED OUT of this list, deliberately, and 500 stayed in.
   *
   * The requests here became bounded + retrying (they were unbounded, and RN's fetch has no default
   * timeout, so a bad connection hung rather than failed). Tim's rule for that work is "don't build
   * error states, make it work", so the connection is retried — but only where the request never
   * reached a working handler. 429 means "retry after a wait" by definition, so it is now retried.
   *
   * 500 is still NOT retried, and this test still guards that, because this module's original
   * reasoning holds: a handler that threw on this payload will throw on it again, and on a 45-second
   * analysis route that is three times the server cost for nothing. The rule did not get looser, it
   * got more precise: infrastructure saying "try again" vs the handler saying something.
   */
  it('does NOT retry anything but a 404 — a handler status is the handler talking', async () => {
    for (const status of [400, 401, 500]) {
      mockFetch({ 'https://h/api/swing-review': status });
      const res = await freshModule().fetchSwingReview('https://h', {});
      expect(calls).toEqual(['https://h/api/swing-review']);
      expect(res.status).toBe(status);
    }
  });

  it('DOES retry a 429 — that one means "try again", by definition', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => { n++; return { ok: n >= 2, status: n < 2 ? 429 : 200, json: async () => ({}) } as Response; }) as unknown as typeof fetch;
    const res = await freshModule().fetchSwingReview('https://h', {});
    expect(res.status).toBe(200);
    expect(n).toBe(2);
  }, 15_000);

  it('never loops — a 404 from the old path is returned, not retried again', async () => {
    mockFetch({ 'https://h/api/swing-review': 404, 'https://h/api/cage-review': 404 });
    const res = await freshModule().fetchSwingReview('https://h', {});
    expect(calls).toHaveLength(2);
    expect(res.status).toBe(404);
  });
});

describe('both names still reach the same handler', () => {
  it('vercel routes them explicitly, not by regex alternation', () => {
    // The alternation form deployed and still 404'd the new path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const v = fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8');
    // Two REAL routes, each with its own file. An alias had no file, which the sim's
    // "every client endpoint is routed" guard correctly reported as a 404 waiting to happen — and the
    // regex-alternation form deployed and still 404'd.
    expect(v).toMatch(/"src": "\/api\/cage-review",\s*\n\s*"dest": "\/api\/cage-review\.ts"/);
    expect(v).toMatch(/"src": "\/api\/swing-review",\s*\n\s*"dest": "\/api\/swing-review\.ts"/);
    expect(v).not.toMatch(/cage-review\|swing-review/);
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'api/swing-review.ts'))).toBe(true);
  });
});
