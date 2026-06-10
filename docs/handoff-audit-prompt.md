# SmartPlay Caddie — new-session handoff (clean slate + full audit)

Paste this into a new chat to start fresh. `main` is clean, validated, and
deployed; there is **no half-finished work to pick up** — start with a full
audit, then act on what you find.

## Context
- **Real repo:** `/Users/timothyg/smartplay` (NOT the `smartplaycaddie` stub). Expo SDK 54 / RN 0.81 / Hermes, expo-router, Zustand+persist, TypeScript.
- **I (Tim) test on ANDROID ~95% of the time.** Weigh fixes for Android (e.g. `videoExportPreset` is iOS-only; `MediaMetadataRetriever`/thumbnail quirks are Android).
- **Validate every change:** `npx tsc --noEmit` (0 errors), `npm run lint` (baseline = 3 pre-existing require() warnings, 0 errors), `npx tsx scripts/simulations/run-sim.ts` (238 scenarios, all pass). Two audit passes to zero bugs on anything substantial.
- **Deploy:** commit to `main` → push (Vercel auto-deploys API) → if `api/` changed, `vercel alias set <deploy> smartplay-beta.vercel.app` + verify → `npx eas update --branch production` AND `--branch preview`. `EXPO_PUBLIC_API_URL=https://smartplay-beta.vercel.app`.
- **Standing rule — Caddie Brain lens:** evaluate everything with *"does it belong in the Caddie Brain?"* Route brain responsibilities (player model, what-to-compute, language register, learned state) through the CNS; keep presentation/infra as clean utilities the brain consumes.

## What's complete & live (don't rebuild)
- **Caddie CNS — all four phases:** Phase 1 memory store (`store/caddieMemoryStore.ts`), Phase 2 retrieval (`services/caddieMemoryRetrieval.ts` → `unified_context_block`), Phase 3 round reflections (endRound baseline + recap LLM enrichment, deduped by round), Phase 4 signal-independence (`getCourseHoleGuidance` → on-course local responder answers from memory when GPS is weak). All additive, honest (null until enough real samples), bounded.
- **Fail-safe caddie/voice:** breaker never blocks (`isDegraded`→false), no auto-Local-Mode; brain has a minimal-body retry + local fallback (never "no network" walls).
- **Honest networking:** timeouts not mislabeled "lost connection"; client 63s > server 60s.
- **Providers:** Anthropic = spine, Gemini = fast fallback, OpenAI = ears/mouth (out of analysis).
- **Analysis pretext:** angle (DTL/FO), handedness, ball anchor, CNS tendencies fed to the analyzer; acoustics-free uploads via swing localizer.
- **Clip persistence:** uploads + recordings copied to documentDirectory (replay/re-analyze survive). `probeDurationMs` has an 8s hang-guard; frame extraction retries jittered times.
- **Issue log** covers GPS + voice + **analysis/app failures**; empty frame extraction logs `frame_extraction_empty` (uri scheme + thumbnail error) to /owner-logs.
- **B1 tier constants** (`constants/handicapTiers.ts`, behaviour-neutral). Foot anchors corrected (FO above ball, DTL to the side). Caddie Clip Test owner tool removed.

## Known OPEN threads (audit + decide; not blocking)
1. **Android re-analyze of some existing uploads** (video plays, won't analyze): root cause is `expo-video-thumbnails`/`MediaMetadataRetriever` failing on certain camera-roll codecs/VFR that ExoPlayer plays. Mitigated (jittered retry, tentative fallback, honest "re-upload" message). **Confirm on-device** via the `/owner-logs` `frame_extraction_empty` entry (shows the exact error + uri scheme), then implement the real fix: transcode picked clips to constant-frame-rate H.264 (e.g. ffmpeg-kit) OR extract frames via an ExoPlayer/expo-video seek surface instead of MediaMetadataRetriever. Also: re-persist legacy `content://` clips to documents on first open.
2. **Clip-storage GC:** persisted clips aren't deleted when sessions age out of the 50-session window → storage grows. Add a cleanup pass.
3. **Optional/experimental:** a `feature/tier-language-system` branch holds early B2 (compute-budget gating of heavy pose/biomech by tier) + plans for B3 (jargon→plain register by tier) and Track A (full UI localization — i18next+es/zh are wired and the caddie SPEAKS es/zh, but only ~2% of static UI strings use `t()`; ~1,526 hardcoded across ~135 files — run `npx tsx scripts/audit/i18nAudit.ts`). NOT on main; pick up only if Tim asks.

## First task for the new session
Do a deep, skeptical, **read-only full audit FIRST** (no changes until confirmed), prioritizing:
1. The Android re-analyze root cause (confirm from a device repro + the `frame_extraction_empty` log) and propose the real frame-extraction fix.
2. Analysis paths end-to-end (upload + SmartMotion record + re-analyze + putt) for any stranded-spinner / no-terminal-status path.
3. Data→UI honesty (no fabricated metric shown as measured).
4. CNS correctness (reflections dedupe, signal-independence fallback) under real round data.
Then act on findings with Tim's go-ahead. Keep tsc + lint + 238-sim green; two audit passes to zero bugs on anything substantial.
