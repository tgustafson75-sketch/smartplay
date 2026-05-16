/**
 * Phase 410B — Auth store.
 *
 * Wraps Supabase's session state in a Zustand store so React components
 * can subscribe via the usual `useAuthStore(s => s.session)` pattern.
 * The store does NOT persist to AsyncStorage — supabase-js already
 * persists the session to SecureStore. We just mirror the in-memory
 * session for selectors.
 *
 * # Lifecycle
 *
 * - `init()` is called once at app boot from app/_layout.tsx. It:
 *   1. reads the current session from supabase (resolves from SecureStore)
 *   2. subscribes to onAuthStateChange so SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED
 *      events keep the store in sync
 *   3. flips `hydrated = true` so the routing gate can render
 *
 * - `signInWithGoogleAndSupabase()` is the single entry point the auth
 *   screen calls. It runs Google sign-in, then hands the ID token to
 *   supabase.auth.signInWithIdToken, then waits for onAuthStateChange
 *   to fire SIGNED_IN. Returns a typed result.
 *
 * - `signOut()` revokes Google + Supabase + clears local profile/AsyncStorage.
 */

import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseIsConfigured } from '../lib/supabase';
import { signInWithGoogle, signOutGoogle } from '../lib/googleAuth';

export type AuthSignInResult =
  | { kind: 'ok'; userId: string }
  | { kind: 'cancelled' }
  | { kind: 'play_services_missing' }
  | { kind: 'not_configured' }
  | { kind: 'error'; message: string };

type AuthStore = {
  hydrated: boolean;
  session: Session | null;
  user: User | null;
  init: () => Promise<void>;
  signInWithGoogleAndSupabase: () => Promise<AuthSignInResult>;
  signOut: () => Promise<void>;
};

let initialised = false;
let unsubAuthListener: (() => void) | null = null;

export const useAuthStore = create<AuthStore>((set, get) => ({
  hydrated: false,
  session: null,
  user: null,

  init: async () => {
    if (initialised) return;
    initialised = true;
    if (!supabaseIsConfigured()) {
      // Without env vars supabase-js still returns null sessions on
      // getSession() — the gate will route to /auth and the auth
      // screen surfaces a "not configured" banner.
      set({ hydrated: true });
      return;
    }
    try {
      const { data } = await supabase.auth.getSession();
      set({
        session: data.session ?? null,
        user: data.session?.user ?? null,
      });
    } catch (e) {
      console.log('[authStore] getSession failed:', e);
    } finally {
      set({ hydrated: true });
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[authStore] onAuthStateChange:', event);
      set({ session, user: session?.user ?? null });
    });
    unsubAuthListener = () => sub.subscription.unsubscribe();
  },

  signInWithGoogleAndSupabase: async (): Promise<AuthSignInResult> => {
    if (!supabaseIsConfigured()) return { kind: 'not_configured' };
    const google = await signInWithGoogle();
    if (google.kind === 'cancelled') return { kind: 'cancelled' };
    if (google.kind === 'play_services_missing') return { kind: 'play_services_missing' };
    if (google.kind === 'in_progress') return { kind: 'error', message: 'Sign-in already in progress.' };
    if (google.kind === 'error') return { kind: 'error', message: google.message };

    try {
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: google.idToken,
      });
      if (error) return { kind: 'error', message: error.message };
      const userId = data.session?.user?.id;
      if (!userId) return { kind: 'error', message: 'Supabase returned no session.' };
      // onAuthStateChange will populate session/user; we set immediately
      // so the routing gate doesn't lag a frame.
      set({ session: data.session, user: data.session?.user ?? null });
      return { kind: 'ok', userId };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      return { kind: 'error', message };
    }
  },

  signOut: async () => {
    try {
      if (supabaseIsConfigured()) {
        await supabase.auth.signOut();
      }
    } catch (e) {
      console.log('[authStore] supabase signOut failed:', e);
    }
    await signOutGoogle();
    set({ session: null, user: null });
  },
}));

export function teardownAuthListener(): void {
  if (unsubAuthListener) {
    unsubAuthListener();
    unsubAuthListener = null;
  }
  initialised = false;
}
