# Recent-Changes Audit — Session of 2026-05-17

Walks every code change from this session (commits `8fa2390` → `a7908c0`,
plus the unfinished work). Per-file, per-function. Concerns and
"please review" flagged at the bottom of each section.

## Commit timeline

| SHA | Subject | Lines |
|---|---|---|
| `8fa2390` | Automatic green detection via OSM Overpass + drag-to-anchor on hole view | +601 / −23 |
| `69cf9ec` | Hero shot removed; OSM Overpass Accept header; debug-route owner gate | +121 / −178 |
| `adb2d8c` | Stop Palms leaking into other courses; crop Crystal Springs + Mariners | +101 / −43 (+image bytes) |
| `b331a14` | SJM scorecard + OSM pairing bounds + chained intent sequence | +264 / −36 |
| `bd1bf3f` | SmartVision rebuild — Bluegolf-class hole view from OSM polygons | +780 / −3 |
| `a7908c0` | Phase 413 — wearable integration | +590 / −9 |

## 1. OSM Overpass green detection (`api/course-geometry.ts`)

The server endpoint that fetches per-hole tee/green coords. Started as
a thin wrapper around golfcourseapi; grew to include OSM Overpass
fallback, polygon retrieval, and bipartite tee↔green pairing.

### `fetchOsmFeatures(centroid, feature)` → `Loc[]`
- Single-feature Overpass query (`way[golf=green]` or `way[golf=tee]`)
  for centroid lat/lng within `OSM_SEARCH_RADIUS_M` (1500m).
- Returns centroid lat/lng per feature; polygon ring discarded.
- Filters out `name~practice|chipping|putting|training|warm` features
  via `isPracticeFeature(tags)`.
- Used by `osmOnly=1` mode (when golfcourseapi has no upstream record)
  and the upstream-fallback path (when golfcourseapi returns null
  greens for known holes).

### `fetchOsmPolygons(centroid, feature)` → `OsmPolygon[]`
- Same Overpass query but keeps the full polygon ring + name tag.
- Used when `withPolygons=1` is set (always for `local:` courses).
- Drops polygons with fewer than 3 points (degenerate).

### `polygonCentroid(points)` → `Loc | null`
- Naive arithmetic mean of all points. Not a true geometric centroid
  (which uses the signed-area formula), but golf green polygons are
  small and convex enough that the error is sub-yard. Documented in
  the inline comment.

### `pointToSegmentYards(p, a, b)` → `number`
- Distance from point `p` to segment `a→b` in yards.
- Projects to local equirectangular meters (using `cos(a.lat)`)
- then clamps `t` ∈ [0,1] for the projection onto the segment.
- Used by `assignPolygonsToHoles` to find each polygon's nearest hole
  by proximity to its tee→green line.

### `lateralYards(p, tee, green)` → `number`
- Signed lateral offset of `p` from the tee→green bearing (positive =
  right, negative = left).
- 2D cross product divided by `|G−T|`. Standard trick.
- Used to tag bunkers as `left` / `right` / `fairway`.

### `assignPolygonsToHoles(holes, polygons)` → `Map<holeNumber, AssignedPolygon[]>`
- For each polygon, finds the hole whose tee→green segment is
  closest (min `pointToSegmentYards`).
- Drops polygons farther than `MAX_HOLE_DIST_YARDS` (60y) from any
  hole — those belong to cart paths, ranges, etc.
- Tags each assigned polygon's `side`:
  - `greenside` if within 30y of the hole's green centroid
  - `left` / `right` if lateral offset is >12y from the tee→green axis
  - `fairway` if lateral offset is ≤12y (on the centerline)
- This is the source of "Left Bunker" / "Greenside Bunker" /
  "Fairway Bunker" labels in the yardage book.

### `minCostPairs(tees, greens)` → `[teeIdx, greenIdx][]`
- Builds all tee×green edge weights, filters edges outside
  `[MIN_REALISTIC_YARDS, MAX_REALISTIC_YARDS]` ([80, 650]y), sorts
  by distance ascending, assigns greedily.
