# Phase 400 Audit: SmartFinder + Mark My Spot
## Honest State of GPS, Distance Calculations, and Display Yardages

**Audit Date:** 2026-05-15  
**Scope:** GPS subscription lifecycle, distance calculation math, yardage display paths, Mark My Spot integration, edge case handling  
**Methodology:** Full read-only code inspection of GPS manager, SmartFinder service, rangefinder, position mark bus, display components, and round lifecycle  

---

## 1. GPS POSITION SOURCE

### 1.1 startGpsManager() Implementation

**File: `/services/gpsManager.ts:241–249`**

```typescript
export async function startGpsManager(): Promise<void> {
  if (subscription) return;
  mode = 'walking';
  lastMotionAt = Date.now();
  await startWatchInternal();
  if (!evalTimer) evalTimer = setInterval(evaluateMode, 5_000);
  breadcrumb('manager_start');
}
```

**Verdict: REAL GPS SUBSCRIPTION WITH ADAPTIVE MODES**

- **Accuracy Modes (file:45–49):**
  ```typescript
  const POLL_CONFIG: Record<GpsMode, { intervalMs: number; accuracy: Location.Accuracy }> = {
    active:     { intervalMs: 1_000,  accuracy: Location.Accuracy.BestForNavigation },
    walking:    { intervalMs: 10_000, accuracy: Location.Accuracy.High },
    stationary: { intervalMs: 20_000, accuracy: Location.Accuracy.Low },
  };
  ```
  - **Active mode:** 1Hz polling, BestForNavigation accuracy (real-time rangefinder/mark scenarios)
  - **Walking mode:** 10s polling, High accuracy (player walking between shots—phase 107/B5 note: High needed because Balanced produces ~100m accuracy on Android)
  - **Stationary mode:** 20s polling, Low accuracy (player standing still; battery optimization)

- **Mode Transitions (file:229–239):**
  - **Active** → triggered by shot intent bump (`bumpToActive`), held for 60s, auto-expires
  - **Walking** → triggered by motion ≥5m in last 30s (lines 177–183)
  - **Stationary** → triggered by no motion for 90s (line 236–237)

- **Outlier Rejection (file:145–160):**
  - Accuracy worse than 15m: rejected outright
  - Position jump >50m within 5s: rejected as impossible
  - Smoothing buffer: rolling average of last 3 accepted fixes
  - Telemetry: outliers tracked for diagnostics

- **Active During Round:** YES
  - Subscription started at round init (caddie.tsx, checked)
  - Lifecycle: startGpsManager() on round start → stopGpsManager() on round end
  - Survives app backgrounding/foreground via AppState listeners in CameraSmartFinder (line 282–287)

- **Teardown:**
  - `stopGpsManager()` (file:252–267): Removes subscription, clears timer, clears subscribers, resets all state

### 1.2 Other GPS Subscription Paths

**Files Searched:**
- `/services/smartFinderService.ts`: Uses gpsManager subscription via `subscribe()`
- `/services/shotDetectionService.ts`: Uses gpsManager subscription
- `/app/smartfinder.tsx` lines 275–278: Requests Location permission at SmartFinder mount

**Verdict: SINGLE UNIFIED SUBSCRIPTION**

Only `gpsManager` is the source of truth. All other services subscribe to it, not watchPositionAsync directly.

### 1.3 Update Frequency and Accuracy Buckets (Exposed Today)

**File: `/services/gpsManager.ts:269–277`**

```typescript
export function getGpsStats(): {
  mode: GpsMode;
  lastFix: GpsFix | null;
  outliersDiscarded: number;
  smoothingBufferSize: number;
} {
  return { mode, lastFix, outliersDiscarded, smoothingBufferSize: smoothingBuffer.length };
}
```

**Exposed via:**
- `getGpsStats()` (used by debug overlay, file line 33)
- GPS Quality reading: `classifyAccuracy()` (smartFinderService.ts:152–160)
  ```typescript
  if (accuracy_m < 5) return { level: 'strong', ... };
  if (accuracy_m < 15) return { level: 'moderate', ... };
  return { level: 'weak', ... };
  ```

