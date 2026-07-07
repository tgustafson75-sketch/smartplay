# Tim — do later this week (the only manual steps)

Everything below is BUILT and shipped. These are the handful of things that can only
be done from a dashboard/toolchain, not by OTA. Do them when you have a few minutes.

## 1. Turn on cloud auto-backup — ONE SQL paste (5 min) ⭐ most important

Your data now has two safety nets:
- **Local file backup** — works RIGHT NOW, no setup. Settings → Backup & Restore →
  **Save backup file** (put it in Drive/Files). "Restore from file" on any phone.
  Do this once before you ever switch phones and you can't lose anything.
- **Cloud auto-backup** — built, needs ONE table created in Supabase, then it runs
  automatically forever (backs up on every round + when you background the app, and
  restores on a new phone with your Backup ID / email).

**To turn on cloud auto-backup:**
1. Supabase dashboard → your SmartPlay project → **SQL Editor** → New query.
2. Open `supabase/migrations/0004_device_backups.sql` in the repo, copy the whole
   thing, paste, **Run**. (It just creates one table: `smartplay.device_backups`.)
3. In the app: Settings → Backup & Restore → **Auto-backup to your account** → type
   your email as the Backup ID **and a passphrase** → **Back up now**. Done — it's
   automatic from there. On a new phone, enter the SAME email + passphrase → **Restore**.

That's it. No anon key, no email-auth toggle, no sign-in flow needed — the server
already has the Supabase service key from the Vercel↔Supabase integration.

**Why the passphrase (2026-07-07 security fix):** the row is keyed by a hash of your
email + passphrase, so nobody can pull your data by guessing an email. Keep the
passphrase safe — it can't be recovered, and it must match to restore.

## 1b. SmartPump golf-workout import (no setup — works now)

Your SmartPump golf-workout export now feeds a **TRAINING → PERFORMANCE** card on the
dashboard (training volume vs. your scoring). Settings → **Import SmartPump golf
workouts** → pick the export. A PDF or image is read by the server AI parser; a JSON or
CSV export is read on-device (instant, offline). Re-import any time — duplicates are
skipped. Nothing to configure. If SmartPump can also emit JSON/CSV, that path is fastest.

## 2. Install the watch app on your Galaxy Watch (one-time)

The phone side of the watch (live pin yardage + Ask-caddie mic) ships in the native
build. The **watch app itself** is a separate mini-app that installs onto the watch —
it can't be pushed remotely. It's a one-time build+install; full steps in
`wear-os-app/README.md`. Key point: sign it with the SAME key as the phone (Data
Layer only pairs matching-signed apps).

## 3. Install the newest phone build

Latest Android build (earbud button + on-device skeleton + watch phone-side):
https://expo.dev/accounts/tgustafson76/projects/smartplay-caddie/builds/2a0bef8c-02ff-44d1-955d-abca20b5f9f6
(EAS emails you when it's ready. This is the one that turns the earbud + smooth
skeleton ON — your old build predated that native code.)

---
Optional later (not blocking anything): if you ever want the legacy email-OTP
account path too, enable Supabase → Authentication → Email provider. Not needed —
the Backup ID path above already covers new-phone restore.
