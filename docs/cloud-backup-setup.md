# Cloud Backup — activation checklist

The cloud backup feature (email-OTP account → auto-backup/restore of structured
data) is **built and shipped**, but **inert until these 4 steps are done**. Until
then the Settings → "Cloud Backup & Sync" card honestly shows "not set up yet".

Design: Supabase Auth email OTP · structured data only (v1) · auto-backup on
background + after each round + restore-on-fresh-install.

## 1. Apply the migration
Apply `supabase/migrations/0003_backups.sql` to the Supabase project (the same
one in `SMARTPLAY_SUPABASE_URL`). It creates `smartplay.backups` (RLS: each user
reads/writes only their own row) and hardens `smartplay.messages` (revokes the
world-readable anon/authenticated grants — safe, the app only reaches messages
via the server service_role).

Run via the Supabase SQL editor (paste the file) or `supabase db push`.

## 2. Enable the Email auth provider
Supabase Dashboard → Authentication → Providers → **Email** → enable, with
**"Confirm email" / OTP** on. The default Supabase mailer sends the 6-digit code
for free (no external SMTP needed for testing; add SMTP later for volume).

## 3. Give me the anon key + project URL (I hardcode them OTA-safe)
`EXPO_PUBLIC_*` vars are EMPTY in `eas update` bundles (see memory
api-base-url-spine), so the anon key must be a hardcoded fallback constant —
exactly how the Mapbox `pk.` and Google `AIza` public keys already work.

From Supabase → Project Settings → API, copy:
- **Project URL** — `https://<ref>.supabase.co`
- **anon public** key (the long JWT; safe to ship — RLS protects the data)

Paste them to me; I fill `SUPABASE_URL_FALLBACK` + `SUPABASE_ANON_KEY_FALLBACK`
in `services/cloudSync/cloudClient.ts` and OTA. (Also add them to `eas.json` env
in all profiles so native builds get them too.)

## 4. Test
Fresh install → Settings → Cloud Backup & Sync → enter email → get code →
verify. Play/save something → background the app (auto-backup) or tap "Back up
now". Reinstall → sign in with the same email → it offers "Restore your data?".

## Not in v1 (phase 2)
Media sync — swing clips (`cage-store-v1`) and base64 caddie portraits
(`custom-caddie-media-v1`) reference local `file://` media and need Supabase
Storage. Structured data (rounds, bag, CNS, profile, custom courses, settings)
is fully covered now.