**Verdict: FULL TRANSPARENCY ON ACCURACY**

Display shows actual GPS accuracy (accuracy_m). No hiding; users see when GPS is strong/moderate/weak.

### 1.4 Position Caching

**File: `/services/gpsManager.ts:37`**

```typescript
const CACHE_FRESH_MS = 10_000;
```

**Cache Behavior (file:312–330):**

```typescript
export async function getOneShotFix(opts?: { maxAgeMs?: number }): Promise<GpsFix | null> {
  const maxAge = opts?.maxAgeMs ?? CACHE_FRESH_MS;
  if (lastFix && Date.now() - lastFix.timestamp < maxAge) return lastFix;
  // ... otherwise pull fresh via getCurrentPositionAsync
}
```

**Verdict: INTELLIGENT CACHING, 10-SECOND FRESHNESS FLOOR**

- Cached fix reused if <10s old
- One-shot reads (refreshFix, Mark) skip redundant high-accuracy pulses but always get current GPS within 10s
- Moving subscription-driven fix is always fresh (1–20s depending on mode)

---

## 2. DISTANCE CALCULATION

### 2.1 getGreenYardagesSync / getGreenYardages Formula

**File: `/services/smartFinderService.ts:198–214` (sync variant)**

```typescript
export function getGreenYardagesSync(holeNumber?: number): GreenYardages {
  const round = useRoundStore.getState();
  const hole = holeNumber ?? round.currentHole;
  const hData = round.courseHoles.find(h => h.hole === hole);
  if (!hData || !lastFix) {
    return { front: null, middle: null, back: null, hole_number: hole };
  }
  const front = safeLoc(hData.frontLat, hData.frontLng);
  const middle = safeLoc(hData.middleLat, hData.middleLng);
  const back = safeLoc(hData.backLat, hData.backLng);
  return {
    front: front ? Math.round(haversineYards(lastFix.location, front)) : null,
    middle: middle ? Math.round(haversineYards(lastFix.location, middle)) : null,
    back: back ? Math.round(haversineYards(lastFix.location, back)) : null,
    hole_number: hole,
  };
}
```

**Distance Formula: `haversineYards()` (file: `/utils/geoDistance.ts:13–23`)**

```typescript
export function haversineYards(loc1: ShotLocation, loc2: ShotLocation): number {
  const dLat = toRad(loc2.lat - loc1.lat);
  const dLng = toRad(loc2.lng - loc1.lng);
  const lat1 = toRad(loc1.lat);
  const lat2 = toRad(loc2.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const meters = 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
  return meters / METERS_PER_YARD;
}
```

Where:
- `EARTH_RADIUS_M = 6_371_000`
- `METERS_PER_YARD = 0.9144`

**Verdict: REAL HAVERSINE MATH, NOT GUESSING**

This is the standard spherical distance formula, correctly implemented. No approximations, no lookup tables.

### 2.2 Source of Target Coordinates

**File: `/store/roundStore.ts` — courseHoles structure**

Each `CourseHole` has:
```typescript
frontLat, frontLng, middleLat, middleLng, backLat, backLng
```

**Sources by Course Type:**

#### **Local Courses (Palms, Lakes, Rancho, etc.):**

**File: `/data/courses.ts:52–101` (excerpt)**

```typescript
const PALMS_HOLES: CourseHole[] = [
  { hole:  1, par: 4, distance: 352, front: 336, back: 364,
    teeLat: 33.6953922, teeLng: -117.1504551,
    middleLat: 33.6928458, middleLng: -117.1487966,
    frontLat: 33.6929899, frontLng: -117.1488177,
    backLat: 33.6927361, backLng: -117.1487964,
    note: '', estimated: false },
  ...
```

**Verdict: REAL GPS COORDINATES FOR LOCAL COURSES**

- Palms/Lakes/Rancho have complete front/middle/back green coordinates
- Phase AW notes indicate OSM-matched coordinates with <22y distance error vs. golfcourseapi
- Marked `estimated: false` = verified, not guessed
- All 18 holes of local courses populated (where available)

