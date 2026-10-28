# SmartPlay Caddie: security and IP-exposure audit (2026-10-27)

**Scope:** `~/smartplay` (the active mobile repo). This was a read-only review; no source file was changed.

**Method:** four parallel passes, one per section, each citing file:line. Every Critical and High finding was then re-read in the source by hand before it went into this report. Findings marked **(verified)** were confirmed that way.

**How to read it:**
- Anything in `app/`, `components/`, `services/`, `store/`, `lib/`, `hooks/`, `utils/` or `constants/` ships in the public JS bundle.
- `api/` holds Vercel server code.
- **UNVERIFIED** means the code alone cannot prove it. Usually that's a live dashboard setting or a deployed env var.

**Headline:** The database is clean. Paid-model keys are server-side, and the client never calls Supabase or a paid AI API directly. The exposure is in three other places:
1. **Entitlement is decided entirely on the device.** Typing a published owner address grants lifetime Pro and Owner Tools.
2. **No `api/` route that spends money checks who the caller is.** Cost control is a per-IP, in-memory limiter, and four warmup paths skip even that.
3. **Proprietary caddie logic and the persona specs ship in the bundle.**

---

## Section 1: Secrets in the client bundle

### 1a. EXPO_PUBLIC_* variables (client code)

| Variable | References | Holds | Class |
|---|---|---|---|
| EXPO_PUBLIC_API_URL | services/apiBase.ts:8,9,11,18,41,78; hooks/useCaddieTabMic.ts:475; services/intents/mediaHandlers.ts:250; services/videoTranscription.ts:96 | API base URL (eas.json:11,29,49,71,85) | SAFE |
| EXPO_PUBLIC_MAPBOX_TOKEN | services/mapboxImagery.ts:8,42; fallback utils/mapboxScale.ts:15-16 | Mapbox `pk.eyJ…` public token (eas.json:12,30,50,72,86) | SAFE by design; URL restriction UNVERIFIED |
| EXPO_PUBLIC_SENTRY_DSN | services/sentryDsn.ts:7,12,29 (fallback :24-25); services/analytics.ts:5; app/_layout.tsx:2056; store/playerProfileStore.ts:729 | Sentry DSN (write-only ingest) | SAFE |
| EXPO_PUBLIC_REVENUECAT_IOS_KEY / _ANDROID_KEY | services/billing/purchases.ts:113,114 | RevenueCat public SDK keys (`appl_…`, `goog_…` literal fallbacks) | SAFE |
| EXPO_PUBLIC_MESSAGING_KEY | services/appAuth.ts:17,27 (literal fallback :23) | Shared messaging key | SECRET-ish (a shared literal: anyone can extract it) |
| EXPO_PUBLIC_OWNER_EMAIL | app/_layout.tsx:602,685,707,711,742; store/playerProfileStore.ts:45,66,214 | Owner email; dev/preview only (eas.json:14,32) | Not a key, but it grants privilege |
| EXPO_PUBLIC_DEMO_MODE | services/kevinGreeting.ts:26,103 | flag | SAFE |

### 1b. Findings