- v3 of three iterations:
  - v1 (greedy NN by hole order): mis-paired SJM H1's tee to a closer
    wrong green at 73y
  - v2 (sorted-edge greedy, 65y floor): still emitted 70y false holes
    and an 834y cross-course phantom
  - v3 (current): bounded edges. Empirically clean for Mariners
    (9 holes 66–177y) and SJM (no obvious outliers; hole numbering
    still bearing-sorted, not real layout).

### `nearestUnassigned(target, candidates, used)` → `number`
- Greedy nearest-unused. Used as a fallback for tee assignment in
  the upstream-fallback path when minCostPairs isn't called.

### Handler `default async function(req, res)`
- Query params: `courseId` (required), `lat`/`lng` (centroid hint),
  `holeCount` (1–18 cap), `osmOnly` (1=skip upstream), `withPolygons`
  (1=fetch polygon rings).
- Two code paths:
  - **osmOnly**: Pair tees+greens from OSM, bearing-sort the pairs
    around the centroid, cap to `holeCount`. Then if `withPolygons`,
    snap polygon green/tee back to their paired hole via 15y match,
    and call `assignPolygonsToHoles` for fairway/bunker/water.
  - **default**: Call golfcourseapi. Augment null greens/tees from
    OSM via greedy NN anchored on the hole's tee. Then same polygon
    attach if `withPolygons`.

### Concerns
- **Hole numbering for OSM-only courses doesn't match real layout.**
  Bearing-sort around centroid is a heuristic; SJM's actual H1–H18
  walk order is different from what bearing-sort produces. End-state
  effect: a Tim-driven round at SJM will see real par + yardage from
  the static scorecard data we baked in, but the green LAT/LNG used
  for live SmartFinder yardages may be the wrong hole's green. The
  drag-to-anchor UX handles per-hole correction; this is a "test on
  the course and adjust" item.
- **No `expectedPars` input.** The pairing algorithm doesn't know par
  3/4/5 distribution. Knowing pars would let us reject pairings that
  conflict (e.g. a 500y "par 3" pairing). Future enhancement: pass
  `expectedPars=[5,4,4,3,...]` and prefer pairings within
  par-typical yardage ranges.

## 2. Centroid corrections (`data/localCourseImages.ts`, `app/(tabs)/play.tsx`)

Four of seven `LOCAL_COURSE_CENTROIDS` were 2.4–5km off, which
silently broke the OSM Overpass fallback (queried the wrong
location, got zero greens).

| Course | Old (wrong) | New (OSM truth) | Off by |
|---|---|---|---|
| San Jose Muni | 37.3670, -121.9310 | 37.3771789, -121.8881051 | **4.5 km** (wrong neighborhood) |
| Crystal Springs | 37.5120, -122.3580 | 37.5560947, -122.3829982 | **5.0 km** |
| Mariners Point | 37.5480, -122.2750 | 37.5731586, -122.2823681 | **2.8 km** |
| Sunnyvale | 37.3777, -122.0357 | 37.3983857, -122.0417245 | **2.4 km** |

Palms / Lakes / Rancho centroids were already accurate.

Centroids re-derived from OSM `leisure=golf_course` feature centers
via the `nominatim` / `Overpass` lookup process. Each was verified by
running `way[golf=green](around:1500,LAT,LNG)` and confirming a
non-zero count.

`app/(tabs)/play.tsx` LOCAL_COURSES entries updated to match (these
drive the closest-course distance sort on the course picker).

**Concerns:** none — these are objective coordinate corrections.

## 3. Slug mismatch fix (`app/(tabs)/play.tsx`, `services/courseGeometryService.ts`)

`play.tsx` was using `id: 'local:rancho'` for Rancho California,
while `LocalCourseSlug` type and `LOCAL_COURSE_CENTROIDS` map keys
expected `'rancho-california'`. The substring-match `getLocalHoleImage`
kept images working, but `LOCAL_COURSE_CENTROIDS[slug]` returned
undefined → OSM fallback failed silently.

Fixed `id: 'local:rancho'` → `'local:rancho-california'`. Also added
`LOCAL_COURSE_API_HINTS` entries for Crystal Springs, Mariners,
Rancho so `resolveLocalCourseId` can find them on golfcourseapi.

**Concerns:** none.

## 4. Drag-to-anchor for hole view (`components/smartvision/VectorHoleView.tsx`, `app/hole-view.tsx`)

