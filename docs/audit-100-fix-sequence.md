# Phase 100 — Component 5: Targeted Fix Sequence

**Audit date:** 2026-05-05
**Bundle SHA:** `94e7d29`

Fix proposals derived from Components 1–4. Sequenced by severity and dependency. **No fix is "shipped" without empirical Z Fold verification.**

## Severity legend
- **BLOCKING** — defeats core feature value or causes user-visible breakage
- **SIGNIFICANT** — degrades feature quality or trust meaningfully
- **MINOR** — polish, edge case, technical debt

## Critical insight from Components 1–4

**The single highest-leverage action in Phase 100 is empirical verification, not new fixes.** The five phases since BU (BV/BX/BW/BY-quick/BZ-v1) shipped structural fixes for every BU finding except #5 (review UI thin), which BZ-v1 just addressed. **What Phase 100 needs is for Tim to RUN the verification, not for me to write more code blindly.**

Therefore Phase 100's fix sequence prioritizes:
1. **Empirical verification gate** (no code, just Tim on Z Fold)
2. **Fixes targeted at gaps the verification surfaces** (we don't know which until we run)
3. **Cleanup that's independent of verification** (lint error, dead code, console-log hygiene)

## Fix proposals

### F1 — Empirical verification on Galaxy Z Fold (no code; gate)

**Severity:** BLOCKING (everything else gated by this)

**Owner:** Tim

**Scope:** Run `docs/verification-BV-PREP.md` end-to-end on Z Fold. Fill `docs/verification-BV-PREP-results.md`. Spend ~60–90 minutes covering:
- Test Group A (4 personas cold launch) — 10 min
- Test Group B (hydration race, 3 personas) — 10 min
- Test Group C (Tank/Harry emotion crossfades) — 5 min
- Test Group D (portrait visual confirmation) — 2 min
- Test Group E (Cage Mode E1–E4, the highest-stakes section) — 30 min
- Test Group F (foundation regression spot-checks) — 10 min

**Outcome:** every UNKNOWN in Component 1 resolves to WORKING / PARTIAL / BROKEN. Persona verdicts update. PATH 1–4 statuses update. Phase 100 verdict (Component 9) becomes writable.

**Estimated time:** 60–90 min on device.

**Dependency:** none (just need Z Fold + dev-client + Metro reload).

---

### F2 — Lint error: diagnostic-card.tsx unescaped apostrophe

**Severity:** MINOR

**Specific failure:** `app/diagnostic-card.tsx:159:80` — `'` should be `&apos;`/`&lsquo;`/`&#39;`/`&rsquo;` (JSX entity).

**Root cause:** raw apostrophe in JSX text where eslint's `react/no-unescaped-entities` rule requires escape.

**Files to touch:** `app/diagnostic-card.tsx` line 159 only.

**Estimated scope:** 30 seconds.

**Verification:** `npm run lint` — expect 0 errors, 6 warnings (one less than current 7).

**Dependency:** none.

---

### F3 — Lint warnings: 5 unused-var warnings in caddie.tsx + smartvision.tsx

**Severity:** MINOR

**Specific failures:**
- `app/(tabs)/caddie.tsx:5` — `Image` import unused
- `app/(tabs)/caddie.tsx:58` — `SmartFinderCard` import unused
- `app/(tabs)/caddie.tsx:324` — useMemo extra dep `markTick`
- `app/(tabs)/caddie.tsx:470` — `saverActive` array-destructure element unused
- `app/(tabs)/caddie.tsx:1303` — `handleChangeModePress` callback unused
- `app/smartvision.tsx:100` — `projectToPixels` unused

**Root cause:** dead code accumulated across phases. None are functional bugs.

**Files to touch:** `app/(tabs)/caddie.tsx`, `app/smartvision.tsx`.

**Decision per warning:** for each, either:
- Remove the dead code (preferred when truly unused)
- Prefix with `_` if intentionally retained for future use (e.g., `_handleChangeModePress`)

**Estimated scope:** 15 minutes (verify each is truly unused, not part of a not-yet-wired path).

**Verification:** `npm run lint` — expect 0 errors, 0 warnings (clean baseline).

**Dependency:** none.

---

### F4 — Console.log hygiene pass

**Severity:** MINOR

**Specific failure:** 250 `console.log/warn/error` calls in source. Some are intentional telemetry tags (`[path3:cage]`, `[V6-DIAG]`, `[ttfa]`); some may be leftover dev-logging.

**Root cause:** organic accumulation across phases.

**Files to touch:** spot-check across `app/`, `services/`, `store/`, `components/`, `hooks/`.

**Process:**
1. Grep for `console\.log\(['"\`][^[]` to find calls NOT starting with a `[tag]` marker.
2. Per call: keep if it's diagnostic and useful, strip if it's leftover.

**Estimated scope:** 30–45 minutes.

**Verification:** Reduced count, no functional change. Empirical verification not required (logging is non-functional).

**Dependency:** none.

---

### F5 — Resolve TODOs

**Severity:** MINOR

**Specific failure:** 2 TODOs in source. Each should be either resolved (small fix) or documented as deferred (move to a docs/v1.2-deferred.md file with reasoning).

**Files to touch:** TBD by inspection.

**Estimated scope:** 15 minutes total.

**Dependency:** none.

---

### F6 — Delete orphaned `app/cage/summary.tsx` (post-BV)

**Severity:** MINOR

**Specific failure:** Per BV migration doc, `/cage/summary.tsx` is not reached by the new canonical flow (overlay's `onComplete` navigates to `/swinglab/swing/[id]`). The file still exists and contains its own Phase K useEffect. If a residual entry point routes to it, the trace shows `[path3:cage:summary-phase-k-*]` markers.

**Root cause:** BV migration intentionally deferred deletion until verification confirms no entry point reaches it.

**Files to touch:** `app/cage/summary.tsx` (delete), `app/_layout.tsx` (route registration if any).

**Estimated scope:** 15 minutes (delete + verify routes).

**Verification:** post-BV cage session does not show `summary-phase-k-*` markers in logcat. Per BV migration doc Recipe 3.

**Dependency:** F1 (empirical verification first; if F1 surfaces a residual entry point reaching summary, fix that first).

---

### F7 — Vercel deployment sync (server-side persona routing)

**Severity:** SIGNIFICANT

**Specific failure:** `/api/*.ts` files have been updated to be persona-aware (api/voice.ts, api/brain.ts, api/kevin.ts, etc.) but the **deployed Vercel backend** may still be running pre-persona code. If so:
- Z Fold dev-client calls `/api/voice` with `persona: 'serena'`
- Vercel responds with the OLD code that ignores `persona`, falls through to gender_lang map
- All male personas (Kevin/Harry/Tank) sound identical (onyx)

**Root cause:** Vercel auto-deploys on push to main IF the GitHub→Vercel integration is healthy. Last few commits pushed to GitHub; need to confirm Vercel build succeeded.

**Files to touch:** none. Vercel deployment dashboard check.

**Estimated scope:** 5 min (open vercel.com → smartplay-caddie project → check latest deploy).

**Verification:** F1 voice tests across 4 personas reveal whether ElevenLabs path is firing per persona. If all male sound the same, Vercel sync issue. Logcat from `/api/voice` server-side (Vercel logs) shows whether `persona` is being read.

**Dependency:** none for the check; F1 surfaces the issue.

---

### F8 — Per-clip mp4 extraction (deferred from BW)

**Severity:** SIGNIFICANT (would unlock per-swing share/export)

**Specific failure:** BW Component 1 specified per-detection clip files. Implementation deferred Option D (Phase K reshape only); per-clip mp4 files NOT extracted. Result: each CageShot's `clipUri` points at the master video. Users can share the WHOLE session video (BZ-v1) but not a single swing clip.

**Root cause:** native ffmpeg dependency was rejected for Phase BW scope; expo-video-thumbnails doesn't extract mp4 segments. Workaround needed.

**Files to touch:** new module `services/clipExtractor.ts`, `components/CageSessionOverlay.tsx` `handleEndSession` (call extractor), `store/cageStore.ts` (per-shot clipUri update).

**Options:**
- **Option A** — `react-native-ffmpeg` / `ffmpeg-kit-react-native` (~30MB native dep, requires new EAS build)
- **Option B** — defer to v1.2 unless user-demand for per-swing share is high

**Estimated scope:** 8–12 hours (Option A) including new EAS build and testing. **Out of v1.1 scope; recommend defer to v1.2.**

**Decision: DEFER to v1.2.** v1.1 ships per-session share via BZ-v1; per-clip share is enhancement not foundation.

---

### F9 — `meet-kevin.tsx` onboarding screen persona awareness

**Severity:** MINOR

**Specific failure:** `app/onboarding/meet-kevin.tsx` still hardcodes "MEET KEVIN" heading + Kevin portrait. New users default to Kevin during onboarding; persona switching only matters for users who deliberately change persona later.

**Root cause:** legacy onboarding flow predated persona widening.

**Files to touch:** `app/onboarding/meet-kevin.tsx` — make heading + portrait read `caddiePersonality`. But: ALL new users start as Kevin (caddiePersonality default), so this only matters if a user wipes app data and reinstalls AFTER having Tank/Harry preference cached… but app-data-wipe also clears Zustand persist, so default-Kevin reinstates.

**Conclusion:** **NO-OP for v1.1.** Acceptable as-is.

---

### F11 — AbortSignal.timeout polyfill for Hermes [SHIPPED]

**Severity:** BLOCKING (silently breaks weather, course content, course geometry, cage upload, golf course API, pose detection, CV scoring, context synthesis — every fetch with a timeout)

**Specific failure:** `[weather] fetch exception: [TypeError: AbortSignal.timeout is not a function (it is undefined)]` observed on Galaxy Z Fold dev-client cold launch (Phase 100 F1 evidence, 2026-05-05).

**Root cause:** Hermes runtime on the device's RN build predates the static `AbortSignal.timeout()` factory (Chromium 103+ / Node 17.3+). 12 call sites across 8 services rely on it.

**Files touched:**
- `services/polyfills.ts` (new) — defines `AbortSignal.timeout` if missing using `AbortController` + `setTimeout`.
- `app/_layout.tsx` — first import is `'../services/polyfills'` so the patch lands before any other module's network call.

**Verification:** observe weather fetch succeeds on next launch / next polling tick. No more `[weather] fetch exception` line in Metro logs. Side effect: pose detection, course content, cage upload all stop silently aborting on timeout-arming code paths that previously threw on import.

**Status:** SHIPPED (Phase 100/F11).

---

### F12 — Voice speak timeout (diagnostic needed)

**Severity:** SIGNIFICANT pending diagnosis (could be BLOCKING for PATH 4)

**Specific failure:** `[voice] speak timeout` observed in Metro logs after cold launch (Phase 100 F1 evidence, 2026-05-05).

**Hypothesis tree (no fix yet — needs diagnostic):**
1. Vercel deployment sync (F7): server-side `/api/voice` is the pre-persona code; persona body field ignored; ElevenLabs roundtrip times out. **Probability: HIGH if Vercel hasn't auto-deployed since persona widening.**
2. ElevenLabs API key missing or unhealthy in Vercel `.env`: any persona TTS times out. **Probability: MEDIUM.**
3. AbortSignal.timeout polyfill missing (F11) caused fetch to abort instantly with weird timing. **Probability: HIGH this contributed; F11 may resolve.**
4. The cold-launch greeting screen called `speak()` with non-Kevin persona → ElevenLabs path took >timeout. **Probability: MEDIUM.**

**Files touched:** none yet. Diagnostic first.

**Diagnostic plan:**
- Re-launch app with F11 polyfill in effect; check whether `[voice] speak timeout` recurs.
- If yes: Vercel dashboard → smartplay-beta project → confirm latest deploy is post-`98c5822` (BU-followup) commit.
- If Vercel is in sync: check `[path4:voice]` markers in Metro for which fetch is stalling.
- If Vercel is stale: trigger redeploy.

**Status:** OPEN — pending re-launch evidence with F11 in place.

---

### F10 — Documentation refresh (Phase 100/docs)

**Severity:** MINOR

**Specific files needing refresh:**
- `README.md` — current?
- `CLAUDE.md` — needs Phase BU through BZ-v1 entries to "Locked elements" or "Phase decisions" section if any new locks landed (none did).
- `docs/critical-paths.md` — accurate per latest path map?
- Master Compendium / outline doc — currently scattered across docs/audits/BS/, docs/audit-BU-*, docs/audit-100-* — could use a single index.

**Estimated scope:** 1–2 hours.

---

## Sequence

```
1. F1   Empirical verification on Z Fold     [60-90 min, Tim] [IN PROGRESS]
   ↓ produces F11 + F12 surface findings live
2. F11  AbortSignal.timeout polyfill          [5 min, code]   [SHIPPED]
3. F12  Voice speak timeout                   [diagnostic, then variable] [OPEN]
4. F7   Vercel deployment sync check          [5 min, Tim]    [PENDING]
   ↓ likely overlaps with F12 root cause
5. F2   Lint error fix                        [30 sec, code]
6. F3   Lint warnings cleanup                 [15 min, code]
7. F4   Console.log hygiene                   [30-45 min, code]
8. F5   Resolve TODOs                         [15 min, code]
9. F6   Delete orphaned cage/summary.tsx     [15 min, after F1 confirms unreachable]
10. F10 Documentation refresh                 [1-2 hours, docs]

Deferred to v1.2:
- F8   Per-clip mp4 extraction
- F9   meet-kevin persona awareness (no-op decision)
```

## What's NOT in the fix sequence

- **No new feature work.** Per Phase 100 spec, scope is "stop building new."
- **No speculative fixes.** Every fix above either targets a documented baseline issue (lint) or is gated by F1 empirical evidence.
- **No retrofix on items that "might be wrong."** UNKNOWN-state items in Component 1 don't get speculative fixes — they get F1 verification, then targeted fix only if F1 surfaces breakage.

## Estimated total time

- F1 (Tim runs): 60–90 min
- F2–F5, F10 (code): ~3 hours
- F6 (after F1): 15 min
- F7 (Tim checks): 5 min
- Any F1-surfaced fixes: variable (1–4 hours typical)

**Total v1.1 close-out: 5–9 hours of work + 90 min Tim's empirical session.**
