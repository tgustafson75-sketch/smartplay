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

**Last updated:** 2026-09-03 · Claude Code (session `smartplaycaddie-fd`) — **BUILDS ARE DONE AND iOS IS SUBMITTED.** Billing is ON, Health Connect is OUT of 1.0, versionCode is **23**. Several rows below were rewritten today; the Health rows reversed direction, so re-read them before filling any form.

---

## 🔴 Blocking — nothing ships until these clear

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | `REFERRAL_SALT` env var set on Vercel (any long random string; never rotate once live — rotating invalidates every existing referral code) | **Cowork** | ☐ **STILL OPEN** |
| 2 | Run `supabase/migrations/0009_referrals.sql` against the `smartplay` schema | **Cowork** | ☐ **STILL OPEN** |
| 3 | ~~Publish the September 3 privacy policy~~ | ~~Cowork~~ → **Code** | ✅ **DONE 2026-09-03** — live and verified at `smartplaycaddie.com/privacy` (19,426 bytes, health disclosure + address present, "cage" gone). See the note below: this was never a dashboard task. |
| 4 | Create the Play Console app (`com.smartplaycaddie.app`) | **Cowork** | ✅ **DONE 2026-09-03 (Cowork)** — Play app ID `4973574947441812809`. RevenueCat Play app `appdf3a1c0d56` also created. |
| 5 | ~~Health Connect declaration form~~ ✅ *Cowork confirms 2026-09-03: filed as "no health features", matching the binary.* | ~~Cowork~~ | ✅ **NOT NEEDED for 1.0** — health is out of the build entirely. The four `health.READ_*` permissions, the `react-native-health-connect` plugin and the API-34 rationale alias are all gone from `app.json`; a prebuild on 2026-09-03 confirms **zero** `permission.health` entries in the manifest. Filing this declaration would describe a feature the binary does not have. Comes back in 1.1 with the permissions. |
| 6 | Background location declaration form | **Cowork** | ⚠️ **REPORTED CLEAR, RE-CHECK AFTER THE FIRST AAB UPLOAD.** Cowork 2026-09-03: App content shows "You're all caught up", zero declarations pending. But **no AAB has been uploaded to Play yet** (the Android submit is still blocked on the service account key), and Play surfaces the background-location declaration off the permissions it finds in an uploaded bundle. Expect it to appear once versionCode 23 lands on the internal track. Not a contradiction of Cowork's check — a different moment in time. |
| 7 | Background location **video** (screen recording — see recipe below) | **Tim** | ✅ **UNBLOCKED** — OTA shipped 2026-09-03 to production + preview from `a20c4031`. Force-close and reopen the app to pick it up, then film. |
| 8 | Fresh EAS native build (API 36 + permission changes) | **Code** | ✅ **DONE 2026-09-03** — both platforms, `production` profile/channel, 1.0.0 build **23**. Android AAB `6abd67e6-3948-4ced-b566-2a856984a050`, iOS IPA `3b04e18d-2940-4c9a-b1d5-fd70eac098dc`. iOS **submitted to App Store Connect**; Android AAB built but **not** submitted (no Play service account key yet). |
| 9 | Decision: ship 1.0 with `SUBSCRIPTIONS_ENABLED` false, or flip it | **Tim** | ✅ **FLIPPED TRUE 2026-09-03.** The listing and the Play Purchase-history declaration both describe a paid app, so the binary had to match the paperwork. Both real RevenueCat public keys are in; the test-store key is deleted. **Consequence: the paywall is live, so the store products must exist or testers meet an empty paywall.** |

## 🟡 Needed before submit, not blocking each other