Added draggable `TEE` / `GRN` markers on the vector hole view. Long-
press, drag finger, release. On release, the new lat/lng inverts
through the projection and writes to `courseGeometryOverrideStore`
(same store the existing "📍 Anchor Tee" button used; just sourced
from a drag instead of current GPS).

### `VectorHoleView` — added props
- `onTeeAnchor?: (latlng: LatLng) => void`
- `onGreenAnchor?: (latlng: LatLng) => void`

### `VectorHoleView` — added state
- `teeDrag` / `greenDrag`: pixel offset during drag, rendered as a
  ghost marker following the finger
- `teeDragRef` / `greenDragRef`: same value, in refs, so PanResponder
  callbacks have a fresh read without re-binding on every render

### `VectorHoleView` — added `unproject(x, y)`
- Inverse of the existing projection (lat/lng → pixel). Reverses
  rotation, scaling, equirectangular conversion. Drag UX needs this
  to convert the dropped pixel back to a lat/lng to persist.

### `VectorHoleView` — added `teePR` / `greenPR` PanResponders
- Grant: zero the drag delta.
- Move: update both the state and the ref.
- Release: if movement < 4px, ignore (fat-finger tap). Else call
  `onTeeAnchor` / `onGreenAnchor` with the unprojected lat/lng.
- Terminate: reset state without calling the callback.

### `app/hole-view.tsx` wiring
- When round is active AND `courseId` is known, passes the anchor
  callbacks. Otherwise undefined → markers stay non-draggable.

### Also did the same in `components/smartvision/HoleView.tsx`
- This component is currently *not used* anywhere in the app — the
  imagery-based parallel to VectorHoleView that was orphaned. I
  added the drag plumbing there too in case it gets adopted; harmless
  while unused.

### Concerns
- **VectorHoleView drag has no visual hint** that it's draggable.
  Until the user touches a marker, they don't know it's interactive.
  Consider adding a 1-time toast on first hole-view view: "Tip:
  press and drag the T or G marker to fix the hole layout."
- **HoleView (the orphaned one) shouldn't be there forever.** Either
  adopt it (refactor smartvision.tsx to use it) or delete it. Cleanest
  is to delete since `app/smartvision.tsx` and `VectorHoleView` cover
  the territory.

## 5. Hero shot removal

Per your verbatim quote: "I think the hero shot thing is kinda
stupid. I always did. It was a chat GPT thing that I don't think
anybody's gonna fucking use." Stripped the entire `highlight`
CaptureKind + the auto-opening replay/share pane.

### `services/mediaCapture.ts`
- `CaptureKind` type changed from `'shot' | 'swing' | 'highlight'` to
  `'shot' | 'swing'`.
- `DURATION_BY_KIND` dropped the highlight entry (was 5s).
- `CapturedMedia.isHighlight` field removed.
- `commitCapture` round-shot back-ref simplified (no `is_highlight`
  on the shot record).
- `buildCaddieAck` no longer carries highlight lines per persona.
- `canCapture` round-context gate now only for 'shot' (was
  'shot|highlight').

### `components/CaptureOverlay.tsx`
- Subscribe call dropped 'highlight' (was `['shot', 'highlight']`).
- The entire post-capture `review` state + the `<Video>` + Share /
  Done UI removed.
- HUD label simplified ("Shot · …").
- All unused `<Video>`, `expo-sharing`, `Ionicons`, `VideoWatermark`
  imports removed.

### `services/intents/mediaHandlers.ts`
- `normalizeKind` collapses legacy `'highlight'` input to `'shot'` so
  a stale voice intent from before the deploy doesn't crash.
- Schema doc + examples updated.

### `api/voice-intent.ts` + `app/api/voice-intent+api.ts`
- Removed `"watch this" / "hero shot" / "check this out" / "look at
  this"` triggers from media_capture examples.
- Removed `capture_type: "highlight"` from the type union.
- Updated putt_watch guidance to handle ambiguous "watch this" — now
  prefers `putt_watch` when context suggests putting (recent putter
  use, on/near green), else falls through to media_capture(shot).

### `services/intents/logIssueHandler.ts`
- Replaced the "hero shot share button does nothing" example with
  "cockpit log shot button does nothing" (still a real bug example
  from your prior session).

