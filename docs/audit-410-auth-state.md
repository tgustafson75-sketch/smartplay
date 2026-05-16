# Phase 410 Audit: Authentication state — honest verdict

**Date:** 2026-05-16
**Scope:** authentication provider + session management + sign-out
**Methodology:** read-only inspection of `app/auth.tsx`,
`app/_layout.tsx`, `app/index.tsx`, `store/playerProfileStore.ts`,
`store/settingsStore.ts`, `package.json` deps, full grep for
supabase / firebase / OAuth / session / token.

---

## Honest verdict

**There is no authentication system in this app.** Period.

| Component | State | Evidence |
|-----------|-------|----------|
| Auth provider | **STUB** | `app/auth.tsx` contains only a "coming soon" placeholder screen |
| Login UI | **MISSING** | No email/password form, no OAuth buttons, no magic-link flow anywhere |
| Session tokens | **MISSING** | No JWT, no SecureStore usage, no refresh logic — `package.json` has no supabase / firebase / auth0 / expo-auth-session deps |
| Sign-out flow | **PARTIAL** | Settings has a "Reset / Sign Out" button that clears AsyncStorage; functionally a wipe, not a session logout |
| Account recovery | **MISSING** | No forgot-password, no email-verification, no account-existence check |
| Multi-device sync | **MISSING** | No server-side state; data trapped on the device that created it |
| Owner-email override | REAL | `playerProfileStore.ts:15-17, 96-101` — `EXPO_PUBLIC_OWNER_EMAIL` env var grants lifetime subscription on first open |

## What exists instead

A **trial lifecycle** local-only system:

- First app open writes `first_opened_at` + `trial_started_at` timestamps to AsyncStorage.
- `subscription_status` starts as `'trial'`, expires after 7 days.
- Owner emails (matched against `isOwnerEmail()` or the env var) get `subscription_status='lifetime'` on every boot — bypasses the expiry check.
- `services/featureAccess.SUBSCRIPTIONS_ENABLED` global kill-switch — when `false` (current default in many builds), everyone gets lifetime, no expiry, no countdown.

This works for the "trial vs lifetime" gate. It is NOT authentication.

## What this means for beta testers

PGA Hope graduates downloading the app this week will:

- Open it. No login screen.
- Land on Caddie tab (greeting first, if `kevinGreetingEnabled`).
- Have NO profile data captured (onboarding is hardcoded off — see Phase 410 profile audit).
- Edit profile only via Settings (discoverable but unobvious).
- Lose their data only if they hit "Reset / Sign Out" — otherwise it persists indefinitely.
- Cannot install on a second device and recover their state. Single-device per tester.

This is shippable if framed correctly: **"local-device single-tester beta."** It is NOT shippable as a multi-user product without real auth.

## Real auth roadmap (deferred)

The honest implementation path:

1. Install `@supabase/supabase-js` + `expo-secure-store`.
2. Configure Supabase project (auth schema, email/password + magic-link providers, RLS policies).
3. Build login + signup screens. Wire to `supabase.auth.signInWithPassword` / `signUp`.
4. Wire `onAuthStateChange` listener that hydrates a session-aware store.
5. Replace the "Reset / Sign Out" button with a real `supabase.auth.signOut()` call.
6. Set up server-side profile + round-history tables, RLS policies, background sync.
7. Conflict-resolution policy for local-vs-remote divergence.
8. Email-verification flow + forgot-password flow.

**Estimated work:** 3-5 focused sessions minimum. This is a Phase 410B effort separate from this commit.

## Blockers for beta — frame honestly

What the beta tester will experience is **NOT broken** — it's missing.
The app currently has no concept of "your account." Frame it to PGA
Hope graduates as: *"This is a local-device beta — your profile lives
on this phone only. We're shipping account sync in v1.2."* That's
honest.
