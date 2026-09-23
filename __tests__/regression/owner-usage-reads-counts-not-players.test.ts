/**
 * 2026-09-23 (Tim) — the Owner Tools "App usage" card, opted-in data only, no privacy-policy change.
 *
 * What must hold, by behaviour:
 *  - no server secret → not_configured (never a default key); wrong key → 401;
 *  - device_backups is COUNTED, never read: the policy tells players a backup is keyed to a
 *    passphrase only they know, so the `data` column must never be selected;
 *  - the numbers are right, and the export states what it cannot see.
 */
const selects: { table: string; cols: string; head: boolean }[] = [];
function fakeDb() {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      let result: unknown = { data: [], error: null, count: 3 };
      const chain = () => q;
      q.select = (cols: string, opts?: { head?: boolean }) => {
        selects.push({ table, cols, head: !!opts?.head });
        if (table === 'usage_events') {
          const now = Date.now();
          result = {
            data: [
              { anon_id: 'a', user_id: null, event: 'round_started', ts: new Date(now - 1000).toISOString() },
              { anon_id: 'a', user_id: null, event: 'voice_turn', ts: new Date(now - 2000).toISOString() },
              { anon_id: 'b', user_id: null, event: 'voice_turn', ts: new Date(now - 3 * 86400000).toISOString() },
              { anon_id: 'c', user_id: null, event: 'voice_turn', ts: new Date(now - 20 * 86400000).toISOString() },
            ],
            error: null,
          };
        }
        return q;
      };
      q.gte = chain; q.order = chain; q.not = chain;
      q.limit = async () => result;
      q.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      return q;
    },
  };
}
jest.mock('../../api/_supabase', () => ({ getSmartPlaySupabase: () => fakeDb() }));

import handler, { aggregateUsage } from '../../api/owner-usage';
import { formatUsageReport } from '../../services/ownerUsage';

function call(headers: Record<string, string>) {
  const out: { status?: number; body?: unknown } = {};
  const res = {
    setHeader: () => res,
    status: (s: number) => { out.status = s; return res; },
    json: (b: unknown) => { out.body = b; return res; },
  };
  return handler({ method: 'GET', query: {}, headers: { 'x-forwarded-for': `10.9.${Math.random()}`, ...headers }, socket: {} } as never, res as never).then(() => out);
}

describe('owner usage endpoint', () => {
  const prev = process.env.OWNER_USAGE_KEY;
  afterAll(() => { if (prev === undefined) delete process.env.OWNER_USAGE_KEY; else process.env.OWNER_USAGE_KEY = prev; });

  it('with no server secret it is not configured — there is no default key', async () => {
    delete process.env.OWNER_USAGE_KEY;
    expect((await call({ 'x-owner-key': '' })).status).toBe(503);
  });

  it('a wrong key is refused', async () => {
    process.env.OWNER_USAGE_KEY = 'right-key-123';
    expect((await call({ 'x-owner-key': 'wrong-key-123' })).status).toBe(401);
  });

  it('the right key gets totals, and backups are counted — never read', async () => {
    process.env.OWNER_USAGE_KEY = 'right-key-123';
    selects.length = 0;
    const out = await call({ 'x-owner-key': 'right-key-123' });
    expect(out.status).toBe(200);
    const backupSelects = selects.filter((s) => s.table === 'device_backups');
    expect(backupSelects.length).toBeGreaterThan(0);
    for (const s of backupSelects) {
      expect(s.head).toBe(true);
      expect(s.cols).not.toMatch(/data/);
    }
    const body = out.body as { opted_in: { active_installs: { d1: number; d7: number; d30: number } } };
    expect(body.opted_in.active_installs).toEqual({ d1: 1, d7: 2, d30: 3 });
  });
});

describe('usage aggregation and export', () => {
  it('counts distinct installs per window and ranks events', () => {
    const now = Date.parse('2026-09-23T12:00:00Z');
    const agg = aggregateUsage([
      { anon_id: 'x', user_id: null, event: 'e1', ts: '2026-09-23T11:00:00Z' },
      { anon_id: 'x', user_id: null, event: 'e1', ts: '2026-09-23T10:00:00Z' },
      { anon_id: 'y', user_id: null, event: 'e2', ts: '2026-09-18T10:00:00Z' },
    ], now);
    expect(agg.active_installs).toEqual({ d1: 1, d7: 2, d30: 2 });
    expect(agg.top_events_30d[0]).toEqual({ event: 'e1', count: 2 });
    expect(agg.daily_active_7d).toHaveLength(7);
    expect(agg.daily_active_7d[6]).toEqual({ day: '2026-09-23', installs: 1 });
  });

  it('the exported report says who it cannot see', () => {
    const { body } = formatUsageReport({
      generated_at: '2026-09-23T12:00:00Z', window_days: 30,
      opted_in: { active_installs: { d1: 1, d7: 1, d30: 1 }, events_30d: 1, top_events_30d: [], daily_active_7d: [], truncated: false },
      backups: { total: null, updated_7d: null, updated_30d: null },
      referrals: { claimed: 0, qualified: 0 },
      cannot_see: 'Players who did not turn on usage sharing.',
    });
    expect(body).toMatch(/Opted-in players only/);
    expect(body).toMatch(/Not visible here: Players who did not turn on usage sharing/);
    expect(body).toMatch(/Cloud backups — total unknown/);
  });
});
