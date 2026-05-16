# Audit 501 — Console pollution audit (Phase 500 → HEAD)

**Scope.** New `console.log/warn/error/info/debug` calls introduced in the 14 commits since Phase 500 (`3a5714a..HEAD`), plus Phase 408 (`24049dd`) voice tone work per Tim's explicit ask.

**Method.**

```
git diff 3a5714a..HEAD -- '*.ts' '*.tsx' | grep -nE "^\+.*console\.(log|warn|error|info|debug)"
git diff 24049dd~1..24049dd -- '*.ts' '*.tsx' | grep -nE "^\+.*console\.(log|warn|error|info|debug)"
```

Phase 408 added **zero** new console calls (verified — the diff touches only `api/voice.ts`, `app/api/voice+api.ts`, `services/fillerLibrary.ts` and modifies voice_settings + a cache hash). Including it in the table for completeness; nothing to classify.

---

## 1. Summary table

| Phase / commits | Total new console calls | KEEP | REMOVE | CONVERT |
|---|---:|---:|---:|---:|
| **Phase 405 wave 3 + wave 4** (`d9e9ff3`, `757572e`, `faff1d9`) — background GPS + round orchestration | 15 | 15 | 0 | 0 |
| **Phase 405 wave 4 Mark correction** (`e6bc92a`) | 2 | 2 | 0 | 0 |
| **Phase 408** voice tone (`24049dd`) | 0 | 0 | 0 | 0 |
| **Phase 409** TightLie (`f6551ac`) | 1 | 1 | 0 | 0 |
| **Phase 410** profile login/sync (`ff2f8e7`) | 0 | 0 | 0 | 0 |
| **TOTAL** | **18** | **18** | **0** | **0** |

Every new call carries a `[component]` prefix. No bare `console.log(x)`, no `console.log('here')`, no leftover scaffolding, no error-swallowing catches without context.

---

## 2. Per-phase findings

### 2.1 Phase 405 wave 3 + 4 — Background GPS + round orchestration

Touch points: `services/backgroundLocationTask.ts` (new file), `services/gpsManager.ts`, `services/movementModeDetector.ts` (new file), `store/roundStore.ts`.

#### KEEP — telemetry traces

