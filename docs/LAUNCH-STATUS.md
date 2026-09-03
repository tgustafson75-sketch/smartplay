# Launch status — the bridge between the repo and the consoles

**One owner for "where is launch actually up to".** Claude Code works in this repo; Cowork works
behind the logins (Play Console, App Store Connect, Vercel, Supabase, RevenueCat). Neither can see
the other's side, so this file is where they meet.

- **Read it before starting anything**, so you don't redo or contradict work already done.
- **Update it the moment a row changes**, not at the end of a session.
- **Never mark a row DONE you did not personally verify.** "I filled the form" is done. "The form
  looked filled" is not.

**How to update:** Code edits and commits it. Cowork edits it directly on GitHub
(`docs/LAUNCH-STATUS.md` → pencil icon → commit to `main`). Put your name and the date in the row
you touch.

**Last updated:** 2026-09-03 · Claude Code (session `smartplaycaddie-fd`)

---

## 🔴 Blocking — nothing ships until these clear

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | `REFERRAL_SALT` env var set on Vercel (any long random string; never rotate once live — rotating invalidates every existing referral code) | **Cowork** | ☐ not started |
| 2 | Run `supabase/migrations/0009_referrals.sql` against the `smartplay` schema | **Cowork** | ☐ not started |
| 3 | Publish the legal site so `smartplaycaddie.com/privacy` serves the **September 3** policy. Source of truth: `docs/legal-site/privacy.html` + `privacy-embed.html`. **The live site is still serving August 25** — no health disclosure, no address. Data safety cannot be submitted against the old one. | **Cowork** | ☐ not started |
| 4 | Create the Play Console app (`com.smartplaycaddie.app`) | **Cowork** | ☐ not started |
| 5 | Health Connect declaration form | **Cowork** | ☐ not started |
| 6 | Background location declaration form | **Cowork** | ☐ not started |
| 7 | Background location **video** (screen recording — see recipe below) | **Tim** | ⛔ code ready (`2e8aae9b`) but NOT on any device — needs an OTA or the EAS build first |
| 8 | Fresh EAS native build (API 36 + permission changes). **None of today's manifest work is live without it** — it is native config, not OTA. | **Code** | ⏸ holding until #4 exists (Tim's call) |
| 9 | Decision: ship 1.0 with `SUBSCRIPTIONS_ENABLED` false, or flip it | **Tim** | ☐ leaning false |

## 🟡 Needed before submit, not blocking each other

| Item | Owner | Status |
|---|---|---|
| Store listing, screenshots, Target audience, Content rating questionnaire, pricing & countries | **Cowork** | ☐ |
| Cut the pricing block from the Play description if `SUBSCRIPTIONS_ENABLED` stays false — the listing must match the build | **Cowork** | 🔄 in progress (Tim, 09-03) |
| Sign in details → name `support@smartplaycaddie.com` / `tim@smartplaycaddie.com` | **Cowork** | ☐ — code side DONE (`e9f7dda9`) |
| App Store Connect app record → get the iOS **App ID** | **Cowork** | ☐ |
| Replace the placeholder store URLs in the referral landing page once the App ID exists (`api/referral.ts`, currently `id0000000000`) | **Code** | ⛔ blocked on the App ID |
| App Store Connect: IAP products, Small Business Program | **Cowork** | ☐ |
| RevenueCat entitlement `full` | **Cowork** | ☐ |
| Tier C device verification — invite screen, recap "THE WALK" card, background-location disclosure | **Tim** | ☐ WiFi-only iPad: no GPS or Watch verification possible on iOS |

---

## Facts the console forms need — take these from here, not from memory

**Package** `com.smartplaycaddie.app` · **version** 1.0.0 · **versionCode** 22
**Target API** 36 (was 35; Play rejects below 36 for new apps as of 2026-08-31)
**minSdk** 29 · **Entity** SmartPlay AI LLC, 29003 Navigator Way, Menifee, CA 92585

### Permissions actually declared (`app.json`, verified 2026-09-03)