### `scripts/simulations/run-sim.ts`
- The sim check `CaptureOverlay subscribes for shot+highlight` was
  hardcoded to fail after this change. Updated the check string +
  expected substring.

### `store/roundStore.ts` — NOT touched
- `ShotResult.is_highlight` field still exists on the shot record
  type. I left it in place because removing a persisted-store field
  can break Zustand persist hydration for users who have rounds with
  the field set. The field is just unused now; nobody writes it.

### Concerns
- **`is_highlight` on `ShotResult` is dead code.** A future
  cleanup (Phase XX) can remove it once we're sure no historical
  round records depend on it. Left in place to avoid an immediate
  persist-migration risk.
- **Voice-trigger handling for "watch this".** It now defaults to
  putt_watch when context leans putting, else falls through to
  media_capture(shot). If you say "watch this" planning to NOT have
  it record video, it'll still trigger something. Worth field-testing.

## 6. Debug route owner+`__DEV__` gating (`hooks/useDebugRouteGate.ts`, 9 screens)

App Store review will reject deep-linkable internal debug screens;
9 of them were public.

### `hooks/useDebugRouteGate.ts` (NEW)
```ts
export function useDebugRouteGate(): boolean {
  const email = usePlayerProfileStore(s => s.email);
  const allowed = __DEV__ || isOwnerEmail(email);
  useEffect(() => {
    if (!allowed) router.replace('/(tabs)/caddie');
  }, [allowed]);
  return allowed;
}
```
- Returns `true` when the user is allowed (owner OR dev build),
  `false` while redirecting.
- Effect-based redirect means the render returns `null` (caller does
  `if (!allowed) return null`) without unmounting before navigation.

### Gated screens
- `app/api-debug.tsx`
- `app/battery-debug.tsx`
- `app/cage-debug.tsx`
- `app/ghost-debug.tsx`
- `app/patterns-debug.tsx`
- `app/plan-debug.tsx`
- `app/smartfinder-debug.tsx`
- `app/subscription-debug.tsx`
- `app/voice-debug.tsx`

Pattern at the top of each component:
```ts
const _gateAllowed = useDebugRouteGate();
if (!_gateAllowed) return null;
```

Other debug-adjacent routes that were NOT gated (because they have
explicit owner-only entry points and are legitimate user tools):
- `app/acoustic-test.tsx` (Owner Tools row in Settings)
- `app/gps-test.tsx` (Owner Tools row in Settings)
- `app/mark-green.tsx` (currently visible to all; see follow-up)

### Concerns
- **`mark-green.tsx` is technically reachable** by anyone deep-
  linking to `/mark-green`. Settings UI gates it under Owner Tools
  visibility, but if you decide to keep this tool live you should
  add `useDebugRouteGate()` to its top. If you're killing the tool
  per the OSM-auto-detect work, just delete the file (auto-mode
  blocked the delete earlier; needs your explicit OK).

## 7. Onboarding cleanup — INCOMPLETE