| Finding | File:line | Severity | Move-to-server? |
|---|---|---|---|
| Meta Wearables CLIENT_TOKEN (full value) is in git history. It was committed in fb117da6 and removed from the tree in edfbbdf1, and it is still reachable from branches (e.g. `android-r8-sdk-refresh`). A prefix remains in HEAD. Rotation UNVERIFIED. | plugins/withMetaWearablesDAT.js (history, fb117da6); docs/SPRINT-LOG.md:934 | High | Y (already build-env only: plugins/withMetaWearables.js:44); **rotate** |
| Google Maps `AIza…` key is in git history from 3a5ad934 to 8cf5fd2c (eas.json env and the coursePlaces fallback). It is server-only today (services/coursePlaces.ts:11). Rotation UNVERIFIED. | services/coursePlaces.ts (history, 84b94aed); eas.json (history, 3a5ad934) | High | Y (done); **rotate** |
| A shared app key is hardcoded in the bundle and gates paid routes (image-edit, google-key-audit, swing-share, referral, issue-report). | services/apiBase.ts:69,74; api/_appKey.ts:20 (same literal as fallback) | Med | Y (replace with per-user/device auth) |
| A shared messaging key is hardcoded in the bundle. | services/appAuth.ts:23,27; services/messaging.ts:22,38; api/messages.ts:47 | Med | Y |
| The Mapbox `pk.` token has a hardcoded fallback; URL/app restriction UNVERIFIED. | utils/mapboxScale.ts:15-16 | Med | N (restrict in Mapbox) |
| The owner-usage key is user-entered and kept in AsyncStorage, which is unencrypted. | services/ownerUsage.ts:35 | Low | N (move to SecureStore) |
| Sentry DSN and RevenueCat SDK keys | services/sentryDsn.ts:24-25; services/billing/purchases.ts:113-114 | Low | N |
| No `sk-`, `sk_ant`, `AIza`, `AR\|`, `Bearer` or JWT literal in client code (apart from Mapbox `pk.`). No `.env`, `.jks`, `.p8`, `.p12` or service-account file is tracked or was ever added. | .gitignore:21,42,69 | Low (OK) | N |
| eas.json env blocks hold only API URL, Mapbox `pk.`, the Sentry upload flag, OWNER_EMAIL (dev/preview) and APP_VARIANT. app.json `extra` holds only router and eas.projectId. | eas.json:11-14,29-32,49-50,69-73,85-86; app.json:171-176 | Low (OK) | N |

---

## Section 2: IP in the client bundle

### 2a. Prompts

