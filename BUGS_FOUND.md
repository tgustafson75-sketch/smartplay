# v2 Functional Code Walk — Bugs Found
Branch: fix/v2-wiring
Date: 2026-05-03

Scope: live entry path `app/index.tsx` → `/splash` → `app/tabs/*`. Voice facade `services/voice/index.ts`. GPS hook `core/hooks/useUnifiedGPS.ts`. Round store `store/roundStore.ts`. Hole progression `hooks/useHoleProgression.ts`.

---

## CRITICAL (will break or crash within first round)

- [ ] **`app/tabs/caddie.tsx:59` + `:1707`** — `PostRoundSummary` component is **imported but never rendered**.
  - `setShowPostRound(true)` is called at line 1707 inside `handleEndRound`, but `<PostRoundSummary visible={showPostRound} … />` does **not** appear anywhere in the JSX (verified: only matches are the import line and the setter; no `<PostRoundSummary` usage).
  - Combined with `app/tabs/_layout.tsx:78-79` which calls `router.replace('/tabs/play')` the instant `isRoundActive` flips false (which `handleEndRound` does at `caddie.tsx:1701`), the user is yanked off the Caddie tab before any modal could even mount. Net effect: **post-round summary is unreachable** and `pendingNavRef.current` (line 1706) is never run.
  - Repro: end a round of any length; observe that the summary modal never appears, even though `analyzeRound` + `generateInsights` produced data and points were awarded.
  - Suggested fix: render `<PostRoundSummary visible={showPostRound} analysis={postRoundAnalysis} insights={postRoundInsights} onDismiss={() => { setShowPostRound(false); pendingNavRef.current?.(); }} />` in the modal block, AND defer `setIsRoundActive(false)` (or the `tabs/_layout.tsx` redirect) until after the user dismisses the modal.

- [ ] **`app/tabs/caddie.tsx:2386-2391`** — Round start does **not** reset prior round state. The Start button only calls `setStrategyMode`, `setCurrentHole(1)`, `setIsRoundActive(true)`. It does NOT call `clearRound()`, does NOT reset `scores`, `gridScores`, `courseScores[activeCourse]`, `holePutts`, `penaltyLog`, or `currentPar`.
  - Combined with `clearRound` itself only resetting `shots / shotResult / aim / multiRound / holePutts` (`store/roundStore.ts:174`), a second round inherits **all hole scores, putts, penalties, and per-course saved scores** from the previous round.
  - Repro: play round 1, finish (or abort by tapping End Round). Tap Start Round again — hole 1 already shows the score from round 1's hole 1. Same with putts. Penalty log for round 1 is still attached to round 2.
  - Suggested fix: on round start, call `clearRound()` (which itself must be expanded to also reset `scores`, `gridScores`, `courseScores[id]`, `penaltyLog`, `currentHole`, `currentPar`).

- [ ] **`store/roundStore.ts:174` (`clearRound`)** — partialize at line 233-258 persists `scores, currentHole, currentPar, gridScores, courseScores, penaltyLog, holePutts, isRoundActive, multiRound, shots, …`, but `clearRound` resets only **5** of those (`shots, shotResult, aim, multiRound, holePutts`). Everything else survives across rounds and across app relaunch. Same root cause as the bug above; calling out separately because the store is the layer to fix.
  - Suggested fix:
    ```ts
    clearRound: () => set(() => ({
      shots: [], shotResult: '', aim: 'center', multiRound: [],
      holePutts: Array(18).fill(0),
      scores: Array(18).fill(0),
      gridScores: EMPTY_GRID(),
      penaltyLog: [],
      currentHole: 1, currentPar: 4,
      // optionally: do NOT clear courseScores here — save it elsewhere if you need round-1 history
    }))
    ```

- [ ] **`app/tabs/_layout.tsx:74-82`** — phase-driven nav `router.replace('/tabs/play')` on `isRoundActive: true → false` runs **before** any post-round UI can render on the Caddie tab. Direct conflict with `app/tabs/caddie.tsx:1707` (`setShowPostRound(true)`) and `:1706` (`pendingNavRef.current = … router.replace('/tabs/play')`). Two redirects compete; the layout one always wins because `isRoundActive` flips at line 1701, which is before `setShowPostRound(true)` at 1707.
  - Suggested fix: don't redirect on round-end inside `_layout.tsx`. Let the screen own the post-round flow; only redirect on **mount** if `!isRoundActive`.

---

## HIGH (will degrade across rounds 2-10)

