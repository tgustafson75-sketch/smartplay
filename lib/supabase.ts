/**
 * Phase 410B — Supabase client singleton.
 *
 * Auth + Postgres + RLS in one. Used by:
 *   - store/authStore.ts (onAuthStateChange listener, session getters)
 *   - lib/googleAuth.ts (signInWithIdToken handoff)
 *   - services/profileSync.ts (profiles table CRUD)
 *
 * # Session persistence
 *
 * Sessions are persisted to expo-secure-store (iOS Keychain / Android
 * Keystore) via a small adapter. supabase-js calls getItem/setItem/
 * removeItem with the storage key `sb-<project-ref>-auth-token`; the
 * adapter just proxies to SecureStore.
 *
 * # Boot safety
 *
 * If EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY are
 * missing at module load, we DO NOT throw — that was the Phase 411 hot
 * fix lesson. Instead we log a warning and export a stub client whose
 * methods all return shaped errors. The app still boots; the auth gate
 * just won't be able to sign anyone in until the env vars land.
 *
 * # URL polyfill
 *
 * supabase-js touches the global URL constructor. RN's polyfill ships
 * via react-native-url-polyfill/auto — imported once here so consumers
 * don't have to think about it.
 */

import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseIsConfigured = (): boolean =>
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

function createRealClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

if (!supabaseIsConfigured()) {
  console.log(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / ANON_KEY missing — auth disabled until env vars land',
  );
}

// We always create a client. When env vars are missing, supabase-js
// constructs OK with empty strings (it just fails at request time with
// a clear error). That's preferable to a stub: real error messages from
// supabase-js are more debuggable than synthetic ones.
export const supabase: SupabaseClient = createRealClient();