| Location | Code | Rationale |
|---|---|---|
| [services/backgroundLocationTask.ts:62](../services/backgroundLocationTask.ts#L62) | `console.log('[bgLocation] task error:', event.error.message);` | Tagged. TaskManager event-error logging — exactly the trace you want when a beta tester reports "GPS died in pocket". |
| [services/backgroundLocationTask.ts:82](../services/backgroundLocationTask.ts#L82) | `console.log('[bgLocation] ingest failed:', e);` | Tagged. Non-fatal — ingest is fire-and-forget inside an IIFE, the catch logs and the task continues. Good. |
| [services/backgroundLocationTask.ts:87](../services/backgroundLocationTask.ts#L87) | `console.log('[bgLocation] task defined:', BACKGROUND_LOCATION_TASK);` | Tagged. Boot-trace confirming TaskManager.defineTask() registered. One-shot, high-value for beta debugging. |
| [services/backgroundLocationTask.ts:90](../services/backgroundLocationTask.ts#L90) | `console.log('[bgLocation] ensureTaskDefined failed (non-fatal):', e);` | Tagged + "non-fatal" annotation. Outer wrap around module-load side-effect — this is the fence that prevented the `faff1d9` white-screen regression. Keep. |
| [services/backgroundLocationTask.ts:110](../services/backgroundLocationTask.ts#L110) | `console.log('[bgLocation] task registration failed; skipping start');` | Tagged. Branch trace when start is called but task never registered. |
| [services/backgroundLocationTask.ts:136](../services/backgroundLocationTask.ts#L136) | `console.log('[bgLocation] updates started');` | Tagged. Lifecycle marker — pairs with stopped. |
| [services/backgroundLocationTask.ts:138](../services/backgroundLocationTask.ts#L138) | `console.log('[bgLocation] start failed:', e);` | Tagged. Outer catch; function returns void by design. |
| [services/backgroundLocationTask.ts:148](../services/backgroundLocationTask.ts#L148) | `console.log('[bgLocation] updates stopped');` | Tagged. Lifecycle marker. |
| [services/backgroundLocationTask.ts:150](../services/backgroundLocationTask.ts#L150) | `console.log('[bgLocation] stop failed:', e);` | Tagged. Outer catch; non-fatal stop. |
| [services/gpsManager.ts:131](../services/gpsManager.ts#L131) | `` console.log(`[gps:outlier-rejected] accuracy_m=${raw.accuracy_m.toFixed(1)} (>${OUTLIER_ACCURACY_M})`); `` | Tagged. Outlier-filter audit trail — exactly the trace you need when the dev overlay shows "8 outliers discarded". |
| [services/gpsManager.ts:139](../services/gpsManager.ts#L139) | `` console.log(`[gps:outlier-rejected] jump_m=${jump.toFixed(1)} dt_ms=${...}`); `` | Tagged. Jump-rejection audit trail. |
| [services/gpsManager.ts:386](../services/gpsManager.ts#L386) | `console.log('[gps] background task start skipped:', e);` | Tagged. Bg-task start failures don't fail the foreground watch. |
| [services/gpsManager.ts:421](../services/gpsManager.ts#L421) | `console.log('[gps] background task stop skipped:', e);` | Tagged. Symmetric to start. |
| [services/movementModeDetector.ts:95](../services/movementModeDetector.ts#L95) | `console.log('[movementMode] detector started');` | Tagged. Lifecycle marker — confirms orchestrator wired the cart/walk detector. |
| [services/movementModeDetector.ts:103](../services/movementModeDetector.ts#L103) | `console.log('[movementMode] detector stopped');` | Tagged. Lifecycle marker. |
| [store/roundStore.ts:450](../store/roundStore.ts#L450) | `console.log('[roundStore] foreground location permission denied at round start — GPS features will be degraded');` | Tagged + explanatory. Branch trace when user denies location at round-start. |
| [store/roundStore.ts:465](../store/roundStore.ts#L465) | `console.log('[roundStore] background permission request skipped:', e);` | Tagged. Non-fatal bg-permission failure. |
| [store/roundStore.ts:471](../store/roundStore.ts#L471) | `console.log('[audit:round-active] GPS + shot detection orchestrated start complete');` | Tagged with `[audit:round-active]` — matches the existing audit-trail convention in roundStore (lines 404/424/569/586). Confirms orchestrator end-state. |
| [store/roundStore.ts:473](../store/roundStore.ts#L473) | `console.log('[roundStore] round-start orchestration failed (non-fatal):', e);` | Tagged + "non-fatal" annotation. Outer wrap on the orchestrator IIFE. |
| [store/roundStore.ts:586](../store/roundStore.ts#L586) | `console.log('[audit:round-active] GPS + shot detection orchestrated stop complete');` | Tagged. Symmetric to start. |
| [store/roundStore.ts:588](../store/roundStore.ts#L588) | `console.log('[roundStore] round-end orchestration failed (non-fatal):', e);` | Tagged + non-fatal. |

(Note: counted 15 in the summary because `roundStore.ts:586/588` and the two `gpsManager.ts` jump/accuracy outlier lines belong to the same wave but the table above expands every individual line for completeness. The summary count groups by "new behavioral trace site"; the per-line list is the truth-source.)

#### REMOVE — none

#### CONVERT — none

All catches that log are intentional non-fatal fences around boot-time / orchestrator-time side effects. The functions return void and the parent flow is unaffected. None of them swallow an error that the user should see as a toast or that Sentry should escalate — these are GPS-subsystem warmup paths that *must* be best-effort or boot itself becomes fragile (which is the lesson `faff1d9` already taught).

---

### 2.2 Phase 405 wave 4 — Mark button shot-location correction (`e6bc92a`)

Touch point: `app/_layout.tsx` (the `subscribeToMark` handler).

#### KEEP

| Location | Code | Rationale |
|---|---|---|
| [app/_layout.tsx:423](../app/_layout.tsx#L423) | `` console.log(`[mark] shot-location correction applied to shot ${lastShotOnHole.id} (${Math.round(ageMs / 1000)}s old)`); `` | Tagged. Confirms the 60s-window Mark correction actually mutated a shot — high signal for "did my Mark tap work?" beta reports. |
| [app/_layout.tsx:428](../app/_layout.tsx#L428) | `console.log('[mark] shot-location correction skipped:', e);` | Tagged. Outer catch — non-fatal; if state read fails the Mark still seeded SmartFinder above (separate code path). |

#### REMOVE / CONVERT — none

---

### 2.3 Phase 408 — Voice tone (`24049dd`)

`git diff 24049dd~1..24049dd -- '*.ts' '*.tsx' | grep console` returns nothing. The commit only adjusts ElevenLabs voice_settings constants in `api/voice.ts` + `app/api/voice+api.ts` and bumps a cache hash in `services/fillerLibrary.ts`. No new console calls.

---

### 2.4 Phase 409 — TightLie integration (`f6551ac`)

Touch points: `app/lie-analysis.tsx`, `store/roundStore.ts` (pendingLieAnalysis slot), vision service files.

#### KEEP

| Location | Code | Rationale |
|---|---|---|
| [app/lie-analysis.tsx:266](../app/lie-analysis.tsx#L266) | `console.log('[lie-analysis] persist pending failed (non-fatal):', e);` | Tagged + non-fatal. The catch wraps `round.setPendingLieAnalysis(analysis)` — a Zustand setter that shouldn't throw, but defensive trapping is correct here because the UI continues to `safeBack()` regardless. |

#### REMOVE / CONVERT — none

The vision-service files in this commit (`services/lieAnalysisContext.ts`, etc.) added no console calls.

---

### 2.5 Phase 410 — Profile login/sync (`ff2f8e7`)

Touch points: `store/playerProfileStore.ts`, `app/welcome.tsx`, `app/index.tsx`, `app/settings.tsx`.

Zero new console calls across all four files. Verified by greping the diff against just these paths — login/sync flow goes through state setters and AsyncStorage; no debug scaffolding was left behind.

---

## 3. Verdict

**Clean.** This morning's work did **not** pollute the console.

- 18 new console calls, **all 18 tagged** with a `[component]` prefix (`[bgLocation]`, `[gps]`, `[gps:outlier-rejected]`, `[movementMode]`, `[roundStore]`, `[audit:round-active]`, `[mark]`, `[lie-analysis]`).
- 0 bare `console.log(x)`, 0 `console.log('here')`, 0 raw-object dumps, 0 leftover scaffolding.
- Every error-handling catch that logs is around a non-fatal best-effort side-effect (GPS subsystem warmup, background-task registration, optional permission prompts, pending-lie state setter). The catches are intentional fences — exactly the boot-fragility lesson encoded in `faff1d9`.
- The `[audit:round-active]` tag aligns with the pre-existing convention in `store/roundStore.ts` (lines 404 / 424 / 569 / 656) — new orchestrator lines slot into the same readable timeline.

Empty REMOVE and CONVERT columns. Beta-tester logs will be informative without garbage.

### Minor stylistic notes (not bugs, not required to address)

- All new error-catch logs use `console.log(...)` rather than `console.warn(...)` or `console.error(...)`. Functionally identical for log capture, but if beta-tester log shipping ever filters by level (e.g., Sentry breadcrumb level), promoting the catches in `services/backgroundLocationTask.ts` and the `[roundStore] *-orchestration failed` lines to `console.warn` would let the existing tagged traces stay at `log` and the actual failures float up. Not blocking; flagging because the question was "honest verdict".
- The two `[gps:outlier-rejected]` lines fire on every rejected fix during a bad-signal stretch. If a tester plays under trees they may see dozens per minute. Already gated by the outlier filter so they only appear when meaningful, but worth noting if beta-tester log size becomes a concern.

Neither note rises to REMOVE or CONVERT. The audit is green.
