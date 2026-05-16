/**
 * Phase 410B — Google Sign-In wrapper.
 *
 * Wraps @react-native-google-signin/google-signin so the rest of the
 * app deals with one helper instead of the library's lifecycle. The
 * sign-in flow is:
 *
 *   1. configure() — called once at app boot from app/_layout.tsx
 *   2. signInWithGoogle() — opens native one-tap, returns the ID token
 *   3. caller hands the ID token to supabase.auth.signInWithIdToken
 *
 * The library auto-handles iOS native sheet + Android one-tap. No
 * browser tab, no email roundtrip.
 *
 * # Config plugin
 *
 * `@react-native-google-signin/google-signin` is registered in app.json
 * plugins. The native module is included in the next EAS build.
 *
 * # webClientId vs androidClientId
 *
 * Despite the name, `webClientId` is the GCP "Web application" OAuth
 * client ID — Supabase uses it to verify the ID token signature. It's
 * required even on Android because Supabase's token-verification path
 * needs the Web client as the issuer audience.
 */

import {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
} from '@react-native-google-signin/google-signin';

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

let configured = false;

export function configureGoogleSignIn(): void {
  if (configured) return;
  if (!WEB_CLIENT_ID) {
    console.log('[googleAuth] EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID missing — sign-in will fail until env var lands');
    return;
  }
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    offlineAccess: false,
    scopes: ['profile', 'email'],
  });
  configured = true;
}

export type GoogleSignInResult =
  | { kind: 'ok'; idToken: string; email: string | null }
  | { kind: 'cancelled' }
  | { kind: 'play_services_missing' }
  | { kind: 'in_progress' }
  | { kind: 'error'; message: string };

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  try {
    if (!configured) configureGoogleSignIn();
    if (!WEB_CLIENT_ID) {
      return { kind: 'error', message: 'Google sign-in is not configured yet.' };
    }
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    // v13+ returns { type: 'success' | 'cancelled', data?: { idToken, user } }.
    if (response.type === 'cancelled') return { kind: 'cancelled' };
    const idToken = response.data?.idToken ?? null;
    const email = response.data?.user?.email ?? null;
    if (!idToken) return { kind: 'error', message: 'Google did not return an ID token.' };
    return { kind: 'ok', idToken, email };
  } catch (e) {
    if (isErrorWithCode(e)) {
      switch (e.code) {
        case statusCodes.SIGN_IN_CANCELLED:
          return { kind: 'cancelled' };
        case statusCodes.IN_PROGRESS:
          return { kind: 'in_progress' };
        case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
          return { kind: 'play_services_missing' };
      }
    }
    const message = e instanceof Error ? e.message : 'Unknown sign-in error';
    return { kind: 'error', message };
  }
}

export async function signOutGoogle(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch (e) {
    console.log('[googleAuth] signOut failed (non-fatal):', e);
  }
}