| Item | Owner | Status |
|---|---|---|
| Store listing, screenshots, Target audience, Content rating questionnaire, pricing | **Cowork** | ✅ **DONE 2026-09-03 (Cowork)** — icon, feature graphic, 8 phone + 8× 7" + 8× 10" tablet screenshots; Target audience 18+; content rating complete; app price **Free** (subscriptions are IAP, so free-to-install is correct). |
| **Play subscription products** — create them and attach to RevenueCat entitlement `smartplay_caddie_pro` | **Cowork** | ☐ **STILL OPEN — this is the one that matters.** The RevenueCat Play *app* exists (`appdf3a1c0d56`), which is not the same as the *products*. `SUBSCRIPTIONS_ENABLED` is true in the shipped binary, so with no products the paywall renders empty. |
| Countries / availability, and tax setup | **Cowork** | ☐ |
| Cut the pricing block from the Play description if `SUBSCRIPTIONS_ENABLED` stays false — the listing must match the build | **Cowork** | 🔄 in progress (Tim, 09-03) |
| Sign in details → name `support@smartplaycaddie.com` / `tim@smartplaycaddie.com` | **Cowork** | ☐ — code side DONE (`e9f7dda9`) |
| **Play service account key** — Google Cloud IAM → JSON key → invite into Play Console → grant Release. Hand the JSON to Code. | **Cowork** | 🔴 **THE ONLY THING BLOCKING THE ANDROID SUBMIT.** `eas submit` fails with "Google Service Account Keys cannot be set up in --non-interactive mode." Target track is **internal**. |
| App Store Connect app record → get the iOS **App ID** | **Cowork** | ✅ **DONE** — `6772344465`. Used for the referral landing page's App Store link in `7811cff5`; the `id0000000000` placeholder is gone. |
| Replace the placeholder store URLs in the referral landing page | **Code** | ✅ **DONE `7811cff5`** — real ASC id `6772344465`. |
| App Store Connect: IAP products, Small Business Program | **Cowork** | ☐ **STILL OPEN** — same empty-paywall consequence as the Play products. |
| RevenueCat entitlement — the code reads **`smartplay_caddie_pro`**, not `full` | **Cowork** | ☐ **STILL OPEN.** This row used to say `full`; that is the old name. Both stores' products must attach to `smartplay_caddie_pro` or entitlements never resolve. |
| Tier C device verification — invite screen, recap "THE WALK" card, background-location disclosure | **Tim** | ☐ WiFi-only iPad: no GPS or Watch verification possible on iOS |

---

## 📍 Where the public site actually lives — this was wrong on the first draft of this file

`smartplaycaddie.com` is a **git repo**, not a hosting dashboard: `/Users/timothyg/smartplaycaddie`,
remote `smartplaycaddie.git`, Vercel auto-deploys on push to `main`. `privacy.html` and `terms.html`
are in it. **Publishing a legal page is a commit, not a console task.**

This file originally listed it as Cowork's, on the assumption the site sat behind a login. It did
not — and the app repo's `docs/legal-site/*` copies are *drafts*, not the published artifact, so
updating them changed nothing a reviewer could see. The live policy stayed stale for a day because
of that mistake.

The misleading part has been fixed at the source: that folder's `CLAUDE.md` used to open with "this
folder is an empty stub with no code and no commits", which reads as *nothing here, go away*. It now
says what the folder is. Note the local checkout can genuinely look empty — local `main` may have no
commits while `origin/main` carries the whole site; `git fetch origin && git checkout -B main
origin/main` before concluding anything is missing.

**Four copies of the privacy policy now exist.** The published one is
`smartplaycaddie/privacy.html`. The others — `smartplay/docs/privacy-policy.html`,
`docs/legal-site/privacy.html`, `docs/legal-site/privacy-embed.html` — plus the in-app
`constants/legalText.ts`, are all in step as of 2026-09-03. A sim guard fails if any of the app-repo
copies drifts, but **nothing guards the published one from the app repo**; they are different
repositories. Change the policy in both, or the guard passes while the web lies.

## Facts the console forms need — take these from here, not from memory

**Package** `com.smartplaycaddie.app` · **version** 1.0.0 · **versionCode** 23
**Target API** 36 (was 35; Play rejects below 36 for new apps as of 2026-08-31)
**minSdk** 29 · **Entity** SmartPlay AI LLC, 29003 Navigator Way, Menifee, CA 92585