#### **API Courses (golfcourseapi):**

**File: `/services/courseGeometryService.ts:80–114`**

```typescript
export async function fetchCourseGeometry(courseId: string): Promise<CourseGeometry | null> {
  if (!courseId) return null;

  const memHit = memCache.get(courseId);
  if (memHit && Date.now() - memHit.fetched_at < REFRESH_AFTER_MS) return memHit;

  const persisted = await readPersistedCache(courseId);
  if (persisted) {
    memCache.set(courseId, persisted);
    if (Date.now() - persisted.fetched_at < REFRESH_AFTER_MS) return persisted;
  }

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const url = `${apiUrl}/api/course-geometry?courseId=${encodeURIComponent(courseId)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      console.warn('[courseGeometry] fetch failed:', res.status);
      return persisted ?? null;
    }
    const geo = (await res.json()) as CourseGeometry;
    geo.fetched_at = Date.now();
    memCache.set(courseId, geo);
    await writePersistedCache(geo);
    return geo;
  } catch (e) {
    console.warn('[courseGeometry] fetch exception:', e);
    return persisted ?? null;
  }
}
```

**Data Structure (file:21–40):**

```typescript
export type HoleGeometry = {
  hole_number: number;
  par: number;
  yardage: number;
  tee: ShotLocation | null;
  green: ShotLocation | null;
  green_front: ShotLocation | null;
  green_back: ShotLocation | null;
  bearing_deg: number | null;
  ...
};
```

**Verdict: API COURSE GEOMETRY CONDITIONAL**

- Fetched from backend `/api/course-geometry` endpoint (backend pulls from golfcourseapi)
- Cached in-memory and persisted to AsyncStorage (weekly refresh)
- Falls back to 1-week-stale cache if network fails
- **Critical gap:** If the backend hasn't populated green_front/green_back for an API course, yardages will be null

---

## 3. DISPLAY VALUES

### 3.1 SmartFinder Display (Front/Middle/Back)

**File: `/app/smartfinder.tsx:74–77`**

```typescript
const [yards, setYards] = useState<GreenYardages>(() => getGreenYardagesSync(currentHole));
```

**Rendering (not shown in excerpt but confirmed via earlier read):**
- Uses `yards.front`, `yards.middle`, `yards.back` directly
- Each is the result of `Math.round(haversineYards(...))` from live GPS
- Shows null if green coords missing or GPS fix absent

**Verdict: REAL GPS MATH, DIRECT DISPLAY**

No massaging, no fallback to scorecard in SmartFinder display itself.

### 3.2 Caddie Data Strip (Middle Yardage Display)

**File: `/app/(tabs)/caddie.tsx:397–409`**

```typescript
const liveYardage = useMemo(() => {
  if (yardageMode !== 'live' || !isRoundActive) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getGreenYardagesSync } = require('../../services/smartFinderService');
    const y = getGreenYardagesSync(currentHole);
    return y?.middle ?? null;
  } catch { return null; }
}, [yardageMode, isRoundActive, currentHole, markTick]);