```
RECORD_AUDIO · CAMERA
ACCESS_FINE_LOCATION · ACCESS_COARSE_LOCATION · ACCESS_BACKGROUND_LOCATION
VIBRATE · MODIFY_AUDIO_SETTINGS · POST_NOTIFICATIONS
FOREGROUND_SERVICE · FOREGROUND_SERVICE_MEDIA_PLAYBACK · FOREGROUND_SERVICE_LOCATION
READ_MEDIA_IMAGES · READ_MEDIA_VIDEO · READ_MEDIA_VISUAL_USER_SELECTED
health.READ_STEPS · health.READ_DISTANCE · health.READ_HEART_RATE · health.READ_ACTIVE_CALORIES_BURNED
```

⚠️ **`READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` were REMOVED on 2026-09-03.** Do not
declare them. They had zero code references and are superseded by `READ_MEDIA_*` at minSdk 29.

### Data safety — the answers that are easy to get wrong

- **Health & fitness: YES, collected.** Four Health Connect read permissions, and the Health Data
  toggle defaults **ON**. Used for the post-round recap "THE WALK" card and the caddie's narration.
  Read-only — the app never writes back to Health Connect.
- **Health data IS included in cloud backup.** Health readings hang off the round they were measured
  during, and `round-store-v1` is in the backup allowlist, so step/distance/heart-rate/calorie
  figures reach Supabase when backup is on. The published policy now says so explicitly.
- **Location: collected, including in the background**, only during an active round.
- **Audio and video: collected**, sent to processors for the duration of a request, not retained.
- **No accounts, no sign-in.** Cloud backup identity is `sha256(email::passphrase)`; the email itself
  is never stored.
- **No ads. No data sold. No push nagging.**

### Background location video — the recipe

One take, ≤30 seconds, unlisted YouTube or a Drive MP4.

1. Open the app from the home screen (a visible cold open)
2. Start a round
3. **The disclosure dialog appears** — hold ~3s so the full text is readable, then tap **Continue**.
   *(This is the step reviewers look for. It did not exist before `2e8aae9b`.)*
4. The system dialog → tap **Allow all the time**
5. Show the feature working — yardage updating with the phone pocketed

A second short take showing **Not now** (round continues, nothing breaks) is worth having; Play's
guidance asks for the non-consent flow too.

---

## ⚠️ Two hazards discovered 2026-09-03 via the cross-session bridge

**Committed ≠ on anyone's device.** The most recent production OTA (`5b1d4289`) was published from
`237dc013` — *before* every commit listed below. So the referral flow, the launch-day changelog fix,
the SwingSim and SmartVision fixes and the background-location disclosure are all on `main` and on
**nobody's phone**. The native half (target 36, removed storage perms, Health Connect) genuinely
needs the EAS build; the JS half could go OTA at any time. **The background-location video cannot be
filmed until one of those two ships.**

**Two Claude Code sessions share ONE working tree** (`/Users/timothyg/smartplay`), not separate
clones. Branch state is fine, but either session can stage or publish the other's in-progress edits.
If two sessions are going to work at once, one should move to a git worktree.

## Repo state

`main` @ `2a7f10eb` · ts-check clean · jest **222 suites / 2493 tests** · sim **928/928**

*Independently re-verified 2026-09-03 by Claude Code (session `smartplaycaddie`) against the combined tree — both sessions' commits together, since we share one working tree and neither had run the gates over the other's work. The sim count here read 926; it is 928.*

Shipped 2026-09-03: target API 36 · Health Connect reader + disclosure in all three policy copies ·
light-use trial extension · referral system · SwingSim 1-D-course fix · SmartVision layup inversion ·
SmartFinder clamp honesty · SmartMotion budget overrun · voice preempt diagnostic · launch changelog
seeding · background-location prominent disclosure.

## Known-dormant by design — not bugs, do not "fix"

- **Referral rewards do not redeem while `SUBSCRIPTIONS_ENABLED` is false.** `promo_expires_at` is an
  absolute time, so redeeming now would burn 30 days against a period that is already free. The
  server holds unredeemed rows indefinitely; they apply when the paywall turns on. The invite screen
  says "bank", not "get".
- **The light-use trial extension never fires while the paywall is off** — `planTrialExtension`
  correctly answers `not_on_trial`. Its tutorial card is hidden for the same reason.
