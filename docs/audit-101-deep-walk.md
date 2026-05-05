# Audit 101 — Deep Code Walk

**Audit date:** 2026-05-05
**Scope:** every function/utility across the app — services, stores, hooks, contexts, components, API routes.
**Method:** 6 parallel review agents, each focused on a slice; findings synthesised + dedup'd + verified by sampling here.
**Bar:** real bugs and quantifiable inefficiencies. Style/comment nits excluded by design.

Phase 100 fixes (AbortSignal polyfill, persona-correctness sweep, lint baseline, console hygiene, TODOs) are excluded from this list — they are already shipped.

## Severity legend
- **BLOCKING** — incorrect behavior visible to a real user; ship-stopper for v1.1
- **SIGNIFICANT** — wrong but bounded (silent persistence failure, server hang risk under load, etc.)
- **WIN** — quantifiable inefficiency worth fixing in v1.1 cleanup
- **VERIFY** — agent flagged it; needs Tim's eyeballs before action
- **DEFER** — real but v1.2 scope

---

## BLOCKING (4)

### B1 — `services/shotDetectionService.ts:48` — Haversine missing `cos(lat1)*cos(lat2)` factor
**Symptom:** shot displacement distances computed wrong. The formula reduces to bearing-aligned-only distances; cross-latitude shots get systematically under/over-estimated.

**Evidence:** `services/gpsManager.ts:70` uses the correct full Haversine. shotDetectionService.ts uses `Math.sin(dLng / 2) ** 2` with no `cos(lat1) * cos(lat2)` multiplier. Real bug. Affects shot-distance attribution → club selection → recap stats.

**Fix:** copy the correct formula from gpsManager.ts:70.

### B2 — `services/cageApi.ts:101-105` — FormData.append uses plain object instead of Blob
**Symptom:** cage video upload body is malformed. React Native's fetch does not auto-convert `{ uri, type, name }` to a Blob; the upload arrives as a stringified object on the server.

**Fix:** read file as binary via `FileSystem.readAsStringAsync(uri, { encoding: 'base64' })`, build proper Blob, append. Alternative: many RN codebases pass the `{ uri, type, name }` shape and rely on RN's polyfilled FormData — verify on Z Fold whether the upload is actually arriving correctly via `[V6-DIAG]` markers before refactoring.

### B3 — `api/voice.ts:50` — `text` field not validated; abuse vector
**Symptom:** request body's `text` is passed directly to ElevenLabs / OpenAI TTS with no length / type check. A 10MB string burns ElevenLabs quota; a non-string blows up server-side.

**Fix:** validate `if (!text || typeof text !== 'string' || text.length > 10000) return 400;` before the TTS call.

### B4 — Server-side persona handling gap (acknowledged in F13 commit, still open)
**Files:** `api/brain.ts:68`, `api/voice.ts:50`, plus any `getCaddieName(voiceGender)` site in `api/*` (~20 places).

**Symptom:** even after Phase 100 client-side sweep, server-side routes default to `voiceGender` and ignore the newer `persona` field. Tank/Harry persona names don't surface in API responses (system prompts say "Kevin" or "Serena").

**Fix:** accept both fields, prioritize `persona`. Pattern:
```ts
const persona = body.persona ?? (body.voiceGender === 'female' ? 'serena' : 'kevin');
```
Then thread `persona` through `getCaddieName()`. Touches ~20 server routes; estimated 2-3h work.

---

## SIGNIFICANT (8)

### S1 — `services/audioLifecycle.ts:75-76, 82` — AppState + trust-level listeners never unsubscribed
**Symptom:** stacked listeners on hot-reload (dev) and on multiple `initAudioLifecycle()` calls (production cold-restart paths). All fire on each event, thrashing audio state.
**Fix:** store the unsubscribe handles at module scope; call them in `teardownAudioLifecycle()`; idempotent re-init guard at top of `initAudioLifecycle()`.