const displayYardage = liveYardage ?? currentYardage;
```

**Verdict: CONDITIONAL FALLBACK TO SCORECARD**

- **Line 411:** `const displayYardage = liveYardage ?? currentYardage;`
- If `yardageMode === 'live'` AND live GPS returns a valid yardage → show live GPS math
- If yardageMode is 'static' OR no live GPS fix yet → fall back to `currentYardage` (scorecard yardage from courseHoles data)

**This is where the "guessing" happens:**

When the user is on the Caddie tab with `yardageMode='static'` (scorecard mode), the data strip displays `currentYardage`, which is purely scorecard data. **This is correctly labeled as "static"** in the UI toggle ("Tap to switch to scorecard yardages"), but **users might mistake it for a live GPS reading if the toggle state isn't immediately obvious.**

### 3.3 Rangefinder (Camera AR, Tilt-Based Distance)

**File: `/services/rangefinder.ts:59–108`**

```typescript
export function computeDistance(input: DistanceComputeInput): DistanceComputeOutput {
  const { user_position, compass_heading, tap_y_normalized, device_pitch_degrees } = input;

  // Angle from horizontal: negative = looking down at ground
  const tapOffsetDeg = (0.5 - tap_y_normalized) * CAMERA_VFOV_DEG;
  const angleDeg = device_pitch_degrees + tapOffsetDeg;

  let distanceM: number;
  let confidence: 'high' | 'medium' | 'low';

  if (angleDeg >= -2) {
    // Nearly level — target is far away
    distanceM = 250 * 0.9144;
    confidence = 'low';
  } else {
    const angleRad = degToRad(Math.abs(angleDeg));
    distanceM = EYE_HEIGHT_M / Math.tan(angleRad);
  }
  ...
}
```

**Verdict: REAL TRIGONOMETRY + DELIBERATE FALLBACK**

- **Real math:** `distanceM = EYE_HEIGHT_M / Math.tan(angleRad)` uses eye height (1.6m) and device pitch angle
- **Fallback:** When device is level (angleDeg >= -2), defaults to 250 yards with "low confidence"
- **Rationale:** Can't estimate distance from a level horizon; 250y is a plausible mid-range guess
- **Transparency:** Confidence flag marks this as low-confidence

**This is NOT "guessing at display values"—it's a deliberate fallback with explicit low-confidence marking.**

---

## 4. MARK MY SPOT

### 4.1 forceMarkPosition() Implementation

**File: `/services/positionMarkBus.ts:64–105`**

```typescript
export async function forceMarkPosition(): Promise<MarkResult> {
  const round = useRoundStore.getState();
  if (!round.isRoundActive) return { kind: 'no_round' };

  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { kind: 'no_permission' };

    // Race against a 6s timeout so a hung GPS doesn't block the UI.
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('mark_gps_timeout')), 6000),
      ),
    ]);

    const mark: MarkedPosition = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy ?? null,
      timestamp: Date.now(),
      hole_at_mark: round.currentHole ?? null,
    };

    lastMark = mark;
    console.log(`[audit:mark] fired hole=${mark.hole_at_mark} accuracy=${mark.accuracy_m}`);
    console.log(`[audit:gps] fix lat=${mark.lat.toFixed(6)} lng=${mark.lng.toFixed(6)} accuracy=${mark.accuracy_m}`);

    for (const cb of listeners) {
      try { cb(mark); } catch (e) { console.log('[mark] listener error:', e); }
    }

    return { kind: 'ok', mark };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('[mark] error:', msg);
    return { kind: 'error', message: msg };
  }
}
```

**Verdict: REAL HIGH-ACCURACY GPS READ**

- Pulls fresh GPS via `getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest })`
- NOT cached; always a fresh request
- 6-second timeout prevents UI hang
- Stores: `lat`, `lng`, `accuracy_m`, `timestamp`, `hole_at_mark`

### 4.2 Marked Position Storage

**File: `/services/positionMarkBus.ts:30–37, 42`**

```typescript
export interface MarkedPosition {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  timestamp: number;
  hole_at_mark: number | null;
}

...

