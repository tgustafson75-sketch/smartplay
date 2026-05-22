# SmartPlay Caddie — Consolidation Sprint Log

**Sprint goal:** clean, consolidate, kill duplication, make it intuitive, prove it works on device. Target: app ready by June.
**Sprint start date:** 2026-05-20

The full sprint plan lives in [docs/audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md). This log is the running daily record. The short "where are we right now" pointer is [docs/SPRINT-RESUME.md](SPRINT-RESUME.md).

---

## Standing design principles

**These are permanent rules, not one-off decisions. Every diagnosis, fix, and verification touching the listed surfaces must apply them.**

### Cart is the default, not the exception (logged 2026-05-21)

~95% of golfers start in a cart. All GPS / hole-detection / round-flow logic must be designed for CART movement as the **primary** case and walking as the secondary case — not the other way around.

What "cart-default" means in practice:
- **Cart movement is faster** (typically 6-12 mph vs walking 2-4 mph). Sustained-position thresholds calibrated for a stationary walker on a tee miss the cart-rider's pre-shot stops (~5-15s) and incorrectly hold transitions.
- **Cart paths swing wide** of the tee-to-green line and routinely pass adjacent holes' tees and greens. A cart at 60 yards from the current green might be 30 yards from a different hole's tee — false-transition territory that a walker on the playing corridor never sees.
- **Cart stops aren't on the tee/green.** Carts park at the cart-path stop, walk to the ball, swing, walk back. Yardages and hole transitions must tolerate cart-path positions that diverge from the playing line by 20-50 yards.
- **Multi-course / interwoven facilities compound this.** Menifee Lakes + Palms share cart paths in places; a cart on Palms hole 9 passes within yards of Lakes hole 12. The cart-default rule + co-located course logic must work together.

**Verification rule:** any hole-detection / round-GPS / shot-detection change MUST be verified on a real cart round before being declared ready. A walker-only pass or harness-only pass is **insufficient**. This is a permanent test-bar item.

Relevant surfaces to apply this to: [services/holeDetection.ts](../services/holeDetection.ts), [services/shotDetectionService.ts](../services/shotDetectionService.ts) (already has a cartMode config), [services/gpsManager.ts](../services/gpsManager.ts) (mode evaluator), [services/walkingDetector.ts](../services/walkingDetector.ts), and the new co-located-course atCourse logic in [app/(tabs)/play.tsx](../app/(tabs)/play.tsx).

---

## Day 1 — 2026-05-20

