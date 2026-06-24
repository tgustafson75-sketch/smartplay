/**
 * SmartPlay Caddie — the ONE place a Supabase client is created.
 * Off-device data layer · Phase A (usage telemetry).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ HARD ISOLATION RULE — READ BEFORE TOUCHING THIS FILE                 │
 * │                                                                     │
 * │ This Supabase PROJECT is shared with another app, "SmartManage",    │
 * │ whose data lives in the `public` schema (tables like `events_state`,│
 * │ `shifts_state`). SmartPlay must NEVER read or write SmartManage's   │
 * │ data — not by accident, not "just this once".                       │
 * │                                                                     │
 * │ The isolation guarantee is structural, not conventional:            │
 * │   1. This client is pinned to the `smartplay` Postgres schema via   │
 * │      `db: { schema: 'smartplay' }`. Every `.from('x')` resolves to  │
 * │      `smartplay.x` — the `public` schema is unreachable through it.  │
 * │   2. NO code anywhere may call `.schema('public')` on this client,  │
 * │      nor name any SmartManage table (events_state, shifts_state,    │
 * │      …). Doing so would tunnel out of the isolation. Don't.         │
 * │   3. SmartPlay uses its OWN env var NAMES (SMARTPLAY_SUPABASE_*) so  │
 * │      its credentials are configured + rotated independently of any  │
 * │      SmartManage vars even though the project URL is the same.      │
 * │                                                                     │
 * │ If you ever need a new table, add it to the `smartplay` schema in a │
 * │ migration under supabase/migrations/. Never reach into `public`.    │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import { createClient } from '@supabase/supabase-js';

/**
 * SmartPlay-specific env var names. Distinct from any SmartManage var so the
 * two apps' credentials never collide even on the same Supabase project.
 * Tim sets these in Vercel (Project → Settings → Environment Variables):
 *   SMARTPLAY_SUPABASE_URL          — the project URL (https://xxxx.supabase.co)
 *   SMARTPLAY_SUPABASE_SERVICE_KEY  — the service_role key (server-only; bypasses RLS)
 *
 * The service key is a SECRET — it is only ever used here, server-side, in
 * Vercel serverless functions. It is NEVER bundled into the Expo client.
 */
const SUPABASE_URL = process.env.SMARTPLAY_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SMARTPLAY_SUPABASE_SERVICE_KEY;

/**
 * The schema-scoped SmartPlay client type. Inferred from createClient with the
 * `smartplay` schema so its `.from()` calls resolve into that schema only — the
 * `public` (SmartManage) schema is not part of this type and is unreachable.
 */
type SmartPlayClient = ReturnType<typeof makeClient>;

function makeClient() {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false },
    // Hard scope: every query through this client targets the `smartplay`
    // schema. The `public` schema (SmartManage's data) is unreachable here.
    db: { schema: 'smartplay' },
  });
}

let cached: SmartPlayClient | null = null;

/**
 * Returns the singleton SmartPlay service client, schema-scoped to `smartplay`.
 *
 * Returns `null` when the env vars are missing so callers can degrade
 * gracefully (telemetry is best-effort — a missing config must NEVER crash an
 * endpoint or block the app). Every caller MUST null-check the result.
 */
export function getSmartPlaySupabase(): SmartPlayClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  if (cached) return cached;
  cached = makeClient();
  return cached;
}
