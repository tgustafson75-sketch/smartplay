# Phase 420 Audit: Duplication Hunt

**Audit Date:** 2026-05-20
**Scope:** SmartPlay Caddie Pro — every place the codebase says the
same thing in two voices (overlapping screens, parallel state holders,
re-implemented math, type-name collisions, repeated inline logic).
**Methodology:** read-only `rg`/`find` sweep across `app/`, `components/`,
`services/`, `store/`, `utils/`, `types/`, `hooks/`, `lib/`,
`constants/`, `data/` with spot-checks of every claim against the
actual source.

> Phase 405–413 audits already noted some of these in passing
> (e.g. the dual GPS cache, the cage UI reconciliation comment block
> on `app/cage/session.tsx`). This audit pulls them into one place,
> adds the ones nobody has called out yet, and ranks them by blast
> radius + consolidation effort.

---

## Verdict by duplication

| Duplication | State | Anchor |
|-------------|-------|--------|
| Cage / SwingLab / SmartMotion capture surfaces (5 screens, 3,649 LOC) | **CRITICAL** | `app/swinglab/cage-drill.tsx`, `app/swinglab/quick-record.tsx`, `app/smartmotion-quick.tsx`, `components/CageSessionOverlay.tsx`, `components/CaptureOverlay.tsx` |
| Cage entry points — three roads into the cage flow | **CRITICAL** | `app/cage/index.tsx:84`, `app/(tabs)/caddie.tsx:3121`, `components/CageSessionOverlay.tsx` |
| `CageSession` interface defined twice with different shapes | **CRITICAL** | `types/cage.ts:1` vs `store/cageStore.ts:116` |
| Live GPS fix cached in **three** places | **CRITICAL** | `services/gpsManager.ts:87`, `services/smartFinderService.ts:67`, `services/shotLocationService.ts:25` |
| Five `haversine` implementations | **HIGH** | `utils/geoDistance.ts:13`, `services/gpsManager.ts:108`, `services/shotDetectionService.ts:65`, `services/mapboxImagery.ts:88`, `services/smartVisionOverlay.ts:178` |
| Two `bearingDegrees` implementations | **HIGH** | `utils/geoDistance.ts:45` vs `services/mapboxImagery.ts:65` |
| Watch-connected state held in two stores | **HIGH** | `store/settingsStore.ts:86` vs `store/watchStore.ts:33` |
| `handicap` (integer) vs `handicap_index` (float) in same store, manually kept in sync | **HIGH** | `store/playerProfileStore.ts:30, 60, 201-207` |
| Two `BrandHeader` components rendering the same brand row | **HIGH** | `components/brand/BrandHeaderRow.tsx` vs `components/caddie/cockpit/BrandHeader.tsx` |
| Two `PrimaryIssueCard` components, same name, different domains | **HIGH** | `components/PrimaryIssueCard.tsx` vs `components/swinglab/PrimaryIssueCard.tsx` |
| Drill / Issue catalogs split across constants & data | **HIGH** | `data/drillCatalog.ts` vs `constants/primaryIssueCatalog.ts` |
| `Hole` shape defined twice with different fields | **HIGH** | `types/course.ts:19` vs `store/roundStore.ts:11` |
| `ShotLocation` / `LatLng` defined 5+ times | **HIGH** | `utils/geoDistance.ts:3`, `store/roundStore.ts:29`, `services/smartVisionOverlay.ts:23`, `services/holeDetection.ts:41`, `services/golfbertApi.ts:25`, `types/smartfinder.ts:4` |
| Club label table defined 4+ times | **MEDIUM** | `services/clubRecognition.ts:214` (canonical) vs `app/cage/index.tsx:24-31`, `app/hole-view.tsx:49`, `app/swinglab/upload.tsx:23`, `components/QuickLogShotSheet.tsx:32`, `api/tutorial-analysis.ts:27` |
| Inline `formatDate` / `formatTime` mm:ss helpers | **MEDIUM** | `services/shareCardGenerator.ts:5`, `app/cage-debug.tsx:49`, `app/swinglab/swing/[swing_id].tsx:37`, `components/CageSessionOverlay.tsx:451`, `app/cage/history.tsx:60`, `app/owner-logs.tsx:27`, `app/gps-test.tsx:99`, `app/hole-view.tsx:58` |
| `useKevin` + `useVoiceCaddie` — both wire the same voice pipeline | **MEDIUM** | `hooks/useKevin.ts` (183 LOC) + `hooks/useVoiceCaddie.ts` (1,008 LOC); `app/(tabs)/caddie.tsx:53-54` imports both |
| `services/rangefinder.ts` vs `services/smartFinderService.ts` — same domain, two service files | **MEDIUM** | `services/rangefinder.ts` (math) + `services/smartFinderService.ts` (state + math) |
| Cage calibration split across two persistent stores | **MEDIUM** | `store/cageCalibrationStore.ts` + `store/cageOverlayCalibrationStore.ts` |
| Course geometry — `golfCourseApi` vs `golfbertApi` vs `courseGeometryService` vs `mapboxImagery` | **MEDIUM** | All four cache or fetch hole geometry; lookup priority is ad-hoc per caller |
| Routes that point to files that no longer exist | **HIGH (bug)** | SwingLab tab card → `/arena/practice` (no folder); comments reference `app/swinglab/drills.tsx` + `drills-legacy.tsx` (deleted) |

