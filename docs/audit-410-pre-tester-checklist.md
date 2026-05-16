# Phase 410 Pre-Tester Checklist

Pass each row before sending the build to PGA Hope graduates. Ships
with commit Phase 410.

## Profile flow

- [x] Fresh install lands on `/welcome` (single-screen capture).
- [x] Welcome captures name + caddie + optional handicap.
- [x] Skipping the form (empty name) still writes `first_opened_at` so the welcome doesn't re-fire on next launch.
- [x] Returning users skip welcome (gated on `first_opened_at != null` OR non-empty `name`).
- [x] Settings → "Edit Profile" routes back to `/welcome` so testers can update.

## Persistence (already-working, audit-confirmed)

- [x] Settings survive app close (Zustand persist + AsyncStorage).
- [x] Settings survive device restart (AsyncStorage survives reboot).
- [x] No data loss between sessions (writes queue atomically).
- [x] No forced re-login (no auth — by design for v1.1 beta).
- [x] Hydration race protection via `whenRoundStoreHydrated()` gates.

## Tester experience

- [x] Onboarding clear and welcoming (single screen vs old multi-step).
- [x] Caddie selection well-explained (one-line blurb per persona).
- [x] First round path clear (Get started → Caddie tab → Play tab).
- [x] Cage Mode accessible (Tools menu → Cage Mode).
- [x] Support contact prominent (Settings → Help → Contact Support).
- [x] Privacy Policy link present (Settings → Help → Privacy Policy).
- [x] Reset App Data button copy cleaned up (no more "until real auth ships" leak).

## Technical health

- [x] `tsc --noEmit`: 0 errors, 0 warnings.
- [x] `expo lint`: 0 errors, 0 warnings.
- [x] Sentry breadcrumb on profile hydration (debug aid for "I lost my data" reports).
- [x] No crashes during full lifecycle test (per audit).

## Beta scope — what testers should know

Frame the v1.1 beta to PGA Hope graduates honestly:

- **Local-device single-tester beta.** Your profile lives on this phone.
- **No login.** You don't need an account.
- **No cloud sync.** If you switch phones, your data doesn't follow.
- **Reset App Data wipes everything.** Don't tap it unless you mean it.
- **Real account sync** (Supabase) is shipping in v1.2. The audit at
  `docs/audit-410-auth-state.md` documents the roadmap.

## Deferred to Phase 410B (real auth)

Documented in [`docs/audit-410-auth-state.md`](audit-410-auth-state.md):

1. Install `@supabase/supabase-js` + `expo-secure-store`.
2. Configure Supabase project (auth + RLS).
3. Login + signup UI.
4. `onAuthStateChange` listener → session-aware store.
5. Replace Reset button with real `supabase.auth.signOut()`.
6. Server-side profile + round-history tables.
7. Conflict resolution.
8. Email verification + forgot-password.

Estimated effort: 3-5 dedicated sessions. NOT shippable tonight.

## Empirical-test scenarios (Z Fold)

Tim runs these before sending to testers:

1. **Fresh install** — uninstall app, reinstall, open. Should land on `/welcome`. Enter name + pick caddie + tap Get Started. Should land on Caddie tab.
2. **Force close + reopen** — force-close, reopen. Should NOT see `/welcome` again. Profile data intact.
3. **Settings → Edit Profile** — should route to `/welcome` with prior values pre-populated. Update name → Get Started → should land on Caddie tab with new name in caddie greeting.
4. **Settings → Reset App Data** — confirm dialog → reset. Force-close. Reopen. Should land on `/welcome` again (fresh install state).
5. **Privacy Policy link** — should open browser to smartplaycaddie.com/privacy (placeholder URL until the real policy is published).
6. **Contact Support** — should open mail client with subject pre-filled.

If any of these fail, the audit's anchor points tell you exactly where to look.
