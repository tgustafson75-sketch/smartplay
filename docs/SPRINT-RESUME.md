# SPRINT RESUME — read this first

> **STANDING ENGINEERING RULES:** see [docs/ENGINEERING-PRINCIPLES.md](ENGINEERING-PRINCIPLES.md). **Read these before any fix prompt.** The anti-bandaid rules are non-negotiable — they exist because six weeks of GPS/voice band-aids almost shipped a broken product. **Find when it last worked. Prefer removing code. No new user-facing error surfaces without root cause. Two attempts then archaeology. Trust the user's lived reality. Competitor parity check. Parallel sweeps + post-sweep audit. Double-check before commit.**

If you are a fresh chat with no prior context: this is your starting point. Then read [SPRINT-LOG.md](SPRINT-LOG.md) for the daily detail and [audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md) for the full prioritized plan.

---

## Where we are right now

> ### ⚠️ LATEST — 2026-09-23. COURSE ENGINE + CLAUDE-COST FIX SHIPPED (`6ac60296`, `d7a64f63`, `ba5df313`). OTA `a757346d` PUBLISHED TO PRODUCTION.
>
> Server half is live with the push (course-content on Haiku with a budget that fits, proxy CDN caching,
> Course Cloud refuses 0,0, brain 24s whole-turn deadline). Client half — dedupe/cooldowns, Play tab pick
> races and first-tap, goToTab everywhere, no brain re-send after timeout — is JS-only and waits on Tim's
> OTA call — now published (group a757346d). Verified LIVE: proxy CDN HIT, course-content 200 in 19s on
> Haiku with all 18 holes, portraits on gemini-3.1-flash-image. Nothing verified on device yet (PATH 2/4/5).
> Next: plan + build the one course-build pipeline (Tim said yes). Detail: SPRINT-LOG Day 127.
>
> **Root cause still open (Tim: "we haven't fixed the universal truth around course building"):** no single
> owner builds a course — seven surfaces each run their own search/detail/geometry/content. The fix is one
> course-build pipeline with observable progress (also what Tim's progress-card idea sits on). Awaiting his yes.
>
> **Never poll api.smartplaycaddie.com in a loop from this Mac** — it trips a per-IP Vercel challenge that
> also cuts off Tim's phone (happened 21:28-21:38 UTC 09-23).

> ### ⚠️ LATEST — 2026-09-21. 1.0.1 (29) IS IN REVIEW ON BOTH STORES. The watch app shipped too.
>
> **Play:** `production` versionCode 29, and `wear:production` versionCode 1030 — the Wear artifact
> has its OWN track and Play refuses it in the standard production track. **App Store:** 1.0.1 with
> build 29 attached, WAITING_FOR_REVIEW.
>
> **`runtimeVersion` is still the literal "1.0.0" and must stay that way.** `version` moved to 1.0.1
> only because Apple closed the 1.0.0 train. The two are decoupled on purpose: one OTA reaches every
> binary ever shipped.
>
> **OWED THE MOMENT 29 IS LIVE:** `npm run ota:baseline`. Preflight exits 1 until then, correctly —
> the baseline was deliberately NOT re-recorded when the OTA was published on 09-21, so it still
> describes build 27, which is what is actually installed. See the bypass note in OTA-RUNBOOK.md.
>
> **NOT VERIFIED ON HARDWARE.** Everything on 09-21 was verified by emulator, AAB manifest
> inspection and the gates. The device pass is still open, and the new one-tap watch flow has never
> run with a real phone paired to a real watch.
>
> **Toolchain now on this Mac:** openjdk@17 + Android cmdline-tools + a Wear OS 5 emulator AVD
> (`smartplay_wear`), which is how the watch app gets built and screenshotted. `brew` itself is
> blocked by the Xcode licence, and `git`/`strings` are Xcode shims — use
> `/Library/Developer/CommandLineTools/usr/bin/git` and read bytes in python.

> ### 2026-09-17. 1.0 (27) IS LIVE IN BOTH STORES. Post-launch sweep shipped by OTA.
>
> **No new builds until 2.0** (Tim: "glad to be done building for now"). Everything since release
> has gone out as an OTA (update group `7a9c6cf3`, commit `00f5dd6f`) or a Vercel deploy —
> `api/kevin.ts` is server-side and auto-deploys on push to main, which is why the handicap fix did
> not need an OTA at all.
>
> Sixteen defects fixed in a four-way parallel sweep the night of release. The headline: **the
> driver was barred from every tee shot for every user** (ClubId vs ClubName across one boundary),
> **putts were fabricated as 0** on every hole scored from the caddie card, **Start Round could wipe
> a live round with no prompt**, and **the handicap never reached the caddie's prompt at all**
> despite being sent and destructured for months. Full detail in SPRINT-LOG.md.
>
> **THE ONE THING THAT STILL NEEDS A BINARY:** `android-native/MediaPipePoseModule.kt` never calls
> `bitmap.recycle()` or closes the MPImage. The JS half shipped (frames downscaled to 1024px, ~10x
> smaller allocations), so it is no longer urgent — but it is still a leak, and it is the leading
> suspect for the production WatchdogTermination. Do it with the next build, whenever that is.
>
> **Also open:** the silent round briefing (diagnosed, deferred, voice path + PATH 4 — see
> OPEN-ITEMS.md), and Sentry API access returning 403 for this org.

> ### 2026-09-16. APP REVIEW REJECTION FIXED; BUILDS 27 BUILT, NOT SUBMITTED.
>
> Apple rejected 1.0 (26) on **5.1.1(iv)** (permission primer: a postpone button, and the OS dialog's
> own verb of consent on our button) and **2.1(b)** (reviewers could not find either subscription).
> Both fixed and pushed — `194a54f0`, `570ac3c5`. **iOS 27 and Android 27 are both BUILT** off
> `570ac3c5` and waiting; Tim/Cowork do the uploads.
>
> **The 2.1(b) cause is the one worth carrying forward.** Every route to `/paywall` was a GATE —
> `triggerPaywall(feature)` fires only when `canAccess()` FAILS. A fresh install starts a trial,
> a trial grants `pro`, and `pro` passes every check, so **for the first fortnight of any install
> there was no reachable path to the purchase screen at all.** App Review installs fresh. The paywall
> was not hidden by a flag; it was behind a door that only opened from the inside. Same defect class
> as the referral programme (09-13) and the three unaskable capabilities (09-12/13).
>
> **Still Tim's to do:** reply to Apple in App Store Connect with the reviewer tap path
> (Caddie → ••• → Subscription → both prices), and upload the two builds.
>
> **Known bug, deliberately deferred:** the round briefing can go silent. Diagnosed 09-16, written up
> in [OPEN-ITEMS.md](OPEN-ITEMS.md) with the fix and the gate it must carry. Voice path + PATH 4, so
> it needs a device round; held back so 27 could go to Apple untouched.
>
> **Sentry API access is 403** for this org — event counts cannot be queried, which is what decides
> whether the 09-15 WatchdogTermination is noise or a bug. Memory instrumentation landed (`da7dff34`)
> so the *next* one arrives with evidence, but it is not in build 27.

> ### 2026-09-15 (afternoon). SHIPPED: commit `82d35dff`, OTA to PRODUCTION ANDROID.
>
> Everything from today is live on the **production** channel, Android only — update group
> `81bb1b64`, runtime 1.0.0, commit stamped `82d35dff`. **iOS was deliberately left alone** (Apple is
> in review; `--platform android` on the publish, verified against `eas update:list`).
>
> **On device: open the app twice.** `fallbackToCacheTimeout: 0` means open #1 downloads and open #2
> runs it.
>
> **`git` is NOT actually blocked — it never needed sudo.** `/usr/bin/git` is an Xcode shim that
> refuses everything until the licence is accepted, but the Command Line Tools ship their own real
> git at **`/Library/Developer/CommandLineTools/usr/bin/git`**, which works untouched. Putting that
> directory first on `PATH` fixes every tool that shells out to bare `git` — the pre-commit hook and
> `eas update` both do, and both failed until it was.
>
> **THE PERMANENT FIX IS `brew install git`** (no sudo on Apple Silicon; /opt/homebrew is user-owned)
> — Homebrew's git prefix exists on this machine but the binary was never installed. Until that runs,
> every session has to remember the PATH prefix, and a tool that shells out to git will break in a
> way that looks like something else. Handed to Cowork in `_handoff/from-code.md`.
>
> **Two machine-level findings came out of it:**
> - The **pre-commit hook could skip itself in silence.** Every gate was guarded by
>   `git diff --cached | grep`; when git itself fails the pipe carries nothing, grep matches nothing,
>   and tsc/jest/i18n are all skipped with exit 0. Its own header says "discipline is not a gate.
>   This is." It was not. Now fails loudly, break-tested with a fake failing git.
> - **`Claude outputs/`** (a scratch dir, not the app's) was untracked and un-ignored in the repo
>   root, and the standing save-point rule is `git add .` — the next session following the rule would
>   have committed it. Ignored now, *without* a trailing slash, for the reason the `_handoff` entry
>   right above it in .gitignore spells out.
>
> Green at the commit: tsc · lint **0** · jest **5073/5073 (417 suites)** · sim **1040/1040**. The
> hook ran all three of its own gates on the way in.
>
> **NEXT — device verification, Tim's gate.** Four things: Profile → "Choose home courses" → Play →
> back (lands on Profile, once); the two new buttons on the dashboard player card; a TRACKED club on
> the Fit Profile set in TOTAL; and the BALL row in round setup.
>
> ---
>
> ### ⚠️ LATEST — 2026-09-15 (midday, part 2). "Check all work" found five more — three of them mine.
>
> **The audit was worth it.** In order of severity:
>
> 1. **My own NAV sweep guard scanned `app/` + `components/` and claimed everything.** Three tab
>    pushes sat in `services/` — `quickRoundHandler`, `conversationalToolDispatch`,
>    `pendingDisambiguation` — i.e. the loop was **also reachable by voice**, and the new guard was
>    green over it. Sweep now covers 8 dirs (**844 files, was 207**) and ASSERTS THE SUPERSET; that
>    assertion immediately caught a ninth directory I had missed (`utils/`).
> 2. **A typo could wall a club off from its own measurements for ever.** A stated number is the
>    centre of the ingest band: `setManual('Driver', 15)` → band 8–22 → every real 240y drive rejected
>    at ingest, silently, permanently. Pre-existing, but this morning I opened editing on all fourteen
>    clubs. Now refused at the setter (shared 30–400 band) and a wild value no longer gates his shots.
> 3. **I introduced a false confirmation in three places** — the Fit Profile, the voice registrar, and
>    both import screens ("12 club distances applied to your bag" over writes that never happened).
>    All count what LANDED now; `recordCarry`/`recordTotal` report too.
> 4. A latent split: `caddieDecision` counted gaps off the wider test. Identical today — which is why
>    it would never have been noticed if it stopped being.
> 5. Two comments describing a gate they no longer described (the shaft-flex `hasCarry`).
>
> Four more guards had pinned the LINE not the invariant (one pinned a type signature). **25 break-test
> mutations across the day, all watched to fail.** Verified rather than assumed: `saysToPlayer('BALL')`
> can actually fail; 23 new locale keys present in en/es/zh with matching placeholders; no residue.
>
> Green: tsc · lint **0** · jest **5073/5073 (417 suites)** · sim **1040/1040**.
>
> ---
>
> ### ⚠️ EARLIER — 2026-09-15 (midday). Two production reports, five defects. SHIPPED — see the top entry.
>
> *(Written before the commit. It shipped — `82d35dff`, OTA `81bb1b64`, production Android. The git
> blocker was worked around, not cleared: see the top entry.)*
>
> Five complaints from Tim's phone on production, all real, each reproduced before it was touched:
>
> 1. **The home course loop.** `router.push('/(tabs)/play')` from a pushed screen does not switch
>    tabs — it mounts a SECOND tab navigator on top. Profile → Play → Profile → Play, back never
>    reaching the bottom, a live tab navigator left behind each lap. **Seven call sites.** All go
>    through `goToTab` (→ `dismissTo`/POP_TO) now; a 207-file sweep guards the rest.
> 2. **The dashboard player card** had both ways in and named neither. Two labelled buttons now;
>    the bag one opens the same `/bag-scan` the Profile page opens.
> 3. **A tracked club's distance could not be edited, and a club he HAD set could never be set
>    again** — `editable` was `!measured`, and `measured` counted a typed number, so the first save
>    locked the row and the bin that clears it lived inside the row he could no longer open. The
>    stated number also did nothing: `carryFor` answered 160 on a club he had just set to 135.
> 4. **No carry/total toggle.** Every stated number was filed as a CARRY — **28 yards of hazard on
>    the driver**. Toggle added, defaulting to TOTAL (the app's own 09-12 rule: an over-stated carry
>    loses a ball). The spoken path was fixed with it — a spoken total used to land in the MEASURED
>    ladder and could be dropped silently while the caddie said "Got it".
> 5. **Nowhere to declare the ball for a round** — while the round record stamped it, the comparison
>    consumed it and the brain received it. A BALL row now sits in the round-setup panel.
>
> **One I introduced today and caught on the re-read:** `getLearnedClubDistances` kept its own copy of
> the precedence, so the bag the BRAIN quotes would have ignored his correction — the reported bug,
> one pipe to the left. Both learned bags delegate to the store now.
>
> **Three existing guards had to be rewritten** because they pinned the line rather than the
> invariant; the My Bag one would have stayed green through both of today's worst findings.
> Sixteen break-test mutations, all watched to fail.
>
> Green: tsc · lint **0** · jest **5065/5065 (417 suites)** · sim **1040/1040**.
>
> **NEXT — commit (after the license), publish, then device verification.** Four things to check:
> Profile → "Choose home courses" → Play → back (should land on Profile, once); the two new buttons on
> the player card; a TRACKED club set in TOTAL on the Fit Profile; and the BALL row in round setup.
>
> ---
>
> ### ⚠️ LATEST — 2026-09-15 (small hours). LIVE ON PRODUCTION ANDROID. Lint at ZERO.
>
> **Tim is on the PRODUCTION channel, not preview** — every Android build on this project is
> `channel=production` (verified via `eas build:list`; the preview publish reached nothing).
> Published to **production, Android only** (`2239117c`): iOS is also production-channel and Apple is
> in review, so the iOS binary stays on the 1-day-old update.
>
> **Open items are closed.** The last lint warning turned out to be five real stale reads inside
> `runAnalysis` — feel/coach notes saved against the wrong swing, the persona stamped wrong, a hero
> moment pointing at the wrong clip, and `isPutt` read directly while `puttModeRef` sat three lines
> away. Fixed with mirrors, not suppressed. **Lint 78 → 0.** Hotel Mode and SwingSim are recorded as
> fixed-dark by design.
>
> Green: tsc · lint **0/0** · jest **5047/5047 (416 suites)** · sim **1034/1034**.
>
> **The only thing left is device verification.** Open the app twice.
>
> ---
>
> ### ⚠️ EARLIER — 2026-09-14 (end of session). Published to preview.
>
> **Everything from 2026-09-14 is live on the `preview` channel** (update `6a3aaf70`). It was not
> visible before because nothing had been published for 23 hours — a commit is not a deploy.
> **Production is untouched** and still on `a89d2dfe`; channel isolation was verified before and
> after publishing.
>
> On device: **open the app twice.** `fallbackToCacheTimeout: 0` means open #1 downloads in the
> background and open #2 runs it. Settings shows the build stamp — expect `01a0a3e2 · preview`.
>
> Caught on the way out: the profile-form move had deleted the Settings → "Your Bag" row added on
> 09-13 at Tim's own request. Restored on the Profile screen (`8970fb8c`) and guarded.
>
> Lint is at **0 errors / 1 warning** (from 78). The one left is `runAnalysis` in SmartMotion,
> deliberately NOT suppressed — see the note above it.
>
> ---
>
> ### ⚠️ EARLIER — 2026-09-14 (late). The queue, worked in order.
>
> `7dfe14d1` **Profile holds the profile** — the form moved out of Settings (745 lines lighter);
> PillRow had to be extracted first because it was trapped inside the Settings component. Caught a
> keyboard bug of my own and a second, silent recalculate handler on the way.
> `22d18f80` **every fault names its fix** — 7 of 11 had no teaching anywhere; enforced by the TYPE,
> not a test. `864ff8ab` **full-swing shaping taught** (draw/fade/knockdown/high), graded on start
> line because a curve is not measurable from one departure point; mirrors for a lefty.
> `92743fa4` **a tempo count fitted to the measured backswing**, plus one for the target tempo.
>
> **Ball type → acoustic detector: investigated, NOT built** — a per-ball offset would be fabricated
> constants and a learned baseline has no consumer. Written up in SPRINT-LOG.
>
> Green: tsc · lint 0 errors · jest **5026/5026 (412 suites)** · sim **1034/1034**.
>
> **NEXT — device verification. None of today has been on a phone.**
>
> ---
>
> ### ⚠️ EARLIER — 2026-09-14 (later). Tempo, the home set, and the profile audit.
>
> `c1946e14` **tempo was measured to the millisecond and described from a table of four.** Five
> findings, all reproduced by execution: canned coaching (same sentence for a 1.0:1 and a 2.6:1, and
> it said "slightly"), TWO disagreeing band sets across two screens, a 'smooth' band 0.10 wide, a
> displayed ratio that was not the graded ratio, and a measured tempo that **never reached the
> caddie** below a four-week trend.
>
> `9fb5a167` **three picked home courses**, each queuing a build on the Play tab; the cap lives in
> the store and a fourth is refused. Three existing guards caught defects in my own change, including
> a migration that threw on a corrupt blob.
>
> `ed6d6022` **goal and physical note are buttons**, keyboard only behind "Other".
>
> **Profile audit:** the data is fine — `experienceContext` exists, is editable and reaches the brain;
> `homeCourse`/`default_mode`/`missType` go via `contextSynthesizer`. The SCREEN is the gap:
> `app/profile.tsx` holds five of twenty-odd facts.
>
> **NEXT, decided and not yet built:** the profile-screen unification; `PoseFault` has no `fix` and
> **7 of 11** faults have no teaching anywhere; full-swing shaping is measured but never taught; ball
> type as an acoustic grouping key; a spoken tempo count from his measured ms.
>
> ---
>
> ### ⚠️ EARLIER TODAY — 2026-09-14. The bag is a bag, not a camera; the green map had no pars.
>
> `9e341c5d` **the scan could not be SAVED.** The review list was a `<ScrollView>` with no `flex: 1`
> above a footer holding the only writing control, and RN's `flexShrink` defaults to **0** — so the
> more clubs the scan read, the further off-screen the save button went. The store was never at fault.
> The screen is now the **BAG**: opens on what you own, a scan **merges**, photos (camera or library)
> sit beside video, and balls in the frame are read and offered.
>
> **One record per PHYSICAL club.** The club was scattered over five owners — flat brand/model/loft,
> three drivers inferred from free-text shot labels, shaft and grip nowhere, `setClubSpecs` an orphan
> with zero callers, and `clubVariantStore` keyed by club NAME beside a bag keyed by club id. Now
> `clubs[id].variants[]` with head + shaft + grip, specs **derived** so no flat copy can drift,
> `clubVariantStore` deleted and folded forward. **Three** call sites broke — the read boundary held.
>
> **The 14-club cap is universal** (Tim's call) — and the triple-check caught the regression that
> came with it: an 18-club owner tapping ONE club off lost **four**, and the three the app chose were
> 9I, PW, SW. The screen now holds an over-limit selection instead of handing the store a trim.
>
> **Green heat drew dashes.** Proven by execution: 3 rounds, 54 putt-holes, `ready=true` and
> `approach.holes=0 / scramble.holes=0`. Par came only from the ACTIVE course; every `RoundRecord`
> already carries `holePars`. Same sweep found the **GIR rule written three times**, two drifted.
> One `isGirHole` now.
>
> Green: tsc · lint **0 errors** · jest **4941/4941 (405 suites)** · sim **1034/1034**. Six
> break-tests, all watched to fail. The v1→v2 bag migration verified by running it.
>
> **NEXT — device verification, Tim's gate. Nothing here has been on a phone.** First things to
> check: does a bag scan survive leaving the screen, and does the scorecard's green heat show real
> approach/scramble cells after ~9 putt-logged holes.
>
> ---

> ### ⚠️ LATEST — 2026-09-13 (late, 2nd). Putt distance by tilt, and the ground-level view.
>
> `07f76efd` **the putt distance was never a measurement** — `PIXELS_PER_FOOT = 35`, the pixel gap over
> a constant, which perspective alone moves. Replaced by a tilt projection through the LEARNED hold
> height (`rangefinderCalibration.effectiveEyeHeightM`, not a new preset system), with a ± propagated
> from the real geometry: ±0.3 ft on a 7-footer, ±9.3 ft on a 53-footer.
>
> **The method pulled off the reticle in August is the right one here.** It failed there because a
> 150-yard target sits at 0.67° of down-angle; a 20-ft putt sits at 13.8°. Outside its envelope vs
> inside it. A guard pins that numerically.
>
> **GROUND VIEW** — phone standing on the green, camera an inch off the deck, where relief that is
> invisible from chest height stands up against the backdrop. Gated on the pose being held (upright AND
> steady — upright alone is just the aiming hold). Qualitative only; the inclinometer owns the numbers.
>
> **Distance audited app-wide** (Tim asked): one heuristic existed, gone; `computeDistance` has one
> caller with map-first ordering intact; `yardageResolver` 13 consumers behind 10 guards.
>
> Green: tsc · lint **0 errors** · jest **4878/4878** · sim **1034/1034**. 18 break-tests across the day;
> **B13 initially passed** and exposed a test that never exercised the floor it was guarding.
>
> **NEXT — device verification, Tim's gate.** Echo Hills (Hemet) over the next few days. First thing to
> check: **pace a putt and compare.** `CAMERA_VFOV_DEG = 60` is a default; a device whose true FOV
> differs produces a PROPORTIONAL error, so a consistent offset is one constant, not a redesign.
>
> ---
>
> ### ⚠️ LATEST — 2026-09-13 (late). The putt read: a deliberate route, a measured slope, a vision check.
>
> `65d748eb` **"look at my putt" had never once opened putt mode on purpose.** Tim: *"You just make a
> very simple assumption and ran with it."* He was right — I had explained his experience from the
> `putt_analysis` branch without checking which route his words take. What actually happened: the local
> precheck returned **null** for every putt phrasing → the cloud classifier picked `open_tool{look}` →
> spoke "Let me take a look." → `/smartfinder?autoread=1` → SmartFinder opened at its **persisted** mode
> (putt only because that is what he last tapped) → autoread fired the general **hole** scene read, on a
> putt, 1500 ms after mount, **before either end had been tapped**. There was no `mode` param in the app
> at all.
>
> **Fixed as one story:** a validated `?mode=` param + `open_tool{putt_read}` + a deterministic precheck
> (scene-read routes now name `mode=target` so they cannot inherit a persisted putt mode either);
> `readGroundSlope` — the phone laid ON the green, ~0.5° floor, which finally resolves the 2% the aimed
> tilt never could (2% = 1.15°, a hand wanders 2-3°) — in **both orientations**, because Tim caught that
> laid crosswise the axes SWAP and would *invert* the break call; a derived confidence level instead of
> hedging every clause; and a vision cross-check on the flagstick/hole where **a miss is the valuable
> answer**, since it means the A/B distance is wrong.
>
> It goes through `askCaddie` — the first version hand-assembled its own payload and the one-payload
> guard went red, correctly. Also rescoped a guard of my own that pinned a *token* rather than a
> property, and break-tested that it still catches the original bug.
>
> Green: tsc · lint **0 errors** · jest **4861/4861 (399 suites)** · sim **1034/1034** · ota-preflight OK.
> **Ten break-test mutations, all caught.**
>
> **Next real accuracy item:** the A/B distance is still `PIXELS_PER_FOOT = 35`, a rough pixel heuristic
> that perspective alone moves. Labelled a ballpark everywhere it is spoken; a tilt-and-known-height trig
> model is the principled fix and no machinery for it exists yet.
>
> ---
>
> ### ⚠️ LATEST — 2026-09-13 (fifth session). The dashboard's last four, lint to ZERO, and a release audit.
>
> **The release gate that remains is device verification, and it is Tim's.** Everything below is
> code-traced and gated; none of it has been on a real round.
>
> `35269109` **the four dashboard findings.** RECENT SHOTS was a heading with nothing under it (the
> gate and the renderer disagreed about which shots they meant). **A putt is always in FEET** now, one
> owner in `services/puttUnits` — and the app had been *collecting* them in yards, since Quick Log
> offers `putter` then asked for "Distance (yards)". PROGRESS had no word for "you stopped": three
> services ended in a bare `else` that called a collapse a "steady stretch" over a 0-ball line;
> `effortScoreVerdict` owns all nine outcomes as an exhaustive `Record`. And TRAIN YOUR SWING still led
> with the pump drill — `faultWorkouts` was a third owner nobody told on 08-13.
>
> `0adab626` **lint is at ZERO errors for the first time.** The last 72 hardcoded strings, plus a 73rd
> error that was never i18n: `eslint-plugin-import` had no TS parser, so `import/namespace` failed on a
> file that compiles cleanly and the error moved when unrelated lines moved.
>
> `f5a6c6a8` **"how do I …?" reaches the caddie.** 29 how-to entries were in the cached prompt and the
> three most likely asks never got there — "how do I change my handicap" was answered with what it IS.
> The guard is on the dispatcher, above every pattern.
>
> `b62f2fe9` **triple-check.** The recap was a SECOND renderer still saying "8 yd" for a putt, and
> `caddieRequestBody` still said "down or flat" — the screen had got smarter than the brain. New guard
> over all 2,629 `t()` call sites.
>
> `c483329d` **release audit.** All six critical-path markers ARE emitted; store config, permissions and
> secrets clean; **the live privacy policy matches the repo word for word**, five copies agreeing on the
> dates. Two fixes: a **privilege default** (`_layout.tsx` stamped a blank profile with
> `OWNER_EMAILS[0]` at list-length 1 — inert only by coincidence; trim the list after launch and every
> install is an owner with lifetime access), and the **orphan lock could not see `constants/` or
> `data/`** — widening it found a threshold with two owners, and the widening itself went quiet until a
> throwing superset assertion was added.
>
> Green: tsc · jest **4578/4578 (385 suites)** · sim **1034/1034** · lint **0 errors / 75 warnings**.
>
> **Mental leg: DONE** (`a20e0a27`) — the data was guarded, the VOICE could not be selected. Four of
> eight `ActiveSurface` values were never registered, so both `psychologist` branches were dead and the
> recap answered in the on-course tactical register. `'arena'` is parked for 3.0 (Tim). Same sweep
> found Fix G dead for months behind a comment that explained it away, an apostrophe acting as a word
> boundary that made 45 KB aliases unreachable (including the tagline), and a mental KB with no word
> for "choke" or "yips".
>
> **No-device items: CLOSED** (`6e688dc1`, `a0aa4c2e`). Three wrong numbers removed from the caddie's
> mouth — a stroke index read as a hole number, a hole number read as a yardage, and a corrupt-capture
> drive celebrated as real. `greenHeat` now reaches the caddie, the green floor has one owner, lint is at
> zero, and every orphan TRIAGE entry is resolved or has a written reason. ota-preflight: OK to publish.
>
> **Triple-checked** (see SPRINT-LOG). Two real defects found in my own day's work: a missing dialog
> template would have THROWN on the TTS path (the nine deletions widened it), and three ordinary golf
> questions retrieved nothing — verified pre-existing, not a regression, before fixing. Behaviour of the
> v4 migration, the putt round-trip and the greenHeatInput extraction all verified by execution.
>
> **NEXT BUILD: pin position, OPTION A** — round-level, on the Play tab, 3×3 grid beside the walking/cart
> chips. Depth adjusts yardage through `resolveYardage` (reaching all 13 consumers) and ONLY when
> front/back are real; side is an aim bias for the hole plan. Scoped in `docs/v1.2-deferred.md`.
>
> **The only thing left that needs Tim rather than a keyboard:** device verification on a real round.
>
> **Carried:** device verification of everything above; ~~`services/putting/greenHeat` reaches three
> screens and the caddie not at all~~ **— DONE**, ratchet answered with a registered reason; 12 of 18 authored dialog situations never requested (pinned shrink-only);
> four orphan entries baselined as TRIAGE/DUPE; `docs/audit-unguarded-inventory.md` lists 91 unguarded
> logic files.

---

> ### ⚠️ LATEST — 2026-09-13 (fourth session). Launch decisions, and a loop that had never closed.
>
> **Frame (now a rule, APP-BUILD-RULES B1):** no install base to protect — decide for what the app
> LAUNCHES as. And **every question to Tim is BINARY** (A11).
>
> Shipped: **seven presence switches → two** (`services/caddiePresence` owns the combination, no flag
> or consumer touched); **one editable handicap** (the integer was a mirror whose edits never wrote
> back); **the bag before the first round** (step 4 of `decideFirstRunRoute`, not a new onboarding
> step — `bag-scan` marks its flag ON MOUNT or a first-run arrival loops); and **walking as the
> default**.
>
> That last one only became safe because the silent corrector — which existed, and had **never run** —
> was fixed on three counts: the GPS-only branch self-vetoed at `'low'` (threshold was 1.2 m/s, below
> a brisk walk; now the shared audited 3.0), "did the player choose" was untestable (`transportMode`
> has no unset value, so both detectors returned on their first line), and a Play-tab declaration
> never reached `settings.cartMode`.
>
> Green: tsc, jest 4404/4404 (375 suites), sim 1034/1034, lint 76 = exactly HEAD. Break-tested 9/9
> and 7/7. **NOT verified on device — the cart loop wants a real round.**
>
> **Carried:** the cart loop is code-traced only; the i18n lint backlog **(CLOSED 09-13 — lint is 0 errors)**; the mental-game leg.

---

> ### ⚠️ LATEST — 2026-09-13 (third session). Settings, read as a product surface.
>
> 28 screenshots, 11 sections, ~75 controls, and **no guard on the screen at all** — which is how
> eleven defects accumulated in it. Shipped: **Tank removed from every string a player reads** (code
> was already clean; the three `'tank' → 'kevin'` migration lines are KEPT); **"Cecily Mode" →
> "Kid-Friendly Mode"**; the `(dev)` GPS overlay and screenshot mode **moved to Owner Tools**; a new
> **People & Coaching** section for the features hiding under Help & About; **the Bag reachable from
> Profile**; three **Health Connect rows gated** behind the flag that says the build has no health;
> and four copy claims that contradicted the code (issue-report email, OpenAI STT, cart default,
> "four caddies").
>
> **Gus was never a persistence bug** — the pillar pickers hard-coded `[Kevin, Serena]` while the
> store has always accepted a full `Persona`. One owner now: `selectablePersonas()`.
>
> Six new sim guards, break-tested 7/7. The sim caught two of MY defects mid-work: conditional hooks
> from the Owner Tools move, and a trim that deleted a sentence a regression test pins.
>
> Green: tsc, jest 4383/4383 (373 suites), sim **1034/1034**, lint 76 errors = exactly HEAD.
> **NOT verified on device.**
>
> **Carried, and all of them are Tim's call:** the seven presence/verbosity controls are grouped but
> not consolidated; `cartMode` still defaults TRUE; handicap and miss each have two fields; four club
> stores sit under "the bag". Plus the i18n lint backlog **(CLOSED 09-13 — lint is 0 errors)** and the mental-game leg.

---

> ### ⚠️ LATEST — 2026-09-13 (second session). One document, four files, and the copy the player accepts.
>
> A documentation review found the privacy policy had **no owner**. The live site was ahead of the repo
> by four changes (09-12); the **in-app** policy — `constants/legalText.ts`, rendered by
> `app/legal.tsx`, reached from the welcome screen — was **two disclosures short** of it, and both
> missing consents (`shareDiagnostics`, `shareCommunityData`) **DEFAULT ON**. Every copy, the live one
> included, also pointed the player's opt-out at the store keys ("Share diagnostics") instead of the
> labels on screen ("Auto-send my issue reports" / "Share course maps"), and §4 disclosed ElevenLabs
> (deleted 06-04) while omitting Deepgram (production STT, every voice query) and Gemini (tried FIRST
> on lie / putting / scorecard images).
>
> Now **one 244-line document across four files**, with the live fragment extracted and proved
> byte-for-byte against smartplaycaddie.com before being written into the repo. **Six new sim guards,
> all break-tested (9/9)** — including disclosure-matches-manifest in BOTH directions, because the old
> guard's `healthPerms.length === 0 ||` short-circuit had stopped checking anything the moment health
> came out for 1.0. Site republished.
>
> **`docs/APP-BUILD-RULES.md` is new and `CLAUDE.md` opens by pointing at it. Rule 1: every new session
> follows it.** Part A general, Part B Caddie.
>
> Green: tsc, jest 4383/4383 (373 suites), sim 1027/1027. **Lint is RED at HEAD and was before today** —
> 76 errors, all the i18n hardcoded-text rule; see APP-BUILD-RULES §B10, Tim's call.
>
> **Carried:** the mental-game leg is still unaudited against the conversation lens — **next**. Plus
> `workoutPerformance`, `workoutSwingImpact`, `pointsPerformance`, `preRoundFactors`,
> `handicapCalculator` screen-only, and the off-round deflection.

---

> ### ⚠️ LATEST — 2026-09-13. The day-one concept: talk to them, and they know.
>
> Tim reframed the sweep around the original idea — a swing coach / caddie / mental coach you TALK
> to, not a menu you open. Two of the three things he named were built and unreachable from a
> conversation. **The swing coach could not see the swing:** not one biomech value reached the brain,
> though the library stores per-shot reads, `swingBenchmarks` holds the tour bands and
> `swingMetricTrend` grades one against the other — dashboard-only. Now `measuredSwingBlock` (raw
> reading + band verdict + direction), a shared `selfSwingReads` collector, and a prompt rule that
> makes a FEEL go through the filter he described: agrees / disagrees / isn't measured, never invent
> a reading. **A course he is only thinking about** could reach `lookup_course` but never
> `courseDownloadEngine`, whose three callers were all "you are already playing here" — now a
> consent-gated `download_course` tool in both dispatchers, and the prompt reads a course against
> HIS game instead of reciting the card.
>
> The sim's cached-prompt RATCHET caught both new interpolations (and 09-12's, committed without the
> sim being run). Both registered deliberately; frozen count 57 → 59. **Run `npm run sim`, not just
> jest.**
>
> Green: tsc, lint, jest 4270/4270 (365 suites), sim 1023/1023. **NOT verified on device.**
>
> **Carried:** `workoutPerformance`, `workoutSwingImpact`, `pointsPerformance`, `preRoundFactors`,
> `handicapCalculator` still screen-only; the off-round deflection ("You're not in a round yet" to
> putting/GIR/last-round questions) still needs a per-topic call; the MENTAL-game leg has not been
> audited against this lens yet.

---

> ### 2026-09-12. The caddie could not see the dashboard.
>
> Tim wanted to talk to Kevin about the practice/score crossing on his dashboard. Kevin had no
> access to it: `practice/practiceImpact` has measured it since 06-14 with `app/(tabs)/dashboard.tsx`
> as its only importer, and the closest thing in the payload was an all-time practice session COUNT
> with no dates in it. Now sent as `practiceImpactBlock` (system-side, cached, direction not the
> dashboard's UI copy), with `practiceImpact.connection` as the one owner of which way each line is
> going. **Three more from the same sweep:** a club question without "my" in it
> ("how many yards do I hit a pitching wedge") was answered with the distance to the GREEN; a spoken
> "my rangefinder says 205" opened /smartfinder and dropped the number that `yardageResolver` ranks
> above live GPS; and the 09-11 "the 60 is a club" fix **had never once fired** — it was handed the
> capture group with the determiner stripped, and its gate asserted the *source text*, so it passed
> over a fix that did not work. That gate is behavioural now.
>
> Green: tsc, lint, jest 4253/4253 (363 suites). **NOT verified on device.**
>
> **Carried:** five more measured findings with no route to the caddie — `swingMetricTrend`
> (progress/regression vs the tour band, the biggest), `workoutPerformance`, `workoutSwingImpact`,
> `pointsPerformance`, `preRoundFactors` — plus the off-round deflection ("You're not in a round
> yet" to putting/GIR/last-round-here questions). Needs a per-topic decision, not a blanket route.

---

> ### 2026-09-10. Three ways the right number could not reach the player.
>
> Reported from the tee at Hemet, mid-round. **(1) The flap** — `yardageResolver` gated live GPS on
> `fixAge < 10_000` while `gpsManager`'s walking mode polls at *exactly* 10_000ms, so the live tier
> aged out at the instant its replacement was due and dropped to the frozen scorecard number, every
> ten seconds. gpsManager already owned staleness (30s, "walking (10s) + 3 missed ticks"); the gate
> is deleted, and the `isSimulatedActive` exemption that existed only to dodge it goes with it.
> **(2) Kevin would not take a correction** — the follow-up bypass skipped the ENTIRE intent router,
> `state_yardage` included, so the one correction a player most needs to make was the one the router
> could not hear. Now narrowed: a reply carrying a yardage reaches the router, everything else
> bypasses as before. **(3) The watch rode an 18s timer and no GPS subscription** — now takes the
> fix fan-out too, merged onto main's same-day watch work, with the heartbeat cadence unchanged.
>
> Green: tsc, lint, jest, sim 968/968. **NOT verified on device — shipped as an OTA mid-round.**
>
>
> **All three follow-ups closed the same day.** Hemet's green was never wrong — `courseToHoles`
> writes ZERO greens for every golfcourseapi course (the free tier ships tees, null greens), so the
> data bar was on `estimatedFromTee` (hole total − distance walked) while SmartVision showed the card
> hole length. Different questions, not a bad coordinate. **SmartVision not loading:** `setLoading
> (false)` was the last statement of a 400-line async body, not a `finally` — any throw hung the
> canvas forever; the floor now goes under the whole body. **Auto hole advance:** `detectCurrentHole`
> read the geometry CACHE only, so on a course with no cached green it returned "no transition" on
> every fix with the toggle ON — and could not even see a player's Mark Green override. All four
> coordinate reads now go through the smartFinderService cascade, proven by a functional test that
> fails on the old code.
>
> **The real carried item:** golfcourseapi courses have no greens until an OSM/derivation build
> lands. That single gap is behind two of today's five defects. Needs a decision (fetch geometry at
> course *download*? stop writing zeros?), not another patch.
>
> **Also carried:** `scripts/ota-preflight.mjs` fingerprints gitignored `ios/`+`android/` prebuild
> output, so it can only pass on Tim's machine — `origin/main` fails it with zero changes.

> ### ⚠️ LATEST — 2026-09-09. Three crashes fixed; all await device verification.
>
> Branch `claude/android-crashes-voice-failures-tjsmho`, 3 commits, unmerged.
> **Recap crash** (allocating Zustand selector, third recurrence), **drill videos never played**
> (`getViewManagerConfig` returns null under the new architecture, so no WebView was ever mounted),
> **SmartMotion record crash** (`onDeviceLocate` bypassed the single-flight media queue AND read the
> file ExoPlayer was looping), **pose + trace** finished onto the shared private-copy pool that
> clubPath has used since 07-30.
>
> **Nothing here is device-verified.** The crash class is native; the tests lock shape only.
> **Still open:** whether the private copy is the ONLY cause of a sparse club arc — needs one field
> report carrying `rejected`/`detected`/`gate` from `f44f06d`.
> Voice start/stop during recording is deliberately unchanged (Tim: tap-stop stays).
>
> A triple-check pass then found three defects in those same fixes (a detector that could throw at
> module scope, a wrong scope claim about which readers touch the looping clip, and an unbounded copy
> in front of a bounded probe that would have broken the analysis hang guard). All fixed; the gates
> now DERIVE their file lists rather than trusting a hand-written one, because the hand-written one
> was wrong twice.
>
> An open-items pass then closed the rest. The headline: the sparse-arc field report the close-out
> asked for was UNOBTAINABLE — `f44f06d`'s `rejected`/`detected`/`gate` fields were reported by the
> swing-detail screen ONLY, so SmartMotion (where swings are recorded) and videoUpload's analysis pass
> stayed silent. All three report now. **The next recorded swing should produce the event that settles
> whether the private copy is the only cause of a sparse arc** — look for `clubpath_arc_too_sparse`
> with `screen` and `rejected`. Lint is 0 errors; the claimed `api/messages.ts` tsc error does not
> exist. Voice start/stop deliberately untouched.
>
> **This branch is JS/TS only — no native, no app.json, no eas.json, no deps — so it cannot affect a
> build in review. It is UNMERGED and no OTA was published. Merge is Tim's call after device test.**
>
> Detail: [SPRINT-LOG.md](SPRINT-LOG.md) → "Day N+2 — 2026-09-08 / 09-09", its triple-check pass, and
> the open-items pass.


> ### ⚠️ LATEST — 2026-09-06 (later). Layer 0: remote kill switches are LIVE.
>
> Any optional feature can be turned off on a phone already in a player's pocket — no rebuild, no
> OTA, no store review. Edge Config `smartplay-flags` → `GET api.smartplaycaddie.com/flags` →
> `store/flagStore.ts`. Server round-trip verified both directions in **under 6 seconds**.
>
> Fail-open everywhere: a failed fetch NEVER darks a feature (28 tests, nine failure modes). Gated at
> both ends — menu rows, the SwingLab tab, six self-gating screens, the mic chokepoint, the caddie's
> own tool routing, and per-course geometry. NOT gated: GPS, round, scorecard, bag, course book,
> history.
>
> **Flip a switch:** `vercel edge-config update smartplay-flags --patch '[{"operation":"update","key":"flags","value":{...}}]'`
>
> **VERIFIED ON DEVICE 2026-09-06 (Tim):** flipped smartvision false → gone from the ••• menu after a
> force-close/reopen; flipped back → returned. No rebuild, no store review, no message shown. Layer 0
> is Tier C. NOTE: the flip only reaches a build that HAS the flag code — Tim's phone needed an
> `eas update` to both branches first, which is the ordinary OTA rule, not a flag bug.
>
> **NEW RISK FROM THE SENTRY MERGE:** the issue-log email path is deleted, so Sentry is now the ONLY
> notification channel for user reports. Until an alert rule exists in the smartplay-caddie project,
> reports land silently. Highest-priority open item.
>
> Known gap: `catalogForPrompt()` is server-side, so Kevin may still MENTION a killed feature. He
> cannot open it.
>
> ### 2026-09-06 (earlier). One course engine for every course.
>
> Menifee Palms + Lakes were the only two courses with a private data path, and it reached into the
> **resolver**, not just imagery: `smartFinderService` read a Golfbert pin cache above `courseHoles`,
> and that cache's only populator was SmartVision's mount. So Menifee's yardages depended on whether
> the map had been opened that session — the likely cause of Tim's bad round there. Also removed: a
> Golfbert render branch that anchored markers with calibration measured off images deleted on
> 2026-08-25, and an `includes('palms')` name gate that left *any* "Palms" course with no imagery.
>
> **Severed, then DELETED** (Tim's call). Parking `golfbertApi.ts` on disk left it imported by
> nobody, and MARSHAL counts that as an ISLAND — "wire the file up or delete it WITH its guards,
> never by adding a line here." So `golfbertApi.ts`, `golfbert-proxy.ts` and `golfbertCourses.ts` are
> gone, with the sim guard, the ORPHAN_BASELINE entries and the vercel route. Recoverable from
> `eb0a20b6`. **Rewire it behind the engine (a provider feeding `courseHoles`) or not at all.**
>
> Same pass, second half — uniformity sweep across ALL courses:
> - 11 more courses still built thumbnails from `X_HOLE_IMAGES[1]` maps that are `{}`. All 41 now use
>   `satelliteThumb(lat, lng)`.
> - SmartVision held a `void`ed 7-rule copy of `getLocalCourseSlug` that had missed both fixes the
>   real one got — no `isAmbiguousComplexName` gate, no `shadow` rule before a bare `lakes`. Deleted.
> - Centroid resolution was name-only while calibration was id-first. **New `data/courseSlug.ts` is
>   the one resolver: id first, name only as last resort.** The centroid picks where the aerial is
>   centred, so a name collision there was a confidently wrong picture of another club.
>
> Pinned by `__tests__/regression/one-course-engine-answers-for-every-course.test.ts` (19 tests).
>
> Health: tsc 0 · jest **2650/2650** (241 suites) · **sim 968/968** · lint 1 pre-existing error
> (`app/paywall.tsx:271`).
>
> **Third pass — course books / thumbnails / commercial polish.** Course books audited and left
> alone: they decline rather than invent, surface `description_source` to the player ("from public
> data — not field-verified"), key on course_id, and gate par/yardage plausibility. No unlicensed
> assets on disk. Thumbnails 38/38 honest — real coords, none 0,0, each built from its own lat/lng.
> Fixed two surfaces that had silently lost their image when the packs emptied on 08-25 (recap hole
> panel, Sim Round board) — both now fall through to Mapbox like every other surface already did.
> Registered the two missing multi-layout complexes (**Coyote Creek**, **Gleneagles**); only Menifee
> had been. Gates now DERIVE the facility list from the shipped courses, so the next one fails on
> arrival. 101 tests in that file.
>
> Known and deliberate: Gleneagles King's/Queen's share one coordinate, so both cards show the same
> tile. Both are scorecard-only (all-zero hole coords) — there is no per-layout geometry to split
> them, and inventing a second centroid would be a fabricated coordinate.
>
> **NEXT:** PATH 2 + PATH 5 device verification at Menifee — Tier A only so far.
>
> **LESSON:** the pre-commit hook runs tsc + jest but NOT the sim. The first commit of this pass
> (`eb0a20b6`) went out with the sim at 967/969 and nothing caught it. Run `npm run sim` before
> pushing anything that removes an import.
>
> ### ⚠️ CURRENT STATE — 2026-08-13. Read this block; the rest of this file is older.
>
> The dated material below ("Day 5 — 2026-05-24") is **months stale** and describes a different point
> in the project. It is kept for continuity, not as current truth. **Today's detail is the
> 2026-08-13 entry at the bottom of [SPRINT-LOG.md](SPRINT-LOG.md);** the verified architecture snapshot
> is §1A of [MASTER_COMPENDIUM.md](MASTER_COMPENDIUM.md).
>
> **Health (measured 2026-08-13):** tsc 0 · jest **946/946** (75 suites) · sim **750/750** ·
> lint 196 problems / 4 pre-existing errors. Head `2ddb2d4e`.
>
> **The course-building engine IS built** — proven live, not code-traced: six real courses built against
> the deployed API (Kettle Brook 3.2s, Blackstone National 6.4s, Green Hill 2.6s, all 18/18 greens+tees).
> Stop re-litigating this one.
>
> **PATH 4 VOICE is Tier C (device-verified)** — 2026-08-13, cold open, intelligent Serena reply under 30
> seconds. It is the ONLY device-verified item. Everything else is Tier A/B.
>
> **⚠️ A DEPLOY IS OWED.** The last three course-engine fixes are SERVER-side (par derivation, green
> rings, Overpass budget). They do nothing until the next Vercel deploy — they are not OTA.
>
> **P0 queue, in order:**
> 1. **Deploy + re-verify** the three server fixes against a live build (rebuild Pakachoag: pars should
>    stop being nine par-4s; rebuild Kettle Brook: `green_polygon` should be populated).
> 2. **Brain merge remainder** — 4 pipecat-only capabilities (`register_bag` + prompt line, SIM ROUND,
>    interview suppression). `conversationalBrain` falls back to `/api/kevin`, so a player on the
>    fallback silently loses all four. BLOCKED on unifying the client tool-call shape: kevin returns
>    `toolAction`, pipecat returns `tool_actions`.
> 3. **Device verification** of the day's work — nothing but voice has been on hardware.
>
> **Standing holds / do not "fix":**
> - **Harry** — deliberate hold (Tim's call 2026-08-13). Full character spec, in no picker. Parked, not dead.
> - **Task prompts are not the caddie identity.** 8 files declare a caddie identity; the other "You are…"
>   prompts are scorecard readers, coordinate detectors, ball trackers. Do NOT collapse those into the persona.
>
> **Method note that keeps paying off:** verify what a grep tells you before reporting it. Three wrong
> claims on 2026-08-13 came from lexical searches — including a customer-facing PDF that listed four
> personas because it was written from `type Persona` instead of the picker (it's three: Kevin, Serena,
> My Caddie).

- **Sprint:** Two-week consolidation sprint, started 2026-05-20. Target: app ready by June. **Day 5 — 2026-05-24.**

### OTA CHANNEL RULE (discovered 2026-06-17) — read every session
**Dev-client build (`development` profile) listens to `--branch development`.**
**Production-APK build (`production-apk` profile) listens to `--branch production`.**
Every OTA must be pushed to BOTH unless you know exactly which build Tim is running:
```
eas update --branch development --message "..."
eas update --branch production --message "..."
```
All prior session OTAs went to `production` only. The `development` channel was empty until 2026-06-17 Session 4. The HEAD push (`a7ee1fe`) covers everything — force-close/reopen on the dev-client picks it all up.

---

### LATEST (2026-06-22, Session 9) — Phase BM pre-review hardening — `233cd99`

**Active focus: backend hardened for professional AI engineer review this week.**

**Working directory: `/Users/timothyg/smartplay`**

**Just shipped this session (`233cd99` — 25 files, 338 insertions, 793 deletions):**

All 23 confirmed HIGH findings from the 30-agent workflow audit addressed:
- **Security:** `kevin.ts` prompt injection caps + security policy prefix; `brain.ts` → 410 Gone (no more deployed injection surface); all image/audio size caps (413); `weather.ts` key fingerprint removed from error responses
- **Gemini timeouts:** `_aiProvider.ts` `withGeminiTimeout()` on all 4 single-call helpers; `swing-analysis.ts` sub-mode timeouts
- **Error handling:** `recap.ts` guarded JSON.parse; `putting-analysis.ts` fabricated 200s → 502; `briefing.ts` empty response → 502; `course-intelligence.ts` auth guard
- **Provider migration:** 8 remaining Anthropic-SDK routes migrated → `_aiProvider.ts` (cage-review, meta-voice's 1.3s timeout eliminated, cv-scoring, club-recognition, space-scan, junior-swing-analysis, tutorial-analysis)
- **Voice races:** speculative Kevin fetch now aborted on handler-routed intents (`listeningSession.ts`); `processFollowUp` gated on `isProcessingRef` (`useVoiceCaddie.ts`)
- **Stale JSDoc:** swing-analysis, swing-compare, swing-question, round-import, _aiProvider.ts all updated to reflect Gemini+OpenAI architecture

**Previously shipped (2026-06-21 Session 7 — bug fixes):**
- Lie-analysis startup guard (removed ANTHROPIC_API_KEY from condition)
- Swing-analysis `locate_swing` + `locate_swings` blocks fully migrated to Gemini inlineData

**What's next (P0 queue):**
1. **Path 2 + Path 4 MIN VERIFY on real Z Fold round** — markers instrumented; run a real round, grep `[path2:round]` + `[path4:voice]`. Update `critical-paths.md` after.
2. **Path 1 ONBOARD + Path 3 CAGE MIN VERIFY** (still `_not verified_`).
3. **EAS dev-client build** — for `expo-document-picker` (Meta-glasses ingest) + BT media-button.
4. **Open Range card in Prepare Better** — 5-min task: `LauncherCard` in `PREPARE_SECTION` in swinglab.tsx.
5. **Remaining medium audit findings** (deferred, lower risk): raw error messages in 13 catch blocks; `owner-triage.ts` auth; `kevin.ts` 60s budget math; `kevin-read.ts` fallback 200.
- **Not done (deliberate):** Phase 6 full `@anthropic-ai/sdk` removal (only `course-intelligence.ts` + a few health/admin routes remain); Jest framework, DI refactor.

### TL;DR (2026-05-24)

**Canonical inventory now lives at [BUILD-STATE-AUDIT.md](../BUILD-STATE-AUDIT.md)** (repo root). Read that for the full feature-by-feature breakdown across BUILT-VERIFIED / BUILT-UNVERIFIED / LEFT-FOR-1.0 / FUTURE. The list below is the running operational state — the audit is the authoritative classification.

**Days 3-5 (2026-05-22 → 2026-05-24) — major shipped items, all OTA-able + tagged `[SHIPPED-UNVERIFIED]` in the audit:**

- **Metric honesty system landed.** Forward-compatible source taxonomy (`38727de`) — pose wired, acoustic/watch/calibrated/profile/placeholder reserved, sources[] slot for fusion. Confidence labels + ranges on every metric (`31156de`) — killed the silent clamp, retired the fake-precision flag. Acoustic re-tiered as estimate not truth-grade (`ae58836`). Acoustic ball speed for SmartMotion in-app captures via parallel recorder (`516aab9`, Option C).
- **BUG #1 — Frame extraction regression diagnosed + fixed.** Diagnosis (`3bb96ee`, read-only) ruled OUT extraction collapse: 5 frames still ship through `/api/swing-analysis`. Fix (`45dfe0e`) rewrote the Sonnet prompt to read full motion + stopped frame-1 anchoring + logged image-count. Owner debug card (`3ef0c67`) makes frames-sent vs server-saw visible in-app.
- **Layman translation layer (`dedba52`).** `layman_explanation` field added to swing-analysis response; rendered as progressive disclosure on PrimaryIssueCard. **Gap:** NOT yet ported to `/api/putting-analysis`.
- **Fault-frame persistence (`c974779`).** Diagnostic frame saved as JPEG (`fault_frame_index` + `visual_reference_path`) — annotation + share prerequisite, opp #4 from the roadmap.
- **Coach Mode player scan + calibration profile (`c777743`).** Player calibration store, scan-student route, beta-tagged for Tank. **Critical gap:** profile is written but NOT yet consumed by `swingMetricsService` — flagged for 1.0 in the audit.
- **GPS-verify three-flow build.** Discovery (`fd7ad07`, read-only). Flow A — raw yardage to pin (`a347e0b`). Flow B — confidence-gated proactive hole ask (`98511a6`, gpsConfidenceAsk orchestrator + gpsHealthStore). Flow C — declared-position cross-check + silent Mark on divergence + UndoMarkBanner (`406ab3a`).
- **Hands-free spine batch (`291a207`, `ecf57d9`, `56a769c`, `bebe100`, `5f08032`).** "watch this" + putt_watch classifier reachability. media_capture swing falls back to /swinglab/quick-record when Cage not mounted (one-phrase-one-path). ES/ZH localization — text-path (`TTS_STRINGS`) AND TTS voice model threading (`eleven_multilingual_v2` swap). iOS/Android-specific permissions copy coaching "Allow all the time". CourseTruth dev tool (`app/dev/CourseTruth.tsx` + `services/courseTruth.ts`, AsyncStorage-backed survey workflow). `resolveGreenCoords` extended to TRUTH > override > courseHoles > geometryCache, sync via boot-hydrated cache. Meta glasses voice-ingest v1 (`metaGlassesIngest.ts` + `externalContext` on roundStore + `what_did_meta_say` voice intent). Tee box geofence (`currentLocationType` on roundStore — fed by gpsManager on every fix, does NOT touch currentHole). `ask_golf_father` intent with location × distance cascade + Tier-1 hardcoded TANK_RULES for 6 questions. `cage_mode` voice route + `watchAndSpeakNextSwingAnalysis()` Cage swing auto-coach. `practiceStore` persisting cage tendencies (overTheTopCount / fatShotCount / typicalMiss / avgCarry) fed from `perShotAnalysis` adapter. AsyncStorage dump panel on `/cage-debug` for on-device persistence verification (no Flipper needed).
- **BUILD-STATE-AUDIT.md (`d97c22e`)** — full read-only reconciliation of sprint log vs code. Authoritative source for "what's actually built vs claimed" going forward.

**NOT on main — pending native EAS Build cut:**
- **Worktree `feat/bt-media-button` @ `7504099`.** Bluetooth headset media-button native bridge (Kotlin Android + Swift iOS) + plugin + JS voiceTriggers + app/_layout integration. Mirrors AirPods/Bose play-pause → `notifyEarbudTap()` → `listeningSession.toggle()`. Not OTA-eligible (native deps). Awaits `eas build --platform all --profile preview`.

**Headline observation from the audit:** ~40 items shipped to `main`, only 2 verified. The dominant 1.0 gap is **verification on real hardware** — a Menifee cart round, a real swing capture, a real Spanish utterance — not more code. See BUILD-STATE-AUDIT.md §B for the per-item verification gate.

---

### Earlier day-by-day fixes (Day 1-2 history — preserved for context)

- **Fix P shipped — voice score-telling intent (OTA-able).** Same silent-contract bug-class as Fix O: `services/intents/logScoreHandler.ts` was fully implemented + registered with the canonical `round.logScore` write path, but `log_score` was completely absent from `api/voice-intent.ts`'s classifier prompt (not in the numbered intent list, not in the JSON schema union). Haiku classifier can't emit an intent it hasn't been told exists, so "I got a 4 on hole 1" classified as `unknown` → triggered the "are you asking or telling?" clarifier. Fix: added the full `log_score` intent definition (#21) with examples covering numeric phrasings ("I got a 4", "took a 5", "carded a 6") AND par-relative names ("made par", "bogey", "birdie", "eagle", "double bogey"); added explicit number-vs-hole disambiguation rules ("4 on hole 1" → strokes 4 hole 1; "I bogeyed 7" → bogey on hole 7); added `"log_score"` to the schema union. Handler extended with `parseScoreName(raw, par)` to resolve par-relative names against the current hole's par; par lookup reordered to happen before strokes parsing. Caddie confirms with "Got it — 4 (par)" via existing listeningSession TTS (persona voice). Strategy questions still route to the brain — log_score only matches past-tense reports.
- **Fix O shipped — hole nav + scoring resilience (OTA-able).** The cockpit's SHOTS / PUTTS steppers were silently no-op'ing on device — `CockpitCaddieScreen.tsx` was calling `setScore` / `setPutts` via `(s as unknown as {...}).setScore?.(...)`, but the store exposes those actions as `logScore` / `logPutts`. Optional chaining swallowed every tap with no error. Replaced with the canonical `logScore` / `logPutts` (same write path the scorecard, voice intents, and harness use). Added manual hole ◀/▶ nav arrows to `CaddieDataStrip` in both layouts (horizontal portrait + grid Fold-open) — calls `setCurrentHole`, which already fires `holeDetection.noteManualOverride()` so a correction holds for 20s against auto-detection. Scorecard already had manual nav via row tap. One canonical write path everywhere: `setCurrentHole` for hole, `logScore` for score, `logPutts` for putts. No parallel logic. GPS / holeDetection untouched (Fix L territory). OTA-able.
- **Fix N (THE GATE) shipped — Start Round crash-proofed (EAS-build-required, not OTA).** Tim's Z Fold (One UI 6 / Android 14 / targetSdk 35) crashed hard on every Start Round; round persisted via Zustand+AsyncStorage but the post-persist GPS orchestration died. Strongest cause: foreground location service posts a persistent notification, but `POST_NOTIFICATIONS` was missing from the manifest → Android 13+ SecurityException → native process kill (JS try/catch can't catch). **Defensive fix shipped without waiting for a stack trace:** (1) added `POST_NOTIFICATIONS` to app.json Android permissions; (2) `services/backgroundLocationTask.ts` now probes the runtime permission via `PermissionsAndroid.check`/`request` BEFORE calling `Location.startLocationUpdatesAsync` — when denied (or the probe itself throws), skips the foreground service entirely and lets foreground `watchPositionAsync` carry the round (loses Doze coverage, NOT the round); the native call is also wrapped in an inner try/catch as a third defense layer; (3) `app/(tabs)/caddie.tsx` no longer double-fires `startGpsManager` — collapsed to a single call site in `roundStore.startRound`, with caddie.tsx only running the post-GPS `refreshFix`+`forceMarkPosition` initial-fix sync after a brief wait; (4) `eas.json` gets an `EXPO_PUBLIC_SENTRY_DSN: ""` slot so Tim can wire runtime crash capture via EAS secrets without further code changes (kept `SENTRY_DISABLE_AUTO_UPLOAD: true` since source-map upload requires the full SENTRY_AUTH_TOKEN/ORG/PROJECT trio — runtime capture works without it). EAS rebuild required for the manifest change; hole-jumping (Fix L) re-evaluation deferred until a clean Start Round runs on device.
- **Day 2 closed (2026-05-21):** three honest-degradation fixes shipped + two no-code diagnoses (analysis is real, timeline is display-only). Fix G — Cage Mode now runs on real capabilities only (dropped the unbuilt CV bullseye + analyze 404 endpoints; CV deferred to post-launch backend build). Fix H — pose-analysis 503 alert killed (200-with-null when env-gated off; trivially reversible if RapidAPI subscription is added later). Fix I — caddie failure path no longer goes silent: localized fallbacks in three languages + `maxDuration: 30` on five Sonnet endpoints (Vercel Pro confirmed) addresses root cause of intermittent + Spanish silent failures. Fix J + K — no code: SmartMotion analysis verified real and swing-specific; timeline "only 2 points" is `Math.floor()` display collapse on short clips, not extraction failure. **Next:** on-device verify of Fix I (force a failure, confirm caddie speaks not silent) + grep V6-DIAG STAGE 2 to confirm 5-frame extraction → close J/K → kick EAS tester build. Tonight: Menifee real round + daughter capturing 5-angle hole photos.
- **Current day:** Day 2 — 2026-05-21. Fix 9B shipped: SmartMotion (quick) and Cage Mode (practice/lessons) are now two clean features with zero overlap. `app/smartmotion-quick.tsx` deleted. `app/swinglab/cage-drill.tsx` renamed to `app/swinglab/cage-mode.tsx` with batch-count ported in. Voice intent + Tools menu + cockpit MOTION skip the NoClipHero (Option D speed). Sprint Map P0-3 closed.
- **Fix A shipped:** new `components/caddie/CaddieMicBadge.tsx` (shared tap-to-talk badge with ring + halo + mic-icon overlay). `BrandHeaderRow` refactored to use it (no API change). Added to SmartMotion + Cage Mode headers; SwingLab gets it via BrandHeaderRow. Auto-voice (continuous wake-word) on these screens remains deferred — manual badge is the manual fallback.
- **Fix C shipped:** SmartMotion skeleton + shot-tracer overlays now map to the displayed-video subrect (COVER scale + crop), not the container box. Stays aligned across Z Fold open/close because `onLayout` on the videoFrame recomputes the rect on container resize. STUB_SKELETON is still a placeholder until real MoveNet keypoints land — Fix C makes the mapping correct so real keypoints will land on the body.
- **Fix D shipped:** new `CaddieIntroSheet` (3 lines + skip + speak with active persona's tone) wired into SmartMotion (pre-record only) and Cage Mode (SETUP phase only). Auto-suppresses after 3 opens per slug via persisted `introOpens` counter on settingsStore. Voice "how does this work" re-trigger deferred.
- **Fix I (A+B+C) shipped:** honest caddie failure handling + 30s Vercel headroom (Pro confirmed). The earbud-tap / mic-badge caddie flow in `services/listeningSession.ts` was swallowing every failure (non-2xx, empty reply, fetch throw, handler throw) silently — the pill went idle with no spoken/haptic feedback, indistinguishable from "Kevin didn't hear me." Wired honest localized fallbacks (English/Spanish/Chinese) into all four silent-drop branches via a new `speakHonestFailure()` helper that vibrates + stops in-flight TTS + speaks "I'm having trouble connecting — try that again" in the user's language. `api/kevin.ts` outer catch was returning HTTP 500 (which the client dropped) — now returns HTTP 200 with the same localized fallback string in `text`, so the client's existing OK-branch picks it up and speaks it. Spanish wasn't a separate bug, just more likely to tip over Vercel's old default cap thanks to heavier `eleven_multilingual_v2` TTS. Added `maxDuration: 30` to `api/kevin.ts`, `api/brain.ts`, `api/voice-intent.ts`, `api/swing-analysis.ts`, `api/cage-coach.ts` in vercel.json so the 25s Anthropic SDK timeout + 5s TTS headroom completes naturally. NOT fabrication — only honest error strings reach the user, never fake answers. `useVoiceCaddie` (cockpit/full-mode round flow) was already correct; left as the reference pattern.
- **Fix H (Option B) shipped:** kill false 503 alert on `/api/pose-analysis`. The endpoint was returning HTTP 503 by design when `POSE_API_KEY + POSE_API_HOST` env vars aren't set — file header documented it as a "graceful 503 — clients fall through silently." Functionally correct but the wrong status code: Vercel couldn't tell "intentionally off" from "broken" and fired false alerts. Blast radius confirmed zero: SmartMotion's primary analysis (`/api/swing-analysis`) is independent, both pose-analysis callers were already fire-and-forget with explicit "failures silent" comments, and [services/poseAnalysisApi.ts:145](../services/poseAnalysisApi.ts#L145) already collapsed `!res.ok → null`. Fix: server now returns `200 OK` with `{ data: null, configured: false, reason }` when env-gated off; client checks `data.configured === false || data.data == null` and returns `null`. UX identical (no biomechanics card when unconfigured), no fabrication, trivially reversible when a real RapidAPI subscription + env vars land (Option A). `tsc --noEmit` clean.
- **Fix G (Option A) shipped:** honest Cage Mode + screen-aware voice "record". Diagnosed three separate problems (not 9B regressions): (a) `/api/cage/check-bullseye` and `/api/cage/analyze` 404 because the endpoints were never built — `services/cageApi.ts` header said *"backend lands in Prompt 2"* and Prompt 2 never landed; (b) `services/intents/mediaHandlers.ts` `normalizeKind()` defaulted to `'shot'` so voice "record" on Cage Mode hit `canCapture('shot')` and was refused for "not in a round"; (c) camera preview was always fine. Fix: deleted `checkBullseye` + `analyzeCageVideo` from `services/cageApi.ts` (kept `coachReview` → `/api/kevin/coach` which is deployed); collapsed Cage Mode phase machine to `SETUP → RECORDING → UPLOADING → RESULT | ERROR` (no fake CV gate); `stopRecordingAndUpload` now awaits the local acoustic-impact detector + `/api/acoustic-detect` ball-speed inline and builds the `coachReview` features payload locally from real signals (`bullseye_offsets: []` because we don't have CV scoring and won't fake one); CameraView pinned to `mode="video"` always (kills the picture/video race); `subscribeCapture(['swing'])` phase guard loosened from `READY` to `SETUP` (the only pre-record phase that exists post-G); `normalizeKind()` is now screen-aware — `getActiveSurface() === 'drill_session'` forces `'swing'`. No mock-mode fabrication in production. OTA-able, no APK rebuild.
- **Consolidation 5 Part 2 shipped:** surfaced the Mark Green capture loop on no-geometry surfaces. The full-screen SmartFinder's `MapView` fallback now renders a green "Mark this green for live yardages" pill below the geometry message; the embedded `SmartFinderCard` on Caddie home shows the same CTA inline (with stop-propagation so the outer card-tap still routes to `/smartfinder`). Both route to `/mark-green`. Pre-change architectural verification confirmed all three correctness invariants Tim required already held: live yardage after marking is `haversineYards(fix.location, …)` against the resolved override (NOT step-subtraction from tee — dogleg-safe; [smartFinderService.ts:336-338, 377-379](../services/smartFinderService.ts#L336-L338)), overrides persist across rounds via AsyncStorage `smartplay.courseGreenOverrides.v1`, and re-mark overwrites with a fresh `getOneShotFix({ maxAgeMs: 0 })` ([mark-green.tsx:106](../app/mark-green.tsx#L106)). Zero changes to the service layer — only UI surfacing. Trip-ready for Maplewood + Pembroke Pines next weekend.
- **Consolidation 5 Part 1 shipped:** SmartFinder honest fallback labeling. `staticYardages()` now returns `reason: 'no_geometry'` (was `'ok'`); DistanceCard + SmartFinderCard render a "SCORECARD" pill + `~` prefix + downgraded GPS dot + "CARD TOTAL" label when the middle value is the scorecard tee→green total instead of a live GPS read. SmartFinder full-screen message differentiates "Scorecard distance — no live GPS green for this course" vs "Green coordinates unavailable." Zero change on courses with real green geometry. Caddie's `fmb` memo threads `reason` through. Same no-fake-precision principle as Phase 418.
- **Consolidation 4 shipped:** `console.log` noise audit. 432 actual calls (audit said 355); ~95% were tagged diagnostics or catch-block error surfaces (Tim's KEEP categories). Created `services/devLog.ts` and gated 18 routine flow traces (filler lifecycle, bgLocation lifecycle, transcript dump, etc.) through it — silent in production via `__DEV__` DCE. 414 intentional diagnostics retained.
- **Consolidation 3 verdict:** the Phase 420 routes-audit "14 orphan routes" claim was wrong — re-grepped with broader patterns (template literals, `pathname:` object form, cold-install redirects), found ALL 14 are reached. Zero deletes. Tightened the central `DEBUG_ROUTES` gate by adding three owner-only surfaces (`/author/reference-assets`, `/landmark-curate`, `/owner-logs`) for defense-in-depth.
- **Consolidation 2b shipped:** deleted `services/modeSelector.ts` + `services/roles/*` (4 files, orphan-island Trust-Spectrum scaffold with no consumers; resurrect from git when register-shifting is actually spec'd). Cleaned dangling `trustLevelStore.ts` header comment. Kept `services/watchService.ts` as the documented native-SDK hook site for the post-sprint EAS watch build. Logged SmartMotion skeleton-stub honesty note: live overlay renders fixed placeholder positions, NOT real MoveNet tracking — do not present as tracked swing until the post-sprint TFJS/MoveNet native build lands.
- **Consolidation 2 shipped:** dead-code removal pass — **2,313 LOC deleted across 29 files**. Batch 1: 12 Expo-starter leftovers (closed-graph). Batch 2: 8 orphan scaffolds incl. the pose pair (verified the live `StubSkeletonOverlay` in smartmotion.tsx uses local constants, NOT the deleted `poseInference.ts`). Batch 3: 8 deprecated components (Phase AT/111/405 consumers removed). Batch 4 deferred for Tim's decision: `services/modeSelector.ts` + `services/roles/*` is a closed orphan island Trust Spectrum doesn't currently consume — delete or keep? `services/watchService.ts` also zero consumers (the only reference was a comment from Fix F) — kept as the documented SDK hook site, but delete-now-resurrect-from-git is on the table. `expo-image` dropped from package.json + lockfile.
- **Consolidation 1 shipped:** three single-source-of-truth merges. Haversine — 5 impls → 1 canonical in `utils/geoDistance.ts` (all 4 re-impls were mathematically identical; cleanly replaced with imports). Voice tuning — `ELEVEN_VOICES_BY_PERSONA` + `ELEVEN_SETTINGS_BY_PERSONA` extracted to new `api/_voiceTuning.ts`; both `api/voice.ts` and `api/kevin.ts` import. Watch state — `watchConnected` removed from `settingsStore`; all four consumers (cage/index, settings, cage-mode, cage/summary) now read from `watchStore.isConnected`. Sprint Map P1-4 / P1-5 / P1-6 closed.
- **Fix F diagnosis:** Galaxy Watch IMU in Cage Mode is unbuilt, not broken. `services/watchService.ts` is scaffold + math + `simulateSwing()` test helper; zero production writers to `useWatchStore`. Cage Mode UI is correctly defensive (Watch Metrics card hidden when `watchSwing` null) so no fake-data UI exists today. Real Watch IMU needs native-module wiring via EAS Build using the beta wearables SDK Tim now has access to — pending the next APK, not OTA-able. Honest header comment updated in `cage-mode.tsx`; no runtime UI change.
- **Skeleton topology rewrite shipped:** stub skeleton now renders an explicit bone-edge list (12 bones + 13 joints in MoveNet-17 order), head as a scaled circle node on a neck line, wrists as visible joint dots. Kills the previous shared-apex topology (kite legs + triangle head). All sizes scale from `videoRect` — no hardcoded pixels. When real MoveNet keypoints land, the same edge list and joint indices apply.
- **Fix E shipped:** Spanish/Chinese now actually applied to caddie TTS. `/api/kevin` was hardcoding `eleven_turbo_v2` (English-only ElevenLabs model) regardless of language — text came back Spanish, audio came back English-pronunciation. Now mirrors /api/voice's `language === 'en' ? 'eleven_turbo_v2' : 'eleven_multilingual_v2'`. Also threaded language into `/api/swing-analysis` so SmartMotion's observation text comes back in Spanish too. Cage-coach endpoint deferred — same fix later, lower priority.
- **Fix B shipped:** SmartMotion angle (down-the-line / face-on) is chosen BEFORE recording. Pre-record picker in `NoClipHero`; quick-record carries the choice forward + back via URL param; `analyzeSwing` passes it to the server; the analyst's prompt uses it to read the right biomechanical patterns. Voice "record me down the line" / "record me face on" sets the angle AND auto-starts recording in one command. Default flipped from face-on to down-the-line.
- **Current focus:** Audit-and-infrastructure day. Phase 420 audit and Phase 421 save-point system landed. No app code changes today beyond the morning's persona TTS + Tools FAB + Phase 418 validation gate.
- **Full prioritized plan:** [docs/audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md)
- **Daily running log:** [docs/SPRINT-LOG.md](SPRINT-LOG.md)
- **Audit evidence (12 docs):** `docs/audit-420-*.md`

---

## What's done and verified

> As of Day 5 (2026-05-24): **[BUILD-STATE-AUDIT.md](../BUILD-STATE-AUDIT.md) is the canonical inventory.** Section A = verified, Section B = shipped-unverified (each with explicit gates), Section C = 1.0 blockers, Section D = future. The lists below are kept for historical continuity but the audit doc has the strict bar.

**Code on `main`, server-side will deploy via Vercel automatically:**
- Phase 416 SmartMotion two-card system + cleanup
- Persona-aware Kevin TTS — `/api/kevin.ts` no longer hardcodes Kevin's voice for every persona
- Tools FAB layout — small right-side chevron expanding left
- Phase 418 SmartMotion validation gate — `services/swingValidity.ts` + server `valid_swing` field + UI gating
- Phase 420 audit (12 docs)
- Phase 421 sprint infrastructure (this set)
- **Day 1 / Fix 1 — End Round crash fixed** ([app/recap/[round_id].tsx:172](../app/recap/[round_id].tsx#L172)) — Zustand selector `roundPhotos` returned a fresh `[]` per render via inline `?? []` fallback. Stabilized via module-level `EMPTY_PHOTOS` constant.

**Verified clean by audits (do not touch — see Sprint Map "VERIFIED CLEAN"):**
- TypeScript strict, zero errors, zero suppressions
- `expo-doctor` 17/17 checks pass
- `BrandHeaderRow` + ••• Tools-pill pattern consistent across all 5 tabs
- Persona definition single-sourced in `lib/persona.ts`
- App entry hydration gate in `app/index.tsx`

**Not verified on device:** ALL of the above. The recurring problem across the audit is that every recent phase ("Phase 410 / 415 / 416 / 418 / persona TTS fix") is "git-diff verified" only. Empirical Z Fold verification is the sprint-end gate.

---

## What's actively in progress

> ### ⚠️ CURRENT — 2026-09-13. CLOSED OUT. On main, seven OTAs out, nothing open.
>
> **ALL FOUR COACHES NOW HAVE EVIDENCE.** That was the point of the whole sweep. caddie (course read
> against his game) · swing coach (`measuredSwingBlock`) · mental coach (`mentalPatternBlock`) ·
> training (`trainingImpactBlock`, `6d35448`). Each is computed by ONE owner that also feeds the
> dashboard card, so the chart and the caddie cannot disagree, and each is SILENT until there is
> enough to be honest.
>
> **THEY ARE NO LONGER SILENT EARLY — `f196c48`, and this was the last thing Tim corrected tonight.**
> Every block returned `null` below its gate. The gates are honest; `null` is not, because the floor
> is invisible from outside and a coach who goes quiet on a straight question reads as BROKEN rather
> than careful. Tim: *"a new golf coach giving a first lesson lets the player swing — let me let you
> swing so I can get a sense of it. We don't wanna just fall silent. That is an unnatural response."*
>
> Each floor is EXPORTED now (`PRACTICE_FLOOR`, `TRAINING_FLOOR`, `MENTAL_FLOOR`,
> `SWING_TREND_FLOOR`) so the block names the real number instead of hardcoding one that drifts, and
> below the floor each says what is in the books and what would make the comparison real. The
> first-lesson case is the one that mattered: with no captured swings the caddie now ASKS TO WATCH
> HIM HIT A FEW instead of having no opinion and no explanation. One session is called a reading,
> never a trend.
>
> **The rule that stops it nagging is in the prompt** (`NEVER GO SILENT ON A MEASURE YOU ARE
> KEEPING`): answer the question first from what you DO have, let the not-yet be the second half of
> the sentence, only when asked, once per conversation, never as a limitation or a feature pitch.
>
> **Four tests asserted `toBeNull()`** — written hours earlier, the same day. Updated, not deleted:
> the invariant they protect (no grade, no direction, no trend from below the floor) is now asserted
> through the new behaviour. A red test can hold the right intent while the code moves under it.
>
> The thresholds below still apply — they are now what the caddie SAYS, not what makes him quiet.

> **(superseded) THEY ARE SUPPOSED TO BE SILENT EARLY, AND THAT LOOKS LIKE A BUG.** Ask about practice with two
> rounds logged and the caddie says nothing. Thresholds, inside 6 weeks, REAL rounds only:
> practice→score 3 sessions + 4 rounds · training→score 3 workouts + 4 rounds · measured swing 4 weeks
> with graded swings · mental pattern 3 rounds carrying reports + 6 moments. This is now an owner
> checklist item (`four-coaches-can-speak`) so the first device test does not read as a false negative.
>
> **Two mechanical interconnectedness sweeps came back CLEAN** — worth recording, because clean was
> not obvious. All 106 payload keys are read in `api/kevin.ts`; all 25 `capOrNull` locals are
> interpolated (none parsed then dropped). Nine UI_TOOLS *looked* unhandled in the Caddie-tab
> dispatcher: its `default:` DELEGATES to the shared one (the 08-17 fix) and the sim already guards
> that. **A case-only parity check reports nine false defects — do not write one.**
>
> **STILL CARRIED, deliberately:** `workoutSwingImpact` (training → STRIKE). Its session mapping —
> per-shot contact grading + the self-only filter — lives inline in the dashboard, so wiring it from
> the payload builder means a SECOND owner of "which swings are graded". It needs the `selfSwingReads`
> treatment first: extract, then both read it. A test asserts the copy has not been made. Also still
> screen-only: `pointsPerformance`, `preRoundFactors`, `handicapCalculator`.

> ### 2026-09-13 (earlier). CLOSED OUT. Everything on main, five OTAs out, nothing open.
>
> **THE DEFECT CLASS, IN TIM'S WORDS, BECAUSE A PREVIOUS SESSION GOT THIS WRONG.** The explanation
> that there are many bugs "because you're one developer using one AI" is untrue and misses the point.
> These were **not untested surfaces.** They were repeatedly tested surfaces, and things he had asked
> for — "probably minimum ten times", "the fiftieth time I've worked on this" — and it is in the
> transcripts and the docs. Every finding in this sweep was ONE shape: a capability built, measured
> and persisted, with nothing connecting it to the CONVERSATION. practiceImpact (dashboard-only since
> 06-14), swingMetricTrend (dashboard-only), the emotional log (persisted fifty rounds, read by
> nothing at all), GIR and longest drive (on screens he looks at, while the caddie said "you're not in
> a round yet"), courseDownloadEngine (fetched and cached, never listed).
>
> **The tests passed the whole time, because they tested the halves that worked.** So "what is
> untested?" is the wrong question here. The right one is **"what does this app already know that the
> caddie cannot reach?"** — and the fix is almost never to build something. It is to wire a half that
> already exists. This is the day-one concept (swing coach · caddie · mental coach · fitness — knowing
> the player, building the player), not a backlog.
>
> **Adversarial pass, `c54ae6b` — four defects, three of them introduced the same day.** Three
> misroutes in the lead detector, found by PROBING it with real utterances rather than re-reading it
> ("read this green" → course coach; "I'm so angry I topped it again" → swing coach, against
> mentalGameBlock's acknowledge-first rule; "what do you know about shadow creek", his own day-one
> example, → no lead). Two prompt rules written hours apart that contradicted each other. And a spec
> that asserted both "ball speed is never shown at any confidence" and "ball speed comes off the
> never-list" — fourteen minutes apart — which is how a defect gets reintroduced next week by someone
> reading a doc as instruction.
>
> **Last night's cage work reintroduced nothing into SmartMotion** (checked on Tim's ask): the
> contentious ball-speed commits were DOCS ONLY; the report-your-shot tap is withheld in the rig
> (`effectiveMode === 'sim'`, which IS the cage since the 09-01 unification) and offered on the range
> where the player is the only sensor; `verifyTarget` PROVES a bullseye geometrically instead of
> thresholding a confidence label, and fails closed.
>
> **Ball speed IS wired into SmartMotion from the acoustic detector** — `swingMetricsService`'s comment
> saying no caller passed it was stale, and I repeated it as fact before checking. What keeps it honest
> is not absence but three guards, now PINNED by a test instead of resting on prose: acoustic-detect
> returns null rather than faking a calibration for an unknown club; `'acoustic'` is not in
> `TRUTH_GRADE_SOURCES`, so smash can never reach its 0.85 branch; confidence ceilings at 0.65.
>
> Gates at close: **tsc 0 · jest 4359/4359 across 370 suites · sim 1023/1023.** Lint is 76 errors / 75
> warnings, IDENTICAL to where main started — pre-existing i18n debt, none added. Control-character
> sweep across all source: clean. **Nothing is device-verified.**

> ### 2026-09-13 (earlier). ON MAIN, AND SHIPPED BY OTA.
>
> The branch work below was merged to `main` (fast-forward) and **three OTAs went out, production and
> preview each time, runtimeVersion 1.0.0**. Nothing native moved in any of them, so neither store
> submission is affected. **Nothing is device-verified.**
>
> - `d855974` — the Play tab half of `download_course`. The fetch worked; nothing LISTED the result,
>   so a course pulled in for a future trip was cached, ready and unreachable. `downloaded` was
>   rendered nowhere and `recentCourseIds` only fills at round START.
>   `downloadedCourseSummaries` owns it; the `place:` alias filter is now load-bearing.
> - `da8a51a` — **the MENTAL leg, which had no evidence at all.** `mentalGameBlock()` told the caddie
>   he was an always-on sports psychologist and handed him the current round's last five reports;
>   `endRound` empties that, so off the course he had nothing, while every report from the last fifty
>   rounds sat in `roundHistory` read by nobody — not even a screen. `services/mentalPatterns` owns
>   it, sparse by construction and says so in its own text. **And the join (Tim: "all those coaches
>   have to work together"):** three measured blocks were in the prompt with nothing saying they
>   describe the same man. `YOU ARE ONE PANEL` names the joins — practice up + scoring flat + a metric
>   going the wrong way means he is practising the wrong thing; readings in-band + scoring worse means
>   do NOT hand him a swing change.
> - `9c38fe6` — **the topic picks the lead** (Tim: "the topic will determine what coach is prevalent…
>   we never want slower response that feels unnatural"). `leadCoachFor` is a LOCAL regex; the verdict
>   rides the MESSAGE side, the doctrine stays cached. No classify round-trip and no model downgrade —
>   `aiTier` stays `'quality'`. The speed comes from a shorter answer, not a cheaper model. **Do not
>   "optimise" this by making the cached blocks topic-dependent: that re-breaks the 08-24 cache fix.**
> - Same commit — **a regex that held BACKSPACE bytes instead of word boundaries.** `LOFT_CUE` in
>   `api/_brain.ts` had five raw 0x08 where `\b` was meant, passed straight through by `String.raw`,
>   so `extractAdvisedClub` returned null for every loft-named club ("your 60", "the 56", "your 52
>   degree"). That is the exact-club attribution that trains the bag (08-09). The CLIENT copy was
>   clean — this was a corrupted second owner of the same rule. Repo-wide sweep: this file only, now
>   gated by a control-character assertion over the whole file.
>
> - `67bac32` — **THE OFF-ROUND DEFLECTION IS CLOSED, and the reason it stayed open was a wrong claim
>   in this very document.** It said the caddie had NO source for GIR or longest-drive history. Tim:
>   *"Longest drive is on the dashboard and GIR is calculated on the scorecard."* He was right. GIR
>   derives from score − putts against par — values `compactHistoryForPersist` explicitly KEEPS — and
>   longest drive is a `playerProfileStore` field `logShot` maintains, which is what the dashboard
>   highlights card shows. `putt_stats`, `gir`, `nine_split` and `longest_drive` now answer off the
>   course, naming WHICH round they read (an unsubjected "11 of 18" sounds like today) and using the
>   round's OWN stored `holePars`. `last_round_here` routes to the brain, because off-round the course
>   he means is in the conversation, not in `activeCourseId`. Formulas live in
>   `services/round/scoredRoundStats`, read by the live handlers, the off-round path AND the dashboard
>   — the 500-yard corrupt-capture cap moved there too.
>
> **DO NOT TRUST A NEGATIVE CAPABILITY CLAIM IN THIS FILE WITHOUT GREPPING FOR IT.** "Nothing reads
> X", "there is no source for Y" — two of those have now been wrong in two days (Cowork's "nothing
> reads the media library", and this file's "no source for GIR"). A claim that something does not
> exist is the easiest kind to write and the most expensive to inherit.
>
> **STILL OPEN:** the five screen-only modules — `practice/workoutPerformance`,
> `practice/workoutSwingImpact`, `practice/pointsPerformance`, `practice/preRoundFactors` and
> `handicapCalculator`. Each is a measured finding about the player whose only importer is a screen,
> which is the same shape as everything fixed above.

> ### ⚠️ CURRENT — 2026-09-13. On a branch, not on main.
>
> **Branch: `claude/dashboard-practice-score-trends-5i4bxh`** — two commits, both pushed, working
> tree clean. `main` does NOT have this work.
>
> ```
> git fetch origin && git checkout claude/dashboard-practice-score-trends-5i4bxh
> ```
>
> - `2258d1e` — the practice→score crossing reaches the caddie; three voice-precheck fixes beside it
>   (a club question without "my" was answered with the distance to the green; "my rangefinder says
>   205" opened a screen and dropped the number; the 09-11 loft fix had never fired).
> - `f0bd3bd` — the swing behind the feel (`measuredSwingBlock` + the FEEL IS EVIDENCE prompt rule +
>   shared `selfSwingReads`), and a course you have not played (`download_course` tool → the existing
>   `courseDownloadEngine`, plus the course-read-against-your-game prompt rule).
>
> - `d855974` — **the Play tab half of `download_course`, which was missing.** The fetch worked and
>   `getCourse` is cache-first, so a pulled-in course really does open offline — but nothing LISTED
>   it. `downloaded` was rendered nowhere (the engine's comment relied on that), and
>   `recentCourseIds` is written at round START, so a course fetched for an upcoming trip was in no
>   list and the only route to it was a network-only search. Cached, ready, unreachable — while the
>   prompt promised "ready and offline when you go". `downloadedCourseSummaries` is the one owner of
>   which downloaded courses are listable; the Play tab folds them in beside bundled/custom/recent,
>   deduped, with the `place:` alias rows filtered (that filter is now load-bearing — see the
>   corrected comment on `rememberAlias`) and no fetch at mount.
>
> Green: tsc 0, jest 4279/4279 (366 suites), sim 1023/1023. **Nothing verified on device.**
> Three OTA-eligible prompt changes are in here, so a device pass is the gate before any is trusted.
>
> **`lint` IS NOT GREEN AND WAS NOT GREEN BEFORE THIS BRANCH.** `npx expo lint` reports 76 errors /
> 75 warnings, all `i18n/no-hardcoded-jsx-text` — and `origin/main` reports the IDENTICAL 76/75.
> Earlier entries here claiming "lint clean" are wrong about main as well; no commit on this branch
> added one. One of the five standing gates has effectively been off.
> [[a-gate-that-cannot-run-is-not-a-gate-that-passes]]
>
> **The download_course gate asserts SOURCE TEXT only** (`readFileSync` + `toMatch`, zero execution)
> — the same shape as the 09-11 "the 60 is a club" gate that certified a fix which had never once
> fired. `a-fetched-course-reaches-the-play-tab.test.ts` is behavioural and break-tested in two
> layers; the `a-course-he-is-thinking-about` gate still is not.
>
> **THE LENS these were found through (Tim, 2026-09-13):** *"This is a day one concept… where the
> sports coach, swing coach, caddy, mental game coach concept originally came from — to be able to
> TALK to them. Sometimes it's not about opening up practice or play."* Read every finding as: is
> this thing the app measures reachable from a CONVERSATION, or only from a screen? Three sweeps in,
> the answer has been "only from a screen" every single time, and the fix has never been to build
> anything — it has been to wire a half that already existed.

<details>
<summary>Older in-progress notes (Day 5, 2026-05-24) — kept for history</summary>


**Day 5 close (2026-05-24):**
- ~40 OTA-eligible items shipped + verified TS-clean + bundled OTA. Update group history: `ac5045ea` (voice spine extensions) → `ab644d16` (voice→cage + auto-coach) → `dcf96941` (Tank rules + practice store) → `23197688` (AsyncStorage dump panel). All on preview channel.
- BUILD-STATE-AUDIT.md committed and pushed (`d97c22e`). Surfaces the verification debt as the dominant 1.0 gap.
- BT media-button native module sitting on worktree `feat/bt-media-button` @ `7504099`. Awaits an EAS Build cut.

**What Day 6+ should do — verification, not more code:**
1. **Cart round at Menifee** covering H12–H17 (the H14→H15 regression case from `holeDetection.ts:36-46`). Verifies the hardened gates + tee geofence + truth resolver + GPS Flow C in one pass. Per memory rule: cart is the default, walker-only / harness-only verification is insufficient.
2. **Real swing capture** in Cage Mode → confirm BUG #1 fix (full motion described, not just setup) + acoustic ball speed + metric ranges + auto-speak observation.
3. **Spanish utterance test** ("¿cuántas yardas?") → confirm Spanish text emitted AND spoken via `eleven_multilingual_v2` (not English-accented monolingual).
4. **AsyncStorage dump panel** verification at `/cage-debug` → confirms practice-store accumulates from real swings.
5. **CourseTruth survey** on Menifee Lakes → walk-to-green + "I'm Here" snap on each hole → confirm truth wins over courseHoles via `side_effects: green_source:truth`.

**1.0 blockers from the audit (not yet addressed):**
- Stripe / RevenueCat real billing wiring (only paywallGuard stub today)
- TestFlight + Play Store submission
- Putt-analysis prompt parity + layman_explanation (parallel of BUG #1 fix not yet ported)
- Calibration profile consumer wiring (`playerCalibrationStore` writes, nothing reads)
- Cloud backup of swing library + videos (data-loss-on-uninstall protection)
- EAS Build cut to ship the BT worktree

</details>

---

## What's next (P0 queue from the Sprint Map)

> ### ⚠️ NEXT UP — 2026-09-13, in recommended order
>
> 1. **The off-round deflection.** `services/intents/queryStatusHandler.ts` (the `!round.isRoundActive`
>    gate, ~L105) answers *"You're not in a round yet. Want to start one?"* to `putt_stats`, `gir`,
>    `nine_split`, `last_round_here`, `longest_drive`. Those are CONVERSATIONS, not round queries —
>    the exact thing the lens above is about, and the last surface still actively refusing one.
>    **Needs a per-topic decision from Tim, not a blanket `route_to_brain`:** the caddie can already
>    answer putting (`golfer_model_snippet` carries avg putts/hole), but he has no source for
>    longest-drive or GIR history, and routing those to him invites an invented number. The
>    `route_to_brain: true` mechanism already exists in that same file (L359, L381, L1398).
> 2. **The mental-game leg.** `mentalState`, `emotionalLog` and `mentalGameBlock` all exist and none
>    were audited against the lens this session. It is the untested third of the four-coach concept.
> 3. **Still screen-only, same class as everything fixed above** — each is a measured finding about
>    the player whose only importer is a screen: `practice/workoutPerformance`,
>    `practice/workoutSwingImpact`, `practice/pointsPerformance`, `practice/preRoundFactors`
>    (the warm-up HALF reaches the caddie via `caddieDecision`; the balls/stretch/both/neither split
>    does not), and `handicapCalculator` (has an intent handler, so "what's my handicap" is answered
>    locally and never as conversation).
> 4. **Device verification** of everything on the branch. Nothing here has been near a phone.
>
> **Closed 2026-09-14** (`9e341c5d`): the bag screen (scan persists, merges, photos, shaft/grip/ball),
> the unification of the physical club onto one record, the universal 14-club cap, and the green heat
> map's missing pars + the third copy of the GIR rule. All code-traced and gated; none on a device.

<details>
<summary>Older P0 queue (Sprint Map, Day 1) — kept for history</summary>

In dependency order — see [audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md) for evidence and file paths:

1. ~~**P0-1** — Fix `/arena/practice` 404.~~ **DONE Day 1 / Fix 2.** Card removed from SwingLab launcher; verified no remaining `/arena` references.
2. ~~**P0-2** — Verify `/swinglab/range` exists.~~ **CONFIRMED — file present at `app/swinglab/range.tsx`.** Earlier audit "likely missing" claim was wrong. Range Mode's Start Session was also rewired (Day 1 / Fix 2) to route only to the Swing Library (was going to `/cage/session`, one of the legacy capture surfaces).
3. **P0-3** — Collapse two SmartMotion UIs. `app/smartmotion-quick.tsx` (954 LOC, OLD) is still reachable from voice-intent (`services/intents/openToolHandler.ts:28-29`), Tools menu (`components/tools/GlobalToolsMenu.tsx:325`), and Library (`app/swinglab/library.tsx:256`). Repoint to canonical `app/swinglab/smartmotion.tsx` and delete. Effort: M.
4. ~~**P0-4** — Reproduce End-Round "Maximum update depth" crash on current bundle.~~ **DONE Day 1 / Fix 1.** Root cause: Zustand selector returning fresh `[]` per render. Fix on `main` in this session's commit. Empirical verification on Z Fold still required.
5. **P0-5** — Write `speaker_id: 'self'` default in 4 paths so multi-player migration doesn't need a data fixup later. Effort: M.
6. ~~**P0-7** — Gate debug routes for non-owners.~~ **DONE Day 1 / Fix 3.** Single central `usePathname()` watcher in `app/_layout.tsx` redirects non-owners away from 11 gated routes.
7. ~~**P1-3** — Collapse 3 GPS-fix caches to one.~~ **DONE Day 1 / Fix 4.** `gpsManager` is the single owner; smartFinderService and shotLocationService became thin readers. Sim, mark, and round-end write paths all flow through gpsManager. Stops the yardage-drift / 629,441y class of bugs at the source.
8. ~~**Day 1 / Fix 5** — Cockpit-mode SHOTS cell now ticks during the hole.~~ Was only watching `scores` (final hole map); harness shots never wrote that until completion. Now derives a running stroke count from `shots` mirroring the data-bar's STROKE calc.
9. ~~**Day 1 / Fix 7** — Hole-transition GPS refresh seam.~~ On `currentHole` change, force `gpsManager.getOneShotFix()` + `markTick++` so the `fmb` memo recomputes against the freshest fix instead of an up-to-one-sim-tick-old cache. Eliminates the 2-5y upward yardage bump Tim saw on transitions around holes 13/16/17. Symptoms 2 (caddie hole announcement on harness) and 3 (stroke ≤2 on synthetic round) confirmed expected harness behavior — left as-is.

Then P1 consolidation (5 swing-capture surfaces → 2; 5 haversines → 1; 3 GPS-fix caches → 1; etc.) and P2 polish.

</details>

---

## Hard constraints / standing decisions a new chat must know

- **(RETRACTED 2026-06-14 — was stale)** ~~Feature-complete. Nothing new gets added this sprint.~~ The 2026-06-08→14 session was overwhelmingly new-feature work (CNS, Smart Motion rebuild, Practice Engine, course book, points, offline caddie, on-device pose). Current mode: build new features in gated OTA increments + keep the audit/honesty/perf bar. See the 2026-06-08→14 reconciliation section in SPRINT-LOG.md and docs/TEST-MANUAL.md.
- **SwingLab and Practice are ONE feature.** Never duplicate components, routes, or services across them. Per audit they appear clean today — keep it that way.
- **Empirical verification on Z Fold is the bar.** Code on `main` is not "done." Every P0 / P1 item closes only after on-device confirmation.
- **The Pro app lives at `/Users/timothyg/smartplay`.** This is the canonical working directory for Claude Code sessions. (An older note referenced `~/Documents/smartplay` — that was stale and has been corrected.)
- **Push to main on completion.** Standing rule from `~/.claude/projects/.../memory/standing-rules.md`. Never `--no-verify`, never `--force` to main.
- **Beta wearables SDK is unblocked** (Galaxy Watch / Health Connect / Meta glasses). Native module changes require an EAS Build, not just OTA.
- **No Grok.** Hard rule. Reference memory entry `no-grok.md`.
- **`speak()` / `playLocalFile()` triggered at launch or by user tap MUST pass `{ userInitiated: true }`** or they go silent at L1.
- **Trust slider order:** use `TRUST_LEVEL_SLIDER_ORDER` (= `[1,5,2,3,4]`), never modulo on numeric value.

---

## End-of-sprint verification gate

Sprint isn't done until ALL of these are confirmed on a real Z Fold (from the Sprint Map):

- [ ] Cold launch → welcome → caddie tab — no flashes, no double-redirects
- [ ] SwingLab tab: every card reaches a real screen (no 404)
- [ ] SmartMotion validation gate suppresses fabrication on floor footage; real swing produces honest read
- [ ] Tools FAB expands left to icons; no fake giant pill
- [ ] Each of the 4 personas speaks in their own voice
- [ ] Round start → 18 holes simulated → End Round → recap — no "Maximum update depth" crash
- [ ] Debug routes return 404 / redirect for non-owner accounts
- [ ] APK build size unchanged or smaller than pre-sprint baseline (5.2 MB Hermes)
- [ ] SmartFinder camera-mode overlay lands the "your phone is your rangefinder" wow moment on Z Fold (pinch-zoom verified); GPS-quality indicator visibly downgrades on weak signal so the user never reads fake precision (same honesty principle as the SmartMotion 418 gate). Full positioning + accuracy framing in [SPRINT-LOG.md → Verification + Polish Backlog](SPRINT-LOG.md).

---

---

### LATEST (2026-06-21, Session 7) — Pre-influencer beta audit: all HIGH bugs fixed

**Just shipped — commits a0b54d7 + 5e493ce (pushed to preview + development + production OTA channels):**

- **HIGH-1** `api/kevin.ts`: `timeoutMs:8000` in `runAgenticLoop` (was unbounded → silent Vercel 504s). TTS client `timeout:10000, maxRetries:0`. Fast-tier `maxTokens` 200→300.
- **HIGH-3** `api/lie-analysis.ts`: Anthropic-only guard replaced — TightLie returned 500 when Gemini/OpenAI keys were present.
- **HIGH-5** `vercel.json`: `maxDuration` added for `lie-analysis` (60s), `image-edit` (60s), `putting-analysis` (60s), `course-geometry` (30s).
- **HIGH-6** `hooks/useVoiceCaddie.ts`: Unmount cleanup `useEffect` clears timers on voice nav-away.
- **HIGH-8** `app/_layout.tsx`: Trial lifecycle hydration guard (same pattern as migration+backfill effects above it).
- **HIGH-9** `app/(tabs)/caddie.tsx`: Auto-end round navigates to recap instead of stranding user.
- **HIGH-11** `api/putting-analysis.ts`: `maxRetries` 3→1 (3×25s exceeded 60s Vercel wall).
- **M13** `app/smartvision.tsx`: `onCuratedPhoto` and `playerCanvas.onCurated` now true when `golfbertHole.imageryUrl` is non-null — GPS projection was mis-applying to Golfbert photos, sending T/P markers off-screen.
- **SmartFinder scene read** `services/sceneReadService.ts`: Added `X-AI-Provider` header — scene reads always used Gemini regardless of toggle.

**SmartFinder audit result:** All clear. No broken connections, all 25 imports resolve, all API routes wired, 5 nav entry points correct.

**Still open:**
- M12: Canvas Tap + marker Pan double-fire `maybeTrackShot()` — low severity.
- M14: `calibrationSlug` derived from name not courseId — low severity.
- Phase 6: Migrate remaining 14 routes off Anthropic (ball-departure, cage-review, club-recognition, course-content, course-intelligence, cv-scoring, health, junior-swing-analysis, meta-voice, owner-triage, space-scan, tutorial-analysis, kevin+api, meta-voice+api), then remove `@anthropic-ai/sdk`.
- Path 2 + Path 4 MIN VERIFY on real Z Fold round.

**Last refreshed:** 2026-06-22 Session 8 — Phase 5 Anthropic vision-route removal complete (all 6 routes). Phase 6 needs remaining 14 routes first.

---

### Session 6 — Anthropic removed from brain path

**Just shipped this session:**
- **Phase 4 — Anthropic fully removed from `api/kevin.ts` + `api/cage-coach.ts`.**
  - `api/_aiProvider.ts`: Added `runAgenticLoop()` — multi-round agentic loop with vision support for both OpenAI and Gemini. Full provider abstraction is now complete.
  - `api/cage-coach.ts`: Replaced Anthropic forced-tool-choice with `completeJSON()` + JSON schema in system prompt.
  - `api/kevin.ts`: Full migration — `TOOLS` → `AI_TOOLS` (input_schema→parameters), `classifyQuestion()` uses `completeText()`, removed `openaiTextFallback()`, warmup uses `completeText()`, tier renamed `'TACTICAL'/'CONVERSATIONAL'` → `AiTier` (`'fast'/'quality'`), entire Anthropic agentic loop replaced with `runAgenticLoop()`, `_debug` telemetry cleaned.
  - `CLAUDE.md` architecture invariants updated: "Kevin runs on OpenAI/Gemini, toggled via X-AI-Provider header. No Anthropic dependency in runtime path."
  - TypeScript: zero errors.

**What this fixes:** "Robot voice" bug root cause. Anthropic credit limits → brain fails → TTS gets empty string → silence that sounds like robot. Now brain always uses OpenAI or Gemini (owner-toggleable in settings). No more empty-string TTS path.

**What's next:**
1. **Phase 5** — Migrate vision routes off Anthropic: `lie-analysis`, `swing-analysis`, `swing-compare`, `swing-question`, `round-import`, `putting-analysis`.
2. **Phase 6** — Remove `@anthropic-ai/sdk` from `package.json`.
3. **PATH 4 VOICE checkpoint** — Verify mic tap → intent → Kevin response works on both providers.
4. Z Fold device round verification (Path 2 + Path 4).

**Last refreshed:** 2026-06-21 Session 6 — Phase 4 Anthropic brain removal complete. Robot voice root cause addressed.