- [ ] **`app/tabs/caddie.tsx:2128`** — penalty-sheet `speakJob(msg, ENGINE_PRIORITY.SHOT, voiceGender)` runs unconditionally; ignores `voiceEnabled`. Every other speakJob site in caddie.tsx is gated (`917, 1124, 1251, 1258, 1263, 1491, 1517, 1523, 2449`). User who has voice off will still hear the penalty announcement.

- [ ] **`store/roundStore.ts:185-196` (`setCourseHoleScore`)** — assumes `state.gridScores[playerIdx]` exists. If `activePlayerCount` was raised mid-session and persisted state from an earlier version had fewer rows, `grid[playerIdx][holeIdx] = score` throws `TypeError: Cannot set properties of undefined`. `EMPTY_GRID()` produces 4 rows, but persisted state from a prior schema version may not. Persisted partialize at line 233 has no `version`/`migrate`, so any schema drift becomes a runtime crash on first score tap.
  - Suggested fix: guard `if (!grid[playerIdx]) grid[playerIdx] = Array(18).fill(0);` before assignment, or add `migrate` + `version` to the persist config.

- [ ] **`store/roundStore.ts:154` (`addShot`)** — `shots.slice(-50)` silently drops the oldest shots on a long round. A complete 18-hole round routinely exceeds 50 shots (par 72 + putts ≈ 90+). After hole ~10–11, the front-9 shots start disappearing. Downstream consumers that depend on full history (`analyzeRound`, `getMissPattern` over `courseMemory` derivation, post-round insights, dispersion model) silently see truncated data.
  - Suggested fix: bump cap to 250 (covers any realistic round + practice) or remove the slice and rely on round-end `clearRound()`.

- [ ] **`hooks/useHoleProgression.ts:74-109`** — when `unifiedGPS.stale === true`, `location` continues to hold the **last smoothed value** (see `useUnifiedGPS.ts:140-167` — the watch callback only writes when a fresh sample arrives). The progression hook receives no signal that the location is stale and will continue feeding the smoothed-but-frozen point into `progressionReducer`. If the player happens to be parked in the dwell radius of the green when GPS goes stale (e.g. tree cover, phone in pocket), the dwell timer keeps elapsing on stale coords and auto-advance fires.
  - Suggested fix: pass `stale` into `useHoleProgression` and gate the reducer call on `!stale`.

- [ ] **`app/tabs/caddie.tsx:1497`** — `recordShot` callback dep array includes `mapSize, ballPosition, targetPosition` but the callback is then captured by `handleMarkShot` (line 1499-1529) which has its own deps `[recordShot, …]`. Each user drag on the map (which updates `targetPosition`) regenerates `recordShot`, which regenerates `handleMarkShot`, which forces re-subscription of `useWatchSync` (line 1532). Watch BLE re-subscribes per-drag while target ring is being moved — quiet battery drain + log noise. Functional but expensive.

---

## MEDIUM (edge case, only some users will hit)

- [ ] **`app/tabs/caddie.tsx:1486-1493`** — `VoiceTimingController.afterShot(...)` fires **after** the post-shot recommendation `speakJob` at line 1523 (which runs in a 400 ms `setTimeout` inside `handleMarkShot`). Both target the same voice queue at SHOT priority. `speakJob` is called twice within ~400 ms with overlapping content. If `VoiceTimingController.afterShot` decides to speak (only "if pattern is strong + cooldown elapsed"), the user hears two pieces of advice back-to-back.
  - Suggested fix: drive both through a single advice resolver, or make afterShot defer until queue is idle.

- [ ] **`app/tabs/caddie.tsx:328`** — `useEffect(() => { setGlobalGender(voiceGender); }, [voiceGender]);` runs only on the Caddie tab's mount/voiceGender change. Other tabs (`scorecard`, `swinglab`, `dashboard`, `play`) do not call `setGlobalGender`. Cold-launching the app and going straight to a non-Caddie tab leaves `voiceService._globalGender` at its module default `'male'` even if the user picked female. The persisted store value is never re-applied until Caddie mounts.
  - Suggested fix: call `setGlobalGender(useSettingsStore.getState().voiceGender)` once at app boot in `app/_layout.tsx`.

- [ ] **`app/splash.tsx:50-57`** — "Resume Round" button routes to `/tabs/play` (a course-search screen), not to `/tabs/caddie` where the round actually plays. The user taps Resume and lands on the play tab, sees the search/setup UI, and has to manually navigate to Caddie. Round state is intact, but UX-wise the resume is half-broken.
  - Suggested fix: route to `/tabs/caddie` when `hasDraft` is true.