## State of duplication (1 sentence)

**The Cage / SwingLab / SmartMotion subsystem has three swing-capture
surfaces (3,649 LOC) doing the same job under different names while
sharing a `CageSession` type-name collision and three GPS caches —
this is the single largest consolidation target in the app, and every
other duplication on this list flows from the same "build the v3 port
next to the existing thing and don't delete the old one" pattern.**

---

## The headline: SwingLab / Practice / Cage / SmartMotion is one
## feature with five entry points

There is **no** `app/practice/` directory. "Practice" is a label
inside the SwingLab tab launcher (`app/(tabs)/swinglab.tsx:106` —
section header `"PRACTICE"`). The actual surfaces are:

### Five swing-capture screens

| File | LOC | Purpose | Camera | Acoustic | Phase machine |
|------|-----|---------|--------|----------|---------------|
| `components/CageSessionOverlay.tsx` | 1085 | Multi-swing cage session (the canonical one per the comment at `app/cage/session.tsx:7-22`) | yes | yes | yes |
| `app/swinglab/cage-drill.tsx` | 1039 | "Cage Drill" single-swing flow with bullseye-visibility gate | yes | yes | yes (SETUP→CHECKING→READY→RECORDING→UPLOADING→RESULT) |
| `app/smartmotion-quick.tsx` | 954 | "SmartMotion Quick" — manual capture + inline analysis loop | yes | yes | yes (REQUESTING→READY→RECORDING→SAVING→ANALYZING→RESULTS) |
| `app/swinglab/quick-record.tsx` | 260 | "Quick Record" — single-tap entry that hands off to `/swinglab/smartmotion` | yes | no | flat |
| `components/CaptureOverlay.tsx` | 311 | Round-side voice-triggered "record this shot" overlay | yes | yes (delegates to detector) | flat |

