import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowInference } from './_inferLimit';
import { getSmartPlaySupabase } from './_supabase';
import { keysMatch } from '../services/appAuth';

/**
 * 2026-09-23 (Tim) — "put a card in my owners tools and I can export to smartmanage … send user data".
 *
 * GET /api/owner-usage  (header `x-owner-key`)  →  aggregate usage for the Owner Tools card.
 *
 * WHAT IT READS, and only this — Tim's call was opt-in data with no privacy-policy change:
 *   • smartplay.usage_events — the anonymous telemetry players OPT IN to (off by default).
 *   • smartplay.device_backups — COUNTS and last-updated dates ONLY. The `data` column is never
 *     selected: the policy tells players a backup is "keyed to a passphrase only you know".
 *   • smartplay.referrals — claimed / qualified counts.
 * It says what it cannot see (everyone who did not opt in) so a small number reads as "small
 * sample", not "no players".
 *
 * AUTH: a server-only secret, OWNER_USAGE_KEY, entered once on the owner's phone. NOT the app key —
 * that ships in the bundle and is public. Unset → 503 not_configured; never a default key.
 */

const DAY = 24 * 60 * 60 * 1000;
const MAX_EVENT_ROWS = 50_000;

type EventRow = { anon_id: string | null; user_id: string | null; event: string; ts: string };

export type OwnerUsageReport = {
  generated_at: string;
  window_days: number;
  opted_in: {
    active_installs: { d1: number; d7: number; d30: number };
    events_30d: number;
    top_events_30d: { event: string; count: number }[];
    daily_active_7d: { day: string; installs: number }[];
    truncated: boolean;
  };
  backups: { total: number | null; updated_7d: number | null; updated_30d: number | null };
  referrals: { claimed: number | null; qualified: number | null };
  cannot_see: string;
};

/** Pure aggregation — exported so the numbers are testable without a database. */
export function aggregateUsage(rows: EventRow[], now: number): OwnerUsageReport['opted_in'] {
  const id = (r: EventRow) => r.anon_id ?? r.user_id ?? '';
  const since = (days: number) => new Set(rows.filter((r) => now - Date.parse(r.ts) <= days * DAY).map(id).filter(Boolean));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.event, (counts.get(r.event) ?? 0) + 1);
  const daily: { day: string; installs: number }[] = [];
  for (let d = 6; d >= 0; d--) {
    const start = new Date(now - d * DAY); start.setUTCHours(0, 0, 0, 0);
    const end = start.getTime() + DAY;
    const ids = new Set(rows.filter((r) => { const t = Date.parse(r.ts); return t >= start.getTime() && t < end; }).map(id).filter(Boolean));
    daily.push({ day: start.toISOString().slice(0, 10), installs: ids.size });
  }
  return {
    active_installs: { d1: since(1).size, d7: since(7).size, d30: since(30).size },
    events_30d: rows.length,
    top_events_30d: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([event, count]) => ({ event, count })),
    daily_active_7d: daily,
    truncated: rows.length >= MAX_EVENT_ROWS,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!allowInference(req, res, 'owner-usage', 20)) return;
  res.setHeader('Cache-Control', 'no-store');

  const secret = (process.env.OWNER_USAGE_KEY ?? '').trim();
  if (!secret) return res.status(503).json({ error: 'not_configured' });
  if (!keysMatch(req.headers['x-owner-key'], secret)) return res.status(401).json({ error: 'unauthorized' });

  const db = getSmartPlaySupabase();
  if (!db) return res.status(503).json({ error: 'database_not_configured' });

  const now = Date.now();
  const since30 = new Date(now - 30 * DAY).toISOString();

  const { data: events, error: evErr } = await db.from('usage_events')
    .select('anon_id,user_id,event,ts')
    .gte('ts', since30)
    .order('ts', { ascending: false })
    .limit(MAX_EVENT_ROWS);
  if (evErr) return res.status(500).json({ error: 'usage_query_failed' });

  // Counts only — `head: true` returns no rows at all, so no backup CONTENT can leave the database.
  const countSince = async (table: string, col: string | null, days: number | null) => {
    let q = db.from(table).select(col ?? '*', { count: 'exact', head: true });
    if (col && days != null) q = q.gte(col, new Date(now - days * DAY).toISOString());
    const { count, error } = await q;
    return error ? null : (count ?? 0);
  };
  const [bTotal, b7, b30, rClaimed, rQualified] = await Promise.all([
    countSince('device_backups', null, null),
    countSince('device_backups', 'updated_at', 7),
    countSince('device_backups', 'updated_at', 30),
    countSince('referrals', null, null),
    (async () => {
      const { count, error } = await db.from('referrals').select('*', { count: 'exact', head: true }).not('qualified_at', 'is', null);
      return error ? null : (count ?? 0);
    })(),
  ]);

  const report: OwnerUsageReport = {
    generated_at: new Date(now).toISOString(),
    window_days: 30,
    opted_in: aggregateUsage((events ?? []) as EventRow[], now),
    backups: { total: bTotal, updated_7d: b7, updated_30d: b30 },
    referrals: { claimed: rClaimed, qualified: rQualified },
    cannot_see: 'Players who did not turn on usage sharing or cloud backup. Store downloads, active users and subscriptions live in App Store Connect, Play Console and RevenueCat.',
  };
  return res.status(200).json(report);
}