I identified `app/onboarding/` (8 files) as dead code: the
`has_completed_onboarding` flag defaults to `true` in
`playerProfileStore`, so `app/index.tsx`'s `if (!isDone) return
<Redirect href="/onboarding/welcome" />` line never fires for fresh
installs. The new `app/welcome.tsx` (Phase 410) is the actual
welcome screen.

**Auto-mode blocked the rm.** I asked for permission inline and
proceeded with other items.

Files awaiting your explicit OK to remove:
- `app/onboarding/_layout.tsx`
- `app/onboarding/welcome.tsx`
- `app/onboarding/name.tsx`
- `app/onboarding/mode.tsx`
- `app/onboarding/home-course.tsx`
- `app/onboarding/about-game.tsx`
- `app/onboarding/meet-kevin.tsx`
- `app/onboarding/ready.tsx`

When you OK, also remove the `<Stack.Screen name="onboarding" />`
entry in `app/_layout.tsx` and the unreachable redirect in
`app/index.tsx`.

## 8. SJM scorecard data (`data/courses.ts`)

You sent the SJM scorecard photo. I baked Black-tee data into
`SAN_JOSE_MUNI_HOLES` (men's middle, 6253y, par 72). Each hole now
has authoritative par + middle distance + estimated F/B (±3% of
middle as a placeholder until OSM Overpass fills in real F/M/B
points). All 18 holes flipped from `estimated: true` to `false`.

Per-hole pars now match scorecard:
- Par 3s: H4, H7, H12, H17 (4 par 3s)
- Par 5s: H1, H9, H11, H18 (4 par 5s)
- Par 4s: 10 par 4s
- Total par 72

Distances correspond to the Black tees.

### Concerns
- **F/B distances are ±3% of middle (estimated).** The real F/B comes
  from the OSM green polygon's nearest/farthest point computed by
  YardageBookPanel. Once OSM Overpass returns the green polygon
  reliably, the static F/B is unused. Until then, this approximation
  is used.

## 9. Crystal Springs + Mariners JPG cropping

Sized 1768×2208 Golfshot screenshots (full Android UI including
status bar, ad banner, yardage column, Get Pro banner, blue tab
strip, Android dock) → 1200×1540 (just the aerial strip).

Crop via PIL (`Image.crop((400, 280, 1600, 1820))`):
- 18 Crystal Springs holes (14.3 MB → 2.8 MB)
- 9 Mariners Point holes (7.7 MB → 1.5 MB)

Net asset bundle reduction: ~17 MB.

### Concerns
- **Minor chrome remnants in the corners** of the cropped images:
  a tiny green sliver bottom-left (Get Pro button corner) and a
  black quarter-circle bottom-right (pencil button). Both are small
  and don't interfere with the hole imagery. Acceptable for now;
  could refine with a tighter crop or PIL alpha-mask if it bugs you.

## 10. Palms-leak routing fixes

Three independent code paths were defaulting `Palms` imagery when
`activeCourseName` was briefly null during a state transition.
Crystal Springs ended up showing Palms on tap. Fixed in three places.

### `app/smartvision.tsx`
- Removed the `'local:palms'` hard fallback at the end of the
  `effectiveCourseId` cascade.
- Reordered `courseName` resolution: courseId-derived label FIRST,
  homeCourseName LAST. Previously `activeCourseName ?? homeCourseName
  ?? derivedCourseLabel`; now `activeCourseName ?? derivedCourseLabel
  ?? homeCourseName`. The home-course leak case (Tim's "Menifee
  Lakes — Palms" homeCourse triggering substring match on Palms in
  a Crystal Springs round) is now impossible.
- `curatedImage` lookup is courseId-first via new
  `getLocalHoleImageById(courseId, hole)`, with name-based fallback
  only when no `local:` id is available.

### `components/caddie/L1HolePreview.tsx`
- Removed the tail `return 'palms'` fallback from
  `previewCourseLabel` resolution. Empty state now renders "Pick a
  course on the Play tab to plan." copy instead of silently showing
  Palms hole 1.
- `getDefaultPreviewImage()` now returns `null` (was Palms hole 1).
- Active-round path uses `getLocalHoleImageById(activeCourseId, ...)`
  first.

### `app/hole-view.tsx`
- `bundledImage = courseName.toLowerCase().includes('palms') ? ... :
  null` generalized to all local courses via
  `getLocalHoleImageById(courseId, hole) ?? getLocalHoleImage(...)`.

### `data/localCourseImages.ts`
- New `getLocalHoleImageById(courseId, hole)` — canonical id-keyed
  lookup. Takes `local:<slug>` directly, no substring matching.
- Reordered `getLocalHoleImage` substring checks to match Lakes
  BEFORE Palms, so "Menifee Lakes — Palms" matches lakes (when it
  shouldn't be matched at all in this case anyway, but defensive).
- `getDefaultPreviewImage` now returns `null`.

### Concerns
- **Substring matching is still a footgun.** Anywhere we still rely
  on `courseName.includes('palms')` is vulnerable to the same kind
  of leak. The id-first lookup is the correct path; eventually every
  caller should switch to `getLocalHoleImageById`. Leaving the
  name-based fallback in place for backwards compat (e.g. when the
  active course came from golfcourseapi search and doesn't have a
  `local:` id).

## 11. SmartVision rebuild — Bluegolf-class hole view

Polygon overlay + yardage book panel + running yardages on the
centerline. 4 steps:

### Step 1 — Data layer
- `HoleGeometry` extended with `green_polygon`, `tee_polygon`,
  `fairway_polygons[]`, `bunkers[]`, `water_hazards[]`. All optional.
- `Polygon = ShotLocation[]` (alias).
- `LandmarkFeature = { polygon, centroid, side, name }`.
- Server fetches polygons + assigns to holes (see §1 functions
  above).
- Client passes `withPolygons=1` for all `local:` courses.

### Step 2 — SVG polygon rendering (`app/smartvision.tsx`)
- New SVG layer drawn BEHIND the tee→target→pin line:
  - Fairway: translucent green fill, dark green stroke
  - Water: blue fill, dark teal stroke
  - Bunker: sand fill, brown stroke
  - Tee: yellow tint
  - Green: bright green outline
- Each polygon projected via the existing `projectToPixels` helper
  that anchors T/Y/P markers, so polygons align pixel-for-pixel
  with the satellite tile.
- Layer ordering: fairway (back) → water → bunker → tee → green
  outline (front).

### Step 3 — Yardage Book panel (`components/smartvision/YardageBookPanel.tsx`)
- New component. Lists landmarks with F (front) / B (back) yards
  from origin.
- For each polygon, F = nearest point yards, B = farthest point
  yards.
- Auto-labeled via `side` tag from server: "Left Bunker",
  "Greenside Bunker", "Right Bunker", "Fairway Bunker",
  "Cross Water", etc.
- Sorted by F ascending. Filtered to entries with B ≥ 50y (drops
  landmarks already behind the player).
- Renders on the landscape side panel only (portrait bottom strip
  lacks vertical room).

### Step 4 — Running yardage labels
- Two SVG `<Text>` labels at the midpoints of the
  (tee → target) and (target → pin) lines.
- Tee→target label: yellow text, black 3px stroke halo for
  legibility on varying satellite tiles. Shows `carryYards`.
- Target→pin label: white text, same halo. Shows `yardages.middle`.
- Identical visual to Bluegolf's "286 / 221" pattern from your
  reference image.

### Concerns
- **Only `local:` courses get polygons.** golfcourseapi-found
  courses (e.g. you start a round at a course you searched, not
  one in `LOCAL_COURSES`) don't trigger `withPolygons=1`. Easy fix:
  always pass `withPolygons=1` when the client has a centroid
  (i.e. when LOCAL_COURSE_CENTROIDS or an alternative source has
  a known lat/lng for the searched course). Today: only local
  courses get the polygon treatment.
- **Polygon performance overhead is ~3-8s** of Overpass round-trips
  per course (5 polygon queries in parallel). Cached client-side
  weekly. First open of a course is slow; subsequent rounds are
  fast. Loading state is the existing SmartVision spinner; users
  see nothing different from before.
- **No pinch-zoom on the hole view.** The map is a single static
  Mapbox JPEG tile. Phase 414 spec asks for `@rnmapbox/maps` for
  interactive pan/zoom. Decision deferred (see assessment in chat).

## 12. Chained intents — `sequence` meta-intent

Voice classifier now recognizes multi-command utterances ("tell
Kevin I'm on hole 7 and refresh GPS") and emits a `sequence`
intent.

### `services/intents/sequenceHandler.ts` (NEW)
- Reads `intent.parameters.steps` (array of step intents).
- Lazy-imports `voiceCommandRouter` to break the load-time cycle.
- Dispatches each step in order via `router.dispatch(stepIntent,
  context)`.
- Collects voice responses, side effects.
- Returns combined voice_response.

### Classifier updates
- `api/voice-intent.ts` + `app/api/voice-intent+api.ts` prompts
  describe the `sequence` intent shape and examples.
- Top-level intent_type union now includes `"sequence"`.

### Concerns
- **The classifier may over-eagerly emit `sequence`** for utterances
  that contain "and" or commas but aren't actually multiple commands
  (e.g. "Kevin, what's the wind speed and direction" is one query,
  not two). The prompt says "ONLY when the steps are independent
  actions"; field-test to see if Claude classifier follows that
  guidance reliably. If not, tighten the prompt or add a
  post-classification heuristic.
- **No handler-level confirmation of compound intents.** A user
  saying "log a 5 on this hole and end the round" would fire both
  silently. Consider a verbal echo for sequence intents ("Got it —
  logging 5 and ending the round").

## 13. Phase 413 — Wearable integration

Documented in detail in `docs/phase-413-verification.md` and
`docs/audit-413-wearable-state.md`. Audit-level summary:

### Files

| File | Status | What |
|---|---|---|
| `package.json` | M | added `react-native-health-connect@^3.5.3` |
| `app.json` | M | 5 health permissions + plugin entry |
| `services/healthData.ts` | NEW | sensor-agnostic abstraction |
| `services/walkingDetector.ts` | NEW | walk/cart classifier + ticker |
| `store/roundStore.ts` | M | `RoundRecord.health`, enrich method, JIT permission ask, ticker lifecycle, async enrich on endRound |
| `store/settingsStore.ts` | M | `healthDataEnabled` + `hasAskedHealthPermission` + setters |
| `services/conversationalLoggingOrchestrator.ts` | M | `isEffectiveCartMode()` gate |
| `app/settings.tsx` | M | Health Data section |

### Functions added

#### `services/healthData.ts`
- `initHealth(): Promise<boolean>` — idempotent init; lazy imports
  `react-native-health-connect`; Platform.OS gate for iOS.
- `isHealthAvailable(): Promise<boolean>` — single gate used by
  every reader.
- `requestHealthPermissions(perms)` — launches Health Connect
  permission activity; returns granted/denied breakdown.
- `getGrantedHealthPermissions()` — current grants.
- `readStepsBetween(start, end)` — sums all Steps records.
- `readDistanceBetween(start, end)` — sums all Distance records (m).
- `readHeartRateBetween(start, end)` — flat list of BPM samples.
- `readActiveCaloriesBetween(start, end)` — sums kcal.
- `readHealthSnapshot(start, end)` — one-shot composite read.
- `debugStatus()` — for owner debug screens.

#### `services/walkingDetector.ts`
- `detectActivity(gpsSpeedMps)` — async one-shot classification.
- `getCachedReading()` — sync read of most recent tick result.
- `startActivityTicker(getGpsSpeed)` — begin 30s background tick.
- `stopActivityTicker()` — end tick + clear cache.
- `isEffectiveCartMode(manualCartMode)` — sync answer: manual OR
  (detector says cart with high confidence).
- `cartModeSuggestion(currentCartMode, reading)` — returns suggestion
  string for future "did you mean to toggle cart mode?" prompts.

#### `store/roundStore.ts` additions
- `enrichLastRoundWithHealth(health)` — patches the most recently
  saved RoundRecord with health data.
- `startRound` — fires JIT permission ask + activity ticker.
- `endRound` — stops ticker + fires async health snapshot + enriches.

### Concerns
- **No iOS HealthKit path.** Stubbed via Platform.OS check.
  Acceptable per your "don't send iOS build yet" rule.
- **JIT permission ask happens during round start.** It's a system
  activity that pops over the app. The user may dismiss thinking
  they're starting their round and then permission lands as
  denied. UX could improve by showing a one-time explainer modal
  *before* launching the system permission flow ("SmartPlay would
  like to read steps and heart rate during your round. Tap Allow
  on the next screen.").
- **Health Connect on the Fold may not be set up.** If Samsung
  Health hasn't been linked to Health Connect at the OS level,
  permission grants don't actually flow watch data. Verification
  doc calls this out as a prereq.

## Open items (your call needed)

1. **Onboarding directory rm** — 8 files dead since `has_completed_
   onboarding` defaults true. Auto-mode blocked the delete; needs
   your explicit OK.
2. **`mark-green.tsx` fate** — keep as backup tool with
   `useDebugRouteGate()`, or delete now that OSM auto-detect is live?
3. **`is_highlight` on `ShotResult`** — remove as dead field (and
   accept a one-shot persist-migration), or leave indefinitely?
4. **`components/smartvision/HoleView.tsx`** — adopt (refactor
   smartvision to use it) or delete (orphaned)?
5. **`@rnmapbox/maps` migration** — schedule, defer, or skip?
6. **Pass `withPolygons=1` for non-local: courses too** — yes/no?

## Repo state at audit time

- main: `a7908c0` (Phase 413 commit)
- All commits this session pushed to origin
- TS clean
- No staged or unstaged changes