| Finding | File:line | Severity | Move-to-server? |
|---|---|---|---|
| **The full Kevin, Serena and Harry character specs (real LLM prompt text) ship in the bundle (verified).** `lib/persona.ts` imports all three into `PERSONA_SPECS`, and client screens import `lib/persona` (app/settings.tsx, app/paywall.tsx, app/lie-analysis.tsx, app/kevin-learning.tsx, app/tutorials.tsx and others). Only the server calls `getCharacterSpec` (api/kevin.ts:692, api/briefing.ts:74, api/preround.ts:47). | constants/kevinCharacter.ts:1-48; constants/serenaCharacter.ts:1-64; constants/harryCharacter.ts:1-99; lib/persona.ts:1-3,24-33 | High | Y |
| The golf knowledge-base modules (~7.7k lines of fault library, drills, strategy and psychology) ship through client importers. The server also injects them as prompt context (api/kevin.ts:2254-2257). | services/knowledgeBase/modules/*.ts; importers services/offlineCaddie.ts, services/swingIssueClassifier.ts, services/swingBenchmarks.ts, store/swingSessionStore.ts | Med | Y (partial; keep the offline subset) |
| The client composes several framed context blocks for the brain. It sends no system prompt, only a persona id plus context data. | services/caddieRequestBody.ts:88, 187, 354-376, 1115, 1133, 1298, 1417, 1525 | Med | Partial |
| `PERSONA_KB` is server-only by import graph today, but it lives in `services/`, so one future client import would ship it. | services/personaKnowledgeBase.ts (imported only at api/kevin.ts:725) | Low | Y (move to api/) |
| The main brain, vision, briefing and preround system prompts are server-only. | api/kevin.ts:1813,1820,895-975,2221; api/_brain.ts:43,168; api/swing-analysis.ts:329,372,411; api/briefing.ts:121; api/preround.ts:59 | — (OK) | N |
| Dialog templates are canned spoken lines, not LLM prompts. | constants/dialogTemplates/caddieTemplates.ts:146; coachTemplates.ts:251; psychologistTemplates.ts:95 | Low | N |
| One sentence of diagnostic doctrine is sent as `contextSuffix`. | services/intents/inRoundDiagnosticHandler.ts:79-80,152 | Low | N |

### 2b. Decision logic

| Finding | File:line | Severity | Move-to-server? |
|---|---|---|---|
| **The plays-like model ships with every coefficient readable:** wind ±1%/0.5% per mph, crosswind 0.1%, temperature 0.5% per 10°F, rain 2-3.5%, altitude 1.2% per 1000 ft. | utils/playsLike.ts:68,76-129; utils/windMath.ts:29 | High | Y (keep a coarse offline fallback) |
| **Club selection ladder `pickClub` and the shot composer** | services/cnsShotRead.ts:183,445 | High | Y |
| **`decideShot`, the one caddie decision every surface uses.** It is on-device and synchronous by design. | services/caddieDecision.ts:125 (rationale :119-124) | High | Y (offline fallback) |
| Hole plan and shot strategy | services/holePlan.ts:210; services/shotStrategy.ts:25 | High | Y |
| Equipment distance modifier | services/distance/equipment_distance_modifier.ts:87 | Med | Y |
| Bag recommendation and club tendencies | services/bagRecommendation.ts:141,293; services/clubTendency.ts:56-78 | Med | Optional |
| Round-condition findings | services/roundConditions.ts:84,205,264 | Med | Optional |
| Pose fault thresholds (sway 0.15/0.22, weight shift 12/4, tempo offsets 0.6/0.5) | services/swing/poseSwingRead.ts:114-115,172-179 | Med | Optional |
| Fault classifier, pro benchmarks and swing comparison. The server can already override the benchmarks (swingBenchmarks.ts:248). | services/swingIssueClassifier.ts:39,127,281,371; services/swingBenchmarks.ts:267,293,318; services/swingComparisonEngine.ts:204 | Med | Optional |
| Tempo bands and phase detection (published ratios) | services/smartTempo.ts:352,418,424,522 | Med | N |
| Acoustic strike detection (30 dB over floor, 100 ms attack, 15 dB decay in 250 ms, 500 ms debounce). It must run on device for real time. | services/swing/strikeDetector.ts:22-50,104,247; services/acousticImpactDetector.ts:193,411; services/acousticsAnalyzer.ts:106,196 | Med | N |
| Handicap math uses the public WHS/USGA formulas. | services/handicapCalculator.ts:36,66,79,156 | Low | N |
| Elevation plays-like delta (fetched via /api/elevation) | services/elevationService.ts:48,61 | Low | N |

### 2c. Direct client calls to third parties

| Finding | File:line | Severity | Move-to-server? |
|---|---|---|---|
| **No direct client call** to Anthropic, OpenAI, Deepgram, Golfbert, Gemini, Google Maps/Places, golfcourseapi, OpenWeather, Overpass or Supabase. Course search, weather, STT and referral all go through api/. | services/golfCourseApi.ts:480,641; services/weatherService.ts:216; hooks/useCaddieTabMic.ts:478; services/billing/referral.ts:30 | — (OK) | N |
| Mapbox static satellite imagery is fetched straight from the client with the public `pk.` token. | services/mapboxImagery.ts:42,228-232,499-503,537-540 | Low | N (restrict the token) |
| The MediaPipe runtime loads from a CDN: a supply-chain dependency with no credential. | components/FrameEngineHost.tsx:266-268 | Low | N (pin or self-host) |
| Reachability probes, outbound deep links, YouTube oEmbed (host construction UNVERIFIED) | services/reachability.ts:61,67; services/teeTimeLink.ts:36,85,98; services/swingDatabase.ts:547 | Low | N |

---

## Section 3: Entitlement and access bypass

### How OWNER_EMAILS grants entitlement (verified, step by step)

1. **The email is unverified client state.** Settings → Profile → "Account email" writes every keystroke straight to the persisted store (components/profile/ProfileForm.tsx:400 → store/playerProfileStore.ts:559). There is no OTP or link check.
2. **The list ships in the bundle and includes the published support address.** `OWNER_EMAILS` (store/playerProfileStore.ts:52-60) holds `support@smartplaycaddie.com` and `tim@smartplaycaddie.com`. `isOwnerEmail` is a case-insensitive string compare (:62-68).
3. **The UI confirms a match.** It shows "owner tools unlocked" once the typed text matches (ProfileForm.tsx:407).
4. **The grant.** On launch, `isOwner = isOwnerEmail(email) || OWNER_EMAIL env non-empty` (app/_layout.tsx:742). `planTrialLifecycle` then returns `grantLifetime` (services/billing/trialLifecycle.ts:99), which persists `subscription_status: 'lifetime'`, a Pro status (services/featureAccess.ts:139,148-151). The paid-screen gate also passes any owner email whatever the status (hooks/useEntitlementGate.ts:37).
5. **What it unlocks:**
   - every Pro feature;
   - Owner Tools (app/settings.tsx:1757);
   - the debug and owner routes (hooks/useDebugRouteGate.ts:27; app/_layout.tsx:288; app/owner-console.tsx:245; app/harness.tsx:261);
   - paywall preview (app/paywall.tsx:89) and shelved routes (services/releaseSurface.ts:91-123).
6. **No server or RevenueCat re-check.** No file in `api/` reads RevenueCat, `subscription_status`, `isPro`, entitlement or owner fields. The client-side RevenueCat read is designed not to clobber an owner's lifetime (services/billing/redeemCode.ts ~:55-80). The code comment that calls this "not reachable without the mailbox" (playerProfileStore.ts:37-40) is false.

| Finding | File:line | Severity | Move-to-server? |
|---|---|---|---|
| **Typing a published owner address grants lifetime Pro and Owner Tools, with no verification (verified).** | components/profile/ProfileForm.tsx:400,407; store/playerProfileStore.ts:52-68; app/_layout.tsx:742; services/billing/trialLifecycle.ts:99; hooks/useEntitlementGate.ts:37 | **Critical** | Y |
| **No server entitlement check on any paid inference route.** Pro gating exists only in the app; the API serves anyone who calls it. | api/kevin.ts:304; api/caddie-voice.ts:45; api/voice.ts:51; api/lie-analysis.ts:161; api/pose-analysis.ts:135; api/swing-analysis.ts:876 (see Section 4) | **Critical** | Y |
| The voice caddie gate is client-only (`mayTalkToCaddie` reads zustand). | services/featureAccess.ts:226-230; callers services/caddieBrain.ts:66, services/conversationalBrain.ts:81, services/presenceCaddie.ts:83, services/sceneReadService.ts:53, hooks/useVoiceCaddie.ts:1293 | High | Y |
| The SmartVision gate is client-only. | app/smartvision.tsx:343; app/(tabs)/caddie.tsx:2084,2116; app/(tabs)/play.tsx:2170 | High | Y |
| The SmartFinder gate is client-only. | app/smartfinder.tsx:121; services/measureScan.ts:60; app/(tabs)/caddie.tsx:2455,3741 | High | Y |
| The SmartMotion (cage mode) gate is client-only. | app/swinglab/smartmotion.tsx:1346 | High | Y |
| Lie analysis and SwingLab upload have no edition gate at all, only a kill flag. Whether they are meant to be paid is UNVERIFIED (currently liberal by design). | app/lie-analysis.tsx:52; app/swinglab/upload.tsx:45; services/featureAccess.ts:45-50 | Med | Y |
| `feature_edition` defaults every feature to `lite`, applied on the client. The live Edge Config value is UNVERIFIED. | api/flags.ts:56-61; services/featureAccess.ts:165-170 | Med | N (intentional for now) |
| Preview and development builds are owner builds for every device on those channels. | eas.json:14,32; app/_layout.tsx:742 | Low | N (internal distribution only) |

### OTA owner guard

| Finding | File:line | Severity | Move-to-server? |
|---|---|---|---|
| **It still blocks a production OTA when `EXPO_PUBLIC_OWNER_EMAIL` is set** in the shell, `.env.local`, `.env.development.local`, `.env.production.local` or `.env`. It exits 1 with no override. A read-only run today printed "not set. Safe to publish". | scripts/ota-owner-guard.mjs:40,55-61,67-91; wired at package.json:29 (`ota:production`) and the production build scripts :23,25,33 | Low (OK) | N |
| It does not check `.env.production` / `.env.development` (none exist today) or EAS server env (UNVERIFIED whether `eas update` reads it). | scripts/ota-owner-guard.mjs:40 | Med | N |
| The runbook tells you to run a raw `eas update --branch production`, which skips the guard. Only `npm run ota:production` runs it. | docs/OTA-RUNBOOK.md:33; docs/ENGINEERING-PRINCIPLES.md:101; docs/HANDOFF.md:59 | Med | N |
| CI does not run the owner guard. | .github/workflows/ota-guard.yml | Low | N |

---

## Section 4: Backend exposure

**Shared mechanics:**
- **No global middleware.** There is no `middleware.ts`; vercel.json is routes only.
- **App key.** `requireAppKey` (api/_appKey.ts:24-41) falls back to the bundled literal (:20), so it is a public value.
- **Rate limits.** `allowInference` (api/_inferLimit.ts:39-52) counts per IP from `x-forwarded-for` (:23-27), in memory per serverless instance (api/_rateLimit.ts:18-34). The default is 60/min. It resets on cold start and is not shared between instances. Whether Vercel overwrites a client-supplied XFF is UNVERIFIED.
- **CORS** (api/_cors.ts:13-40) does not stop native or curl callers.
- **No Supabase JWT, signed token or cron secret is checked on any endpoint.**

| Finding | File:line | Severity | Move-to-server? |
|---|---|---|---|
| **The warmup path makes paid calls before any rate limit (verified):** kevin warmup fires an OpenAI TTS call plus a provider warm call and returns before `allowInference`. The same pattern is in voice, voice-intent and kevin-read. | api/kevin.ts:276-288 (limiter only at :304); api/voice.ts:51,67-70; api/voice-intent.ts:763,769-777; api/kevin-read.ts:146,150-152 | **Critical** | N/A: add auth, or make warmup free/limited |
| **`/api/owner-triage` is unauthenticated and calls Anthropic (verified).** The owner check exists only in the UI, as the file's own comment admits. | api/owner-triage.ts:16-19,94,148; app/owner-logs.tsx:102,488 | **Critical** | N/A: require `x-owner-key` like api/owner-usage.ts:70-72 |
| **About 45 paid-model routes have no auth and only the per-IP in-memory limit:** kevin (Anthropic agentic loop :2818), swing-analysis (:909,1037,1099), lie-analysis (:269,303), putting-analysis, junior-swing-analysis, swing-question, cage/swing-review, ball-departure, ball-path, club-path, club-recognition, bag/space/hole/target/measure-scan, course-verify (up to 36 vision calls per request, :33,105), round/workout/course/arccos-import, toptracer-parse, tutorial-analysis, briefing, recap, preround, caddie-voice, parse-shot, context-synthesis, narrative-extract, course-content, course-intelligence, course-ai-search, meta-voice, transcribe (Deepgram :121), pose-analysis (RapidAPI :178), course-geometry/proxy (golfcourseapi), course-locate/places (Google Places), youtube-search. | e.g. api/kevin.ts:304; api/swing-analysis.ts:876; api/lie-analysis.ts:161; api/course-verify.ts:127; api/transcribe.ts:60; api/course-locate.ts:463 | High | N/A: add per-install auth plus a shared (KV) limiter |
| **messages IDOR:** with the bundled key, `GET ?user=<email>` returns that user's thread. The only bound is the `MESSAGING_ALLOWED_EMAILS` allow-list; when it is unset, any email is allowed (verified, :24-32). Whether the env var is set is UNVERIFIED. | api/messages.ts:24-32,47,71-77; services/appAuth.ts:23 | High (Critical if the env var is unset) | N/A: add real auth |
| **swing-share revoke:** anyone with the bundled key can revoke any share by its public id. There is no `creator_hash` check (verified). | api/swing-share.ts:166-176 | High | N/A: check the creator |
| image-edit (Gemini and OpenAI image calls) is gated only by the bundled key. | api/image-edit.ts:63,96,117,155-156 | High | N/A: add real auth |
| google-key-audit is gated only by the bundled key and has no rate limit. | api/google-key-audit.ts:34,60-70,99 | High | N/A: owner secret |
| health makes full-probe calls to Anthropic, OpenAI and Gemini (3 provider calls per hit) without auth. | api/health.ts:57,81,105,159 | Med | N/A: secret for the full probe |
| meta-voice reads `user_id` from the body and trusts it for the per-user limit, so the limit is spoofable. | api/meta-voice.ts:131,436,446 | Med | N/A |
| course-geometry-share writes crowd-sourced geometry without auth, so the map can be poisoned. | api/course-geometry-share.ts:53; api/_courseCloud.ts:136,281 | Med | N/A: add auth or review |
| course-verify has a hardcoded Mapbox fallback token (public `pk.` UNVERIFIED). | api/course-verify.ts:91 | Low | N |
| acoustic-detect has no limit; it does local DSP on a body of up to ~7 MB. | api/acoustic-detect.ts:30,86 | Low | N/A: add `allowInference` |
| These are fine: backup is keyed by email plus passphrase hash, owner-usage has a server secret, and flags, weather, elevation, usage, glasses-return and the well-known files are free or low risk. | api/backup.ts:142-143,170-179; api/owner-usage.ts:70-72; api/flags.ts:95; api/weather.ts:23 | Low (OK) | N |

### Supabase

**The client never touches Supabase.** Client dirs have no `createClient`, `rest/v1`, anon key or `EXPO_PUBLIC_*SUPABASE*`. The only client is server-side and uses the service role (api/_supabase.ts:47,56-62), pinned to the `smartplay` schema. No service-role key is reachable from client code.

| Table | Client access | RLS (file:line) | Severity |
|---|---|---|---|
| usage_events | none (api/usage) | RLS + deny-all: supabase/migrations/0001_smartplay_init.sql:61,74 | Low |
| messages | none (api/messages) | RLS + deny, grants revoked: supabase/migrations/0003_backups.sql:79-82 (table created in 0002_messages.sql). Exposure is through the API (see the IDOR above). | Low (DB) / High (API) |
| backups (legacy) | none | RLS + own-row policies, anon revoked: 0003:38,43-51,67 | Low |
| device_backups | none (api/backup.ts:28) | RLS + revoke: 0004:20,23 | Low |
| backup_rate_limit | none (api/backup.ts:177) | RLS on, no policy: 0005:15 | Low |
| course_geometry, course_geometry_reports, issue_reports | none (api/_courseCloud.ts, api/issue-report) | RLS + revoke: 0006:76-78,81-83 | Low |
| swing_shares | none (api/swing-share) | RLS + revoke: 0008:57,66 | Low |
| referrals | none (api/referral) | RLS + revoke: 0009:55,63 | Low |
| (future tables) | — | Default grants removed: 0007_default_privileges_lockdown.sql:15 | Low |

Whether these migrations are applied to the live project is UNVERIFIED from code.

---

## Top 5: what to move server-side first

1. **Verify entitlement and owner status on the server, and close the owner-email bypass today.**
   - **Now:** remove `support@` and `tim@` from `OWNER_EMAILS` (store/playerProfileStore.ts:52-60).
   - **Proper fix:** owner = a server-checked owner key (the `x-owner-key` pattern at api/owner-usage.ts:70-72), never a typed email. Pro = a server lookup of the RevenueCat subscriber with the REST secret key by app_user_id, or a short-lived signed entitlement token, required by the Pro inference routes.
   - **Why first:** a Critical anyone can find from the Settings screen, and it chains into free paid inference.
2. **Put auth and a real limiter in front of every paid `api/` route, and stop warmups from spending.**
   - Make warmup free: drop the TTS/LLM call, or move it behind `allowInference` (api/kevin.ts:276-304; voice, voice-intent, kevin-read).
   - Lock `/api/owner-triage` with the owner key (api/owner-triage.ts:94).
   - Replace the in-memory per-instance limiter (api/_rateLimit.ts:18) with a shared store (Vercel KV/Upstash) keyed by install id plus IP.
   - Add a per-install signed token in place of the bundled app key (api/_appKey.ts:20, services/apiBase.ts:69).
   - **Why:** this is the open cost hole; it needs no client edit to exploit.
3. **Move the persona character specs off the client.** Split `PERSONA_SPECS` / `getCharacterSpec` (lib/persona.ts:1-3,24-33) into an `api/`-only module, leaving the client only the persona ids and names. Move `services/personaKnowledgeBase.ts` under `api/` so it can never be imported by the client.
   - **Why:** it's the most copyable IP (the persona voices) and the cheapest fix; the server is already the only reader.
4. **Move the caddie decision core to the server, with a coarse offline fallback on the device.** That means `decideShot` (services/caddieDecision.ts:125), `pickClub` (services/cnsShotRead.ts:183), the plays-like coefficients (utils/playsLike.ts:76-129), the hole plan and shot strategy (services/holePlan.ts:210, services/shotStrategy.ts:25), and the equipment modifier.
   - **Why:** this is the "smart play" moat, and it ships readable today.
5. **Close the two data-integrity holes in shared-key routes.**
   - **messages:** require a per-user token; at minimum, confirm `MESSAGING_ALLOWED_EMAILS` is set (api/messages.ts:24-32).
   - **swing-share:** check `creator_hash` before a revoke (api/swing-share.ts:174-176).
   - **image-edit and google-key-audit:** put the owner key in front of both.

**Also do now (not a move-to-server):**
- Rotate the Meta Wearables client token and the Google Maps key that are in git history. Both rotations are UNVERIFIED.
- Restrict the Mapbox `pk.` token to the app bundle IDs.
- Change docs/OTA-RUNBOOK.md:33 to `npm run ota:production` so the owner guard always runs.

---

## Fix status (2026-10-27)

Server-only changes shipped first (Critical #3, then #2), then the client (#1), then caller identity. Every commit staged explicit paths only; another session's uncommitted work was never included.

| Critical | What changed | File:line | Commit |
|---|---|---|---|
| **#1: typed owner email granted lifetime Pro and Owner Tools** | **Removed.** `OWNER_EMAILS` and `isOwnerEmail` are deleted, and so are the support@ and tim@ entries. `isOwnerBuild()` is true only when the build carries `EXPO_PUBLIC_OWNER_EMAIL`, which only the eas.json development and preview profiles set; `scripts/ota-owner-guard.mjs` (unchanged) still refuses a production OTA while it is set. All ~30 call sites use it, and none reads the email. The lifetime grant is deleted: the `grantLifetime` action, planner rung 2, and the env→profile email mirror in `_layout`. The existing planner rule clears any leftover `lifetime` to `free` on the next launch, which also revokes anyone who already used the trick. An owner build gets Pro only at the one access check. The Profile form no longer confirms a typed owner address. | store/playerProfileStore.ts:23; services/featureAccess.ts:178,181; services/billing/trialLifecycle.ts:124 | 56b3acc5 |
| **#2: warmup made paid calls, some before the rate limiter** | **Removed.** All six warmup branches return 200 before any provider call: kevin (was LLM + TTS), voice (TTS), voice-intent (LLM json), kevin-read and briefing (LLM ping), swing-analysis (Gemini ping). The dead `WARMUP_SYSTEM`/`WARMUP_USER` constants are gone. **Code path:** `mode === 'warmup'` → `return res.status(200)…` with nothing in between. **Tradeoff:** the first real call on a cold Lambda pays provider TLS/SDK setup again (~0.5–2 s). | api/kevin.ts:279; api/voice.ts:54; api/voice-intent.ts:764; api/kevin-read.ts:149; api/briefing.ts:18; api/swing-analysis.ts:884 | ce68fc3e |
| **#3: /api/owner-triage unauthenticated, calling Anthropic** | **Deleted.** Its only caller was the app's own Triage button, so a header secret would have had to ship in the bundle. The route file, its vercel.json build and route entries, and the client button are all gone. Live check after deploy: `POST https://api.smartplaycaddie.com/api/owner-triage` returns **HTTP 404**. | api/owner-triage.ts (deleted); vercel.json; app/owner-logs.tsx | 90ff42f8 (server), 56b3acc5 (client button) |

**Proof the gates are real** (each was run against the broken behavior and failed):
- `__tests__/regression/a-warmup-spends-nothing.test.ts` calls every warmup handler with the provider SDKs mocked: 6/6 failed before the fix, 6/6 pass after.
- `watch-owner-gate` "an owner email TYPED into a player build gets nothing" fails when a typed email is honoured.
- `a-paid-screen-checks-its-own-door` "a TYPED owner email on a player build is gated like anyone else".
- The sim LOCK "owner is the build — no email allow-list, no lifetime grant".

**Net diff, Critical #1–#3 (90ff42f8, ce68fc3e, 56b3acc5):** +254 / −998 lines.

### Section 4: caller identity on paid endpoints (log-only), commit 1c8dca2c

- **Client:** `services/callerIdentity.ts` installs one fetch wrapper when billing configures (services/billing/purchases.ts:181). Every request to our API carries `x-rc-app-user-id` = the RevenueCat appUserID. No other host sees it.
- **Server:** `api/_callerIdentity.ts` verifies `smartplay_caddie_pro` via the RevenueCat REST API, caches answers for 5 min, and logs each verdict (pro / no_entitlement / missing_id / invalid_id / unverified) as a Vercel log line plus a Sentry event with tags and a breadcrumb.
- **Wiring:** `api/_inferLimit.ts:57`. `allowInference`, which all 55 paid call sites use, starts the check without awaiting it, so every request is served and no latency is added.
- **The one-line flip to enforce:** `api/_callerIdentity.ts:18`

  ```diff
  - export const ENFORCE_CALLER_IDENTITY = false;
  + export const ENFORCE_CALLER_IDENTITY = true;
  ```

  `allowInference` then awaits the verdict and answers 402 to anything that is not `pro`.
- **Before flipping:**
  1. `REVENUECAT_SECRET_KEY` is **not set on Vercel** (verified with `vercel env ls production`), so every verdict is `unverified` today.
  2. Old app builds send no header (`missing_id`) until the app update carrying 1c8dca2c reaches them.
  3. With `feature_edition` all `lite`, enforcing would 402 every free player. Enforce only once the Pro routes are meant to be paid.

### Found while fixing

- **Messages IDOR is live.** `MESSAGING_ALLOWED_EMAILS` is not set on Vercel (`vercel env ls production`), so with the bundled messaging key, `GET /api/messages?user=<email>` returns anyone's thread (api/messages.ts:24-32,71-77). Severity: **Critical**. Fastest fix: set that env var to the two participants.
- **Tim's own production install is no longer an owner.** Owner Tools and owner Pro now need a development or preview build.
- **App Review.** `tim@smartplaycaddie.com` was the Google Play review sign-in that reached paid features. Every feature is `lite` today, so review is not blocked. When Pro gates come back, reviewers need a sandbox purchase or a promo, not an email.