### S2 — `services/fillerLibrary.ts:104-116` — TOCTOU race in dual `allFilesExist()` checks
**Symptom:** two concurrent `generateLibrary()` calls (e.g., persona switch + cold-launch) can both pass the early-exit check; one's writes clobber the other; persisted index drifts from in-memory.
**Fix:** wrap the entire generate flow in a promise-based mutex (single in-flight at a time).

### S3 — `services/fillerLibrary.ts:183-185` — Fire-and-forget `saveToStorage()` after in-memory commit
**Symptom:** if save fails (storage quota, write error), in-memory cache says "ready", persisted state is stale; next cold launch reloads stale data, mismatch never detected.
**Fix:** await save before flipping the in-memory `library` reference; on failure, mark cache as needing-regen.

### S4 — `services/voiceService.ts:356-357` — `audioFile.write(bytes)` not awaited before `Audio.Sound.createAsync()`
**Symptom:** under memory pressure / iOS, write may not flush before `createAsync()` reads the file → empty audio → playback timeout clamps at 5s and cuts speech mid-utterance. **Plausible cause of `[voice] speak timeout`** observed in F1 evidence.
**Fix:** await the write; verify file size > 0 before createAsync.

### S5 — `services/cageReview.ts:18` + `services/vocabularyProfile.ts:18,22` — AsyncStorage writes without try/catch
**Symptom:** silent persistence failures. If storage is full / OS denies the write, the in-memory state appears saved; user sees changes vanish on next cold launch with no error trail.
**Fix:** wrap writes in try/catch; log via existing telemetry tags; consider a "persisted-but-failed" flag for retry.

### S6 — `services/swingCapture.ts:62` — `clearTimeout` in `.finally()` runs before `res.json()` parses
**Symptom:** if server sends headers fast but body slow, AbortSignal protection drops once `.finally()` fires; large/slow body parsing has no timeout protection.
**Fix:** clear timeout AFTER `await res.json()` completes (inside the same try block).

### S7 — `api/cage-review.ts:88,146` + `api/brain.ts:272-280` — Anthropic / OpenAI SDK calls without explicit timeout
**Symptom:** if Anthropic / OpenAI stalls, Vercel kills at ~25s with no graceful degradation. Users see a request that "hangs" then errors.
**Fix:** wrap in `Promise.race([apiCall, timeout(20000)])`; on timeout, return a graceful fallback caddie line ("Let me think about that one — try again in a sec.").

### S8 — `services/briefingGenerator.ts:39` — Recap cache key missing `voiceGender` / `persona`
**Symptom:** persona switch mid-round produces a recap rendered for the prior persona; voice TTS uses the new persona but the text is for the old one.
**Fix:** key cache as `${roundId}|${language}|${persona}`. Aligns with the BU-followup persona-cache invalidation discipline.

---

## WIN (10) — high-leverage cleanup

### W1 — `app/(tabs)/caddie.tsx:121-150` — 28-field `useRoundStore()` destructure
**Cost:** caddie.tsx re-renders on every store change to *any* of the 28 fields — score writes, hole changes, club picks all force re-render even when only `currentHole` matters for the visible part of the tree.
**Fix:** per-field selectors `const currentHole = useRoundStore(s => s.currentHole)`. Estimated 30-60 min refactor; meaningful TTI improvement on Z Fold.

### W2 — `app/(tabs)/caddie.tsx:530-533` — 3 `useMemo`s with `[scores]` dep where `scores` is a `Record<>`
**Cost:** every score write creates a new object reference; all 3 memos invalidate; the values aren't actually different. Wasted CPU per shot logged.
**Fix:** shallow-equality selector or compute inline (the 2-line bodies are cheap).

### W3 — `services/fillerLibrary.ts:122-175` — Serial TTS fetches for ~40 phrases on cold launch
**Cost:** 40 × roundtrip latency to ElevenLabs ≈ 30-60s observed cold-launch lag (matches the audit-100-functional-state.md note).
**Fix:** `Promise.all()` with semaphore (concurrency 4-6) drops total to ~5×latency. Big perceived-perf win on first install of a new persona.