### Shipped today (Day 1 / Fix 1 addendum)
- **End Round "Maximum update depth exceeded" crash — FIXED** ([app/recap/[round_id].tsx:172](../app/recap/[round_id].tsx#L172)). Root cause: the `useRoundStore` selector for `roundPhotos` used an inline `?? []` fallback. When `round_photos` was `undefined` (every round without photos — Tim's synthetic rounds in particular), the selector returned a FRESH `[]` literal each evaluation. Zustand's `useSyncExternalStore` saw the new reference as a snapshot change, re-rendered, re-ran the selector, got yet another fresh `[]`, looped forever → crash. Fix: extracted `const EMPTY_PHOTOS: RoundPhoto[] = []` at module scope and use it as the fallback so the reference is stable. Same pattern Tim already fixed in `components/dev/GpsQualityOverlay.tsx` (2026-05-16 — see in-file comment there).

## Day 2 — 2026-05-21

### Fix P — Voice score-telling vs question disambiguation (classifier gap, not handler bug)

**Discovery turned up another silent-contract gap** (same shape as Fix O): the `logScoreHandler` was fully implemented and registered in `services/intents/index.ts:36` — solid stroke parsing (digits + word forms 1-12), hole parsing (explicit "on hole N" + current-hole fallback), confirms with score-vs-par label ("Got it — 4 (par)"). Wired the same canonical `round.logScore` write path Fix O's cockpit + scorecard use. **But voice never reached it**, because `log_score` was completely absent from the `api/voice-intent.ts` classifier prompt — not in the numbered intent list, not in the JSON schema union at line 242. The Haiku classifier model can't emit an intent_type it hasn't been told exists. "I got a 4 on hole 1" → classified as `unknown` → triggered the "are you asking or telling?" clarifier (the default unknown-branch behavior in `listeningSession.ts`).

**Shipped:**

1. **[api/voice-intent.ts](../api/voice-intent.ts)** — added a full `log_score` intent definition (numbered #21, placed adjacent to log_shot #16 for cohesion). Covers natural score-telling phrasings:
   - Numeric: "I got a 4", "took a 5", "made a five", "I shot a 7", "I had a five", "score me 6", "put me down for 4", "carded a 6"
   - Par-relative: "made par", "I bogeyed", "I birdied 7", "eagle", "double bogey", "triple", "I doubled"
   - Hole disambiguation rules baked into the prompt:
     - Number-only → strokes (current hole assumed)
     - "N on hole M" → strokes=N, hole_number=M
     - Score-name + number ("I bogeyed 7", "birdie on 7") → the number is the HOLE, the name is the strokes
     - Score-name alone → strokes is the name, hole_number omitted
   - Explicit DO-NOT-MATCH guards against strategy questions ("what should I hit", "how far") and mid-hole shot logs ("I hit driver 240 left").
   - Added `"log_score"` to the JSON shape union at line 242 so the classifier is actually permitted to emit it.

2. **[services/intents/logScoreHandler.ts](../services/intents/logScoreHandler.ts)** — added `parseScoreName(raw, par)` for par-relative resolution. Handles classifier's canonical tokens (`"par"`, `"bogey"`, `"birdie"`, `"eagle"`, `"double_bogey"`, `"triple_bogey"`) AND loose verbatim matches ("made par", "I bogeyed", "double bogey", "triple", "tripled"). Order-sensitive (longer phrases first so "double bogey" doesn't mismatch on inner "bogey"). Clamped to the existing 1..12 valid range.
   - Reordered the handler's execute path to look up par BEFORE parsing strokes (par-relative names need par to resolve). Numeric parsing still runs first; falls through to par-relative parsing on null.
   - Same canonical write path: `round.logScore(hole, strokes)`. Same confirmation: `"Got it — 4 (par)"` (or `"Got it, hole 7 — 5 (bogey)"` when not the current hole). Caddie persona voice applies via the existing listeningSession TTS path.

3. **Zero parallel scoring logic.** Single source of truth: voice "I got a 4" → classifier emits `log_score` → handler resolves strokes via numeric or par-relative parsing → `round.logScore(hole, strokes)` — the exact same store action the cockpit stepper (Fix O), scorecard row-tap save, and manual scoring flows all hit. Scores recorded via voice appear immediately in cockpit + scorecard with no extra plumbing.

**Verify (desk + harness — OTA-able):**
- "I got a 4 on hole 1" → logs strokes=4 on hole 1, caddie confirms "Got it, hole 1 — 4 (bogey)". No "are you asking or telling?"
- "I made par" → logs strokes=par for current hole, caddie confirms "Got it — 4 (par)" (or whatever par is).
- "I bogeyed" → logs par+1 for current hole.
- "Double bogey" → logs par+2.
- "I birdied 7" → logs par-1 on hole 7.
- "What should I hit here?" → still routes to brain (strategy), NOT a score log.
- "Score me" with no number → falls back to the original "How many strokes?" clarifier (one brief follow-up, not the broken ambiguity loop).
- Logged scores appear in cockpit + scorecard immediately (same Fix O canonical path).

**Build gates:** `tsc --noEmit` clean. OTA-able (no native changes; classifier deploys via Vercel on next push, handler ships via OTA).

**Pattern note:** Fix O (cockpit `setScore` vs `logScore` selector mismatch) and Fix P (classifier missing `log_score` intent) are the same class of silent contract bug — handler exists, write path canonical, but a layer above the handler doesn't know the intent exists or names it wrong. Worth grepping the rest of the intent registrations to see if any other handler is wired but not in the classifier prompt. Logged for a quick audit next session.

### Fix O — Hole nav + scoring resilience (cockpit scoring fix + DataStrip ◀/▶)

**Discovery before the fix changed:** the cockpit's StepperPair UI was fully wired and visible, but tapping the SHOTS/PUTTS +/- buttons did nothing on device. Root cause turned out to be a method-name mismatch — [CockpitCaddieScreen.tsx:105-110](../components/caddie/CockpitCaddieScreen.tsx#L105) was pulling `setScore` / `setPutts` from the store via `(s as unknown as {...}).setScore`, but the Pro store exposes those actions as `logScore` / `logPutts` ([roundStore.ts:335-336, 1067, 1078](../store/roundStore.ts#L335)). The optional chaining `setScore?.(...)` then silently no-op'd every tap. No error, no warning, no log — just a button that didn't do anything. Same bug for PUTTS. The data path was completely correct; only the action getter was wrong.

**Shipped:**

1. **[components/caddie/CockpitCaddieScreen.tsx](../components/caddie/CockpitCaddieScreen.tsx)** — replaced the broken `setScore` / `setPutts` getters with `logScore` / `logPutts` (the canonical store actions the scorecard, voice intents, and harness all use). `handleStepperShots` and `handleStepperPutts` now call the real write path. Cockpit scoring works for the first time on device. Also passed `totalHoles={courseHoles.length || 18}` to StepperPair so 9-hole rounds cap the hole stepper at 9.

2. **[components/CaddieDataStrip.tsx](../components/CaddieDataStrip.tsx)** — added manual hole ◀/▶ nav around the HOLE cell value in BOTH layouts (horizontal portrait + grid Fold-open). Inner Pressables catch their own taps so the value text between them still expands the cockpit on tap (the existing affordance is preserved — nav arrows are additive). Calls `useRoundStore(setCurrentHole)` (the same canonical entry point as cockpit + scorecard + SmartFinder + voice intent + holeDetection auto-transitions). Chevrons disable + dim at boundaries (hole 1 / total). Haptic selectionAsync on each press, matching the cockpit pattern.

3. **Scorecard** — already had manual hole nav via row tap ([scorecard.tsx:294](../app/(tabs)/scorecard.tsx#L294)). No change needed; flagged for the verify list.

**Manual-override behavior verified, no change required.** [roundStore.ts setCurrentHole:1051-1055](../store/roundStore.ts#L1051) already calls `holeDetection.noteManualOverride()` on every manual hole set, and [holeDetection.ts tick:264](../services/holeDetection.ts#L264) honors `manualOverrideAt` for 20 seconds (`SUSTAINED_TRANSITION_MS * 2`). When the user corrects a wrong auto-transition from anywhere (cockpit stepper, scorecard row tap, new DataStrip arrows, SmartFinder picker, voice), auto-detection won't immediately yank them back.

**One canonical write path everywhere:**
- Hole set: `setCurrentHole(n)` in [store/roundStore.ts:1024](../store/roundStore.ts#L1024) — single function, called from every surface.
- Score set: `logScore(hole, n)` in [store/roundStore.ts:1067](../store/roundStore.ts#L1067) — same.
- Putts set: `logPutts(hole, n)` in [store/roundStore.ts:1078](../store/roundStore.ts#L1078) — same.

No parallel scoring or nav logic per surface. The cockpit, scorecard, and DataStrip all hit the same actions.

**Verify on device (desk + harness — OTA-able, no real round required):**
- Cockpit: tap SHOTS +/-, then PUTTS +/-. Values update + persist to scorecard. (Used to silent no-op.)
- DataStrip: tap ◀ / ▶ around HOLE. Current hole steps back/forward, 1..total capped. Cockpit + scorecard reflect the change instantly.
- Tap the value text (between the arrows) on DataStrip → cockpit still expands. Affordance preserved.
- Harness: simulate a wrong auto-transition; manually correct via cockpit OR scorecard OR DataStrip → the correction holds for 20s before auto-detection can re-fire.
- 9-hole round: hole stepper caps at 9 everywhere.

**Build gates:** `tsc --noEmit` clean. OTA-able (no native changes).

**Touched zero GPS / holeDetection logic** — Fix L territory stays untouched. This is purely the resilience layer.

### Field validation — Tank lesson with Nick Chertok, Prunridge GC, 2026-05-21 6:30 PM

Real Tank (the working golf instructor whose voice the app's Tank persona is built from) gave a live lesson to Nick Chertok at Prunridge GC tonight and used **SmartMotion** during the lesson. Nick is a golf influencer + investor with a large following + an investment angle. His reaction: *"amazing, wants to see everything."*

**What this validates:**
- SmartMotion is the most-proven surface in the app right now — real Sonnet vision analysis (Fix J confirmed real-and-specific, not generic), Phase 418 validity gate, the rebuilt skeleton topology, Fix C overlay-to-video-subrect alignment, Fix B pre-record camera-angle choice, Fix E Spanish/Chinese language threading. Nick saw the app at its best surface, and a sharp golf evaluator with reach signed off.
- The discipline that got us here — no fake skeleton overlays presented as tracked, no fake bullseye scores presented as detected, no fake live yardages on courses without geometry, no fake "I heard you" caddie silence — is the discipline that earned the "amazing" reaction. **Honest degradation is the product differentiator** when the evaluator is sharp enough to catch fake precision.

**What this raises the bar on:**
- "Wants to see everything" means the return look hits the **round path, Caddie, and Cage Mode** — exactly the surfaces where tonight's Menifee cart round exposed the open issues:
  - **Fix N — Start Round crash** (just shipped; needs EAS build + on-device verify)
  - **Fix L — Co-located course atCourse + hole-jumping** (diagnosis logged; fix deferred until a clean post-N Start Round confirms the GPS path)
  - **Fix L Symptom 3 — no caddie intro on tee-off** (per-hole "Hole N, par X, Y yards" intro doesn't exist; only round-start)
  - **Voice unification** — the listeningSession honest-fallback work (Fix I) shipped, but a sharp evaluator will probe the small-talk / round-conversation paths harder than the harness ever has
  - **[[cart-is-default]]** — Nick will almost certainly be in a cart on the return visit; the GPS / hole-detection / shot-detection lens must already be cart-first by then, per the standing principle
- A sharp golf evaluator spots fake precision instantly. The no-stubs / honest-degradation discipline matters **more** now, not less. Every "we'll fake it for the demo" temptation should land in the post-launch backlog instead.

**Implication for the current fix priority board:**
- The crash → nav/scoring resilience → voice unification ordering Tim already has is the right board for a returning sharp evaluator. Get those right BEFORE the next showing.
- If the next showing is imminent (days), urgency-now on N → L. If there's a week+, the sprint can land clean first.

**Open item to pin down via Tank:**
- What specifically does Nick want to see next? Round path on a real cart? Cage Mode in a real cage? Voice + caddie during play? Determines whether Fix N + Fix L are urgent-now or there's room to land the full sprint clean.
- Rough timing of the next showing — drives the EAS build cadence and what gets pulled forward from the post-launch backlog.

### Fix N (THE GATE) — crash-proof Start Round (POST_NOTIFICATIONS + graceful foreground service + collapsed GPS double-fire + Sentry DSN slot)

**Root cause established without a stack trace** (per Fix M diagnosis): Tim's Z Fold (One UI 6 / Android 14, targetSdk 35) hard-crashed on every Start Round. Strongest candidate — and the one the defensive fix addresses unconditionally — the foreground location service posts a persistent notification, but `POST_NOTIFICATIONS` was missing from the manifest. On Android 13+ the runtime permission is required; on Samsung One UI 6+, starting a foreground service that posts a notification without it throws a native `SecurityException` that bypasses JS try/catch → process kill. The round persisted because the Zustand `set()` + AsyncStorage flush completed before the crash; the foreground-service start fires in the post-persist async block.

**Shipped:**

1. **[app.json](../app.json) — `android.permission.POST_NOTIFICATIONS` added.** Manifest-side prerequisite for the runtime grant to be possible at all. EAS-build-only — NOT OTA-able.

2. **[services/backgroundLocationTask.ts](../services/backgroundLocationTask.ts)** — new `ensurePostNotificationsPermission()` helper. On Android 13+ (`Platform.Version >= 33`), calls `PermissionsAndroid.check` → `PermissionsAndroid.request` with a localized rationale string. On Android < 13 / iOS / non-Android: returns true. On any throw: returns false (treat as denied → skip foreground service). `startBackgroundLocation` now gates the `Location.startLocationUpdatesAsync` call on this probe: if denied, logs and returns WITHOUT calling the native function — round continues via foreground `watchPositionAsync` in `gpsManager`, only Doze coverage degrades. The actual `startLocationUpdatesAsync` is also wrapped in an inner try/catch so any other native throw (OEM-specific service refusal, future Android version type-mismatch) ALSO can't kill the round. **Three layers of defense:** permission-pre-check → inner try/catch around native call → outer try/catch around the whole function.

3. **[app/(tabs)/caddie.tsx:1387-1404](../app/(tabs)/caddie.tsx#L1387)** — collapsed the double-fire of `startGpsManager`. `runStartRound` used to launch a parallel `requestForegroundPermissionsAsync` → `startGpsManager` → `refreshFix` → `forceMarkPosition` block ~30ms after `roundStore.startRound`'s own orchestration block did the same thing. Two concurrent calls could pass the `if (subscription) return` check in `startGpsManager` and race the foreground-service registration. **Now:** caddie.tsx schedules ONLY the initial-fix sync (`refreshFix` + `forceMarkPosition`) after an 800ms wait for the canonical roundStore orchestration to land the GPS subscription. Single startGpsManager call site.

4. **[eas.json](../eas.json) — `EXPO_PUBLIC_SENTRY_DSN: ""` slot added to all three env blocks** (development / preview / production). When Tim sets a real DSN via EAS secrets or by replacing the empty string here, `Sentry.init()` at [_layout.tsx:64](../app/_layout.tsx#L64) starts capturing native crashes automatically — no more adb sessions needed. **`SENTRY_DISABLE_AUTO_UPLOAD: "true"` is intentionally KEPT** until Tim also has `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` configured (source-map upload requires all three; would otherwise fail the EAS build). Runtime crash capture works WITHOUT source-map upload — separate concern, can wire later.

**What Tim still needs to do for full Sentry coverage** (NOT blocking this fix):
- Create a Sentry project at sentry.io
- Add `EXPO_PUBLIC_SENTRY_DSN` value via EAS dashboard secrets (or replace the empty string in eas.json — secrets are cleaner)
- After confirming runtime capture works, set `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` as EAS secrets and remove `SENTRY_DISABLE_AUTO_UPLOAD` for readable stack traces

**Health Connect + task-manager paths** were left as-is — both are already defensive (Health Connect has an availability probe + try/catch chain, task-manager has a wrapping try/catch in `ensureTaskDefined`). The primary crash surface was the foreground-service notification — that's now blocked by the new permission gate even on rooted/custom-ROM devices where `PermissionsAndroid` itself throws.

**Verification path:** EAS build → install on Z Fold → tap Start Round. Expected: no crash, GPS engages via foreground watch (POST_NOTIFICATIONS prompt fires once on first round; whether Tim grants or denies, the round starts). When granted, foreground service runs and shows the persistent "SmartPlay tracking your round" notification. When denied, no notification, no foreground service, foreground watch only. NOT blocking ship — defensive fix is correct by construction; Sentry will self-report if a different native crash surfaces.

**Build gates:** `tsc --noEmit` clean. EAS rebuild required (manifest permission change) — not OTA-able.

**Hole-jumping (Fix L) re-evaluation deferred** until a clean crash-free Start Round is confirmed on device. The hole-jumping diagnosis stands (co-located atCourse picks Lakes when Tim plays Palms) but the half-init from the crash-and-reopen path also plays a role — both fixes need to land together for a real verification.

### Day 2 close — diagnoses run, open items, post-launch backlog

**Detailed per-fix entries are below** (Fix I → Fix H → Fix G → Consolidation 5 Part 2 → Consolidation 5 Part 1). This block captures the end-of-day work that didn't ship code: two no-code diagnoses (Fix J, Fix K), open items carried into Day 3, and the post-launch backlog that accumulated during today's "are we sure this isn't a bug?" passes.

#### Fix J (diagnosis only) — SmartMotion analysis is real and swing-specific, not generic

Tim's concern: SmartMotion gives nearly identical analysis on every swing — is the text analysis as fake as the known-stub skeleton overlay? Diagnosis below the read.

- **Real frames reach the model every call.** `extractKeyFrames()` ([services/poseDetection.ts:153-228](../services/poseDetection.ts#L153)) uses `expo-video-thumbnails` + `expo-image-manipulator` to extract 5 base64 JPEGs from the specific clip at fractions `[0.08, 0.40, 0.60, 0.75, 0.88]`. They're attached as Anthropic `image` content blocks to Sonnet 4-6 in [api/swing-analysis.ts:286-296](../api/swing-analysis.ts#L286). No mock, no thumbnail substitute, no single-still shortcut.
- **The system prompt is highly specific** ([api/swing-analysis.ts:133-187](../api/swing-analysis.ts#L133)): Phase 418 validity gate (no person → `valid_swing: false` → downstream-forced `detected_issue='none'`), 10-canonical-issue catalog, severity scale, confidence scale, `fault_frame_index` (frame the model picks as most diagnostic), `caddie_name` voice cadence per persona, `player_context` handicap-tier register, `dominant_miss` priority bias, camera-angle awareness (down-the-line vs face-on diagnoses different faults), per-language observation routing.
- **No client-side cache.** SmartMotion `useEffect` at [smartmotion.tsx:99-141](../app/swinglab/smartmotion.tsx#L99) keys on `[clipUri]`; each clip triggers a fresh call.
- **No stub feeding the analysis.** `STUB_SKELETON_JOINTS` is the visual overlay only ([smartmotion.tsx:1163](../app/swinglab/smartmotion.tsx#L1163)) — does not touch the analysis text path.
- **Tentative fallback can't masquerade as a real fault.** `analyzeSwingTentative` ([poseDetection.ts:384+](../services/poseDetection.ts#L384)) is forced to `detected_issue='none'`, `severity='none'`, `confidence='low'` ([api/swing-analysis.ts:364-369](../api/swing-analysis.ts#L364)). Tentative only fires from the upload-pipeline path, not from SmartMotion's direct call.
- **Verdict:** real-and-specific. Tim's "samey" reads = consistent swing + identical `player_context` + temperature-0.2 model on visually-similar 5-frame inputs → similar text by construction, not by fabrication. **One unconfirmed real-but-shallow path** to check on device: partial frame-extraction failure. Smoking-gun log: `adb logcat | grep "V6-DIAG.*STAGE 2"` and look at `successful: N` vs `attempted: 5`. If consistently 5 → close as not-a-bug. If <5 → real-but-shallow extraction fix worth doing.

#### Fix K (diagnosis only) — SmartMotion timeline showing "only 2 points" is almost certainly display formatting

Tim's concern: timeline pills only show ~2s and ~3s, not the expected 5 keyframes (0.08/0.40/0.60/0.75/0.88).

- **The timeline pills are "DETECTED MOMENTS"** on the swing-detail screen ([app/swinglab/swing/[swing_id].tsx:444-461](../app/swinglab/swing/%5Bswing_id%5D.tsx#L444)). Source: `shot.detected_issue_timestamps_sec`, persisted 1-to-1 from `r.frame_timestamps_sec` ([videoUpload.ts:299](../services/videoUpload.ts#L299), [cage/summary.tsx:126](../app/cage/summary.tsx#L126)) — no filtering. **One pill per extracted frame.**
- **Label format collapses sub-second spread.** Render code at line 455: `0:${Math.floor(ts).toString().padStart(2, '0')}`. On a 3-4 s clip the five fraction-spaced frames land at e.g. `0.24 / 1.20 / 1.80 / 2.25 / 2.64s` — `Math.floor` produces `0:00 0:01 0:01 0:02 0:02` → 5 pills, 3 visible labels. On a bounded multi-swing window of ~2s starting at 2s, timestamps cluster at `2.16 / 2.80 / 3.20 / 3.50 / 3.76` → 5 pills, **exactly 2 distinct labels: "0:02" and "0:03"** — matches Tim's report precisely.
- **By-design fraction clustering.** Three of the five fractions (`0.60 / 0.75 / 0.88`) target the downswing-to-impact window ([poseDetection.ts:100-108 comment](../services/poseDetection.ts#L100)); on a short clip they all fall in a 1-2 second range.
- **Verdict:** most likely (b) display-only collapse + (c) short-clip by-design clustering, both visible at 1-second floor precision. Five frames likely extract fine. **Definitive check is the same log as Fix J** (`STAGE 2 — extractKeyFrames done { successful: N }`) — if 5, closes both J and K as not-bugs.
- **Optional cosmetic polish (post-launch):** render labels at 0.1s precision (`(ts).toFixed(1)s`) instead of `0:${Math.floor}`. Visually distinguishes all 5 pills on short clips. No analysis change.

#### Open / carried into Day 3

- **On-device verify pending — Fix I caddie honest-fallback.** Force a failure (airplane mode mid-query, or a Spanish query during a slow Vercel cold start) and confirm the caddie SPEAKS the honest "having trouble" line + vibrates instead of going silent. This is the key tester-trust verification before the EAS tester build.
- **On-device check — frame-extraction log.** `adb logcat | grep "V6-DIAG.*STAGE 2"` while playing back a swing → look at `successful: N` per call. If consistently 5, close Fix J and Fix K as not-bugs. If <5, the partial-extraction path is a real-but-shallow fix worth a small Day 3 patch (likely improving `probeDurationMs` to use a finer staircase or just always use the bounded `ImageManipulator.getInfo` shape).
- **EAS tester build — not yet kicked.** Gated on the Fix I device-verify above.
- **Tonight (Day 2 → Day 3 bridge):** real round at Menifee — round path is solid post-Consolidation work; this is the real-world Doze pocket-test + cart-transition checks. Daughter capturing 5-angle hole photos (raw collection, labeled convention) in parallel.
- **This week before NH trip:** Maplewood + Pembroke Pines have no green geometry. Plan: use Consolidation 5 Part 2's surfaced "Mark this green" CTA to seed per-hole overrides during round 1. Persistence (via `courseGreenOverrides.ts` AsyncStorage) inherits across rounds — round 2 at Maplewood gets live yardages without re-marking.

#### Post-launch candidates logged today (NOT sprint scope, captured here so they don't get lost)

- **Cage Mode CV bullseye + dedicated `/api/cage/analyze` backend** — the unbuilt "Prompt 2" that Fix G dropped. Bullseye-aware scoring + multi-strike features.json would round out Cage Mode to its originally-spec'd six capabilities. Today: it ships honest with five real capabilities + framing guide.
- **Pose-analysis biomechanics enrichment** — needs `POSE_API_KEY` + `POSE_API_HOST` env vars in Vercel + an active RapidAPI subscription. Fix H Option B kept the client + endpoint trivially reversible; flipping the env vars on turns the Biomechanics card live.
- **Second-swing comparison feature in SmartMotion** — Fix J confirmed the analysis IS real and swing-specific, so a side-by-side comparison would surface genuine differences. Out of sprint scope per Tim's "no new features" rule; logged for post-launch.
- **Club-distance-aware synthetic round** (harness v2) — logged earlier in the sprint.
- **Real MoveNet pose tracking + Galaxy Watch IMU** — post-sprint EAS native module builds, gated on the beta wearables SDK access (per memory entry `beta-wearables-sdk-access.md`).
- **Cosmetic Fix K polish** — 0.1s-precision pill labels on the swing-detail "DETECTED MOMENTS" row. Trivial; bundled with any future swing-detail cleanup pass.

### Fix I (A + B + C) — Honest caddie failure handling + 30s Vercel headroom

**Diagnosis verdict before code change:** the on-device "caddie sometimes gives no response, especially in Spanish" report was **two separate problems**:

1. **`services/listeningSession.ts` swallowed every failure silently.** The earbud-tap / mic-badge caddie flow had three silent-drop branches: chat fallback non-2xx + null reply + fetch throw ([line 333-368](../services/listeningSession.ts#L333)), handler path falsy `voice_response` + handler throw ([line 375-459](../services/listeningSession.ts#L375)), and the in-round diagnostic Coach POST ([line 289-347](../services/listeningSession.ts#L289)). All logged to console and dropped the pill to idle — the user heard nothing. The `useVoiceCaddie` hook used by cockpit / full-mode round flow already does this correctly ([line 615-647](../hooks/useVoiceCaddie.ts#L615)) — the listeningSession path just never got the same treatment.
2. **`/api/kevin` had no Vercel `maxDuration` config** — Anthropic SDK timeout is 25s; Vercel Hobby default is 10s; Pro default is 60s. On Pro without explicit config a complex Sonnet conversational reply + multilingual TTS (Spanish via `eleven_multilingual_v2` is ~2-5s heavier than English `eleven_turbo_v2`) could cumulatively brush 25-30s and risk silent server kill before completing. Spanish wasn't a different code path — same bug, just more often tipped over the latency edge.

**Same class as Fix H?** Adjacent but different cause. Fix H = endpoint returned 503 by design; client already collapsed it to a no-op. Fix I = client dropped non-2xx silently with no honest fallback, AND the underlying response could intermittently fail for legitimate reasons (Anthropic latency, Vercel timeout, network blip, rate limit). Both Fixes restore honest-degradation; the underlying mechanisms diverge.

**Fix shipped (Tim chose A + C; B added once Vercel Pro confirmed):**

1. **Shape A — [services/listeningSession.ts](../services/listeningSession.ts) honest fallbacks.** New module-level `FAILURE_FALLBACK` map (English / Spanish / Chinese) and `speakHonestFailure(language, voiceGender, apiUrl)` helper that vibrates 120ms, stops any in-flight TTS, and speaks the user's localized "I'm having trouble connecting — try that again." Wired into every silent-drop branch:
   - Chat fallback path: tracks `chatSpoken` flag; if `!chatRes.ok` OR `reply === null` OR fetch throws OR `responseAllowed` was false → speaks the honest line.
   - Handler path: new `else if (!result.voice_response && responseAllowed && !result.tool_action)` branch — purely-no-output handler calls now get the fallback. Navigation-only `tool_action` results still skip TTS (handlers that route the user aren't expected to speak).
   - Outer catch (was log-only): now also speaks the localized failure line via fresh `useSettingsStore.getState()` (defensive read in case the throw happened before settings was bound).
   - In-round diagnostic Coach: tracks `diagnosticSpoken`; both `!r.ok` and the catch block now hit the fallback.

2. **Shape C — [api/kevin.ts](../api/kevin.ts) outer catch returns 200 with localized fallback.** Was returning HTTP 500 with `{ error: msg }` — which the client's `if (chatRes.ok)` branch dropped silently. Now returns HTTP 200 with `{ text: localizedFallback, audioBase64: null, toolAction: null, error: msg, errorType }`. Same per-language map as the client (English / Spanish / Chinese). Client's existing chat-fallback `if (chatRes.ok) → if (reply)` branch now picks up the fallback string and speaks it. **NOT fabrication** — only the honest error message reaches the user, never a fake answer to their actual question. Original error/stack still logs server-side and surfaces in the response body for debugging.

3. **Shape B — [vercel.json](../vercel.json) per-endpoint `maxDuration: 30`.** Vercel Pro confirmed by Tim. Added explicit `builds[]` entries with `config.maxDuration: 30` for the five Sonnet-using functions before the wildcard catch-all:
   - `api/kevin.ts` (main caddie response)
   - `api/brain.ts` (older path + warm-up pings)
   - `api/voice-intent.ts` (intent classifier with Sonnet fallback)
   - `api/swing-analysis.ts` (SmartMotion Sonnet vision)
   - `api/cage-coach.ts` (cage swing review tool)

   Gives the 25s Anthropic SDK timeout + ElevenLabs TTS (~2-5s on multilingual) + OpenAI TTS fallback (~1-2s) cumulative room to complete naturally instead of being killed mid-request on the 10s default. Endpoints still exit in their natural Anthropic-timeout window for fast queries; this just removes the premature-kill failure mode.

**UX result:** the pill never goes idle in silence on failure. The user hears the honest "having trouble connecting — try again" line in their language and feels a short vibration. Spanish failures speak the Spanish fallback. Normal queries still respond normally.

**Build gates:** `tsc --noEmit` clean. `useVoiceCaddie` round-active path unchanged (it already did this correctly — kept as reference). No fabrication anywhere — only honest error strings reach the user.

### Fix H (Option B) — pose-analysis returns 200-with-null when unconfigured

**Diagnosis (no Vercel logs needed — cause was plain in source):** the Vercel 503 alert was firing on `/api/pose-analysis`, the RapidAPI pose-detection proxy that feeds the optional Biomechanics card on swing detail. The 503 was **intentional** — [api/pose-analysis.ts:104](../api/pose-analysis.ts#L104) returned `res.status(503)` when `POSE_API_KEY + POSE_API_HOST` env vars weren't configured. The file header even documented it: *"Without them, every action returns a graceful 503 — clients fall through silently."* It was working as designed; Vercel just couldn't tell the difference between "intentionally off" and "broken."

**Blast radius (confirmed none):**
- `/api/swing-analysis` (SmartMotion primary analysis path) is independent of `/api/pose-analysis`. SmartMotion was not broken in production.
- Both callers ([services/videoUpload.ts:497](../services/videoUpload.ts#L497) for live biomechanics, [app/swinglab/swing/[swing_id].tsx:158](../app/swinglab/swing/[swing_id].tsx#L158) for older-swing backfill) are fire-and-forget with explicit "failures silent — pose API has known reliability variance, env-var gated; detail screen renders the Biomechanics card iff result is present — zero UX regression when API isn't configured" comments.
- [services/poseAnalysisApi.ts:145](../services/poseAnalysisApi.ts#L145) already collapsed `!res.ok → null`, so the 503 was already handled gracefully on the client.
- Cage Mode (post Fix G) doesn't touch `/api/pose-analysis` at all.

**Fix shipped (Option B — honest status code, not a real fix because nothing was actually broken):**

1. **[api/pose-analysis.ts:104](../api/pose-analysis.ts#L104)** — unconfigured branch now returns `200 OK` with `{ data: null, configured: false, reason: <env-var-message> }`. Vercel sees a successful function → no false alert. The `configured: false` flag distinguishes this state from a genuine upstream failure (which still surfaces as a non-2xx status via the existing branch).

2. **[services/poseAnalysisApi.ts:149](../services/poseAnalysisApi.ts#L149)** — `analyzePoseFromUri` now checks `data.configured === false || data.data == null` and returns `null` for either, collapsing both the new "off" shape and any real-data-empty case to the same no-op. The existing `!res.ok` fallback stays in place so a genuine 5xx still degrades gracefully too.

**UX is unchanged.** Swing detail screen shows zero biomechanics card when POSE env isn't set, identical to pre-G behaviour. No fabrication — null in, no card out. This is trivially reversible when POSE_API_KEY/HOST + a real RapidAPI subscription land later (Option A would just be configuring the env vars).

**Build gates:** `tsc --noEmit` clean. No regression in any caller (both pre-existing `!res.ok` branches and the new `configured: false` branch collapse to `null`, which is what the consumers already expect).

### Fix G (Option A) — honest Cage Mode + screen-aware voice "record"

**Diagnosis report (verbatim verdict before any code change):** the on-device "check position 404 + voice record dead" reports were **three separate problems, none caused by 9B**:

1. **`/api/cage/check-bullseye` 404** — endpoint never built. [vercel.json](../vercel.json) has no route; no `api/cage/` directory exists. The `services/cageApi.ts` header comment literally said *"Two endpoints (backend lands in Prompt 2) … Mock mode … so the on-device state machine can be exercised end-to-end before the backend exists."* Prompt 2 never landed. The 404 has been present since `cageApi.ts` was first authored, masked in dev by `EXPO_PUBLIC_CAGE_MOCK_MODE=true`. Same applies to `/api/cage/analyze`. 9B only renamed `cage-drill.tsx` → `cage-mode.tsx`; the broken URLs live in `services/cageApi.ts` and were not touched.

2. **Voice "record" routed to `'shot'` by default** — [services/intents/mediaHandlers.ts:23](../services/intents/mediaHandlers.ts#L23) `normalizeKind()` returned `'shot'` for anything that wasn't literally `'swing'`. Then `canCapture('shot')` refused on Cage Mode because `round.isRoundActive` is false. The handler had no awareness of `getActiveSurface()` even though Cage Mode does `setActiveSurface('drill_session')` on mount.

3. **Camera preview is fine** — Tim's report that the check-position test pic captured and POSTed (then 404'd) confirms `CameraView` mounts and `takePictureAsync` works. The latent `mode='picture' ↔ 'video'` race wasn't reached because the 404 stopped the user at SETUP→ERROR; the post-G fix removes it by construction (mode='video' always).

**Decision:** Option A. No mock-mode fabrication in production — same no-fake-precision rule as SmartMotion 418 / SmartFinder Consolidation 5. Cage Mode ships honest, using real capabilities only.

**Fix shipped:**

1. **[services/cageApi.ts](../services/cageApi.ts)** — deleted `checkBullseye()`, `analyzeCageVideo()`, and the `CheckBullseyeResponse` type. Kept `coachReview()` (which hits `/api/kevin/coach` → rewritten to `api/cage-coach.ts` in vercel.json — this one is real and deployed). Kept the `CageAnalyzeResponse` shape because `/api/kevin/coach` still takes it as input; cage-mode.tsx now BUILDS it locally from real signals instead of pulling fabricated data from an endpoint that never existed.

2. **[app/swinglab/cage-mode.tsx](../app/swinglab/cage-mode.tsx)** —
   - Collapsed phase machine from `SETUP → CHECKING → READY | NOT_READY → RECORDING → UPLOADING → RESULT | ERROR` to `SETUP → RECORDING → UPLOADING → RESULT | ERROR`. No fake "bullseye detected" gate, no NOT_READY auto-revert.
   - Removed `handleCheckPosition` (was POSTing to the 404 endpoint) and the NOT_READY useEffect + ref.
   - `stopRecordingAndUpload` no longer calls `analyzeCageVideo`. It awaits the local acoustic-impact detector + `/api/acoustic-detect` (ball speed; deployed) inline, then builds the `features` payload from those resolved values (`strike_count` from impact, `strike_times` from `impact_ms/1000`, `bullseye_offsets: []` because there's no CV scoring and we don't fake one, `notes[]` carrying the impact confidence + ball-speed mph estimate when present). Passes the locally-built payload to `coachReview()` → `/api/kevin/coach`. No 404 anywhere in the chain.
   - SETUP CTA simplified: batch-count selector + voice-trigger hint + single "Start Recording" button (the prior `Check Position → READY → Start Recording` two-step is gone).
   - **CameraView pinned to `mode="video"` always.** Pre-G it toggled `'picture' ↔ 'video'` on phase change so `takePictureAsync` could feed the bullseye check; that toggle was async and could race `recordAsync` called immediately after `setPhase('RECORDING')`. With the CV check gone, picture mode is no longer needed and the race is eliminated by construction.
   - `subscribeCapture(['swing'])` phase guard loosened: `phase === 'READY'` → `phase === 'SETUP'`. Voice "record" / "capture" / "start" now fires `handleStartRecording()` from the only pre-record phase that exists post-G. Internal mic-permission + double-tap guards inside `handleStartRecording` already prevent mid-RECORDING dup-fires.
   - Removed `expo-file-system/legacy` import (cache-copy-for-upload code went with the analyze call).

3. **[services/intents/mediaHandlers.ts](../services/intents/mediaHandlers.ts)** — `normalizeKind()` is now screen-aware. When `getActiveSurface() === 'drill_session'` the kind is forced to `'swing'` regardless of what the voice-intent classifier emitted. Bare "record" on Cage Mode no longer falls through to `'shot'` and then refuses for lack of an active round.

**Verify on device (OTA — no APK rebuild needed):**
- Open Cage Mode → framing overlay visible (no 404 / no "checking position" spinner).
- Tap Start Recording → 12s recording → real impact / ball-speed / Kevin coach card. No fabricated bullseye offsets.
- Tap caddie mic, say "record" → SETUP → RECORDING. No "you're not in a round" refusal.
- If acoustic detection misses (silent room, no impact), the impact card stays hidden — honest empty state, not a fake reading.

**Build gates:** `tsc --noEmit` clean. Unused `checkingCard` / `checkingText` / `primaryBtnDisabled` styles left in place (zero-risk dead code; lint-pass cleanup can pick them up later).

### Consolidation 5 (Part 2) — Surface the Mark Green capture loop on no-geometry surfaces

Part 1 made the scorecard fallback label honest. Part 2 closes the next gap on Maplewood / Pembroke Pines: the **path out of fallback** (Mark Green → live yardages) was only reachable via Settings → Owner Tools, the Tools menu, or a voice intent. Buried, not obvious. With the NH trip next weekend Tim wanted the no-geometry surfaces to *actively* offer the capture loop.

**Pre-change architectural verification — the three correctness questions Tim asked before any UI work:**

1. **Is live yardage after marking measured as live-position → marked-green (haversine), NOT step-subtraction from the tee?**
   ✅ Yes. [services/smartFinderService.ts:336-338, 377-379](../services/smartFinderService.ts#L336-L338) — `front/middle/back` are all `haversineYards(fix.location, …)` against the resolved green coords. No tee-subtraction anywhere on the live path. Dogleg-safe.

2. **Does the marked green persist across rounds (and app restarts)?**
   ✅ Yes. [services/courseGreenOverrides.ts](../services/courseGreenOverrides.ts) — AsyncStorage-backed singleton at key `smartplay.courseGreenOverrides.v1`. Per-`(courseId, hole)` entries with `{ lat, lng, markedAt }`. `rehydrate()` runs on first access; persists indefinitely until `clearGreenOverride()` is called.

3. **Does re-marking a green overwrite the prior fix with a fresh GPS pulse?**
   ✅ Yes. [app/mark-green.tsx:106](../app/mark-green.tsx#L106) — `await getOneShotFix({ maxAgeMs: 0 })` forces a fresh fix on every re-mark. [services/courseGreenOverrides.ts](../services/courseGreenOverrides.ts) — `setGreenOverride()` blindly reassigns `cached[courseId][hole]`; no merge / no skip-if-exists. Re-mark always wins.

**No architectural change required.** Only surfacing.

**Surfacing changes shipped:**

1. **[app/smartfinder.tsx](../app/smartfinder.tsx)** — full-screen MapView fallback now renders a green "Mark this green for live yardages" pill button directly below the `geometryMsg` row when `yards.reason === 'no_geometry'`. Routes to `/mark-green`. Added `useRouter` import; added `markGreenBtn` / `markGreenBtnText` styles.

2. **[components/smartfinder/SmartFinderCard.tsx](../components/smartfinder/SmartFinderCard.tsx)** — embedded card on Caddie home now splits the no-geometry empty-block into a static "Scorecard distance — no green GPS for this course." hint **plus** an inline Mark Green TouchableOpacity that stops bubbling and routes directly to `/mark-green`. The outer card-tap still routes to `/smartfinder` for everything else. Other no-geometry-variant branch (`middle == null && gps !== 'none'`) preserved unchanged.

3. **No changes** to `services/smartFinderService.ts`, `services/courseGreenOverrides.ts`, or `app/mark-green.tsx` — they already do exactly what Tim required.

**Result on Maplewood / Pembroke Pines next weekend:** opening the round → SCORECARD pill + `~485` middle + visible green "Mark this green for live yardages" button on both the Caddie-home embedded card AND the full-screen SmartFinder. One tap to capture. Live yardages thereafter are haversine(live → marked) and persist for future rounds at the same course.

**Build gates:** `tsc --noEmit` clean. No regressions to courses with geometry — the new button only renders when `yards.reason === 'no_geometry'`.

### Consolidation 5 (Part 1) — SmartFinder honest fallback labeling (`no_geometry` instead of silent `'ok'`)

The NH pre-trip check (Maplewood / Pembroke Pines) surfaced this honesty gap: golfcourseapi has zero per-hole green coordinates for either course, so SmartFinder's fallback fires the scorecard tee→green total as the "middle" yardage. The fallback was returning `reason: 'ok'` — masquerading a static card-total as a live GPS read. Affects every course missing green geometry, not just the NH trip pair.

**Fix shipped:**

1. **`services/smartFinderService.ts` — `staticYardages()` returns `reason: 'no_geometry'`** (was `'ok'`). The dedicated reason already existed in the `GreenYardagesReason` type but the function wasn't using it. No change to the actual yardage math — only the label.

2. **`components/caddie/cockpit/DistanceCard.tsx`** — extended `FrontMiddleBack` with optional `reason` field. When `reason === 'no_geometry'`:
   - Renders a subtle "SCORECARD" pill next to the GPS badge.
   - Hero number gets a `~` prefix (e.g. `~485` instead of `485`) signaling approximation.
   - Hero label appends "· CARD TOTAL" to the unit label.
   - GPS dot downgrades from `good` → `weak` (effective accuracy override).
   - Accessibility label updated to mention the scorecard-fallback state.

3. **`components/smartfinder/SmartFinderCard.tsx`** — header gets a "SCORECARD" pill; middle cell renders `~Xy`; empty-hint logic now fires on `reason === 'no_geometry'` even when middle is non-null (the prior gate `middle == null` would have missed the case after the service-side fix). New honest hint: "Scorecard distance — no green GPS for this course. Tap to drop a target instead."

4. **`app/smartfinder.tsx`** (full screen) — `geometryMsg` already handled `no_geometry` correctly but the message implied missing data. Updated to differentiate: when middle is non-null, says "Scorecard distance — no live GPS green for this course." When middle is null, keeps the original "Green coordinates unavailable for this course."

5. **`app/(tabs)/caddie.tsx`** — `fmb` memo now passes `y.reason` through to `DistanceCard` so the pill + `~` prefix render correctly on Caddie home.

**Behavior on courses WITH geometry: zero change.** `reason: 'ok'` is still returned when `resolveGreenCoords` finds real green coords; the pill, `~` prefix, GPS-dot downgrade, and "CARD TOTAL" label all stay hidden. Pure additive UI on the fallback path.

**Same no-fake-precision principle** as Phase 418 SmartMotion validation gate and the SmartFinder GPS-quality framing. The number is still useful as a reference; just labelled honestly.

**Build gates:** `tsc --noEmit` clean. `expo lint` at the Consolidation 1/2/2b/3/4 baseline (5 errors + 11 warnings — all pre-existing). No behavior change beyond the new honest labeling on the fallback path.

### Consolidation 4 — `console.log` noise pruned (18 routine traces gated, 414 intentional diagnostics retained)

**Survey:** actual count was **432 `console.log` calls** across the tree (Phase 420 audit said 355 — likely an under-count from the same narrow-grep methodology that produced the route false-positives). Top offenders matched the audit: `store/roundStore.ts` (29), `services/simulatedGPS.ts` (22), `services/listeningSession.ts` (16), `app/(tabs)/caddie.tsx` (14), `hooks/useVoiceCaddie.ts` (12).

**Classification per Tim's spec:**

| Category | Count | Action |
|---|---|---|
| Server-side `api/*.ts` (Vercel functions, `__DEV__` undefined) | 51 | **Skip** — no gate possible |
| Dev-only `scripts/simulations/*` | 33 | **Skip** — dev-only |
| Harness `services/simulatedGPS.ts` | 22 | **Skip** — Tim's explicit exclusion |
| Owner debug surfaces (`*-debug.tsx`, `gps-test.tsx`) | 3 | **Skip** — logging is the point |
| Tagged diagnostic breadcrumbs (`[V6-DIAG]`, `[path2:round]`, `[path4:voice]`, `[audit:round-active]`, `[audit:earbud]`, `[audit:gps]`, `[audit:voice]`, `[ttfa]`, `[handicap]`, `[mark]`, etc.) | ~140 | **Keep** — instrumented grep targets |
| Catch-block error surfacing (`catch (e) { console.log('[X] failed:', e) }`) | ~165 | **Keep** — real-failure visibility |
| Routine flow traces (status messages, value dumps, lifecycle "did X" notifications) | **18** | **Gated through `devLog`** |

**`services/devLog.ts` created** — single-line helper: `if (__DEV__) console.log(...)`. Bundler dead-code-eliminates the body in production builds (`__DEV__` is the literal `false`, so Metro/Hermes drops it). Routes through here are silent in TestFlight / public builds; still log in dev.

**18 routine traces gated** across 6 files:
- `services/fillerLibrary.ts` — 7 (filler library lifecycle: cache hit/miss, generation start/complete, library clear)
- `services/backgroundLocationTask.ts` — 3 (task defined / updates started / updates stopped — pure lifecycle)
- `services/mediaKeyBridge.ts` — 2 (track-player loader notes — defensive notes, not errors)
- `store/roundStore.ts` — 2 (health-snapshot object dump, setCurrentHole clamp notification)
- `hooks/useVoiceCaddie.ts` — 3 (transcript dump, follow-up bypass note, recording-started)
- `app/_layout.tsx` — 2 (Updates background-fetch complete, mark shot-location-correction applied — would spam on long rounds)

**Final count:** **414 `console.log`** (down from 432) + **19 `devLog`** routing through the new helper. Net = same total touch surface; difference is 18 lines that produce zero output in production builds.

**Why the audit's "noise" framing overstated the problem:** reading the corpus showed ~95% of existing logs are already tagged diagnostics or honest catch-block error surfaces. The audit's grep didn't classify; it counted. The genuine routine-flow noise is a much smaller set (~18 lines of 432), already-disciplined codebase by log standards. Tim's KEEP categories were correctly conservative.

**Build gates:** `tsc --noEmit` clean. `expo lint` at the Consolidation 1/2/2b/3 baseline (5 errors + 11 warnings — all pre-existing).

**Did NOT touch:** `app/(tabs)/caddie.tsx` log lines (refactor deferred per project decision — wouldn't gate there in isolation). Server-side `api/*` routes (no `__DEV__` in Node). Harness / scripts / debug surfaces (per Tim's spec). All catch-block error patterns. All `[V6-DIAG]` / `[audit:*]` / `[path*:]` / `[ttfa]` / `[handicap]` breadcrumbs.

### Consolidation 3 — Orphan-routes audit verdict: ZERO genuine orphans (Phase 420 audit had narrow grep, missed 14 of 14)

**Methodology:** re-grepped each "orphan" with broader patterns — template literals (`\`/course/${id}\``), `pathname:` object form, indirect callers (Settings rows, Tools menu), cold-install redirects. Phase 420 routes-audit agent's grep had been string-literal-only and missed most real call sites.

**Every flagged orphan is actually reached.** Categorization below — `keep` for everything; tightened the central debug gate on three owner-only surfaces for defense-in-depth.

| # | Route | Status | Evidence | Action |
|---|---|---|---|---|
| 1 | `/owner-logs` | **REACHED** | `settings.tsx:1106` (Owner Tools section), self-gated via `isOwnerEmail` | Keep + added to `DEBUG_ROUTES` for centralised gating |
| 2 | `/hole-view` (1,484 LOC) | **REACHED** | `caddie.tsx:2860`, `play.tsx:566` — both use `pathname:` object form which the audit's grep missed | Keep — was a FALSE orphan |
| 3 | `/lie-analysis` | **REACHED** | `caddie.tsx:2373`, `CockpitCaddieScreen.tsx:309`, voice intent `lie_analysis`/`tightlie` | Keep |
| 4 | `/mark-green` | **REACHED** | `settings.tsx:1150` (Owner Tools), Tools menu, voice intent `mark_green`/`markgreen` | Keep |
| 5 | `/swinglab/quick-record` | **REACHED** | SmartMotion (4 sites), Tools menu, cockpit MOTION button | Keep — canonical fast-path post Fix 9B |
| 6 | `/ghost-debug` | **REACHED** | `cage-debug.tsx:254` button | Keep, already in `DEBUG_ROUTES` (Fix 3) |
| 7 | `/cage-review/start` | **REACHED** | `cage-debug`, `cage/summary`, `cage/history` | Keep |
| 8 | `/author/reference-assets` | **REACHED** | Tools menu "Reference Authoring" row — was NOT row-gated | Keep + added to `DEBUG_ROUTES` |
| 9 | `/kevin-learning` | **REACHED** | `settings.tsx:1136`, `components/VocabBanner.tsx:59` | Keep |
| 10 | `/landmark-curate` | **REACHED** | `cage-debug.tsx:257` (transitively gated by cage-debug's gate) | Keep + added to `DEBUG_ROUTES` for defense-in-depth |
| 11 | `/welcome` | **REACHED** | `app/index.tsx:96, 114` — cold-install redirect | Keep — critical path |
| 12 | `/intro-video` | **REACHED** | `app/index.tsx:77` — onboarding redirect | Keep |
| 13 | `/course/[course_id]` | **REACHED** | 6 sites in `play.tsx` + `caddie.tsx` using template literal `\`/course/${id}\`` | Keep |
| 14 | `/quick-start` | **REACHED** | `settings.tsx:991`, `welcome.tsx:183` | Keep |

**`/hole-view` special-handling outcome:** false orphan. Both `app/(tabs)/caddie.tsx:2860` and `app/(tabs)/play.tsx:566` push to it via `router.push({ pathname: '/hole-view', ... })`. The Phase 420 audit grep was looking for `router.push('/hole-view')` string-literal pattern only and missed the object-pathname form. **No delete needed.** 1,484 LOC of live screen.

**Gate tightening shipped:** added `/author/reference-assets`, `/landmark-curate`, `/owner-logs` to the `DEBUG_ROUTES` set in `app/_layout.tsx`. Each was reachable today but not in the central debug gate from Fix 3. Defense-in-depth on owner-only surfaces.

**Total LOC removed by Consolidation 3:** zero. Nothing was actually orphaned. The Phase 420 routes audit needs a methodology note — its grep was narrower than the codebase's real call patterns.

**LESSON (Phase 420 audit grep gap):** the routes audit produced 14 false-positive "orphans" because it matched only string-literal `router.push('/x')` and missed template literals (`` `/course/${id}` ``), `pathname:`-object form (`router.push({ pathname: '/x', ... })`), cold-install redirects (`app/index.tsx`), and indirect callers (Settings rows, Tools menu). Zero of the 14 were genuine orphans; `/hole-view` (1,484 LOC) was a false orphan reached via object-form push from `caddie.tsx:2860` and `play.tsx:566`. **Lesson:** the Phase 420 audit's orphan/dead detection systematically undercounts references — always verify importers directly (`tsc --noEmit` after a candidate delete + grep all call forms: string literal, template literal, `pathname:` object, `href=`, `<Link>`) before trusting any "orphaned/dead" claim from it. Consolidation 2's 29-file dead-code deletes were safe because each candidate was confirmed zero-importer with tsc gates after each batch; route "orphans" got the same scrutiny here and almost none survived it.

**Build gates:** `tsc --noEmit` clean. `expo lint` at the Consolidation 1/2/2b baseline (5 errors + 11 warnings).

### Consolidation 2b — modeSelector/roles chain deleted, watchService kept, skeleton-stub honesty note logged

**Deleted (orphan island, no spec, resurrect from git when register-shifting is spec'd):**
- `services/modeSelector.ts`
- `services/roles/caddieRole.ts`
- `services/roles/coachRole.ts`
- `services/roles/psychologistRole.ts`
- `services/roles/` directory removed (auto, after the last file).
- `store/trustLevelStore.ts` header comment line 20 — removed the dangling `services/modeSelector.ts` consumer reference + added a one-line note explaining the deletion + resurrect-from-git path.

tsc clean, lint at the Consolidation 1/2 baseline (5 errors + 11 warnings). Zero importers anywhere in the codebase — verified before delete.

**Kept — `services/watchService.ts`.** The documented native-SDK hook site for the post-sprint EAS watch build (wearables SDK access in hand per Fix F). The tempo/club-speed math is what the wired implementation will use. Real scheduled seam, NOT orphan scaffold.

**Honesty note — SmartMotion skeleton overlay is STUB only.**

The live SmartMotion skeleton overlay renders from `STUB_SKELETON_JOINTS` — hardcoded placeholder constants in `app/swinglab/smartmotion.tsx`. The Fix C coordinate-space remap + the topology rewrite (explicit bone-edge list, scaled head circle, wrist nodes) made it LOOK correct on real device — two distinct legs, head on a neck, joint dots at every limb, scales with `videoRect` so it stays aligned across Z Fold open/close.

**It does NOT yet TRACK the user's real body.** It draws a generic golfer in setup pose. The bones, the head, the joints are visually correct but the positions are fixed — every clip gets the same skeleton overlaid in the same place. Real pose detection (MoveNet via TFJS) is a post-sprint EAS native build, same category as the Galaxy Watch IMU integration: native module + EAS Build, NOT OTA-able. Joint indices already match the MoveNet-17 subset so when real keypoints arrive they drop in without code surgery.

**Standing rule:** do NOT present the skeleton as real swing tracking until that native build lands. No marketing copy / demo language claiming "this is your tracked swing" while the constants are static. Honest framing today: "preview of what real-time skeleton tracking will look like once the on-device pose model ships in the next APK build" — same no-fake-precision principle as the Phase 418 validation gate and the SmartFinder GPS-quality framing.

### Consolidation 2 — dead-code removal pass (2,313 LOC deleted across 29 files)

Methodical batch deletion from the Phase 420 dead-code audit. `tsc --noEmit` gated after each batch. Total: **2,313 deletions across 29 files** (audit estimate was ~3,400 LOC — the difference is files that ended up retained per the report below).

**Batch 1 — Expo starter-template leftovers (12 files, ~zero-risk closed graph).** Confirmed all importers were themselves starter files (the graph: `themed-text`, `themed-view`, `parallax-scroll-view`, `external-link`, `haptic-tab`, `hello-wave`, `ui/collapsible`, `ui/icon-symbol` × 2, `use-color-scheme` × 2, `use-theme-color`, `store/index` barrel). Added `hooks/use-theme-color.ts` to the audit's list because it imported only the starter graph. Real-app code referenced zero of these. All deleted. Only false-positive grep hit was a comment phrase in `services/youtubeLinks.ts` ("external-link calls"), not an import. tsc clean.

**Batch 2 — superseded / orphan scaffolds (8 files).** Verified zero importers for `services/gpsAudit.ts` (418 LOC, superseded by `services/audit/*`), `services/swingCapture.ts` (pre-416), `services/primaryIssueRanker.ts`, `services/cvScoring.ts`, `services/acousticBallSpeed.ts`, `services/sensing/sensingSources.ts`. The pose pair (`components/swinglab/SkeletonOverlay.tsx` + `services/poseInference.ts`) was a circular orphan — SkeletonOverlay only imported poseInference, nothing else imported either.

**Critical pose check before deletion:** confirmed the live skeleton overlay (`StubSkeletonOverlay` in `app/swinglab/smartmotion.tsx`) uses local `STUB_SKELETON_JOINTS` constants, NOT poseInference data. The Fix C topology rewrite added zero poseInference imports. `services/poseInference.ts` was a pre-TFJS seam scaffold returning null until the TFJS install commit landed (never happened). Both files were genuinely dead. **Deleted.** Updated the smartmotion.tsx file header comment to drop the dangling reference to deleted poseInference.

**Batch 3 — deprecated components (8 files).** Phase AT / 111 / 405 had removed all consumers. Verified zero importers: `AddressSilhouette`, `KevinHelpButton`, `WhatCanISayChip`, `TapToTalkButton`, `course/CourseAbout`, `course/CourseHero`, `course/CourseStats`, `caddie/PhotoCaptureButton`. All deleted. tsc clean.

**Batch 4 — REPORT only, deferred to Tim:** `services/modeSelector.ts` + `services/roles/{caddieRole,coachRole,psychologistRole}.ts`. Confirmed closed orphan island:
- `modeSelector.ts` has **zero importers** anywhere outside `services/roles/`.
- Each role file is imported **only** by `modeSelector.ts`.
- `store/trustLevelStore.ts` line 20 mentions `modeSelector` in a header comment but does NOT import anything from the chain.
- `services/trustLevelService.ts` is used by other code (`lieAnalysisContext`, `listeningSession`, `voiceOnboardingService`) but those don't touch the roles chain.
- **Verdict:** the chain is a Trust-Spectrum-aspirational scaffold that nothing currently consumes. Tim's decision: delete (~4 files removed, scaffold reset) vs keep (waiting for the planned Caddie / Coach / Psychologist register-shifting work to land). **Held for Tim.**

**watchService.ts evaluation:** the only remaining "reference" in cage-mode.tsx turned out to be a header comment I wrote during Fix F describing the file — not an actual import. Re-grepped each export (`analyzeTempoRatio`, `estimateClubSpeed`, `getKevinTempoLine`, `simulateSwing`): **zero consumers across the whole codebase.** The entire file is dead today, including the math helpers. **Kept per Tim's prompt** — it's the documented native-SDK hook site for the post-sprint watch build. The math helpers (~15 lines of tempo + club-speed calc) will be load-bearing when the SDK lands; deleting and re-implementing later is the alternative but git history holds the same value. **Tim's call** if he wants to delete it now and resurrect later, or keep.

**`expo-image` dropped from package.json.** Verified zero imports via grep. `npm install` refreshed the lockfile cleanly; both `package.json` and `package-lock.json` no longer list it. tsc still clean.

**Build gates:** `tsc --noEmit` clean after every batch and at the end. `expo lint` unchanged at the Consolidation 1 baseline (5 errors + 11 warnings — all pre-existing). No new regressions.

**Outstanding decisions for Tim:**
1. Delete `services/modeSelector.ts` + `services/roles/*` now (no consumers anywhere; Trust Spectrum doesn't use them) — or keep until register-shifting work spec'd?
2. Delete `services/watchService.ts` now (zero consumers, math will resurrect from git when SDK lands) — or keep as the documented hook site?

### Consolidation 1 — three single-source-of-truth merges (haversine, voice-tuning, watch-state)

**Merge A — Haversine: 5 implementations → 1.** Canonical `utils/geoDistance.ts`. Verified each re-implementation against the canonical before merging:
- `services/gpsManager.ts:116` — `haversineMeters`: R = 6,371,000 m, identical formula, returns meters. **IDENTICAL.**
- `services/shotDetectionService.ts:65` — `haversineMeters`: same R, identical formula. **IDENTICAL.**
- `services/mapboxImagery.ts:88` — `haversineMeters`: same R, identical formula. **IDENTICAL.**
- `services/smartVisionOverlay.ts:178` — `haversineYards`: same R, formula uses `c = 2 * atan2(sqrt(h), sqrt(1-h))` instead of canonical `2 * asin(sqrt(h))`. **Mathematically identical** — both yield the same angle whose sin is sqrt(h); atan2 is slightly more numerically stable at antipodes but the difference is below float precision for any golf-course distance. Local `METERS_TO_YARDS = 1.09361` is a rounded reciprocal of canonical `METERS_PER_YARD = 0.9144` (max ~0.001y drift at 300y, invisible).

No formula differed in a way that mattered. Added a sibling `haversineMeters()` export to the canonical so meters-returning callers don't round-trip through yards. All four re-impls replaced with imports. `R_METERS` constant kept locally in `smartVisionOverlay.ts` because it's also used by the local-tangent-plane projection (separate math from haversine — left alone).

**Merge B — `_voiceTuning` shared module.** Diff confirmed `api/voice.ts` and `api/kevin.ts` held byte-identical `ELEVEN_VOICES_BY_PERSONA` + `ELEVEN_SETTINGS_BY_PERSONA` maps. Extracted to new [api/_voiceTuning.ts](../api/_voiceTuning.ts) (leading-underscore by Vercel convention so it's a private helper, not a route). Both endpoints now import from it. No behavior change to any persona's voice — same IDs, same settings, same `KEVIN` fallback path. Single drift-resistant source for the next tuning pass.

**Merge C — watch-connected state: 2 stores → 1.** Canonical = `store/watchStore.ts` (`isConnected`). `store/settingsStore.ts` had a sibling `watchConnected: boolean` + `setWatchConnected` setter that was a manual-toggle parallel of the same concept. Removed from `settingsStore`. Repointed:
- `app/cage/index.tsx:57` now reads `useWatchStore((s) => s.isConnected)`.
- `app/settings.tsx` ditto for the disabled "Galaxy Watch · Not wired" display row; dropped the unused `setWatchConnected` import (the disabled Switch was already wired to `() => {}`).
- `settingsStore.ts` — field, type, action, and initial value all removed.
- No persistence migration needed: the existing comment at `settingsStore.ts:515` confirms `watchConnected` was never in `partialize`, so no stale persisted value to scrub.

After this, every consumer (cage-mode, cage/summary, settings, cage/index) reads watch state from the single dedicated `watchStore` — ready for the real native SDK to flip `setConnected(true)` from one place when it lands.

**Build gates:** `tsc --noEmit` clean. `expo lint` went from 5 errors + 12 warnings → 5 errors + 11 warnings (an unused-var pickup from dropping `setWatchConnected` from settings.tsx). No new regressions.

**Did NOT change behavior anywhere** — these are pure dedupes. Sprint Map P1-4 (haversine), P1-5 (watch state), and P1-6 (voice tuning) all closed.

### Fix F — Galaxy Watch IMU in Cage Mode (diagnosis: unbuilt, not broken)

**Diagnosis: (a) — not built.** The Galaxy Watch IMU integration is scaffold + math + test sim only. No real SDK wired.

Evidence:
- [services/watchService.ts](../services/watchService.ts) — tempo-analysis math, `estimateClubSpeed()`, and a `simulateSwing()` test helper. Lines 112-118 are an explicit `// FUTURE: REAL SDK HOOK ─` comment block with example code that was never implemented.
- Grep across the codebase for `recordSwing` / `setConnected` / `setSwingDetected` returns **zero callers outside the store itself.** No production code path delivers data into `useWatchStore`.
- Phase 420 dead-code audit had already flagged `services/watchService.ts` as a Phase 417/418 scaffold with no consumers.
- Memory note `beta-wearables-sdk-access.md` (2026-05-19): wearables SDK access just unblocked; **native-module wiring requires an EAS Build, not OTA.**

**No fake-data UI risk today.** Cage Mode's UI is correctly defensive:
- The Watch Metrics card only renders when `watchSwing` is non-null ([app/swinglab/cage-mode.tsx:740](../app/swinglab/cage-mode.tsx#L740)). Never triggers in production because nothing writes to `useWatchStore.sessionSwings`.
- The "Watch connected but didn't catch this swing" hint is gated on `watchConnected === true` ([cage-mode.tsx:770](../app/swinglab/cage-mode.tsx#L770)). Also never triggers — `isConnected` stays `false`.
- The user sees nothing watch-related — correct empty-state for an unbuilt feature.

**Code change this turn — honest header only:** updated `app/swinglab/cage-mode.tsx` file header. Was claiming "all six capabilities" including Galaxy Watch IMU as if it were wired alongside bullseye gate / ball-speed / calibration / analysis APIs. Now reads "five wired capabilities" + a "Fix F diagnosis" paragraph naming Watch IMU as planned-sixth pending native SDK wiring on the next APK.

**No runtime UI change.** Tim's decision pending on whether to add a small "Watch metrics ship in next APK" hint somewhere subtle. Current recommendation: skip it — would itself be a stub of a stub. The defensive render is the right answer.

**Path forward (post-OTA, before launch):**
- Native module integration via EAS Build using the beta Samsung Health SDK Tim has access to. Implementation site = [services/watchService.ts](../services/watchService.ts) `FUTURE: REAL SDK HOOK` block. Hook delivers swing IMU events into `useWatchStore.recordSwing()` + flips `setConnected(true)`.
- Once wired, the existing Cage Mode UI lights up automatically — no UI plumbing changes needed.
- Estimated effort: M (native module + permissions + connection lifecycle); blocked by no JS-only fix, only by the APK build cycle.

**Build gates:** `tsc --noEmit` clean (only changed a comment block). No runtime behavior change.

### Skeleton topology — explicit bone-edge list, circle head, wrist nodes

**Report (3 sentences):**
1. Connection pattern was the bug — TWO shared-apex problems: head (joint 0) connected directly to BOTH shoulders via edges `[0,1]` and `[0,2]` (triangle apex on top), AND both hips connected to a single shared "ankles" joint (index 7) via `[5,7]` and `[6,7]` (kite legs converging to one point at the ball).
2. Keypoint schema was the 8-joint custom STUB (not MoveNet/MediaPipe); now rewritten to 13 joints matching the **MoveNet-17 subset** we'll receive when the TFJS / MoveNet integration lands (nose + left/right shoulder, elbow, wrist, hip, knee, ankle) — same indices, same labels, so real keypoints drop in without renaming.
3. Confirmed: head now renders as an outlined circle (radius derived from shoulder-width × 0.275, clamped 8–36 px), wrists are explicit joint nodes at indices 5/6, every bone is its own `<Line>` — no shared apex.

**Fix shipped (`app/swinglab/smartmotion.tsx`):**
- Replaced `STUB_SKELETON` (joints + connections) with `STUB_SKELETON_JOINTS` (13 named joints in MoveNet order), `STUB_SKELETON_BONES` (12 explicit bone edges — torso 4 + arms 4 + legs 4), and `STUB_SKELETON_NODE_INDICES` (12 non-head joints rendered as dots).
- Extracted a new `<StubSkeletonOverlay>` component. All sizes derive from `videoRect.width` / `height`: `headRadius = clamp(shoulderWidth × 0.55 / 2, [8, 36])`, `jointRadius = clamp(bodyScale × 0.011, [3, 7])`, `boneStrokeWidth = clamp(bodyScale × 0.005, [1.5, 3.5])`. No hardcoded px.
- Neck line drawn explicitly from shoulder-midpoint to the BOTTOM of the head circle (`head.y + headRadiusYPct`) so the head reads as a head on a neck, not an apex.
- Render gate now requires `videoRect` (overlay hides for one frame while natural-size + layout settle, then snaps in — avoids hardcoded-px fallback that Tim explicitly banned).
- Existing vertical alignment reference line preserved as-is.

**Did NOT touch:** coordinate mapping (videoRect math from Fix C), Z Fold remap, useWindowDimensions wiring, Phase 418 validation gate, analysis math, shot tracer overlay. Topology-only.

**Build gates:** `tsc --noEmit` clean. `expo lint` at the Phase 420 baseline (5 errors + 12 warnings — all pre-existing).

### Fix E — Language (Spanish) applied to caddie TTS + analysis

**Diagnosis in one paragraph:** the setting persists correctly. The READ path was sound — every `/api/kevin` fetch site (`hooks/useKevin.ts`, `hooks/useVoiceCaddie.ts`, `services/listeningSession.ts` × 2) sends `language` from the settings store; `/api/kevin` reads it and injects a strict "Respond ONLY in Spanish" rule into the system prompt (lines 462-465). The LLM TEXT comes back in Spanish. **The break was TTS:** [api/kevin.ts:976](../api/kevin.ts#L976) hardcoded `model_id: 'eleven_turbo_v2'` — the English-only ElevenLabs model — regardless of language. Spanish text fed to an English-locale TTS model produces English-cadence pronunciation. `/api/voice` already does this correctly (`language === 'en' ? 'eleven_turbo_v2' : 'eleven_multilingual_v2'`); `/api/kevin` was never updated to mirror it when it gained persona-aware TTS in Fix A (`a63d1b3`). Voice IDs are language-agnostic — only the model id needed to flip.

**Fix shipped:**
- [api/kevin.ts](../api/kevin.ts) — ElevenLabs call now selects `eleven_multilingual_v2` when `language !== 'en'`, otherwise `eleven_turbo_v2`. Mirrors /api/voice exactly. Applies to ALL personas (Kevin / Serena / Tank / Harry) on every caddie response path.
- [api/swing-analysis.ts](../api/swing-analysis.ts) — secondary issue caught: the swing-analysis prompt had zero language directive, so SmartMotion's Insight observation came back in English even when the user picked Spanish. Added a CRITICAL line directing the analyst to write `observation` + `follow_up_question` in Spanish or Chinese (enum values stay English — they're machine identifiers).
- [services/poseDetection.ts](../services/poseDetection.ts) — extended `analyzeSwing` context type with `language?: 'en' | 'es' | 'zh'`.
- [app/swinglab/smartmotion.tsx](../app/swinglab/smartmotion.tsx) — `analyzeSwing` call now passes `language` from settings.

**Confirmed already-correct paths (no changes needed):**
- `/api/voice` (uses multilingual model when language ≠ 'en')
- `/api/briefing` (Spanish/Chinese hard-enforce already in prompt)
- `services/fillerLibrary.ts` (voiceHash keyed by `persona_lang_v5`)
- `services/briefingGenerator.ts` (cache keyed by `${roundId}|${language}`)
- `setLanguage()` in settingsStore — clears filler library + briefing cache on change

**Deferred (lower priority — fix in a follow-up):**
- `api/cage-coach.ts` (the cage-mode "Coach Review" endpoint) — has zero language plumbing. `services/cageApi.ts` doesn't send language to it either. Cage-Mode-only surface, separate from the primary caddie chat.
- `app/ghost-debug.tsx:103` hardcodes `language: 'en'`. Owner-only debug screen; harmless.
- Real-time language change while a clip is on the SmartMotion analysis screen won't re-analyze — `useEffect` is keyed on `clipUri` only. Acceptable: the next recording picks up the new language.

**Build gates:** `tsc --noEmit` clean. `expo lint` at the Phase 420 baseline (5 errors + 12 warnings — all pre-existing).

### Fix D — Caddie 3-line quick-start intro on SmartMotion + Cage Mode

**Fix shipped:**
- New shared [components/caddie/CaddieIntroSheet.tsx](../components/caddie/CaddieIntroSheet.tsx) — Modal overlay with three caddie-voice lines + a single "Got it" button. Tap outside the card also dismisses. Speaks the lines via the existing `voiceService.speak()` with `{ userInitiated: true }` (passes L1 Quiet — the user explicitly opened the screen). Persona-tuned lines for all four caddies (Kevin / Serena / Tank / Harry).
- Persisted counter in `settingsStore`: new `introOpens: Record<string, number>` + `incrementIntroOpen(key)` action. Added to the persistence partialize so opens carry across launches. **Auto-suppress rule:** show for the first 3 opens of each slug (`smartmotion`, `cage_mode`), silent after. Dismissing increments the counter; mounting alone does not (so a partial open doesn't burn the count).
- `useCaddieIntro(slug, gate)` hook encapsulates the read + dismiss logic. Returns `{ visible, dismiss }` for the screen to wire to the sheet.
- [app/swinglab/smartmotion.tsx](../app/swinglab/smartmotion.tsx) — wires the intro behind `gate = !clipUri` so it only shows on the pre-record state (NoClipHero). Once a clip is on screen the user obviously knows what to do.
- [app/swinglab/cage-mode.tsx](../app/swinglab/cage-mode.tsx) — wires the intro behind `gate = phase === 'SETUP'`. Once the user has moved past initial setup (CHECKING / READY / RECORDING / RESULT) the orientation is no longer useful.

**Sample lines (Kevin, SmartMotion):**
> A few steps back. Pick down-the-line or face-on — your call.
> Tell me when to record. Tap stop when you're done.
> I'll break down what I saw the moment it's ready.

Each persona has its own tone — Tank is clipped imperatives, Serena precise-instructor, Harry warm-partnership, Kevin balanced/decisive.

**Did NOT touch:** Phase A mic badge, Phase B angle toggle, Phase 418 validation gate, analysis math. Pure additive intro overlay. The voice "how does this work" re-trigger from the badge is **deferred** — would need a new voice intent + handler; out of Fix D's scope.

**Build gates:** `tsc --noEmit` clean. `expo lint` at the Phase 420 baseline (5 errors + 12 warnings — all pre-existing).

### Fix C — Skeleton overlay alignment + Z Fold aspect-ratio remap

**Coordinate-space mismatch in one sentence:** the skeleton SVG filled the videoFrame container (`StyleSheet.absoluteFill`), but `<Video resizeMode={ResizeMode.COVER}>` scales-and-crops the source clip inside that container — so the skeleton's normalized percentages tracked the container box while the actual body pixels lived in a centered subrect whose offset depended on `(container aspect) vs (source video aspect)`, and Z Fold open/close changed the container dimensions without remapping the subrect.

**Fix shipped (`app/swinglab/smartmotion.tsx`):**
- Track the clip's natural dimensions via `<Video onReadyForDisplay>` → `payload.naturalSize`.
- Track the container's measured size via `<View onLayout>` on the videoFrame.
- New `videoRect` memo computes the displayed-video subrect using the COVER scale formula: `scale = max(containerW/videoW, containerH/videoH)`; `renderedW/H = videoW/H * scale`; `left/top = (containerW/H - renderedW/H) / 2`. Result is the exact pixel rect where the video's visible content lives inside the container.
- Skeleton + shot-tracer SVGs now position absolutely to `videoRect` (left/top/width/height) instead of `StyleSheet.absoluteFill`. Keypoint percentages are normalized to the source video, so 50% in the SVG = 50% of the actual body pixels.
- `useWindowDimensions()` subscribed (not in deps) so any fold/unfold re-renders the component; the videoFrame's `onLayout` then fires with new dimensions and the memo recomputes — alignment tracks the fold transition.
- Grid overlay LEFT on `StyleSheet.absoluteFill` (it's a camera-framing aid, intentionally container-relative).
- Fallback to `absoluteFill` for one frame while natural-size + layout haven't landed yet (snaps correct on next render).

**Did NOT touch:** Phase 418 validation gate, analysis math, pose pipeline, canonical-issue catalog. Pure overlay rendering / coordinate-space plumbing.

**Note for honest expectations:** real pose keypoints land with the TFJS/MoveNet integration in a future APK. Today's `STUB_SKELETON` is still hardcoded normalized coordinates — Fix C makes the MAPPING correct, so when real keypoints arrive they'll land on the body without further work. With the stub, the skeleton now sits at a correctly-scaled position within the visible video rather than against the container box.

**Build gates:** `tsc --noEmit` clean. `expo lint` back at the Phase 420 baseline (5 errors + 12 warnings — all pre-existing).

### Fix B — Camera angle chosen BEFORE recording (tap + voice)

**Problem (real-device):** SmartMotion's down-the-line vs face-on toggle only appeared AFTER recording, so the analyst's biomechanical read used the default orientation against whatever the user actually shot — wrong reads on most clips.

**Fix shipped:**
- **Default flipped to down-the-line** in [app/swinglab/smartmotion.tsx](../app/swinglab/smartmotion.tsx) (was `face_on`). Down-the-line is the common swing-analysis convention and the better default for first-time captures (path / plane / over-the-top / early-extension reads).
- **Pre-record angle picker** in `NoClipHero`. Two-pill row with tap-to-select: "Down the Line — Path · plane · over-the-top" and "Face On — Weight · hips · reverse pivot". The Record button label includes the chosen angle so the user can't miss which one is active when they tap it.
- **Angle persists across navigation** via URL param. SmartMotion → quick-record passes `?angle=…`; quick-record → SmartMotion passes `?clipUri=…&angle=…` so `analyzeSwing` fires with the SETUP angle. SmartMotion also hydrates from `?angle=` so the voice intent path lands on the right initial state.
- **Quick-record angle chip** (top, below the status pill) shows the chosen angle + lets the user flip with a tap before recording. Hidden during recording.
- **`analyzeSwing()` context** ([services/poseDetection.ts:256](../services/poseDetection.ts#L256)) extended with `angle?: 'down_the_line' | 'face_on'`. SmartMotion passes the chosen angle on the call.
- **Server-side prompt** ([api/swing-analysis.ts](../api/swing-analysis.ts)) — added an explicit `Camera angle: …` line to the analyst's user context with orientation-specific guidance: down-the-line clips are good for path/plane/over-the-top/early extension; face-on clips are good for weight shift / hip rotation / reverse pivot / sway. The prompt also tells the analyst NOT to confidently diagnose the wrong-orientation faults from each angle. Defaults to down-the-line server-side when the field is missing (legacy callers).
- **Voice intents** for "record me down the line" / "record me face on":
  - [api/voice-intent.ts](../api/voice-intent.ts) — extended `open_tool` parameter schema with `angle?` and `auto_start?`, added six new training examples covering "DTL" / "face on" / "front view" / variations.
  - [services/intents/openToolHandler.ts](../services/intents/openToolHandler.ts) — when `tool_name='smartmotion'` and `angle`/`auto_start` are present, builds the route `?angle=…&autoStart=1`. Quick-record's new auto-start effect fires `handleRecord` 250 ms after mount once camera + mic permissions are granted. The spoken response confirms the orientation ("Recording down the line.").

**Build gates:** `tsc --noEmit` clean. `expo lint` unchanged at the Phase 420 baseline (5 errors + 12 warnings — all pre-existing).

**Did NOT touch:** the analysis math itself — same haversine, same pose pipeline, same canonical-issue catalog. Fix B is purely WHICH angle the analyst is told the camera was on.

### Fix A — Persistent caddie mic badge on SmartMotion / Cage Mode / SwingLab + auto-voice diagnosis

**Problem (real-device):** Tim reported no way to manually reach the caddie on SmartMotion, Cage Mode, or SwingLab, AND hands-free wake-word ("record" / "start") did nothing.

**Auto-voice diagnosis (one sentence):** the continuous-mic VAD loop (`useVoiceActivityDetection`) is mounted ONLY on `app/(tabs)/caddie.tsx` — no other screen has a continuous wake-word listener, so saying "record" cold on SmartMotion / Cage Mode / SwingLab can never fire. (Cage Mode does have `subscribeCapture(['swing'])` which catches the 'swing' voice intent — but only AFTER a listening session is opened, not as a true wake-word.) Fix is non-trivial (mic ownership across screens) — deferred. Manual badge is the priority path and now works on all three.

**Manual tap-to-talk status before this fix:**
- Cage Mode: badge wired in its custom Header → `toggleListening()`. Static image, no listening pulse, no mic-icon affordance. Title still read "Cage Drill" (drift from the 9B rename).
- SwingLab: `BrandHeaderRow` already had tap-to-talk on the brand badge — but no visual mic affordance, so it read as a logo not a button.
- SmartMotion: NO badge at all in its custom header. Genuinely missing.

**Fix shipped:**
- New shared component [components/caddie/CaddieMicBadge.tsx](../components/caddie/CaddieMicBadge.tsx). Encapsulates: badge image + listening-state ring (green active / amber thinking) + pulsing halo on 'listening' + small mic-icon overlay (bottom-right of the badge so it visually reads as a control) + tap → `listeningSession.toggle()`. Subscribes to `useListeningSessionStore` so every instance pulses in sync.
- [components/brand/BrandHeaderRow.tsx](../components/brand/BrandHeaderRow.tsx) refactored to use `CaddieMicBadge` internally — no API change to consumers (SwingLab + Play + Dashboard + Scorecard tabs unchanged), every tab now gets the mic-icon affordance + consistent state pulse.
- [app/swinglab/smartmotion.tsx](../app/swinglab/smartmotion.tsx) — added `<CaddieMicBadge size={40} />` as the first element of the header (top-left), back chevron remains beside it.
- [app/swinglab/cage-mode.tsx](../app/swinglab/cage-mode.tsx) — Header swapped the static `Image` badge for `<CaddieMicBadge size={40} onPress={onBadge} />`. Listening pulse + mic-icon for free. Stale `badgeBtn` / `badgeImg` styles removed. Header title updated "Cage Drill" → "Cage Mode" (post-9B drift fix).

**Auto-voice fix:** NOT applied (deferred). The fix requires wiring continuous VAD to multiple screens with mic-ownership coordination — beyond Fix A's scope. Manual badge is the verified manual fallback path.

**Build gates:** `tsc --noEmit` clean. `expo lint` unchanged at the Phase 420 baseline (5 errors + 12 warnings — all pre-existing, no new regressions).

### Day 2 / Fix 9B — Two clean features: SmartMotion (quick) + Cage Mode (practice/lessons)

Per Tim's confirmed decision. SmartMotion = quick swing check. Cage Mode = dedicated practice + lesson environment. Zero overlap.

**Cage Mode final identity:**
- **Route:** `/swinglab/cage-mode` (was `/swinglab/cage-drill`).
- **File:** `app/swinglab/cage-mode.tsx` (renamed via `git mv` to preserve history). Component renamed from `CageDrillScreen` to `CageModeScreen`. Header updated to identify as Cage Mode.
- **Reachable from:** SwingLab tab → new "Cage Mode" card (added between SmartMotion and Range Mode).
- **All six capabilities preserved byte-identical:** bullseye-in-frame gate (`checkBullseye`), ball-speed detection (`detectBallSpeed`), cage calibration store (`useCageCalibrationStore`), Galaxy Watch IMU integration (`useWatchStore` + `SwingMetrics`), cage-specific analysis APIs (`analyzeCageVideo` + `coachReview`), and the `CageOverlay` framing component. No behavior changes vs the prior cage-drill.
- **Cockpit caller** at `components/caddie/CockpitCaddieScreen.tsx:301` was routing to `/swinglab/cage-drill` for "fire the camera fast" mid-round intent. That intent matches SmartMotion's fast path more than Cage Mode's setup flow → repointed to `/swinglab/quick-record` (Option D speed path).

**Ported from smartmotion-quick to Cage Mode:**
- **Batch-count selector (1 / 3 / 5 / 10 swings) — PORTED.** Renders in SETUP / NOT_READY phases as a labelled pill row ("SWINGS THIS SESSION"); selecting a size resets `batchIdx`. After each RESULT, if the batch isn't complete the screen auto-returns to SETUP after 4s for the next swing. Final RESULT stays on-screen until the user taps Swing Again. Adds ~30 LOC of additive code; no change to the existing phase machine.
- **Voice "ready" wake-word multi-swing loop — DROPPED.** Cage Mode already subscribes to the `subscribeCapture(['swing'])` voice-capture intent ([cage-mode.tsx:156-164](../app/swinglab/cage-mode.tsx#L156-L164)) so saying "record" / "capture" / "start" hands-free fires the same handler the button does. Functionally equivalent — the wake-word loop would have been redundant + required a new LISTENING_VOICE phase + mode-toggle UI that conflicted with Cage Mode's existing listening model (`toggleListening`).

**smartmotion-quick.tsx deleted:**
- File removed via `git rm app/smartmotion-quick.tsx` (954 LOC gone).
- Stack.Screen registration removed from `app/_layout.tsx` (replaced with a comment explaining the move).
- Zero functional references to `smartmotion-quick` remain anywhere in source (only 3 explanatory comments noting it was removed).

**Option D speed path — wired:**
- Voice intent `smartmotion` / `smart_motion` ([services/intents/openToolHandler.ts:28-29](../services/intents/openToolHandler.ts#L28-L29)) → `/swinglab/quick-record` (camera live immediately; quick-record routes back to `/swinglab/smartmotion?clipUri=...` after recording).
- ••• Tools menu SmartMotion row ([components/tools/GlobalToolsMenu.tsx:325](../components/tools/GlobalToolsMenu.tsx#L325)) → `/swinglab/quick-record` (same flow). Subcopy updated to "Quick swing check · camera opens immediately".
- Cockpit MOTION button (above) → `/swinglab/quick-record` (mid-round fast camera).
- Library "Record a swing" CTA ([app/swinglab/library.tsx:256](../app/swinglab/library.tsx#L256)) → `/swinglab/smartmotion` (review / intro context — keeps the marketing hero).
- SwingLab tab SmartMotion card → `/swinglab/smartmotion` (browsing context — keeps the marketing hero).

**CaptureOverlay.tsx — UNTOUCHED.** Confirmed not a SmartMotion duplicate; it's the round-side voice "record this shot" surface mounted at app root for the `mediaCapture` 'shot' kind.

**Build gates:** `tsc --noEmit` clean. `expo lint` unchanged at Phase 420 baseline (5 errors + 12 warnings — all pre-existing, no new regressions from this batch).

**Overlap verification:** SmartMotion and Cage Mode now share zero direct code paths. They both import `acousticImpactDetector` (separate capture sessions), `useSettingsStore`, and `voiceService` — utility services, not feature code. No shared state, no shared phase machine, no shared screens.

### Day 2 / Fix 9A — Re-route all entry points to canonical SmartMotion (NO DELETES)
Per Tim's standing decision: there is exactly ONE SmartMotion. Survivor = `app/swinglab/smartmotion.tsx` (Phase 416 two-card + Phase 418 validation gate). `app/swinglab/quick-record.tsx` stays as the minimal capture primitive.

**Re-routes shipped (this commit):**
- `services/intents/openToolHandler.ts:28-29` — voice intent `smartmotion` / `smart_motion` → `/swinglab/smartmotion` (was `/smartmotion-quick`)
- `components/tools/GlobalToolsMenu.tsx:325` — ••• Tools menu SmartMotion row → `/swinglab/smartmotion` (was `/smartmotion-quick`). Updated subcopy from "Quick swing capture · acoustic auto-stop" to the canonical's "AI Swing Analysis · Body Mechanics · Shot Tracing"
- `app/swinglab/library.tsx:256` — "Record a swing" empty-state CTA → `/swinglab/smartmotion` (was `/smartmotion-quick`)
- SwingLab tab card already pointed at `/swinglab/smartmotion` — no change

Build gates: `tsc --noEmit` clean. `expo lint` unchanged at the Phase 420 baseline (5 errors all `react/no-unescaped-entities` + 12 warnings — no new regressions from this re-route).

**Inbound-refs audit after re-route:**

| Candidate | LOC | Inbound functional refs | Safe to delete now? |
|-----------|-----|--------------------------|----------------------|
| `app/smartmotion-quick.tsx` | 954 | **0** (only `app/_layout.tsx:746` Stack.Screen registration remains — declarative, drops with the file) | **YES — pending Tim's go** |
| `app/swinglab/cage-drill.tsx` | 1,039 | **1: `components/caddie/CockpitCaddieScreen.tsx:301`** still does `router.push('/swinglab/cage-drill')` for the cockpit-mode cage button. Plus header-comment refs in `app/swinglab/quick-record.tsx`, `app/swinglab/camera-setup.tsx`, `app/swinglab/range.tsx`, `services/acousticImpactDetector.ts`, `store/cageCalibrationStore.ts` (no functional impact). | **NO — one live caller** |
| `components/CaptureOverlay.tsx` | 311 | **Globally mounted at app root** (`app/_layout.tsx:49+582`). Not a screen — listens to `mediaCapture` for the 'shot' kind. Subscribed by `services/mediaCapture.ts` + referenced by `services/intents/mediaHandlers.ts`, `store/roundStore.ts`, `scripts/simulations/run-sim.ts`. | **NO — different feature** |

**Capability check (the load-bearing question for cage-drill):**

**`app/smartmotion-quick.tsx`** vs survivor — pure parallel duplicate of the capture flow, BUT carries two non-obvious behaviours the survivor does not have today:
1. **Voice "ready" wake-word loop** (LISTENING_VOICE phase) — multi-swing demo flow where the user says "ready" / "go" / "swing" to trigger the next capture hands-free
2. **Loop count selector (1 / 3 / 5 / 10 swings)** — multi-swing batch mode for range / demo sessions
3. Inline RESULTS phase that loops back to READY without leaving the screen — survivor today routes through `quick-record` → back to `smartmotion` with `clipUri`, which is functionally the same flow over two screens

If Tim wants those wake-word and loop-count behaviours preserved, **port before delete**. If they were dead-weight (Tim's "Mariners demo" use case has shifted), pure delete.

**`app/swinglab/cage-drill.tsx`** vs survivor — NOT a pure duplicate. Unique capabilities the survivor does not have:
1. **`checkBullseye` gate** — calls `cageApi.checkBullseye` to verify the bullseye is in frame before allowing recording (SETUP → CHECKING → READY | NOT_READY phases). Cage-practice-specific.
2. **`detectBallSpeed` integration** — calls `acousticDetectApi.detectBallSpeed` for ball-speed estimation. Cage-specific.
3. **`useCageCalibrationStore`** — surfaces "effective distance" from the cage calibration store.
4. **Watch IMU integration** — `useWatchStore` `SwingMetrics` consumer (Galaxy Watch swing-detection feed).
5. **`analyzeCageVideo` + `coachReview` APIs** — cage-specific analysis path (different from `runPhaseKOnSession` the survivor uses).
6. **`CageOverlay` component** — visual framing guidance specific to cage practice.

These are CAGE-PRACTICE features, not general SmartMotion features. Tim's "ONE SmartMotion" decree may want these merged in, or it may want cage practice to remain a distinct (but renamed) feature. Need Tim's call before deletion. The cockpit-mode cage button at `components/caddie/CockpitCaddieScreen.tsx:301` was NOT in Tim's listed re-route targets (voice / ••• / Library / SwingLab card) so it's left as-is for now.

**`components/CaptureOverlay.tsx`** — NOT a SmartMotion screen at all. Globally-mounted overlay that listens for the `mediaCapture` `'shot'` kind. Triggered by the voice intent "record this shot" mid-round; captures a 5s shot clip and writes the URI onto the most-recent `ShotResult.clip_uri`. Conceptually distinct from cage/practice capture. The Phase 420 duplication audit tagged it loosely; reading the code, it serves the round-side per-shot recording, not the practice flow. **Recommend: keep, not a deletion candidate.** The audit count drops from 5 capture surfaces to 4 (sm-quick, cage-drill, cage-session-overlay, quick-record); after deletes drops to 2 (cage-session-overlay + quick-record).

**Speed assessment of the survivor's flow (the "deep AND instant" question):**

Currently from "tap SmartMotion in Tools menu":
1. Tap → land on `/swinglab/smartmotion` with no `clipUri` → see `NoClipHero` ("Ready when you are. Tap Record. AI swing analysis · body mechanics overlay · drill recommendation.")
2. Tap "Record Swing" → push `/swinglab/quick-record` → camera live
3. Tap big red record button → records 8s OR tap again to stop early → `router.replace` back to `/swinglab/smartmotion?clipUri=...`
4. Analysis runs → two-card view populated

That's two extra surface transitions vs the prior smartmotion-quick flow (which landed at READY phase with the camera already live, then RESULTS appeared in-place). The two-card analysis depth is preserved AFTER capture, but the **landing-screen friction is not instant**: a marketing-style hero screen sits between Tools tap and camera.

Options to make it instant (NOT applied — Tim's call):
- **A. Auto-push to quick-record when entering smartmotion with no clipUri** — single tap from any entry point lands on a live camera. But: blocks users who want to land on smartmotion to view a library swing.
- **B. Embed the camera inline in the NoClipHero** — biggest visual change, most code surgery.
- **C. Add a tap-friendly "Open camera" entry above the marketing copy** — current Record button already does this, just labelled and positioned for first-time discovery rather than speed. Could tighten the layout / make the CTA larger / drop the copy.
- **D. Direct-camera path for voice intent + Tools menu only (not Library)** — preserves Library's "tap to view existing swings" flow while making fast-path entries truly instant.

Recommendation: **D**. The voice intent and Tools-menu paths are explicit "I want to record now" signals; the Library path is "I want to review what I've recorded." Two intents, one screen, branched on entry source.

**Status: paused for Tim's go on what to port/delete from cage-drill + smartmotion-quick + which speed option (if any) to apply.**

---

### Day 1 / Fix 8 — Diagnosis pass (NO FIX applied tonight)
Two harness findings investigated; both reports below. Tim verifies real-device behavior tomorrow before any fix is applied.

#### Finding 1 — Simulator stalls (1931s + 87s pauses on the latest harness log)
**Verdict: SIM-TIMER ARTIFACT. Real GPS would NOT die under the same conditions, *provided* the user has granted background location permission AND the OEM hasn't killed the foreground service.**

The sim uses a plain JS `setInterval` ([services/simulatedGPS.ts:148](../services/simulatedGPS.ts#L148)) — pure JS timer with no native anchor. Android's Doze + app-background throttling pauses JS timers; the watchdog at [services/simulatedGPS.ts:163-175](../services/simulatedGPS.ts#L163-L175) detects the gap and logs `[stalled]` but cannot prevent it. The 1931s gap is exactly this.

Real GPS path is engineered to survive Doze:
- **Foreground watch:** `Location.watchPositionAsync` in [services/gpsManager.ts startWatchInternal](../services/gpsManager.ts) — JS-callback path, foreground-only. Would also lose ticks when the app backgrounds.
- **Background path:** `Location.startLocationUpdatesAsync` registered via TaskManager in [services/backgroundLocationTask.ts:106-140](../services/backgroundLocationTask.ts#L106-L140), with `foregroundService` notification + `pausesUpdatesAutomatically: false` + `activityType: Fitness`. Task callback flows back into `gpsManager.ingestExternalFix` (same processFix pipeline as foreground).
- **Permission flow:** `Location.requestBackgroundPermissionsAsync` at [store/roundStore.ts:575](../store/roundStore.ts#L575) on round start.

Real risks on a pocketed phone:
1. **Background permission denied** → foreground service config is moot. `startLocationUpdatesAsync` won't deliver while backgrounded → phone-in-pocket goes dark.
2. **OEM battery-optimization** (Samsung One UI, Xiaomi MIUI) can kill foreground services not on the OS whitelist. Z Fold Samsung skin is aggressive — Tim has previously hit this class.
3. **Foreground watch dies** when app backgrounds — only the background task delivers fixes once the app's not in focus. Fix cadence drops from 1Hz (active) to 10s (background config).

Proposed minimal hardening (do not apply tonight — needs real-device verification first):
- **Tomorrow's verification step:** Tim starts a round on the Z Fold, grants background permission when prompted, pockets the phone for 10-15 min, then opens to confirm continuous fix cadence in the GPS Test Bench timeline (no `[stalled]` events, no large gaps in the ring buffer).
- If that passes: no app-side change needed. Sim stall is a harness-only artifact.
- If that fails (Doze killed the foreground service despite the notification): add Samsung-specific battery-optimization opt-out prompt (`PowerManager.requestIgnoreBatteryOptimizations` via a small native module or `expo-intent-launcher` deep-link to the OS settings screen).
- Sim-side hardening optional regardless: replace `setInterval` with a wake-aware ticker (`expo-keep-awake` + `AppState` listener that resyncs `lastTickMs` on foreground), so harness runs don't lose visibility to a "real" issue while the simulator is silent.

#### Finding 2 — Off-course flip at end of round (3461y from nearest hole, after H18 walk_complete)
**Verdict: HARMLESS HARNESS TEARDOWN. Not a round-end state bug; not what the End Round crash (Fix 1, `2801bf9`) was masking.**

Sequence:
1. Sim reaches final waypoint → [services/simulatedGPS.ts:322-326](../services/simulatedGPS.ts#L322-L326) logs `walk_complete` → calls `stopSimulatedWalk()`.
2. `stopSimulatedWalk()` ([services/simulatedGPS.ts:177-184](../services/simulatedGPS.ts#L177-L184)) calls `clearSimulatedFix()` — which (per Day 1 / Fix 4) flips `gpsManager.simulatedActive = false` and nulls `lastFix`.
3. The round is **still active** at this point — `walk_complete` does not call `endRound`. The off-course detector keeps polling ([services/offCourseDetector.ts:147+](../services/offCourseDetector.ts#L147)).
4. With `simulatedActive = false`, the foreground `watchPositionAsync` subscription (still alive) starts delivering real-device GPS fixes → `processFix` → `lastFix` becomes the device's actual coordinates (Tim's living room).
5. Off-course detector reads `gpsManager.getLastFix()` → haversines to every course-hole green/tee/front/back → minimum is 3461 yards because the device is 1.97 miles from the simulated course. Sustained-window threshold elapses → `setOffCourse(true)` → log fires.

This is the detector behaving correctly given the device's true location. Not a bug. Specifically:
- It is **not** state corruption left by round-end — round-end hasn't fired yet.
- It is **not** what the End Round crash was masking — the crash fired on `/recap/[round_id]` mount (`useRoundStore` selector returning a fresh `[]`), a completely different code path and trigger.
- The 3461y reading is genuine: device is 3461 yards from the nearest point of the synthetic course's geometry.

No fix needed. Optional cosmetic: `stopSimulatedWalk` could also suppress off-course logging for a few seconds after teardown (the user obviously doesn't need "off course" telemetry during the brief gap between sim end and End Round). Not worth the surface area unless it's user-visible noise — and the off-course pill on the Caddie tab is only shown during an active round AND with telemetry tab open, so it's almost certainly invisible to Tim. Defer indefinitely.

### Shipped today (Day 1 / Fix 7 addendum)
- **Hole-transition GPS refresh seam** (`app/(tabs)/caddie.tsx`, new useEffect keyed on `[currentHole, isRoundActive]`). Tim hit 2-5y upward yardage drift on holes 13/16/17 of the synthetic round; the value self-corrected within ~1 sim tick and corrected immediately on navigate-away/back. Root cause: when `holeDetection` fires → `setCurrentHole(next)` → `fmb` memo re-runs with the new hole's green coords against a `gpsManager.lastFix` from one sim-tick ago. Memo correct, fix correct, but the position lag = a small drift. Option A fix: on hole change, `await gpsManager.getOneShotFix()` (pulses real GPS if cache >10s; no-op on sim) then bump `markTick` to force the memo to recompute against whatever's freshest. Closes the seam without touching haversine, yardage math, or the GPS quality classifier. Symptoms 2 (no caddie hole announcement on harness) and 3 (stroke never exceeds 2 on harness) confirmed expected harness behavior — documented in the diagnosis, not fixed.

### Shipped today (Day 1 / Fix 5 addendum)
- **Cockpit-mode SHOTS cell ticks during the hole** (`components/caddie/CockpitCaddieScreen.tsx`). Tim flagged: "since cockpit has its own scoring and not the bottom data bar, strokes are not changing in cockpit mode." Root cause: cockpit's `useShallow` selector only watched `scores` (the final hole-score map). Harness shots write to `shots` via `logShot()` but don't touch `scores` until hole completion → SHOTS displayed "—" the whole hole. Fix: added `shots` to the selector; derived a `runningStrokeCount` mirroring the data-bar's STROKE calc; passed `scores[currentHole] ?? runningStrokeCount` to StepperPair so manual stepper edits still win (existing behavior) but the cell ticks with every logged shot when no manual override exists.

### Shipped today (Day 1 / Fix 4 addendum)
- **Collapsed 3 GPS-fix caches to a single owner in `services/gpsManager.ts`.** Root divergence: `setSimulatedFix()` and `setMarkedFix()` lived in `services/smartFinderService.ts` and only updated that file's local `lastFix`. `services/shotLocationService.ts` (via `gpsManager.getOneShotFix()`) read the canonical `gpsManager.lastFix`, which still held whatever real-device fix existed before the simulator started. Two consumers asking "where am I" got different answers — root cause of the 629,441y off-course reading and the "yardages drift up" symptom. Fix: gpsManager now owns `setSimulatedFix` / `clearSimulatedFix` / `setMarkedFix` and the `simulatedActive` flag; `processFix()` drops real GPS while sim is active; `getOneShotFix()` short-circuits to the cached fix in sim mode; `stopGpsManager()` clears `simulatedActive` on round-end. `services/smartFinderService.ts` and `services/shotLocationService.ts` became thin readers — no local cache. Existing public APIs (smartFinderService.setSimulatedFix / setMarkedFix / isSimulatedActive / getLastFix) preserved as proxies so the 7-ish call sites across `services/simulatedGPS.ts`, `app/_layout.tsx`, `services/audit/scenarioRunner.ts`, etc. don't need to change. Haversine math, yardage calc, GPS quality classifier, and adaptive subscription modes all untouched.

### Shipped today (Day 1 / Fix 3 addendum)
- **Central debug-route gate** (`app/_layout.tsx`). Single `usePathname()` watcher inside `AppNavigator` redirects non-owner (and non-`__DEV__`) access away from 11 gated routes: `/gps-test`, `/acoustic-test`, `/api-debug`, `/battery-debug`, `/cage-debug`, `/ghost-debug`, `/patterns-debug`, `/plan-debug`, `/smartfinder-debug`, `/subscription-debug`, `/voice-debug`. Reuses existing `isOwnerEmail` from `store/playerProfileStore`. Per-screen `useDebugRouteGate()` calls left in place as defense in depth.

### Shipped today (Day 1 / Fix 2 addendum)
- **Arena 404 card — REMOVED + Range Mode isolated to library** (`app/(tabs)/swinglab.tsx`, `app/swinglab/range.tsx`).
  - Arena card pulled from the SwingLab launcher entirely. The route it pointed at (`/arena/practice`) has no `app/arena/` directory — was a user-visible 404 on the SwingLab tab. Verified no remaining `/arena` references anywhere in source.
  - Range Mode's `Start Session` CTA was routing to `/cage/session` (one of the 5 duplicated swing-capture surfaces flagged in the Phase 420 duplication audit). Severed that link; Start Session now routes only to the Swing Library (`/swinglab/library`). Range Mode's UI, inputs, and pre-flight planning behavior are unchanged.

### Shipped today
- **Phase 416 cleanup** (`77014bb`) — SmartMotion direct camera, overlay toggles, integrated record button. Earlier today.
- **Tools FAB + persona-aware Kevin TTS** (`a63d1b3`) — Caddie tab giant green pill replaced with small right-side chevron that expands left into tool icons. `/api/kevin` no longer hardcodes Kevin's voice for every persona (Tim flagged: "motherfucking Kevin keeps talking for Serena too"). ElevenLabs persona routing + OpenAI gender-mapped fallback (nova for Serena).
- **Phase 418 — SmartMotion validation gate** (`3cf8d11`) — Single source of truth for "is there an analyzable swing." Pose overlay, metrics, and Insight card now share one gate; floor footage no longer produces fake skeleton or fake "82 mph club speed." Added `services/swingValidity.ts`, framing tips + retake CTA, pre-record framing guide.
- **Bundle hash bump** (`e872f9b`) — trivial change to bypass an Expo asset processor that kept timing out on the prior bundle id.
- **Phase 420 — full state-of-codebase audit** (`bb3db35`) — 12 audit docs covering structure, routes, duplication, dead code, pillars, caddie, tools, recent phases, data models, build health, UX walk, and the synthesized SPRINT MAP.
- **Phase 421 — sprint context infrastructure** (this commit) — `SPRINT-LOG.md`, `SPRINT-RESUME.md`, CLAUDE.md discipline section.

### Verified on device (Z Fold)
- **Nothing this session.** All work today is "git-diff verified" / Vercel-deploys-itself. The Tools FAB layout change and the Phase 418 client-side gating are on `main` but the OTA push to preview did not land (see Notes).

### Open / carried to tomorrow
- **OTA push for `e872f9b`** failed five times with Expo asset processor timeouts on `entry-*.hbc`. Vercel will pick up the server-side validation prompt automatically; the client-side gating is in the next EAS push (or the next APK).
- **End-Round crash** ("Maximum update depth exceeded") was flagged in the prior session and is still unverified on the current bundle. P0-4 in the Sprint Map.
- **Empirical verification debt** — Phase 416, 418, the persona TTS fix, and the Tools FAB are all unproven on a real Z Fold. Day 2 should start with on-device confirmation before any new code lands.

### Notes
- **Date drift mid-session:** the conversation began on 2026-05-19 and rolled over to 2026-05-20 mid-work. Both the persona-aware Kevin fix and Phase 418/420/421 are 2026-05-20 work; SmartMotion Phase 416 was earlier (2026-05-19).
- **Phase 418 ground truth (per request):** validation gate IS in. Files present:
  - `services/swingValidity.ts` — client-side evaluateSwingValidity() with server `valid_swing` + observation-text heuristic fallback
  - `api/swing-analysis.ts` — server emits `valid_swing` + `validity_reason`, system prompt requires validity decision FIRST
  - `app/swinglab/smartmotion.tsx` — wired to gate pose skeleton, shot tracer, metrics, and Insight card
  - `app/swinglab/quick-record.tsx` — added pre-record framing dashed-rectangle guide
  - Commit: `3cf8d11`. NOT verified on device. Server fix deploys via Vercel automatically; client fix needs an OTA or next APK build.
- **Audit headline blockers** (P0 from Sprint Map):
  1. `/arena/practice` is a 404 from the SwingLab Arena card
  2. `/swinglab/range` likely also missing — verify
  3. Two parallel SmartMotion UIs still reachable via voice-intent / Tools menu / Library
  4. End-Round crash unverified on current bundle
  5. `speaker_id` declared on Shots but never written — multi-player blocker
  6. Placeholder buttons in SmartMotion (Tag Club / Compare / View Full Data)
  7. 10 debug routes ungated for non-owners
- **One audit-agent calc error caught:** the routes audit claimed `scorecard.tsx` was 35,210 LINES. It is 772 lines (35,210 BYTES). Fixed in `docs/audit-420-routes.md` before commit. The real refactor target is `app/(tabs)/caddie.tsx` at 3,870 lines.
- **A new chat resuming tomorrow should:** read [SPRINT-RESUME.md](SPRINT-RESUME.md) first, then [audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md). The full audit evidence is in `docs/audit-420-*.md`.

---

## Template for future days

```
## Day N — YYYY-MM-DD

### Shipped today
- [phase / change, commit hash]

### Verified on device (Z Fold)
- [empirically confirmed]

### Open / carried to tomorrow
- [unfinished]

### Notes
- [decisions, gotchas, what a fresh chat needs to know]
```

---

## Verification + Polish Backlog (near-term)

Items captured here are NOT today's work but live within the sprint horizon. Re-evaluate after the active P0/P1 wave settles.

### SmartFinder as "your phone is your rangefinder" — wow moment

**Positioning (honest):** SmartFinder is a GPS-based rangefinder, NOT a laser. For the target user — mid-to-high handicapper, mostly no laser rangefinder, wants club-distance not pin-precision — this is the **correct** tool, not a compromise. Front/middle/back GPS yardages are more useful for club selection than a single laser pin number.

**Accuracy reality (for honest marketing + demo copy):**
- Modern phone GPS, open sky: typically **~3-5 yards**.
- Worst case (tree cover, overcast, hillside, cold GPS): **~10-12 yards**.
- This is BELOW the noise floor of the target golfer's own shot dispersion AND below the typical club gap (~10-15y between irons). The tool is more precise than the player — so the error doesn't drive a wrong club choice. That's why it works.
- **Honest line:** *"within a few yards — close enough to pick the right club."* Do NOT imply laser/point-at-pin precision. A phone camera cannot laser-range regardless of camera quality (LiDAR ≈ 5m max, useless at golf distance). The camera's role is the VISUAL OVERLAY experience, not the measurement.

**Verify on device (tomorrow's list):**
- Camera-mode SmartFinder overlay on Z Fold — does it land the wow moment with current code? Pinch-zoom rewrite was unverified per the Phase 420 audit ([audit-420-tools.md](audit-420-tools.md)).
- Confirm the GPS-quality indicator actually surfaces to the USER when GPS is degraded — a shaky yardage shows lower confidence rather than fake precision. Same no-fake-precision principle as the Phase 418 SmartMotion validation gate.

**Polish (P2 — only if the wow doesn't land after verification, and only after consolidation closes):** if the camera overlay needs to feel more premium, treat as a polish pass. Not new feature work; not before P0/P1 wraps.

### Galaxy Watch IMU — honestly deferred, ready to build post-sprint (excluded from consolidation)

**Diagnosis (Fix F, `b0354f2`):** Watch IMU is scaffold + math + sim only. No real SDK wired, no production data path. UI is correctly defensive — nothing watch-related renders, no fake "connected" stub. The only issue was a [cage-mode.tsx](../app/swinglab/cage-mode.tsx) header comment overselling it as "all six capabilities" wired; comment corrected to mark Watch IMU as scaffold pending native SDK. **No runtime change. Cage Mode is a complete lessons tool without it.**

**Ready to build, post-consolidation:** wearables SDK access unblocked 2026-05-19 (memory `beta-wearables-sdk-access.md`). Real Watch IMU ships via an **EAS Build** (native module, NOT OTA). This is NEW construction — **excluded from the consolidation sprint per the feature-complete mandate.** Build it after the sprint, on its own EAS cycle.

**Implementation site already marked:** `services/watchService.ts` `// FUTURE: REAL SDK HOOK` block (lines 112-118). Hook delivers swing IMU events to `useWatchStore.recordSwing()` and flips `setConnected(true)`. Once wired, the existing Cage Mode UI (defensive render gates already in place) lights up automatically with zero additional plumbing.

**Do NOT add a "coming soon" UI hint in the meantime** — that would itself be a stub of a stub. Silence is the right answer for an unbuilt feature.

---

## Post-Launch Tooling Ideas

Captured to clear them off the active sprint. **Not sprint work — do not build during the consolidation sprint.** Re-evaluate after 1.0 ships.

### Club-distance-aware synthetic round (harness v2)
**What:** Upgrade the synthetic round generator so it plays golf instead of walking a path. Instead of interpolating position along fractional waypoints (tee → 1/3 → 2/3 → green) per [services/simulatedGPS.ts](../services/simulatedGPS.ts), the harness steps by realistic shot distances: tee shot ~driver carry, lands at a real position, next shot the appropriate club distance, etc., until on the green. Mock round JSON carries a shot sequence per hole (club, expected carry, resulting position) with realistic dwell at each.

**Why:** Lets the FULL interconnected round system be desk-verified in one run — club selection, club yardages, stroke count, shot logging, hole transitions, and caddie club-recommendation logic all reacting to realistic shots together. The cross-component dynamics (how these pieces talk to each other) are exactly what's hard to verify piece-by-piece. Today the harness caps observed strokes at ~2 and can't exercise shot sequencing (see Day 1 / Fix 7 diagnosis Symptom 3 — the cap is the harness emitting 1 shot at mid-fairway + a burst at the green). Harness v2 fixes that.

**What it does NOT do:** Still feeds SIMULATED position, so it still cannot exercise real-GPS hardware behavior (accuracy, signal, the `getOneShotFix` pulse that the sim guard short-circuits per Day 1 / Fix 4). Real-device round remains the only proof of GPS hardware behavior. This is a logic-coverage tool, not a GPS hardware test.

**Priority:** Post-1.0. Good debugging investment, not launch-critical. Sits with the video content engine and other post-launch tooling.

### SmartMotion estimated smash factor reads high — calibration question, not a bug

**Observation (2026-05-21):** On an 8-iron the estimated smash factor read **1.37** — at the top of the plausible iron range (real irons ~1.30-1.38). Not physically impossible, not a calculation bug — the estimate landing at the optimistic end of the valid window.

**Sprint decision: no code change.** The `(est)` label on the metric cell is the honest treatment for an approximate value. Hand-tuning the displayed number to "look right" would be faking precision and violates the no-fake-precision principle (same principle as the Phase 418 SmartMotion validation gate and the SmartFinder GPS-quality framing).

**Post-launch:** if estimated metrics consistently read high across many swings — not just a one-off — that's a CALIBRATION question for the estimation model, almost certainly over-estimating ball speed or under-estimating club speed. Can only be tuned properly against real launch-monitor ground truth (Garmin R10 / Rapsodo / SkyTrak / etc.) feeding the phone estimate alongside actual measurements so the offset can be measured and corrected per club. Sits with the launch-monitor-integration item. **Not sprint work.**

---

## Launch Prep — Business / Legal Track (parallel to fix sprint, not code)

### Terms & Conditions + Privacy Policy required for store submission (2026-05-21)

**Status:** required before App Store + Play Store submission. Both stores require a privacy-policy URL at submit time. ToS protects SmartPlay AI LLC and defines the user relationship. **Not a code item** — sits on the business/legal track in parallel with the fix sprint.

**Data profile the docs MUST cover (sensitive — generic boilerplate is insufficient):**
- Location / GPS (rounds, hole detection, SmartFinder yardages)
- Video + audio capture (swing analysis, caddie microphone)
- AI processing via third parties (Anthropic, OpenAI, ElevenLabs)
- Account info; payments (Stripe) if monetized at launch
- AI-content disclaimer: analysis / yardages / club suggestions are **estimates**, not professional or medical advice — ties to the no-fake-precision principle that runs through the whole product (Phase 418 SmartMotion gate, SmartFinder GPS-quality framing, smash-factor `(est)` label).
- Support contact: support@smartplaycaddie.com

**Plan:** Claude can draft both documents tailored to the actual data practices in a focused session — NOT in the middle of a fix cluster. Draft MUST get real legal review before publishing (paid attorney review or a compliant generator like Termly / iubenda). The combination of location + video/audio capture + AI processing + potential minor users is a real liability profile and unvetted legal text is not acceptable to ship.

**Sits with other deferred business-track items:** Apple Developer enrollment + D-U-N-S number, Stripe production configuration, App Store / Play Store assets + screenshots, App Privacy disclosures.