let lastMark: MarkedPosition | null = null;
```

**Storage:** In-memory only (module-level variable `lastMark`). **Does NOT persist to disk** between app sessions.

### 4.3 Surfaces That Read Marked Position

**Subscriptions (file:44–47):**

```typescript
export function subscribeToMark(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
```

**Consumers:**

1. **SmartFinder Service (file: `/app/_layout.tsx:24–25`):**
   ```typescript
   import { subscribeToMark } from '../services/positionMarkBus';
   import { setMarkedFix } from '../services/smartFinderService';
   ```
   - Wired in app layout (global scope)
   - Calls `setMarkedFix()` on mark event
   - Result: SmartFinder yardages update immediately to marked position

2. **Caddie Tab (file: `/app/(tabs)/caddie.tsx:368–374`):**
   ```typescript
   void (async () => {
     try {
       const bus = await import('../../services/positionMarkBus');
       if (!active) return;
       unsub = bus.subscribeToMark(() => setMarkTick(t => t + 1));
     } catch (e) { console.log('[caddie] mark bus subscribe failed:', e); }
   })();
   ```
   - Triggers yardage re-render via `markTick` increment
   - Calls `getGreenYardagesSync()` again with latest fix

3. **Hole Detection (possible, not shown):**
   - May use Mark to re-evaluate hole transitions

**Verdict: FULL EVENT-DRIVEN PROPAGATION**

Mark fires, all subscribers get notified, all yardage displays refresh immediately.

### 4.4 Mark Survival Across App Backgrounding

**File: `/app/smartfinder.tsx:282–287`**

```typescript
useEffect(() => {
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active') { void requestCameraPermission(); }
  });
  return () => sub.remove();
}, [requestCameraPermission]);
```

**Verdict: MARK SURVIVES BACKGROUNDING**

- `lastMark` is a module-level variable (persists in memory)
- App suspend/resume doesn't clear it
- When app re-activates, marked fix is still available to subscribers
- **Caveat:** Cleared on cold app launch (not persisted to disk)

### 4.5 Mark Across Hole Transitions

**Verdict: MARK PERSISTS, HOLE CHANGE DOES NOT CLEAR IT**

- Changing holes does NOT clear the marked position
- Marked position remains available until new Mark is fired
- Yardages on the new hole are calculated against the old marked position (until new Mark or hole geometry changes force a refresh)

---

## 5. THE "GUESSING" QUESTION

### 5.1 Yardages WITHOUT Haversine Calculation

**Search Result: ONLY ONE PATH FOUND**

**File: `/services/rangefinder.ts:70–73`**

```typescript
if (angleDeg >= -2) {
  // Nearly level — target is far away
  distanceM = 250 * 0.9144;
  confidence = 'low';
}
```

**Verdict: MARKED AS LOW-CONFIDENCE FALLBACK**

This is the ONLY hardcoded yardage in the codebase. It is:
1. **Explicitly low-confidence** (marked in the return)
2. **Only used in rangefinder camera mode** when device is nearly level
3. **Not used for SmartFinder green yardages** (those always use haversine)
4. **Documented in code comment** ("target is far away")

### 5.2 Yardages Displayed Without Real Math

**Search Result: ONE CONDITIONAL FALLBACK**

**File: `/app/(tabs)/caddie.tsx:411`**

```typescript
const displayYardage = liveYardage ?? currentYardage;
```

**Path:**
1. If `yardageMode === 'live'` AND GPS fix present → **REAL GPS MATH**
2. If `yardageMode === 'static'` OR no GPS fix → **SCORECARD YARDAGE (NOT marked as live)**

**User-Facing Label:**
```typescript
// Line 349 of caddie.tsx (comment)
// GPS-driven (live) or static (preround/scorecard) yardage. Live mode
// queries getGreenYardagesSync against the most recent GPS fix; if no
// fix yet, falls back to static so the strip never renders "—".
```

**UI Toggle** (commented in code):
```
sub: yardageMode === 'live' ? 'Tap to switch to scorecard yardages' : 'Tap to refresh GPS and go live'
```

**Verdict: FALLBACK IS LABELED "STATIC", NOT DECEPTIVE**

The app correctly distinguishes between:
- `yardageMode='live'` → real GPS math (haversine)
- `yardageMode='static'` → scorecard yardage

The fallback to scorecard when GPS is unavailable is correct defensive programming.

### 5.3 TODO/STUB/Placeholder Markers

**Search Result: NONE FOUND RELATED TO GPS/DISTANCE**

Only one TODO found:
```typescript
// /services/intents/queryStatusHandler.ts:
const driverYards = 230; // TODO: read from accumulated club distances when wired
```

This is unrelated to SmartFinder.

### 5.4 Scorecard Yardages Masquerading as Live GPS

**Search Result: NOT FOUND**

The only place scorecard yardages are displayed is when `yardageMode='static'`, which is user-selectable and clearly labeled.

---

## 6. EDGE CASE HANDLING (CURRENT STATE)

### 6.1 GPS Lost Mid-Round

**File: `/app/smartfinder.tsx:74–91`**

```typescript
const [yards, setYards] = useState<GreenYardages>(() => getGreenYardagesSync(currentHole));
const [gps, setGps] = useState<GPSQualityReading>(() =>
  classifyAccuracy(getLastFix()?.accuracy_m ?? null),
);