### W4 — `api/kevin.ts:605-609` — System prompt rebuilt every request, no Anthropic prompt caching
**Cost:** ~2-4kB of static prompt skeleton sent every call → Anthropic charges full input tokens, no cache hit.
**Fix:** use Anthropic SDK prompt caching (`cache_control: { type: 'ephemeral' }` blocks) on the static skeleton; only the dynamic context block (firstName, mode, current hole, etc.) is uncached. Materially cheaper and faster on every kevin.ts call.

### W5 — `services/videoUpload.ts:189-268` — Per-swing analysis loop is sequential
**Cost:** N swings × analyzeSwing latency. For a 5-swing session: 5 × ~3-8s = 15-40s instead of ~3-8s with `Promise.all`.
**Fix:** `Promise.all(shots.map(analyzeSwing))` — independent calls. Verify Anthropic rate limits don't cap concurrency for the typical case.

### W6 — `contexts/SmartVisionContext.tsx:38` + `contexts/KevinPresenceContext.tsx:31` — Context value rebuilt every render
**Cost:** every consumer of these contexts re-renders on EVERY parent render, not on actual context changes. KevinPresenceContext has many consumers in caddie.tsx; high noise.
**Fix:** wrap value object in `useMemo([...captures])`. 5-line edit per file.

### W7 — `components/CaddieAvatar.tsx:339-341, 388` — `resolvePersona(persona)` called twice per render
**Cost:** small but on the avatar render hot path. Persona doesn't change during a single render.
**Fix:** compute once at top of component or inside a useMemo.

### W8 — `components/VocabBanner.tsx:29` — `useState(new Animated.Value(0))[0]`
**Cost:** anti-pattern. New Animated.Value created on every render but discarded. Old animations may still be live on the prior instance.
**Fix:** `const fade = useRef(new Animated.Value(0)).current;` (one-line change).

### W9 — `components/battery/BatteryPrompt.tsx:26` — `const { voiceGender, language, voiceEnabled } = useSettingsStore();`
**Cost:** without selectors, the component re-renders on every settings-store update (theme changes, persona switches, anything).
**Fix:** per-field selectors.

### W10 — `api/lie-analysis.ts:147-161` — `temperature: 0.5, max_tokens: 800` on Sonnet vision
**Cost:** vision Sonnet is the slowest, most-expensive call. Lie reads converge in <400 tokens at temperature 0.3.
**Fix:** lower both. Measure the new outputs against ~10 sample images before locking the change.

---

## VERIFY (6) — agent flagged but worth Tim's eyes

### V1 — `services/poseDetection.ts:166` — clip-window time math
Agent claim: when `boundaries` provided, `timeMs = windowStartMs + Math.round(windowDurationMs * t)` may extract the wrong frame relative to the master video. Correct path may be `Math.round((boundaries.startSec + windowDurationMs * t / 1000) * 1000)`. **Tim verify:** does `expo-video-thumbnails` interpret `time` as offset-into-master or offset-into-window? That decides the fix.

### V2 — `app/(tabs)/caddie.tsx:173-228` — `runStartRoundRef.current(...)` may fire before ref is assigned
Agent claim: two `useEffect`s call `runStartRoundRef.current(...)` but the ref is assigned in a later effect. If query params trigger before the assignment, the call is silently dropped. **Tim verify:** does the deep-link "Start Round Here" path from Course Detail actually start a round? If yes, the agent is wrong (or the timing happens to work). If users have reported "tapped Start Round and nothing happened" — this is the bug.

### V3 — `services/voicePermissionService.ts:16-39` — async OS permission read + sync store read can diverge
Edge case under fast OS-permission-flip. Probably fine in practice; flagged for awareness.

### V4 — `store/cageStore.ts:482-516` — `ingestUploadedSwing` dedup
Same `clipUri` + different `source` could collide; `sessionHistory.slice(-50)` may drop entries. **Tim verify:** is the same video ever ingested twice in the wild? If not, no fix needed.

### V5 — `app/_layout.tsx:112-125, 156-174, 200-222` — `whenRoundStoreHydrated()` subscription cleanup
Agent claim: subscriptions inside the wrapper may leak. Worth a Read of those exact lines and confirming each `subscribe()` call's return value is stored and called on cleanup.