The header comment at `app/smartmotion-quick.tsx:1-37` calls out that
this file was a rewrite of a prior auto-start flow and explicitly
keeps that prior pattern alive on `/swinglab/cage-drill` ("works
equally for cage / course / range — the surface registry tag stays
'cage' because the camera + acoustic ownership semantics are
identical"). The header at `app/swinglab/quick-record.tsx:1-14`
calls out that it "replaces the prior /camera-setup → /cage-drill
detour for the SmartMotion entry point. cage-drill stays put for
the longer cage-session flow." Both surfaces have shipped; neither
old surface has been removed.

### Five cage entry points

1. SwingLab tab → **Cage Mode card** → `/cage` → `/cage/session` →
   `<CageSessionOverlay />` (the canonical wrapper per `app/cage/session.tsx:30-49`)
2. SwingLab tab → **SmartMotion card** → `/swinglab/smartmotion` →
   Record button → `/swinglab/quick-record` (`app/swinglab/smartmotion.tsx:185, 211, 224, 494`)
3. SwingLab tab → **Range Mode card** → `/swinglab/range` →
   Start Session → `/cage/session` (`app/swinglab/range.tsx:96`)
4. SwingLab tab → **Drills card** → `/drills` (no cage interaction)
5. Caddie tab Tools menu → "Cage Mode" → `/cage` (`app/(tabs)/caddie.tsx:3121`),
   "SmartMotion" → `/swinglab/smartmotion` (`app/(tabs)/caddie.tsx:2490`),
   or "Practice" → `/(tabs)/swinglab` (`app/(tabs)/caddie.tsx:3120`)
6. `app/cage-drill.tsx` ← does **not exist** (`find` confirms) but the
   path `app/swinglab/cage-drill.tsx` is the actual file
7. SwingLab tab → **Arena card** → `/arena/practice` —
   **`/arena` folder does not exist**. `app/(tabs)/swinglab.tsx:78` ships
   a broken route. Spot-checked with
   `find /Users/timothyg/Documents/smartplay/app/arena` (no result).

### Cage routes table

| Route | File | What it does |
|-------|------|--------------|
| `/cage` | `app/cage/index.tsx` | Club picker + calibration setup |
| `/cage/session` | `app/cage/session.tsx` (50 LOC thin wrapper) | Renders `<CageSessionOverlay />` |
| `/cage/history` | `app/cage/history.tsx` | Past sessions list |
| `/cage/summary` | `app/cage/summary.tsx` | Post-session recap |
| `/cage-review/start` | `app/cage-review/start.tsx` | Phase BL review flow start |
| `/cage-review/[review_session_id]` | `app/cage-review/[review_session_id].tsx` | Phase BL per-swing review |
| `/cage-review/summary` | `app/cage-review/summary.tsx` | Phase BL review summary |
| `/cage-debug` | `app/cage-debug.tsx` | Dev panel |
| `/swinglab/cage-drill` | `app/swinglab/cage-drill.tsx` | The 1039-LOC parallel single-swing flow |
| `/swinglab/smartmotion` | `app/swinglab/smartmotion.tsx` | Two-card analysis screen (Phase 416) |
| `/swinglab/quick-record` | `app/swinglab/quick-record.tsx` | Bare camera, hands off to smartmotion |
| `/swinglab/range` | `app/swinglab/range.tsx` | "Range Mode" planning surface |
| `/swinglab/library` | `app/swinglab/library.tsx` | Swing library |
| `/swinglab/space-scan` | `app/swinglab/space-scan.tsx` | Practice space configuration |
| `/swinglab/camera-setup` | `app/swinglab/camera-setup.tsx` | Pre-flight checklist |
| `/swinglab/tutorials` | `app/swinglab/tutorials.tsx` | Tutorial library |
| `/swinglab/upload` | `app/swinglab/upload.tsx` | Camera-roll upload |
| `/smartmotion-quick` | `app/smartmotion-quick.tsx` | The OTHER 954-LOC manual capture loop |

The previous SwingLab body lives at... nowhere. The header comment of
`app/(tabs)/swinglab.tsx:17-19` claims it was "copied verbatim to
`/app/swinglab/drills.tsx`" and `data/drillCatalog.ts:15` claims
`app/swinglab/drills-legacy.tsx` preserves the previous body — **both
files are absent from disk**. Spot-checked with
`find . -path "*/swinglab/drills*"` returning nothing.

### Canonical recommendation

- **One swing-capture surface**: `components/CageSessionOverlay.tsx`
  is already labelled canonical (`app/cage/session.tsx:7-22`,
  `docs/phase-BV-migration.md` referenced). Effort to retire
  `cage-drill.tsx` + `smartmotion-quick.tsx` + `quick-record.tsx`:
  **L** (2-3 days; touches 5 entry points, 3 phase machines, the
  acoustic detector, and surface registry tags).
- **One cage route**: `/cage` for setup, `/cage/session` for capture,
  `/swinglab/library` for review, `/swinglab/smartmotion` for the
  Phase 416 two-card analysis only. Delete `/swinglab/cage-drill`,
  `/swinglab/quick-record`, `/smartmotion-quick`.
- **Fix `/arena/practice` broken card** *or* ship the missing
  `app/arena/practice.tsx` route.

---

## Components that do the same job under different names

### 1. `BrandHeader` × 2 (HIGH)

- `components/brand/BrandHeaderRow.tsx:43-115` — 194 LOC, used on
  Dashboard / SwingLab / Play / Scorecard (mounted via `BrandHeaderRow`)
- `components/caddie/cockpit/BrandHeader.tsx:36-116` — 228 LOC, used
  on the Caddie cockpit screen

Both render: 56px circular SmartPlay badge + "SMARTPLAY CADDIE" wordmark
+ tagline + ••• Tools pill + listening halo around the badge when
voice is active. Same `BADGE_SIZE = 56`, same `Animated.Value`-driven
halo, same `useToolsMenuStore.open()` for the pill, same
`react-native-safe-area-context` patterns.

The header comment at `BrandHeaderRow.tsx:11-16` acknowledges this:
*"The Cockpit BrandHeader does NOT use this component because it adds
tap-the-row-to-talk + voice-state badge ring + MODE pill. Both
renderings stay in visual lock-step by sharing the same constants
below."* — but it does **not** share constants; each file declares its
own `BADGE_SIZE = 56` (or `BRAND_BADGE_SIZE`), its own halo, its own
styles.

**Canonical:** consolidate on `BrandHeaderRow` with a
`voiceState?: VoiceState` prop. Cockpit passes the prop; everywhere
else omits it. **Effort: M** (~1 day).

### 2. `PrimaryIssueCard` × 2 (HIGH — name collision)

- `components/PrimaryIssueCard.tsx` — Phase 111 catalog card with
  illustration + "Watch" video + "Try drill" button
- `components/swinglab/PrimaryIssueCard.tsx` — cage-session result
  card showing detected `PrimaryIssue` with severity dot + mechanical
  breakdown

Same component name, different file paths, different prop shapes,
different render trees. Will silently confuse anyone editing one
thinking they're editing the other. **Canonical:** rename
`components/swinglab/PrimaryIssueCard.tsx` to
`CageSessionIssueResult.tsx` or similar. **Effort: S** (rename + update
imports — about 1 hour).

### 3. `TapToTalkButton` vs `AskCaddieButton` (LOW — overlap, not dup)

- `components/TapToTalkButton.tsx` (78 LOC) — earbud fallback button
- `components/caddie/cockpit/AskCaddieButton.tsx` (171 LOC) — full-width
  mic pill on cockpit

Both fire mic activation. Different surfaces, different ergonomics —
**not the same component but both wire `services/listeningSession.toggle()`**
and re-derive the same labels. Could share a label-by-VoiceState
helper. **Effort: S.**

### 4. `useKevin` vs `useVoiceCaddie` (MEDIUM)

- `hooks/useKevin.ts` — 183 LOC, talks to `/api/kevin`
- `hooks/useVoiceCaddie.ts` — 1008 LOC, talks to `/api/voice-intent`,
  filler library, conversation state, intents router

Both are used by `app/(tabs)/caddie.tsx:53-54` simultaneously. The
`useKevin` hook is the older one (talks directly to `kevin+api.ts`);
`useVoiceCaddie` is the newer one with the full pipeline. **The fact
that a primary surface mounts both is a red flag** — there's a real
risk of two parallel voice paths competing on the same user tap.
**Canonical:** retire `useKevin` once Caddie tab is fully on
`useVoiceCaddie`. **Effort: M.**

### 5. `services/rangefinder.ts` vs `services/smartFinderService.ts` (MEDIUM)

- `services/rangefinder.ts` (151 LOC) — pure tilt/heading → distance math
- `services/smartFinderService.ts` (469 LOC) — yardage state, F/M/B
  to green, GPS cache, sim hooks, subscribe API

Same problem domain (the rangefinder feature). `rangefinder.ts` is
*only* the lock-math helper; everything else lives in
`smartFinderService.ts`. The split is defensible but obscured —
SmartFinder also has its own state slice in `store/smartFinderStore.ts`
and a card component in `components/smartfinder/`. **Canonical:** fold
`rangefinder.ts` into `smartFinderService.ts` (or into a `smartfinder/`
folder with `math.ts` + `service.ts` + `store.ts`). **Effort: S.**

---

## Services / stores holding the same data in two places

### 1. Live GPS fix in THREE caches (CRITICAL)

| Cache | Anchor | Owner |
|-------|--------|-------|
| `lastFix: GpsFix \| null` | `services/gpsManager.ts:87` | The authoritative one — receives every `watchPositionAsync` event |
| `lastFix: LastFix \| null` | `services/smartFinderService.ts:67` | Mirrors gpsManager via `subscribeGps` (line 98) but also gets *seeded directly* by the simulator (`setSimulatedFix`, line 131), by `setMarkedFix` (line 162), and is the read source for `getGreenYardagesSync` |
| `lastLocation: ShotLocation \| null` | `services/shotLocationService.ts:25` | Receives writes from `getCurrentLocation()` only; used as a fallback when `getOneShotFix()` fails |

`smartFinderService.lastFix` and `gpsManager.lastFix` get out of sync
in three cases:
1. **Simulator on** — `setSimulatedFix` writes to smartFinder only,
   gpsManager unaware (see Phase 405 audit note about simulator
   semantics).
2. **Marked position** — `setMarkedFix` overrides smartFinder's cache,
   gpsManager keeps reading raw GPS.
3. **Round end** — `stopSmartFinderGpsTracking` (`smartFinderService.ts:118`)
   nulls smartFinder's `lastFix` but `gpsManager.lastFix` survives.

`shotLocationService.lastLocation` is a stale copy that never gets
invalidated (no round-end reset). The "Phase B refinement" comment in
that file already acknowledges this is a fallback, but the cache
itself is never cleared.

**Canonical:** `gpsManager.lastFix` is the single source of truth.
SmartFinder should consume via `subscribeGps` only (delete
`smartFinderService.lastFix` as state; turn `getLastFix()` into a
direct delegation to `gpsManager.getLastFix()`). Move
`setMarkedFix` + `setSimulatedFix` semantics into `gpsManager` via
`ingestExternalFix` (which already exists at `gpsManager.ts:189`).
Delete `shotLocationService.lastLocation` entirely. **Effort: L** —
this is load-bearing across 25+ call sites and the simulator harness.

### 2. Watch-connected state in TWO stores (HIGH)

- `useSettingsStore().watchConnected` — set by `setWatchConnected` in
  `store/settingsStore.ts:342`, read by `app/settings.tsx:46`,
  `app/cage/index.tsx:57`
- `useWatchStore().isConnected` — set by
  `store/watchStore.ts:setConnected`, read by
  `app/swinglab/cage-drill.tsx:120`, `app/cage/summary.tsx:45`

`app/cage/index.tsx` (the setup screen) and `app/cage/summary.tsx`
(the post-session recap) read from **different** stores for the same
piece of UI state ("Watch On / Off" pill). If a watch disconnects
mid-session, one screen updates and the other doesn't. **Canonical:**
`useWatchStore.isConnected` (the store that owns swing telemetry
already). **Effort: S** — replace 4 read sites + remove
`watchConnected` from settingsStore.

### 3. Player profile: `handicap` vs `handicap_index` in the same store (HIGH)

`store/playerProfileStore.ts:30, 60` declares both:
- `handicap: number` (default `18`, integer)
- `handicap_index: number | null` (Phase T, USGA one-decimal)

The author noticed: `setHandicapIndex` (line 206) manually keeps the
two fields in lockstep by rounding the index back into `handicap`.
This works until a consumer mutates `handicap` directly via
`setHandicap` — then `handicap_index` becomes stale. Both fields are
referenced across the app (`hooks/useKevin.ts:33`,
`store/roundStore.ts:725-727`).

**Canonical:** `handicap_index` is the WHS-correct field. Remove
`handicap` and derive integer rounding at the read site. **Effort: M**
— need to audit every reader; the integer field is on the wire of the
relationship engine + Kevin's context prompt.

### 4. Cage calibration split across two stores (MEDIUM)

- `store/cageCalibrationStore.ts` — distance (yards), 59 LOC
- `store/cageOverlayCalibrationStore.ts` — bullseye + ball-box
  positions (fractions), 63 LOC

Conceptually one config ("how is the user's cage set up?") split into
two persisted slices. Not strictly wrong, but the UI on
`app/swinglab/camera-setup.tsx` and `app/swinglab/cage-drill.tsx` has
to read from both. **Canonical:** merge into one
`useCageSetupStore` with `distance`, `bullseye`, `ballBox`,
`calibrated_at`. **Effort: S.**

### 5. Course geometry — four overlapping caches (MEDIUM)

- `services/golfCourseApi.ts` (341 LOC) — golfcourseapi.com client +
  on-disk cache
- `services/golfbertApi.ts` (207 LOC) — Golfbert client; "callers fall
  back to the existing golfcourseapi geometry path" per the header
- `services/courseGeometryService.ts` (329 LOC) — in-memory geometry
  service; called by `getHoleGeometry()` in `store/roundStore.ts:58`
- `services/mapboxImagery.ts` (370 LOC) — Mapbox tile imagery + its
  OWN `haversineMeters` + `bearingDegrees`

Lookup priority is per-caller (`store/roundStore.ts:50-71` tries
courseGeometryService first, then falls back to `courseHoles` slice in
the round store). Adding a new caller means reasoning about the
priority ladder from scratch. **Canonical:** a single
`courseGeometryService` that exposes `getGeometry(courseId, hole)`
and internally fans out to golfbert → golfcourseapi → cached fallback.
**Effort: L** — every hot-path service reads geometry.

---

## Utility functions duplicated across files

### 1. `haversine` — FIVE implementations (HIGH)

| File | Line | Returns | Notes |
|------|------|---------|-------|
| `utils/geoDistance.ts` | `13` | yards | **Canonical**. Exported as `haversineYards`. Used by 8+ callers. |
| `services/gpsManager.ts` | `108` | meters | Private. Could call utils. |
| `services/shotDetectionService.ts` | `65` | meters | Private. Could call utils. |
| `services/mapboxImagery.ts` | `88` | meters | Private. Could call utils. |
| `services/smartVisionOverlay.ts` | `178` | yards | Private `haversineYards` — **literally re-declares the same function name as the utils one**, just with `Math.atan2` form instead of `Math.asin` form. Functionally identical. |

All five use the same earth radius (6371000) and same algorithm.
**Effort: S** — change four `function haversineMeters(...)` to
`(a, b) => haversineYards(a, b) * METERS_PER_YARD` and import from utils.

### 2. `bearingDegrees` — TWO implementations (HIGH)

- `utils/geoDistance.ts:45` — exported, used by `HoleShotMap`
- `services/mapboxImagery.ts:65` — private, byte-identical math

**Effort: S** — delete the mapboxImagery copy, import from utils.

### 3. `formatDate` / `formatTime` mm:ss (MEDIUM)

| Pattern | File | Line |
|---------|------|------|
| `formatDate(ts: number)` → "Mon, May 20" | `services/shareCardGenerator.ts` | `5` |
| `formatDate(ms: number)` → "May 20, 5:32 PM" | `app/cage-debug.tsx` | inline |
| `Math.floor(s / 60).toString().padStart(2,'0')` mm:ss | `components/CageSessionOverlay.tsx` | `451` |
| `Math.floor(s / 60)` + `s % 60` mm:ss | `app/swinglab/swing/[swing_id].tsx` | `37` |
| `Math.floor(ms / 60_000) + 'm ago'` | `app/hole-view.tsx` | `58` |
| `Math.floor(ms / 60_000) + 'm ' + ...` | `app/gps-test.tsx` | `99` |
| `toLocaleDateString(...)` inline | `services/swingLibrary.ts:123`, `app/recap/[round_id].tsx:246`, `app/cage/history.tsx:60`, `app/(tabs)/dashboard.tsx:475`, `app/owner-logs.tsx:27`, `app/voice-debug.tsx:147`, `app/patterns-debug.tsx:226`, `app/swinglab/library.tsx:266`, etc. |

**Canonical:** add `utils/formatDate.ts` and `utils/formatDuration.ts`
exporting `formatShortDate(ts)`, `formatTimeAgo(ms)`,
`formatMMSS(seconds)`, `formatRelative(ts)`. **Effort: M** — touches
20+ files but each replacement is mechanical.

### 4. Audio mode configuration calls (LOW — pattern reuse, not strictly dup)

15+ call sites do `await configureAudioForSpeech()` before `speak()`.
This is the documented contract (Phase V.7 voiceService) but the
boilerplate could be folded into `speak()` itself with an opt-out for
the few callers (intro-video, acoustic-test) that need raw control.
**Effort: S.**

### 5. Club label table (MEDIUM)

- **Canonical:** `services/clubRecognition.ts:214` `clubLabel(club_id)`.
- Inlined re-implementations:
  - `app/cage/index.tsx:24-31` — `CLUB_LABELS` + local `clubLabel()`
  - `app/hole-view.tsx:49` — `CLUBS` array
  - `app/swinglab/upload.tsx:23` — `CLUBS` array
  - `components/QuickLogShotSheet.tsx:32` — `CLUBS` array
  - `api/tutorial-analysis.ts:27` — `VALID_CLUBS` array

Each has a slightly different shape (some include putter, some
don't; some use "7I" some use "7i"). **Canonical:** one
`constants/clubs.ts` with `ALL_CLUBS`, `CLUB_LABEL_MAP`,
`isValidClubId()`. **Effort: S.**

---

## Duplicate type definitions for the same shape

### 1. `CageSession` — TWO interfaces, SAME name (CRITICAL)

- `types/cage.ts:1` — multi-clip master-video session shape:
  ```ts
  { id, player_id, started_at, ended_at, master_video_path,
    clips: CageClip[], distance_to_target_meters, ... }
  ```
- `store/cageStore.ts:116` — Phase J cage-mode session with shots:
  ```ts
  { id, date, club, shots: CageShot[], currentClub, clubSegments,
    dominantMiss, primary_issue, drill_recommendation, ... }
  ```

`services/cageStorage.ts` imports the first. `components/CageSessionOverlay.tsx`
imports the first. `store/cageStore.ts` exports the second, and 36
files import from `store/cageStore`. **These two `CageSession`s never
overlap on the same call path** but the name collision is a foot-gun
waiting for the next refactor. **Effort: S** — rename
`types/cage.ts:CageSession` to `CageStorageSession` (or
`MasterVideoSession`). 8 call sites.

### 2. `ShotLocation` / `LatLng` — 6 declarations of the same shape

| Declaration | Anchor |
|-------------|--------|
| `type ShotLocation = { lat: number; lng: number }` | `store/roundStore.ts:29` |
| `export type ShotLocation = { lat: number; lng: number }` | `utils/geoDistance.ts:3` |
| `export type LatLng = { lat: number; lng: number }` | `services/smartVisionOverlay.ts:23` |
| `type LatLng = { lat: number; lng: number }` | `services/holeDetection.ts:41` |
| `export interface LatLng { lat: number; lng: number }` | `services/golfbertApi.ts:25` |
| `user_position: { lat: number; lng: number; accuracy: number }` | `types/smartfinder.ts:4` |

`utils/geoDistance.ts:1` re-imports `ShotResult` from `store/roundStore`
*because* it wanted to be free of the store but the type lives there.
Then it declares its own `ShotLocation` to avoid the circular dep.
This is technical debt with a comment apologizing for itself.

**Canonical:** move `ShotLocation` to `types/geo.ts` (or back into
`utils/geoDistance.ts` and import everywhere). Delete the four other
declarations. **Effort: M** — touches 15+ files but each is a
one-line import swap.

### 3. `Hole` vs `CourseHole` (HIGH)

- `types/course.ts:19 Hole` — `{ hole_number, par, yardage, handicap, gps, hazards }`
  (from golfcourseapi)
- `store/roundStore.ts:11 CourseHole` — `{ hole, par, distance, front, back, teeLat, teeLng, middleLat, middleLng, frontLat, frontLng, backLat, backLng, note, estimated }`
  (denormalized for app use)
- `services/golfbertApi.ts:44 GolfbertHole` — Golfbert-shaped raw
- `services/golfCourseApi.ts:63 RawHole` — golfcourseapi-shaped raw
- `services/simulatedGPS.ts:516 MockRoundHole` — sim-only

Five hole shapes for one domain object. Three are wire formats
(legitimate); two — `Hole` (in `types/`) and `CourseHole` (in `store/`)
— overlap meaningfully. The `Hole` from `types/course.ts` is barely
used (`golfCourseApi.ts:2` imports it, `app/course/[course_id].tsx`
imports it for the detail page); `CourseHole` is what `roundStore`
actually stores. **Canonical:** drop `types/course.ts:Hole` in favor
of `CourseHole`, or formalize the contract that `Hole` is the wire
shape and `CourseHole` is the internal shape. **Effort: M.**

### 4. `RoundRecord` vs `RoundRecap` (LOW — same domain, different lifecycle)

- `store/roundStore.ts:137 RoundRecord` — completed-round persisted record
- `types/plan.ts:49 RoundRecap` — the user-facing recap shape

Different purposes; not a duplication, more a naming inconsistency.
**Effort: S** — rename one for clarity (e.g. `RoundCompletion` vs
`RoundRecapPayload`).

---

## Repeated inline logic (3+ files)

### 1. `mm:ss` formatter — `components/CageSessionOverlay.tsx:451`, `app/swinglab/swing/[swing_id].tsx:37` (verbatim). Covered above.

### 2. `new Date(ts).toLocaleDateString(...)` block — 8+ occurrences:

- `services/swingLibrary.ts:123`
- `services/shareCardGenerator.ts:5`
- `app/recap/[round_id].tsx:246`
- `app/cage/history.tsx:60`
- `app/(tabs)/dashboard.tsx:475`
- `app/owner-logs.tsx:27`
- `app/voice-debug.tsx:147`
- `app/patterns-debug.tsx:226`
- `app/swinglab/library.tsx:266`
- `app/cage-debug.tsx:446, 472`

### 3. Green centroid lookup (line 50-71 of `store/roundStore.ts`) — the
`greenForHole` helper does the geometry-service-first, courseHoles-second
fallback. **Same fallback pattern is repeated inline** in
`services/shotLocationService.ts:55-100` and
`services/lieAnalysisContext.ts:58`.

### 4. Camera permission request boilerplate (3+ copies):
`app/swinglab/cage-drill.tsx`, `app/swinglab/quick-record.tsx`,
`app/smartmotion-quick.tsx`, `components/CageSessionOverlay.tsx`,
`components/CaptureOverlay.tsx` all run the
`useCameraPermissions() + useMicrophonePermissions() + Linking.openSettings`
sequence with the same denial-fallback copy.

### 5. Persona-keyed background colors / accent maps — `app/(tabs)/caddie.tsx`,
`components/CaddieAvatar.tsx`, `app/profile/custom-caddie.tsx` each declare
their own `Record<Persona, string>` color tables.

---

## Routes that point to nothing

| Broken route | Origin | Status |
|--------------|--------|--------|
| `/arena/practice` | `app/(tabs)/swinglab.tsx:78` (Arena card) | No `app/arena/` folder exists |
| `app/swinglab/drills.tsx` | comment in `app/(tabs)/swinglab.tsx:18` | File deleted; comment stale |
| `app/swinglab/drills-legacy.tsx` | comment in `data/drillCatalog.ts:15` | File deleted; comment stale |
| `app/cage-drill.tsx` | implied by SmartPlay-Caddie-V3 routing | Actual file is `app/swinglab/cage-drill.tsx` |

The SwingLab tab's Arena card is dead-ends silently — tapping it
attempts to push `/arena/practice` and the router throws (or returns
404 to the user as a blank screen, depending on expo-router version).
**Effort: S** — either ship `app/arena/practice.tsx` (and the rest of
the Arena product the card teases) or replace the route with a
"Coming soon" affordance like the comments at
`app/(tabs)/swinglab.tsx:20-25` originally intended.

---

## Prioritized "what to do"

### CRITICAL (do these first — blast radius is the whole feature)

1. **Pick ONE swing-capture surface.**
   `components/CageSessionOverlay.tsx` is already labelled canonical.
   Delete `app/smartmotion-quick.tsx`, `app/swinglab/quick-record.tsx`,
   `app/swinglab/cage-drill.tsx`. Route every entry point through
   `/cage/session`. Effort: **L**.

2. **Collapse GPS caches.** `gpsManager.lastFix` becomes the only
   source of truth. `smartFinderService.lastFix` → delegate.
   `shotLocationService.lastLocation` → delete. Effort: **L**.

3. **Rename `types/cage.ts:CageSession`** to `CageStorageSession` to
   end the type-name collision. Effort: **S**.

### HIGH (each one is a 1-day cleanup with real ROI)

4. Unify `haversine` + `bearingDegrees` on `utils/geoDistance.ts`.
   Effort: **S**.
5. One `ShotLocation` / `LatLng` shape; delete the rest. Effort: **M**.
6. Move `watchConnected` to `useWatchStore.isConnected`; remove from
   settings. Effort: **S**.
7. Drop `handicap: number` (integer mirror) from
   `playerProfileStore`; derive at read sites. Effort: **M**.
8. Consolidate two `BrandHeader`s on `BrandHeaderRow`. Effort: **M**.
9. Rename `components/swinglab/PrimaryIssueCard.tsx` →
   `CageSessionIssueResult.tsx`. Effort: **S**.
10. Ship the missing `app/arena/practice.tsx` or fix the SwingLab tab
    card. Effort: **S**.

### MEDIUM

11. `utils/formatDate.ts` + `utils/formatDuration.ts` for the 15+
    inline date/time blocks. Effort: **M**.
12. `constants/clubs.ts` with one canonical club table. Effort: **S**.
13. Merge `cageCalibrationStore` + `cageOverlayCalibrationStore` into
    one. Effort: **S**.
14. Decide: keep `useKevin` or retire it for `useVoiceCaddie`.
    Effort: **M**.
15. Fold `services/rangefinder.ts` into `smartFinderService.ts`.
    Effort: **S**.

### LOW

16. Resolve `Hole` vs `CourseHole` naming. Effort: **M**.
17. Decide on course-geometry priority ladder
    (`golfCourseApi` + `golfbertApi` + `courseGeometryService` +
    `mapboxImagery`). Effort: **L** — but no behavior regression risk
    if you only do the API surface, not the priority logic.
18. Audio config boilerplate folded into `speak()`. Effort: **S**.

---

## Notes that contradicted what's on disk

- `app/(tabs)/swinglab.tsx:17-19` claims SwingLab body was moved to
  `app/swinglab/drills.tsx`. **The file does not exist.**
- `data/drillCatalog.ts:15` claims the prior body lives at
  `app/swinglab/drills-legacy.tsx`. **The file does not exist.**
- `components/brand/BrandHeaderRow.tsx:14-15` claims Cockpit
  BrandHeader and BrandHeaderRow "stay in visual lock-step by sharing
  the same constants below" — **they share no constants**; each
  declares its own.
- `app/cage/session.tsx:7-22` claims "Phase BV reconciles to a single
  canonical UI" but `app/swinglab/cage-drill.tsx` is still a full
  parallel 1039-LOC swing-capture flow. The reconciliation is half-done.

If you fix only one thing in Phase 421, fix the
SwingLab/Cage/SmartMotion three-surface tangle. Everything else on
this list is housekeeping; that one is product-level.
