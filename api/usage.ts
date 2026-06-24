/**
 * SmartPlay Caddie — usage telemetry ingest (off-device data layer · Phase A).
 *
 * POST /api/usage
 *   body: {
 *     events: Array<{ event: string; props?: Record<string, unknown>; ts?: number }>,
 *     anonId?: string,
 *     userId?: string,
 *   }
 *   warmup: { mode: 'warmup' }  → early 200, no DB work
 *
 * Design rules (telemetry must NEVER break the app):
 *   • Method-guarded to POST.
 *   • Validates + clamps everything; drops malformed events rather than failing.
 *   • Writes ONLY into `smartplay.usage_events` via the schema-scoped client in
 *     api/_supabase.ts — it CANNOT reach SmartManage's `public` tables.
 *   • If Supabase isn't configured (env missing), returns 200 {ok:false,
 *     reason:'not_configured'} — never a 500. A telemetry call must not error.
 *   • Opt-in is enforced CLIENT-side (services/usageTelemetry.ts); the server
 *     only ever receives data from users who turned the toggle on.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSmartPlaySupabase } from './_supabase';

const MAX_BATCH = 50;
const MAX_EVENT_NAME = 64;

type IncomingEvent = { event: string; props?: Record<string, unknown>; ts?: number };

/** Validate + normalize one event. Returns null to drop a malformed entry. */
function sanitizeEvent(
  raw: unknown,
  anonId: string | null,
  userId: string | null,
): { anon_id: string | null; user_id: string | null; event: string; props: Record<string, unknown>; ts: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<IncomingEvent>;
  if (typeof e.event !== 'string') return null;
  const name = e.event.trim();
  if (!name || name.length > MAX_EVENT_NAME) return null;

  const props =
    e.props && typeof e.props === 'object' && !Array.isArray(e.props)
      ? (e.props as Record<string, unknown>)
      : {};

  // ts: client-supplied epoch ms → ISO; fall back to now. Guard against junk.
  const ms = typeof e.ts === 'number' && Number.isFinite(e.ts) && e.ts > 0 ? e.ts : Date.now();
  const ts = new Date(ms).toISOString();

  return { anon_id: anonId, user_id: userId, event: name, props, ts };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // POST only — anything else is a no-op for telemetry.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const body = (req.body ?? {}) as {
    mode?: string;
    events?: unknown;
    anonId?: unknown;
    userId?: unknown;
  };

  // Keep-warm ping — no DB work, fast 200.
  if (body.mode === 'warmup') {
    return res.status(200).json({ ok: true });
  }

  const supabase = getSmartPlaySupabase();
  if (!supabase) {
    // Env not configured yet — degrade, never 500.
    return res.status(200).json({ ok: false, reason: 'not_configured' });
  }

  const anonId = typeof body.anonId === 'string' && body.anonId.length <= 64 ? body.anonId : null;
  const userId = typeof body.userId === 'string' && body.userId.length <= 128 ? body.userId : null;

  const incoming = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  const rows = incoming
    .map((e) => sanitizeEvent(e, anonId, userId))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return res.status(200).json({ ok: true, inserted: 0 });
  }

  try {
    // `.from('usage_events')` resolves to `smartplay.usage_events` (the client
    // is schema-scoped). Cannot touch the public/SmartManage schema.
    const { error } = await supabase.from('usage_events').insert(rows);
    if (error) {
      // Swallow — telemetry failures must not surface as app errors.
      return res.status(200).json({ ok: false, reason: 'insert_failed' });
    }
    return res.status(200).json({ ok: true, inserted: rows.length });
  } catch {
    return res.status(200).json({ ok: false, reason: 'exception' });
  }
}
