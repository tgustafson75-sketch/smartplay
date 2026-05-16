# Audit 501 — Type Safety Review (Phase 500 → HEAD)

**Window:** `3a5714a..HEAD` (14 commits, Phase 405 wave 3 → Phase 411 hotfix + Sunnyvale add)
**TS check:** `npx tsc --noEmit` returns clean (no diagnostics).
**Scope:** 22 `.ts`/`.tsx` files touched, +1,672 / -66 lines.

Files in window (TS only):

```
api/voice-intent.ts
app/(tabs)/play.tsx
app/_layout.tsx
app/api/kevin+api.ts
app/index.tsx
app/lie-analysis.tsx
app/quick-start.tsx                (new)
app/recap/[round_id].tsx
app/settings.tsx
app/smartfinder.tsx
app/welcome.tsx                    (new)
components/CaddieDataStrip.tsx
components/dev/GpsQualityOverlay.tsx
data/localCourseImages.ts
hooks/useKevin.ts
services/backgroundLocationTask.ts (new)
services/gpsManager.ts
services/intents/atBallHandler.ts  (new)
services/intents/index.ts
services/movementModeDetector.ts   (new)
store/playerProfileStore.ts
store/roundStore.ts
```

---

## 1. `any` usage

`git diff 3a5714a..HEAD -- '*.ts' '*.tsx' | grep -E "^\+.*: any|^\+.*as any|^\+.*<any>|^\+.*Array<any>"` returns **zero matches**.

The six `any` hits from the broader `\bany\b` search are all English-language matches inside comments or JSX prose ("any incoming fix", "any native-binding failure", "any browser", "any club / strategy recommendation", "any section"). No new `: any` parameters, no `as any` escape hatches, no `<any>` generics introduced in the audit window.

**Verdict: clean.** Zero new `any` surface area. This is a real improvement over many of the older Phase 100/200 commits which routinely carried `as any` in store interop.

---

## 2. Type assertions (`as X`)

`git diff 3a5714a..HEAD -- '*.ts' '*.tsx' | grep -E "^\+.* as [A-Z]"` returns 8 hits across 4 files. Each:

| # | Site | Code | Verdict |
|---|---|---|---|
| 1 | [data → app/(tabs)/play.tsx:155](../app/(tabs)/play.tsx#L155) | `thumbnail: (SUNNYVALE_HOLE_IMAGES[1] ?? null) as ImageSourcePropType \| null` | **OK.** `SUNNYVALE_HOLE_IMAGES` is typed `Record<number, ImageSourcePropType>` so indexing already returns `ImageSourcePropType` — the assertion only adds the `\| null` to satisfy the `CourseSummary.thumbnail` field shape. Safe narrowing, not laundering. |
| 2 | [app/index.tsx:111](../app/index.tsx#L111) | `<Redirect href={'/welcome' as never} />` | **OK.** Codebase-wide expo-router workaround — 47 occurrences of `as never` for route literals. Necessary because expo-router's generated `Href` union doesn't include freshly added screens until type-gen runs. Consistent with prior phases. |
| 3 | [app/settings.tsx:746](../app/settings.tsx#L746) | `router.push('/welcome' as never)` | **OK.** Same expo-router pattern. |
| 4 | [app/settings.tsx:765](../app/settings.tsx#L765) | `router.push('/quick-start' as never)` | **OK.** Same. |
| 5 | [app/welcome.tsx:97](../app/welcome.tsx#L97) | `router.replace('/(tabs)/caddie' as never)` | **OK.** Same. |
| 6 | [app/welcome.tsx:185](../app/welcome.tsx#L185) | `router.push('/quick-start' as never)` | **OK.** Same. |
| 7 | [services/backgroundLocationTask.ts:64](../services/backgroundLocationTask.ts#L64) | `require('expo-task-manager') as typeof import('expo-task-manager')` | **OK.** Dynamic require is intentional (Phase 411-hotfix root cause: a static import side-effected white-screen at boot). The `typeof import(...)` cast preserves the full module type surface so `TaskManager.isTaskDefined` / `TaskManager.defineTask` calls below remain type-checked. This is the textbook safe pattern for lazy native modules. |
| 8 | [services/backgroundLocationTask.ts:73](../services/backgroundLocationTask.ts#L73) | `event.data as { locations?: Location.LocationObject[] } \| undefined` | **Borderline → OK.** The cast narrows `TaskManagerTaskBody.data` (typed `unknown` by expo-task-manager) to the locations shape. The very next line guards with `data?.locations ?? []` and an empty-array short-circuit, so a malformed payload produces an early return rather than an unsafe `.coords.latitude` read. Honest narrowing of an external native callback shape. Acceptable. |

**Verdict: clean.** No risky assertions. Every `as X` either (a) narrows an already-typed value to a wider field, (b) is the established `as never` route-literal pattern, or (c) is a lazy-require cast that preserves the full module type. Nothing laundered unknown shapes into consumer code.

---

## 3. null/undefined handling

I traced each null/undefined-prone path introduced in the window. Each is honest.

### 3.1 TightLie capture pipeline (Phase 409)

The full chain: camera → `analyzeLie()` → `LieAnalysisResult` → `setPendingLieAnalysis()` → `logShot` (copy + clear) → Kevin context.

- **Vision response is already a tagged union.** `LieAnalysisResult = { kind: 'ok'; analysis } | { kind: 'no_network' } | { kind: 'too_large' } | { kind: 'low_quality'; follow_up } | { kind: 'error'; message }` ([services/lieAnalysisService.ts:26](../services/lieAnalysisService.ts#L26)). The lie-analysis screen narrows via `kind` before accessing `.analysis`. No bare `.x` access on a potentially-null analysis.
- **Persistence call is guarded.** [app/lie-analysis.tsx:262](../app/lie-analysis.tsx#L262) wraps `useRoundStore.getState().setPendingLieAnalysis(analysis)` in try/catch with non-fatal log. The `analysis` value here is already narrowed (it's a prop on the `Result` view, populated only on the `kind === 'ok'` branch upstream).
- **Shot consumption is `??`-chained.** [store/roundStore.ts:731](../store/roundStore.ts#L731): `lie_analysis: shot.lie_analysis ?? s.pendingLieAnalysis ?? null`. Triple-fallback, can't fail.
- **Pending-clear is conditional.** [store/roundStore.ts:755](../store/roundStore.ts#L755): `pendingLieAnalysis: enriched.lie_analysis ? null : s.pendingLieAnalysis`. Correctly leaves the slot intact if no analysis was attached.
- **Kevin reads via getter, not destructure.** [hooks/useKevin.ts:140](../hooks/useKevin.ts#L140) wraps `useRoundStore.getState().pendingLieAnalysis` in `(() => { try { ... } catch { return null; } })()` so even a store-not-mounted edge case (test harness) returns `null` rather than throwing. Then on the server, [app/api/kevin+api.ts:367](../app/api/kevin+api.ts#L367) gates the whole block on `pendingLieAnalysis ? ... : ''` and uses `?.` / `??` for each optional field (`recommended_club ?? 'open'`, `alternative_play ?? 'n/a'`, `goal_aware_note ?` ternary).

**No unguarded access found.**

### 3.2 Profile sync (Phase 410)

- `first_opened_at`, `firstName`, `name`, `handicap` are all typed nullable / optional in the store. Welcome screen reads them with `?? ''` fallbacks ([app/welcome.tsx:71-73](../app/welcome.tsx#L71)).
- `parseFloat(handicapText.trim())` is gated by `Number.isFinite(hcp) && hcp >= 0 && hcp <= 54` before persistence ([app/welcome.tsx:84](../app/welcome.tsx#L84)). Won't write `NaN`.
- Empty-name fallback: `if (trimmed.length > 0) setName(trimmed); else if (!existingName) setName('friend')`. Caddie always has SOMETHING to address.
- `first_opened_at` re-stamping uses `if (!profile.first_opened_at) usePlayerProfileStore.setState({ first_opened_at: Date.now() })`. Idempotent and correctly guarded.
- Index gate `if (!hasOpenedBefore && !hasName) return <Redirect href='/welcome' />` ([app/index.tsx:108](../app/index.tsx#L108)) uses `?? ''` on name before `.trim()` — null-safe.
- The new Sentry `onRehydrateStorage` hook ([store/playerProfileStore.ts:215](../store/playerProfileStore.ts#L215)) uses presence flags (`!!state.name`, `state.first_opened_at != null`) only — never dereferences a missing field — and is wrapped in try/catch.

### 3.3 At-ball intent + Mark-button correction

- [services/intents/atBallHandler.ts:33](../services/intents/atBallHandler.ts#L33) `snapshotLocation()` returns `ShotLocation | null`. Caller checks `if (!loc) return { success: false, ... }` before passing on.
- Active-round check, shot-on-hole check, and "already closed" check all gate the mutation ([services/intents/atBallHandler.ts:54-87](../services/intents/atBallHandler.ts#L54)). Honest "I don't have a shot on this hole" branch instead of mutating nothing.
- Mark-button correction in [app/_layout.tsx:418](../app/_layout.tsx#L418) is wrapped in try/catch; checks `round.isRoundActive`, `lastShotOnHole` existence, `ageMs < 60_000`, and `!lastShotOnHole.end_location` before mutating. Belt + suspenders.

### 3.4 Background-location task

- [services/backgroundLocationTask.ts:71-90](../services/backgroundLocationTask.ts#L71) iterates `data?.locations ?? []`; per-fix reads `l.coords.accuracy ?? null` and `l.coords.speed ?? null`. Nothing dereferences a possibly-missing field unguarded.
- Outer `ensureTaskDefined()`, `startBackgroundLocation()`, and `stopBackgroundLocation()` are each fully try/catch-wrapped. A native-binding failure logs and continues; nothing throws back to the caller.

### 3.5 Movement-mode detector

- `pushSpeed` validates with `if (s == null || !Number.isFinite(s) || s < 0) return` ([services/movementModeDetector.ts:54](../services/movementModeDetector.ts#L54)). No `NaN` or negative-speed contamination.
- Empty buffer short-circuits in `evaluate()` before any reduce.

### 3.6 Course auto-detect banner

- `atCourse` memo in `app/(tabs)/play.tsx` filters out courses with `c.lat == null || c.lng == null` before haversine, returns `null` when no fix. Render is gated `{atCourse && selected?.id !== atCourse.course.id && (...)}`. Both nulls and the no-fix case route to no-render.

**Verdict: clean.** Every new async pipeline guards each stage. No unguarded `.x` access on a possibly-null value found.

---

## 4. API response typing

| API | Response type defined? | Where consumed | Notes |
|---|---|---|---|
| Anthropic Sonnet (TightLie lie analysis) | **Yes** — [`LieAnalysis` type at services/lieAnalysisService.ts:14](../services/lieAnalysisService.ts#L14) and the `LieAnalysisResult` tagged union at line 26. | `app/lie-analysis.tsx` (narrows by `kind`), `store/roundStore.ts` (shot.lie_analysis), `app/api/kevin+api.ts` (request body type at line 213), `hooks/useKevin.ts` (read-through getter). | Phase 409 added `pendingLieAnalysis?: { situation_description: string; ... } \| null` to `kevin+api.ts`'s request body destructure ([line 213](../app/api/kevin+api.ts#L213)). This is a **duplicated literal type**, not an `import('../services/lieAnalysisService').LieAnalysis` reference. Borderline — drift risk if `LieAnalysis` ever gains a field. Mitigated because the duplicate is field-for-field identical today and the server only reads named fields with `??` fallbacks. **Recommend follow-up: have `kevin+api.ts` import the canonical type.** Not a beta blocker. |
| ElevenLabs voice (tone refinement) | **N/A in window.** Phase 408 isn't part of the audit range (`3a5714a..HEAD` starts at Phase 405 wave 3). `git diff` shows no ElevenLabs-related files modified. | — | No new untyped surface; not a regression. |
| golfcourseapi (Phase 410 profile sync) | **N/A.** Phase 410 commits in this window are profile-storage + login-hardening only — no golfcourseapi changes. The new Sunnyvale entry is hard-coded into `LOCAL_COURSES` literal, not synced from an API. | — | No untyped API surface introduced. |
| TaskManager background-location callback | **Yes** — narrowed via `event.data as { locations?: Location.LocationObject[] } \| undefined` then immediately guarded with `?? []`. | [services/backgroundLocationTask.ts:73](../services/backgroundLocationTask.ts#L73). | Acceptable per Section 2 #8. |
| Voice intent classifier | Existing typed contract (`IntentHandler` / `IntentResult`). New `atBallHandler` conforms; no untyped surface added. | services/intents/atBallHandler.ts. | OK. |

---

## 5. Verdict

**Type safety improved over the window.** Concrete signals:

- **Zero new `any`.** Six new files (`backgroundLocationTask.ts`, `movementModeDetector.ts`, `atBallHandler.ts`, `welcome.tsx`, `quick-start.tsx`, plus extensive edits to `roundStore.ts` / `gpsManager.ts` / `useKevin.ts` / `kevin+api.ts`) ship with no escape hatches.
- **Eight new `as X` assertions, all justified.** Six are the established `as never` expo-router pattern, one is `as typeof import(...)` for a deliberately-lazy native require, one is a narrowed `unknown → { locations?: ... }` immediately guarded by `?? []`. None launder unknown shapes.
- **New async pipeline (TightLie persistence) is fully discriminated-union driven.** The vision response uses a tagged-union `LieAnalysisResult`. Every consumer narrows by `kind` before reading payload. The pending-slot → shot copy → Kevin-context chain uses `??` everywhere a value could be null.
- **Profile fields (`firstName`, `name`, `handicap`, `first_opened_at`) all have sensible defaults at consumers** — `?? ''`, `?? 'friend'` fallback, `Number.isFinite` gate on handicap, `if (!profile.first_opened_at) setState(...)` idempotent stamp.
- **`npx tsc --noEmit` is clean.** No diagnostics across the working tree.

### Beta-tester readiness

**Ready from a type-safety standpoint.** The pipelines a tester will exercise most heavily — round start orchestration, TightLie capture, voice intents, profile setup — are the most carefully guarded. Background-location is fully try/catch-walled after the Phase 411 hotfix so a native-binding regression can't reproduce the white-screen.

### One follow-up worth scheduling (not a blocker)

[app/api/kevin+api.ts:213](../app/api/kevin+api.ts#L213) declares an inline duplicate of the `LieAnalysis` shape instead of importing it. Field-for-field identical today, but adds future-drift risk. Suggested fix: replace the inline shape with `pendingLieAnalysis?: import('../../services/lieAnalysisService').LieAnalysis | null`. Trivial change, single point of truth.

Other than that: type safety held and improved. Ship.