### Permissions the APK will actually contain — VERIFIED, not inferred

Generated with `npx expo prebuild --clean --platform android` on 2026-09-03 and read out of
`android/app/src/main/AndroidManifest.xml`. **Take this list, not app.json.**

```
RECORD_AUDIO · CAMERA
ACCESS_FINE_LOCATION · ACCESS_COARSE_LOCATION · ACCESS_BACKGROUND_LOCATION
VIBRATE · MODIFY_AUDIO_SETTINGS · POST_NOTIFICATIONS · INTERNET
FOREGROUND_SERVICE · FOREGROUND_SERVICE_LOCATION
READ_MEDIA_IMAGES · READ_MEDIA_VIDEO · READ_MEDIA_VISUAL_USER_SELECTED
```

**14 permissions, and NO health permissions.** Re-verified from a clean prebuild on 2026-09-03
after the build that was actually submitted. `grep -c permission.health` on the generated manifest
returns **0**.

⚠️ **CORRECTION to what this file said earlier.** It previously claimed READ_EXTERNAL_STORAGE and
WRITE_EXTERNAL_STORAGE "were REMOVED — do not declare them". Deleting them from `app.json` did
**nothing**: Expo's permission merge is purely additive, and `expo-file-system`, `expo-media-library`
and `expo-image-picker` each contribute them from their own manifests. A prebuild proved they were
still in the manifest. They are now genuinely stripped, via `android.blockedPermissions`, which
writes `tools:node="remove"` and removes them at the Gradle merge.

**Blocked — present in the manifest with `tools:node="remove"`, absent from the APK. Do NOT declare
any of these:**

| Permission | Where it came from | Why it is blocked |
|---|---|---|
| `READ_EXTERNAL_STORAGE` | expo-file-system, expo-media-library, expo-image-picker | The app only SAVES to the library; reading is not needed and triggers Play's Photo & Video Permissions policy |
| `WRITE_EXTERNAL_STORAGE` | same three | Legacy, superseded by scoped storage at minSdk 29 |
| `READ_MEDIA_AUDIO` | expo-media-library's default `granularPermissions` (photo+video+**audio**) | No conceivable justification for a golf app. Also narrowed at source to `['photo','video']` |
| `ACTIVITY_RECOGNITION` | expo-sensors' own manifest | A dangerous runtime permission ("Physical activity"). Nothing uses Pedometer |
| `SYSTEM_ALERT_WINDOW` | expo-dev-client | "Display over other apps" — a dev-menu overlay with no place in a store build |

`FOREGROUND_SERVICE_MEDIA_PLAYBACK` was **removed from app.json** (not blocked — nothing else
contributes it). No service in the build declares that type; the only foreground service is
expo-location's, covered by `FOREGROUND_SERVICE_LOCATION`.

### Data safety — the answers that are easy to get wrong

- **Health & fitness: NO — not collected in 1.0.** ⚠️ **THIS ROW REVERSED on 2026-09-03.** It
  previously read "YES, collected", and answering YES now would declare a data type the binary
  cannot access. The Health Connect permissions and plugin were removed before the submitted build;
  the reader code stays but never sees data. Answer **No** to Health & fitness on Data safety, and
  do **not** file the Health Connect declaration.
- **Health data in cloud backup: not applicable in 1.0.** The plumbing exists — health readings hang
  off their round and `round-store-v1` is in the backup allowlist — but with no health permissions
  there is nothing to put in it. The published privacy policy still describes the feature, which is
  correct and harmless: a policy may describe more than the current build collects. It must never
  describe less.
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

**Committed ≠ on anyone's device — RESOLVED for the JS half.** Production OTA had been sitting on
`237dc013`, before every commit from 2026-09-03, so a day of fixes was on `main` and on nobody's
phone. Republished to **production and preview** from `a20c4031` (sequentially, never in parallel),
runtime `1.0.0`, which matches the frozen TestFlight build so it actually reaches testers.