- [ ] **`app/tabs/caddie.tsx:353-358`** — `useEffect(()=>{ if (roundActive && activeCourse) setShowResumePrompt(true); }, [])` reads from `useRoundStore.getState()` once on mount. If the user backgrounds the app mid-round and returns, the modal does NOT re-prompt (deps are `[]`). Acceptable. But the modal "Continue" button (line 2080-2087) only closes the prompt — it doesn't actually re-arm anything. And the "Start New Round" button (line 2088-2096) calls `useRoundStore.getState().clearRound()` which has the partial-reset bug above (HIGH item) — so "start new round" leaves stale grid scores / penalties.

- [ ] **`core/hooks/useUnifiedGPS.ts:147`** — `if (stale) setStale(false)` reads `stale` from the closure captured when `start()` was first called. At first invocation `stale` is `false`, so this branch is dead. Functionally OK because the watchdog interval at line 96-100 resets it (`setStale(age > STALE_TIMEOUT_MS)` evaluates to false when fresh), but it can take up to 5 s to clear after a recovery. Tighten by removing the closure read and unconditionally calling `setStale(false)` (state setter is referentially stable, no extra renders if value unchanged).

- [ ] **`core/hooks/useUnifiedGPS.ts:91-172`** — `start()` re-entry race in `retry()`: if `retry` is tapped while the previous `await Location.watchPositionAsync(...)` promise is still in flight, both calls reach line 132 (`subscriptionRef.current?.remove()`), but only the second one's `subscriptionRef = await …` assignment overwrites the first; the first watch's subscription is never `remove()`'d (since `subscriptionRef.current` had already been overwritten by the time the first awaited promise resolved). Leak: one orphaned watch per duplicate retry. Battery cost.
  - Suggested fix: guard with an `isStartingRef` flag at the top of `start()`.

---

## LOW (cosmetic, race, minor)

- [ ] **`app/tabs/caddie.tsx:451-463`** — `lockPulse` `Animated.loop` has no unmount cleanup. If the component unmounts while `pointALocking || pointBLocking` is true, the loop keeps a native driver reference. Minor; GC-able.

- [ ] **`app/tabs/caddie.tsx:380`** — yardage-to-watch effect deps `[isRoundActive, currentHole, club, targetDistance]` — does not include `displayDistance`'s upstream `unifiedMiddleDist`, so the watch yardage doesn't update as GPS yardage drifts. It only updates when target/club/hole changes.

- [ ] **`app/tabs/caddie.tsx:420`** — front-9 summary effect deps include `scores` and `voiceGender`. Re-runs every time any score in any hole is edited. Speech is gated by the `prevHoleRef.current === 9 && currentHole === 10` condition so it doesn't double-speak, but the effect body does run a slice/reduce on every score change — minor.

- [ ] **`app/tabs/caddie.tsx:1602-1626`** — voice-triggered drill video search effect deps `[micTranscript]`; the same transcript could fire the same search twice if `micTranscript` is reset to the same string. Practically rare. Use a ref to dedupe by transcript string + timestamp.

- [ ] **`services/voice/index.ts`** facade — re-exports verified against `VoiceEngine.d.ts` (line 1-9) and `voiceService.js` (line 41-46, 115). All 8 names from `VoiceEngine` exist. `voiceService` symbols `setGlobalGender / getGlobalGender / configureAudioForSpeech / speak` all exist. `VoiceController` named export confirmed at `services/VoiceController.js:33`. `VoiceTimingController` exported from `voiceTimingController.ts`. **No undefined re-exports** — facade is clean.

---

## Verified-clean (session fixes hold up)

- `useGolfGPS` no longer imported in `app/tabs/caddie.tsx` (only `useUnifiedGPS` at line 67).
- `useUnifiedGPS.ts` exposes `permissionDenied` (line 81), `stale` (line 82), `retry()` (line 174-176), and a 30 s watchdog (`STALE_TIMEOUT_MS = 30_000`, line 73; interval at 96-100).
- Voice imports in `app/tabs/caddie.tsx:5-14` and `app/tabs/_layout.tsx:8` go through `services/voice` facade; no direct imports of `services/VoiceEngine`, `services/voiceService`, etc., from those screens.
- `services/voice.js` is renamed to `services/voice-legacy.orphan.js` (verified: no `voice.js` in `services/` root).
- `app/splash.tsx:16` reads `'round-store-v1'` (matches the persist `name` at `store/roundStore.ts:231`); `'draftShots'` is no longer referenced in live tree.
- `services/voice/index.ts` facade re-exports all resolve to defined symbols (cross-checked with `VoiceEngine.d.ts`, `voiceService.js`, `VoiceController.js`, `voiceTimingController.ts`).
- Background-location permission added in `app.json` (status: present per session fix; not re-validated here).
- Corrupt JSON in `round-store-v1` is handled: splash wraps `JSON.parse` in try/catch (`splash.tsx:18-25`) — no crash on malformed payload.
