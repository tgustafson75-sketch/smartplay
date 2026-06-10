# SmartPlay Caddie — clean-slate handoff & audit prompt

Paste this into a new chat to continue with full context.

## Context
- **Real repo:** `/Users/timothyg/smartplay` (NOT the `smartplaycaddie` stub). Expo SDK 54 / RN 0.81 / Hermes, expo-router, Zustand+persist, TypeScript.
- **I test on ANDROID ~95% of the time.** Weigh fixes accordingly (e.g. `videoExportPreset` is iOS-only; `MediaMetadataRetriever` quirks are Android).
- **Validate every change:** `npx tsc --noEmit` (0 errors), `npm run lint` (baseline = 3 pre-existing require() warnings, 0 errors), `npx tsx scripts/simulations/run-sim.ts` (currently 236 scenarios, all pass).
- **Deploy:** commit to `main` → push (Vercel auto-deploys API) → if api/ changed, re-point the pinned alias `vercel alias set <deploy> smartplay-beta.vercel.app` and verify → `npx eas update --branch production` AND `--branch preview` (OTA). `EXPO_PUBLIC_API_URL=https://smartplay-beta.vercel.app`.
- **Caddie Brain lens (standing rule):** evaluate everything with *"does it belong in the Caddie Brain?"* — route brain responsibilities (player model, what-to-compute, language register, learned state) through the CNS; keep presentation/infra as clean utilities the brain consumes.

## What's LIVE on main (shipped)
- **Caddie CNS Phase 1** (`store/caddieMemoryStore.ts` — learned bag/tendencies/course memory) + **Phase 2** (`services/caddieMemoryRetrieval.ts` `getCaddieContext()` folded into the brain's `unified_context_block`). Additive, honest (null until enough samples), bounded.
- **Fail-safe caddie/voice:** circuit breaker never blocks (`isDegraded` always false), no auto-Local-Mode; brain has a minimal-body retry; honest local fallbacks. (See [[caddie-failsafe-no-walls]].)
- **Honest networking:** timeouts no longer mislabeled "lost connection"; client timeout 63s > server 60s.
- **Provider architecture:** Anthropic = spine (Haiku→Sonnet), Gemini = fast fallback (re-enabled), OpenAI = ears/mouth only (removed from analysis).
- **Analysis pretext:** angle (DTL/FO), handedness, ball anchor, CNS-learned tendencies fed to the analyzer.
- **Acoustics-free uploads:** AI swing localizer + duration-scaled sampling.
- **B1 tier foundation** (`constants/handicapTiers.ts` — `deriveTier`, `tierToComplexity`, centralized thresholds; behaviour-neutral).
- **Clip persistence** (`persistClipToDocuments` — uploads + recordings copied to documentDirectory so they replay/re-analyze).
- **Issue log** now covers GPS + voice + **analysis/app failures** (`addAppEvent`, kinds `analysis_error`/`app_error`); frame-extraction failures log `frame_extraction_empty` with uri scheme + errors.
- **Foot anchors** corrected (face-on feet ABOVE ball; down-the-line feet to the SIDE along the line).
- Caddie Clip Test owner tool removed.

## OPEN — top priority to confirm/fix
1. **Re-analyzing existing ANDROID uploads fails (video plays, won't analyze).** Root cause: `expo-video-thumbnails` (`MediaMetadataRetriever`) fails to extract frames from some camera-roll clips (HEVC / variable-frame-rate) that ExoPlayer plays fine. Mitigations shipped: jittered retry, tentative fallback, honest "re-upload" message, `probeDurationMs` 8s hang-guard. **Next:** reproduce on device, read the owner Issue Log entry `frame_extraction_empty` (it shows the uri scheme + the exact thumbnail error) to CONFIRM the cause, then implement the real fix — either transcode the picked clip to constant-frame-rate H.264 (e.g. ffmpeg-kit) or extract frames via an ExoPlayer/expo-video seek surface instead of MediaMetadataRetriever. Also consider re-persisting legacy `content://` clips to documents on first open.
2. **Clip-storage GC:** persisted clips aren't deleted when sessions age out of the 50-session window → storage grows. Add a cleanup pass.

## PARKED on branch `feature/tier-language-system` (undeployed, awaits Tim's deploy approval)
- **B2 compute budget** (WIP): `computeBudgetForHandicap` + gating the heavy pose/biomech pass by tier (speed: less compute for higher handicaps; data-driven, not "dumbing down").
- **Then B3** (language register: jargon→plain by tier in prompts + UI) and **Track A localization**: i18next + es/zh are wired and the caddie SPEAKS es/zh, but only ~2% of static UI strings use `t()` — **~1,526 hardcoded strings across ~135 files** (run `npx tsx scripts/audit/i18nAudit.ts`). Sequence: extract strings AFTER B3 finalizes tier-varied copy so each is translated once. High-traffic-first (onboarding → caddie → round → SmartMotion → recap).
- Tim wants the whole tier/language bundle completed + tested on the branch, then ONE deploy on his word.

## CNS roadmap (Tim wants these in the plan — AFTER the tier/language work)
- **Phase 3 — learning/reflection loop:** an Anthropic round-summary pass that distills each round into durable `reflections`/per-course notes (must respect the tier register).
- **Phase 4 — signal-independence:** on a repeat course with weak GPS/network, answer from course memory (your typical line/club/yardage) instead of live signal. Both should consume the tier `computeBudget`.

## Audit instructions for the new chat
Do a deep, skeptical, read-only audit FIRST (no changes until confirmed). Priorities:
1. Confirm the Android re-analyze root cause from a real device repro + the `frame_extraction_empty` issue-log entry; propose the real frame-extraction fix.
2. Re-verify the analysis path end-to-end (upload + SmartMotion record + re-analyze) for any stranded-spinner / no-terminal-status path.
3. Data→UI honesty sweep (no fabricated metrics shown as measured).
4. Then proceed with the parked tier/language plan (B2→B3→Track A) on the branch, tested, deploy only on Tim's approval.
Always: tsc + lint + 236-scenario sim green before commit; two audit passes to zero bugs on anything substantial.