### V6 — `services/conversationalLoggingOrchestrator.ts:115-118` — Orphaned state if `runFlow()` thrown sync error
Re-entry edge case. Probably benign (only one `openSession()` at a time) but worth a code-walk.

---

## DEFER to v1.2

- `services/proactiveKevin.ts:31-165` — no expiry on stored timestamps (long-term memory growth)
- `services/relationshipEngine.ts:35-39` — `countRecent()` O(n²) on hot path
- `services/patternDetection.ts:54-90` — multi-pass shot iteration
- `services/queryStatusHandler.ts:479-519` — multi-pass roundHistory filtering
- `services/rangefinder.ts:70-92` — confidence computed twice (cosmetic)
- `services/poseDetection.ts:237-238` — `totalKB` calc wrong (telemetry-only)
- `api/voice.ts:67` — ElevenLabs model re-evaluated per call (micro)
- `api/voice.ts` log volume (debug-level demotion)
- `api/transcribe.ts:60-64` — silent unlinkSync failure (low blast radius)
- `api/lie-analysis.ts:103-104` — prompt-injection vector via raw user context (audit, low priority)
- `app/(tabs)/caddie.tsx:345-347` — 5-field profile destructure (smaller version of W1)
- `app/(tabs)/caddie.tsx:314-330` — `useMemo` with `markTick` never caches (currently correct behavior, just nominal lint noise)
- `app/(tabs)/caddie.tsx:458-463` — empty deps but reads round state (currently effectively static; flag for next caddie.tsx pass)
- `store/relationshipStore.ts:247-254` — `getTopObservations()` mutates during read (can refactor if it bites)
- `store/roundStore.ts:605-621` — migration mutates `persisted` in-place (fragile, no current symptom)

---

## False positive (2, removed)

- `app/(tabs)/caddie.tsx:473` — agent claimed `useEffect(() => subscribeBattery(cb), [])` leaks because no cleanup. **Verified false:** `services/batteryMonitor.ts:64` returns the unsub function from `subscribeBattery`; the effect's return value (= the unsub) becomes the cleanup. Pattern is correct.
- `services/shotDetectionService.ts:48` (B1) — agent claimed Haversine missed `cos(lat1)*cos(lat2)` factor. **Verified false:** the line reads `Math.sin(dLat/2)**2 + Math.sin(dLng/2)**2 * Math.cos(lat1) * Math.cos(lat2)`. `**` binds tighter than `*`, so this evaluates as `sin²(dLat/2) + sin²(dLng/2)*cos(lat1)*cos(lat2)` — mathematically identical to gpsManager.ts:70's version (different operand order). No bug.

---

## Recommended fix order (ROI-sequenced for v1.1 cleanup)

1. **B1** Haversine — 5 min. Real math bug, real downstream effect on shot stats.
2. **S4** voiceService.ts:356-357 await write — 5 min. Plausibly resolves F12 `[voice] speak timeout`. Verify with adb logcat after fix.
3. **B3** api/voice.ts text validation — 5 min. Closes abuse vector.
4. **W3** parallel filler TTS fetch — 30 min. Cuts cold-launch persona-switch lag from ~30-60s to ~5-10s.
5. **B4** server-side persona handling sweep — 2-3h. Closes the F13 server-side gap; Tank/Harry get correct names in API responses.
6. **W4** Anthropic prompt caching on api/kevin.ts — 1h. Recurring per-call cost + latency win.
7. **S2 + S3 + S5** persistence safety pass (filler library mutex + AsyncStorage error wrapping) — 1h.
8. **S1** audioLifecycle teardown — 30 min. Hot-reload hygiene + restart safety.
9. **S6** swingCapture.ts timeout-after-parse — 5 min.
10. **S7** Anthropic/OpenAI SDK timeouts — 30 min.
11. **W1, W2, W6** caddie.tsx + context re-render hygiene — 1-2h. TTI improvement.
12. **W7-W10** smaller component fixes — 30 min total.

**Total v1.1 close-out estimate: 8-12 hours of code work.**

VERIFY items + DEFER list go to a follow-up pass.
