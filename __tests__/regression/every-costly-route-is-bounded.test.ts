/**
 * 2026-09-01 (adversarial audit) — WHAT COSTS US MONEY, OR WRITES, MUST BE BOUNDED.
 *
 * The brain route learned this on 07-25: it shipped with only CORS, so a curl loop against the public
 * domain could run up an unbounded provider bill and exhaust the quota — an outage for every real
 * player, not just a bill. The same reasoning was never applied to the routes that spend someone
 * else's quota or write to our database.
 *
 * Found unbounded: issue-report (EMAILS the owner through Resend on every accepted report — an open
 * relay into Tim's inbox), course-geometry-share (WRITES the crowd-sourced geometry other players
 * read), messages (writes arbitrary from/to/body), usage (writes telemetry rows), and four proxies
 * that spend OUR third-party keys — weather, elevation, golfbert, youtube-search. YouTube's is a hard
 * DAILY quota, so exhausting it is an outage that lasts until midnight.
 *
 * Payload caps already bounded one request's SIZE. Nothing bounded the COUNT.
 *
 * A key gate is the wrong tool and is deliberately NOT used: the app key ships inside the bundle, so
 * it protects nothing and would 401 real users mid-rollout. Per-IP throttling needs no client change.
 */
import fs from 'fs';
import path from 'path';

const apiDir = path.join(__dirname, '..', '..', 'api');

/** Public by contract — the OS fetches these, and Apple/Google must never be throttled. */
const MUST_STAY_OPEN = new Set([
  'well-known-aasa.ts',
  'well-known-assetlinks.ts',
  'glasses-return.ts',
  'health.ts',
]);

const PROTECTIONS = ['allowInference', 'requireAppKey', 'rateLimit', '_appKey'];

type Route = { file: string; src: string };

const routes: Route[] = fs
  .readdirSync(apiDir)
  .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
  .map((file) => ({ file, src: fs.readFileSync(path.join(apiDir, file), 'utf8') }));

const isProtected = (r: Route) => PROTECTIONS.some((p) => r.src.includes(p));
const writes = (r: Route) => /\.(insert|upsert|delete)\(/.test(r.src);
const spends = (r: Route) =>
  /(openai|OpenAI|anthropic|Anthropic|completeText|GoogleGenerative|gemini)/.test(r.src);

describe('nothing costly is left unbounded', () => {
  it('the sweep sees real routes', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it('THE CLASS: every route that WRITES is rate-limited', () => {
    const bad = routes.filter((r) => writes(r) && !isProtected(r) && !MUST_STAY_OPEN.has(r.file));
    expect(bad.map((r) => r.file)).toEqual([]);
  });

  it('THE CLASS: every route that SPENDS on inference is rate-limited', () => {
    const bad = routes.filter((r) => spends(r) && !isProtected(r) && !MUST_STAY_OPEN.has(r.file));
    expect(bad.map((r) => r.file)).toEqual([]);
  });

  it('the four third-party proxies that spend OUR keys are bounded', () => {
    for (const f of ['weather.ts', 'elevation.ts', 'golfbert-proxy.ts', 'youtube-search.ts']) {
      const r = routes.find((x) => x.file === f);
      expect(r).toBeDefined();
      expect(r!.src).toMatch(/allowInference\(req, res, '[\w_]+', \d+\)/);
    }
  });

  it('issue-report is bounded — it emails the owner on every accepted report', () => {
    const r = routes.find((x) => x.file === 'issue-report.ts')!;
    expect(r.src).toMatch(/allowInference\(req, res, 'issue_report', \d+\)/);
  });

  it('the limiter runs BEFORE the upstream call it protects', () => {
    for (const f of ['weather.ts', 'elevation.ts', 'youtube-search.ts']) {
      const src = routes.find((x) => x.file === f)!.src;
      const gate = src.indexOf('allowInference(');
      const upstream = src.search(/await fetch\(/);
      expect(gate).toBeGreaterThan(-1);
      if (upstream > -1) expect(gate).toBeLessThan(upstream);
    }
  });

  it('a limit of zero would be a wall, not a throttle — every limit is generous', () => {
    for (const r of routes) {
      for (const m of r.src.matchAll(/allowInference\(req, res, '[\w_]+', (\d+)\)/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(10);
      }
    }
  });
});
