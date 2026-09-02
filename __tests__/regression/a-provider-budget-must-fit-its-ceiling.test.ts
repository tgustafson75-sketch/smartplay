/**
 * 2026-09-01 (adversarial audit, from Tim's log: `clubpath_arc_too_sparse · points: 0`).
 *
 * A RETRY THAT CANNOT FIT IS WORSE THAN NO RETRY.
 *
 * api/club-path ran Anthropic with `timeout: 28_000, maxRetries: 1` under a 30s platform ceiling,
 * while the client waited 32s. The first attempt alone nearly exhausts the ceiling, so a retry starts
 * at ~28s and is killed by the platform at 30s — guaranteed, every time. The caller gets neither an
 * answer nor a clean error, which is exactly zero club-path points.
 *
 * Eleven routes had some version of this; two (image-edit, owner-triage) had a provider budget EQUAL
 * to the ceiling, so even the FIRST attempt could not finish — the response still has to be read and
 * written after the provider returns.
 *
 * The invariant is arithmetic, so it can be checked rather than remembered.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
  builds?: { src: string; config?: { maxDuration?: number } }[];
};

const ceilings = new Map<string, number>();
for (const b of vercel.builds ?? []) {
  const ms = b.config?.maxDuration;
  if (ms) ceilings.set(path.basename(b.src), ms);
}

type Row = { file: string; ceiling: number; provider: number; retries: number; worst: number };

function routesWithProviderBudgets(): Row[] {
  const out: Row[] = [];
  for (const file of fs.readdirSync(path.join(root, 'api'))) {
    if (!file.endsWith('.ts') || file.startsWith('_')) continue;
    const ceiling = ceilings.get(file);
    if (!ceiling) continue;
    const src = fs.readFileSync(path.join(root, 'api', file), 'utf8');
    const t = /timeout:\s*(\d[\d_]*)/.exec(src);
    if (!t) continue;
    const r = /maxRetries:\s*(\d+)/.exec(src);
    const provider = Number(t[1].replace(/_/g, '')) / 1000;
    const retries = r ? Number(r[1]) : 0;
    out.push({ file, ceiling, provider, retries, worst: provider * (retries + 1) });
  }
  return out;
}

describe('a provider budget must fit inside its platform ceiling', () => {
  const rows = routesWithProviderBudgets();

  it('there are routes to check — the sweep is not vacuously passing', () => {
    expect(rows.length).toBeGreaterThan(5);
  });

  it('THE CLASS: no route can be killed mid-call, retries included', () => {
    const over = rows
      .filter((r) => r.worst >= r.ceiling)
      .map((r) => `${r.file}: ${r.provider}s x ${r.retries + 1} = ${r.worst}s >= ${r.ceiling}s ceiling`);
    expect(over).toEqual([]);
  });

  it('and a single attempt leaves room to read and write the response', () => {
    const tight = rows
      .filter((r) => r.provider >= r.ceiling)
      .map((r) => `${r.file}: provider ${r.provider}s >= ceiling ${r.ceiling}s`);
    expect(tight).toEqual([]);
  });

  it('THE REPORT: club-path specifically can complete inside 30s', () => {
    const cp = rows.find((r) => r.file === 'club-path.ts');
    expect(cp).toBeDefined();
    expect(cp!.ceiling).toBe(30);
    expect(cp!.worst).toBeLessThan(cp!.ceiling);
  });

  it('and the client still outlives the server, so it is never first to give up', () => {
    const client = /AbortSignal\.timeout\((\d[\d_]*)\)/.exec(
      fs.readFileSync(path.join(root, 'services/swing/clubPath.ts'), 'utf8'),
    );
    expect(client).not.toBeNull();
    const clientMs = Number(client![1].replace(/_/g, ''));
    expect(clientMs).toBeGreaterThan(30_000);
  });
});