The NATIVE half is still pending and cannot go OTA: target API 36, the removed storage permissions,
and the Health Connect manifest entries all need the EAS build (row 8). Until that runs, the app on
a device is API 35 with the old permission set.

- production · `fdaaf626-a0de-4ac0-a082-789ff7d4c4cd`
- preview · `15d5ed53-7c1c-4c7a-9106-7bada5878216`

**Two Claude Code sessions share ONE working tree** (`/Users/timothyg/smartplay`), not separate
clones. Branch state is fine, but either session can stage or publish the other's in-progress edits.
If two sessions are going to work at once, one should move to a git worktree.

## 🚚 Deployment — what is actually ON A DEVICE

**Committed is not deployed, and the gap is currently five commits.** The last OTA went out at
`a20c4031`. Everything after it is on `main` and on nobody's phone:

| Commit | What is stranded |
|---|---|
| `6c545ac6` | route-change tag on the voice preempt diagnostic |
| `583a45b2` | 3-iron reading slower than a 4-iron; tagged 7W told to tag itself |
| `983bdd63` | recap tempo card (the tempo story's first reader) |
| `18f84572` | recap YOUR CLIPS row (clip_uri's first reader) |
| `0db45e23` | handicap card showing a differential the round never posted |

**The background-location video IS filmable** — `2e8aae9b` (the prominent disclosure) is an ancestor
of the OTA commit, so it is on testers' devices now. Force-close and reopen first. Verified with
`git merge-base --is-ancestor`, not assumed.

Everything above is JS and can go OTA at any time. The NATIVE half — target API 36, the removed
storage permissions, Health Connect — cannot, and still needs the EAS build in row 8.

## Repo state

`main` @ `507623f0` · ts-check clean · jest **230 suites / 2546 tests** · sim **969/969** · user-sim 100 players, 0 issues

Gates run in an isolated worktree (`/Users/timothyg/smartplay-launch`, branch `launch-prep`, pushed
with `git push origin launch-prep:main`). A jest run counts only when it prints a `Tests:` line —
on 2026-09-03 node_modules was destroyed and jest exited 194 with ZERO output while `tsc` stayed
green, so "ts-check clean" alone is not evidence the suite ran.

*Independently re-verified 2026-09-03 by Claude Code (session `smartplaycaddie`) against the combined tree — both sessions' commits together, since we share one working tree and neither had run the gates over the other's work. The sim count here read 926; it is 928.*

Shipped 2026-09-03: target API 36 · Health Connect reader + disclosure in all four policy copies ·
light-use trial extension · referral system · SwingSim 1-D-course fix · SmartVision layup inversion ·
SmartFinder clamp shown as a confident measurement · SmartMotion last-resort provider overrunning
its ceiling · voice preempt diagnostic + route-change tag · launch changelog seeding ·
background-location prominent disclosure · recap tempo card · recap clip playback · handicap
differential single-owner.

**Four orphans of one shape found today** — measured, persisted, shipped off-device, read by nobody:
Health Connect, the watch tempo story, in-round `clip_uri`, and `is_highlight` (residue of a capture
kind deleted in May, removed rather than wired).

## Known-dormant by design — not bugs, do not "fix"

> ⚠️ **BOTH ITEMS BELOW WENT LIVE on 2026-09-03** when `SUBSCRIPTIONS_ENABLED` flipped to true.
> They are no longer dormant. Referral rewards now redeem and the light-use trial extension now
> fires. Kept here because the reasoning explains what they do.

- **Referral rewards do not redeem while `SUBSCRIPTIONS_ENABLED` is false.** `promo_expires_at` is an
  absolute time, so redeeming now would burn 30 days against a period that is already free. The
  server holds unredeemed rows indefinitely; they apply when the paywall turns on. The invite screen
  says "bank", not "get".
- **The light-use trial extension never fires while the paywall is off** — `planTrialExtension`
  correctly answers `not_on_trial`. Its tutorial card is hidden for the same reason.