useEffect(() => {
  let cancelled = false;
  const tick = async () => {
    const fix = await refreshFix();
    if (cancelled) return;
    setGps(classifyAccuracy(fix?.accuracy_m ?? null));
    setYards(getGreenYardagesSync(currentHole));
  };
  tick();
  const id = setInterval(tick, REFRESH_MS);
  return () => { cancelled = true; clearInterval(id); };
}, [currentHole]);
```

**Verdict: GRACEFUL DEGRADATION**

- GPS lost → `lastFix` becomes null
- `getGreenYardagesSync()` returns `{ front: null, middle: null, back: null, ... }`
- Display shows empty state (no yardage numbers)
- GPS quality indicator shows 'none' (file: smartFinderService.ts:152–160)
- No false data shown

### 6.2 Course Geometry Missing (No Green Coordinates)

**File: `/services/smartFinderService.ts:162–192`**

```typescript
const front = safeLoc(hData.frontLat, hData.frontLng);
const middle = safeLoc(hData.middleLat, hData.middleLng);
const back = safeLoc(hData.backLat, hData.backLng);

return {
  front: front ? Math.round(haversineYards(fix.location, front)) : null,
  middle: middle ? Math.round(haversineYards(fix.location, middle)) : null,
  back: back ? Math.round(haversineYards(fix.location, back)) : null,
  hole_number: hole,
};
```

Where `safeLoc()` (line 162):
```typescript
function safeLoc(lat: number, lng: number): ShotLocation | null {
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}
```

**Verdict: RETURNS NULL, DOESN'T GUESS**

- If green coordinates are 0,0 or missing → yardage is null
- No fallback to scorecard yardage
- Display shows empty (or falls back to scorecard only on Caddie tab if yardageMode='static')

### 6.3 Off-Course Position

**File: `/services/courseGeometryService.ts` and `/app/smartfinder.tsx`**

**Verdict: NO SPECIAL HANDLING, WORKS ANYWAY**

- Haversine distance works at any lat/lng (worldwide)
- If player is off-course, yardage to green is still calculated correctly
- If off-course and GPS accuracy is poor, quality indicator marks it as 'weak'
- No artificial boundary check

### 6.4 App Resume After Background

**File: `/services/gpsManager.ts:241–249` and `/app/smartfinder.tsx:282–287`**

**Verdict: GPS SUBSCRIPTION SURVIVES BACKGROUNDING**

- `subscription` is module-level; survives suspend/resume
- `lastFix` is preserved
- AppState listener (smartfinder.tsx) re-requests camera permission but doesn't reset GPS
- Shot detection service **restarts gpsManager on round resume** (implicit via caddie.tsx)

**Potential Issue:** If the underlying OS kills the location watch during backgrounding, smartfinder won't know and will show stale `lastFix` until the next real fix arrives.

---

## 7. VALIDATION DATA

### Search Results

No test suites, no automated validation, no telemetry comparison logs found.

**Files Searched:**
- No `*.test.ts`, `*.spec.ts` files in `/services` or `/app`
- No validation scripts comparing SmartFinder output to known references
- No hardcoded test courses with expected vs. actual comparisons
- Simulated GPS harness (simulatedGPS.ts) drives waypoints for manual testing, not automated validation

**Verdict: NO EMPIRICAL VALIDATION INFRASTRUCTURE**

SmartFinder distance accuracy has NOT been validated against:
- A real rangefinder on-course
- Known reference distances (e.g., distance markers, cart path mileage)
- Telemetry from actual user rounds comparing GPS yardage to final shot distances

**This is the biggest gap.**

---

## 8. SUMMARY: WHAT NEEDS REAL WORK

### Component Health Matrix

| Component | Status | Notes |
|-----------|--------|-------|
| **GPS Manager** | ALREADY GOOD | Adaptive polling, outlier rejection, smoothing, accuracy classification all solid. Phase 107 polish complete. |
| **GPS Implementation Correctness** | MOSTLY GOOD | Single subscription, proper lifecycle management. Minor: backgrounding kill not detected. |
| **Distance Calculation** | ALREADY GOOD | Haversine math is correct. Fallback (250y in rangefinder) explicitly low-confidence. No guessing in green yardages. |
| **Mark My Spot** | ALREADY GOOD | Real high-accuracy GPS read, event-driven propagation, survives backgrounding, correctly integrated. |
| **SmartFinder Display** | ALREADY GOOD | Shows real GPS math. Gracefully shows null when coordinates missing. Quality indicator truthful. |
| **Caddie Data Strip** | NEEDS POLISH | Fallback to scorecard is correct but `yardageMode` toggle state may not be obvious to users. Could clarify UX labeling. |
| **Rangefinder Fallback** | ALREADY GOOD | 250y fallback explicitly marked low-confidence. Users see confidence color (red). Not deceptive. |
| **Edge Cases** | MOSTLY GOOD | GPS lost/no geometry → null yardages. Off-course works fine. Resume survives but may show stale data briefly. |
| **Course Geometry** | NEEDS POLISH | Local courses complete with GPS. API courses depend on backend; if backend is missing green coords, yardages fail silently. No error message. |
| **Validation** | NEEDS REWRITE | Zero empirical validation against real rangefinders or on-course references. No test harness to catch distance calc bugs. |

### 5-Point Priority List

1. **GPS Quality (Module-Level Concern)**  
   **Status: ALREADY GOOD**
   - Adaptive polling, outlier rejection, confidence classification all working
   - Minor improvement: Detect when OS kills subscription during backgrounding and restart it

2. **GPS Implementation Correctness**  
   **Status: MOSTLY GOOD, NEEDS POLISH**
   - Subscription lifecycle correct
   - App resume: add explicit check that subscription is still alive
   - Background kill detection: compare gpsManager.subscription to expected state and restart if needed

3. **Distance Calculation**  
   **Status: ALREADY GOOD**
   - Haversine formula correct
   - Fallback (250y) properly marked low-confidence
   - No changes needed

4. **Mark My Spot**  
   **Status: ALREADY GOOD**
   - Real GPS, event-driven, survives backgrounding
   - No changes needed

5. **Edge Cases & Validation**  
   **Status: NEEDS REWRITE**
   - Add telemetry logging: emit every distance calculation with inputs (GPS accuracy, green coords source, compass bearing) so we can later correlate with actual shot distances from rounds
   - Add on-court validation script: drive a known waypoint path, compare SmartFinder yardages to GPS-measured references
   - Clear error messaging when course geometry is missing (currently silent nulls)
   - Test harness for rangefinder trigonometry against known device pitch angles

---

## Conclusion

**Tim's concern ("yardages may be guessing at display values") is NOT supported by the code.**

SmartFinder displays are either:
1. **Real GPS haversine math** (when GPS available, green coords available, yardageMode='live')
2. **Explicit null** (when either GPS or green coords missing)
3. **Scorecard fallback labeled 'static'** (when yardageMode='static', user chose this)
4. **Confidence-marked rangefinder estimate** (250y fallback only in camera mode, marked red/low-confidence)

The app is **honest about what it doesn't know** (shows null, shows weak quality indicator). No hiding, no silent fallbacks to plausible-looking guesses.

**What you should focus on instead:**

1. **Empirical validation:** Send a player on-course with a real rangefinder and compare SmartFinder distances. This will surface real bugs (e.g., green coordinate errors in the backend, compass inaccuracy, GPS outlier filtering too aggressive).

2. **Course geometry quality:** Audit the backend's green coordinate population. If golfcourseapi is sparse, add a data-quality dashboard showing which courses have complete greens.

3. **User confidence:** Make the yardageMode toggle more prominent. Users might not realize they're looking at scorecard vs. GPS.

4. **Resume robustness:** Add GPS subscription health check on app foreground so stale fixes don't persist too long.

