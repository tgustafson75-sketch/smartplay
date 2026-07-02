/**
 * Cloud backup · the ONE client-side Supabase client (auth + user-scoped data).
 *
 * Distinct from api/_supabase.ts (that one is SERVER-side, service_role, telemetry).
 * This client ships in the app bundle and uses the PUBLIC anon key — safe because
 * every table it touches is RLS-scoped to auth.uid() (see 0003_backups.sql), so the
 * anon key alone grants zero access to anyone's data without a verified session.
 *
 * Config-gated: returns null (and isCloudConfigured() = false) until Tim sets
 *   EXPO_PUBLIC_SUPABASE_URL       (same https://xxxx.supabase.co project URL)
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY  (Supabase → Project Settings → API → anon public)
 * in eas.json (all profiles). Until then the backup UI honestly shows "not set up
 * yet" rather than pretending — no fabricated state.
 *
 * Schema-scoped to `smartplay` (never `public` = SmartManage). See api/_supabase.ts.
 */

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True once both the project URL and the anon key are configured. */
export function isCloudConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // Persist the session across launches so the user stays signed in and
      // auto-backup keeps working without re-verifying every cold start.
      storage: AsyncStorage as unknown as {
        getItem: (k: string) => Promise<string | null>;
        setItem: (k: string, v: string) => Promise<void>;
        removeItem: (k: string) => Promise<void>;
      },
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    // Hard scope: user-scoped tables live in the smartplay schema only.
    db: { schema: 'smartplay' },
  });
}

// Infer the schema-scoped client type (mirrors api/_supabase.ts) so `smartplay`
// stays the active schema instead of collapsing to the default `public` generic.
type CloudClient = ReturnType<typeof makeClient>;

let cached: CloudClient | null = null;

/** The singleton client-side Supabase client, or null when not configured. */
export function getCloudClient(): CloudClient | null {
  if (!isCloudConfigured()) return null;
  if (cached) return cached;
  cached = makeClient();
  return cached;
}
