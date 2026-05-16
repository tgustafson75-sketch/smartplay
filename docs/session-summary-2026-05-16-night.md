# Session Summary — 2026-05-16 night

Phase work completed since the last empirical-test bundle, with EAS
build status + everything visible on the Z Fold once the build lands.

## Commits shipped (most recent first)

| Commit | Title | OTA |
|--------|-------|-----|
| `f085ad6` | Round start/end toasts (visible orchestration confirmation) | `deba7c4c` |
| `b928f28` | GPS dev overlay extended with Phase 405 wave 3 state | `331af4e6` |
| `9ffcba9` | Phase 406 wave 2 — SmartFinder graceful landscape | `14394ed0` |
| `37e6c98` | Phase 405 wave 3 + 406 wave 2 (course banner + at-ball + Recap landscape) | `b75699b8` |
| `d9e9ff3` | Phase 405 wave 3 (round-start orchestration + tee selection + cart/walk + native config) | `49218c9e` |
| `3a5714a` | Phase 500 deep code walk (19 lint warnings → 0) | `8659aff6` |
| `24049dd` | Phase 408 voice tuning (per-persona ElevenLabs settings + filler v5) | n/a |
| `a8a40fc` | Phase 405 wave 2 (GPS stale callout + hole re-entry safeguard) | n/a |
| `7a802ab` | Phase 405 wave 1 (audit + geometry pre-warm + off-course indicator) | `7f3739ab` |
| `687c2ca` | Phase 406 wave 1 (audit + useDeviceLayout + SmartVision split-screen) | `3930ac5d` |
| `2744456` | Phase 405b Reference Authoring tool | `bfdc6f54` |
| `8b4fedf` | Phase 407 course locator GPS sort | `bf5a1ce5` |
| `b39665b` | Course Detail V3-reference redesign | `04923442` |
| `207fc6b` | Course Detail wave 1 fixes (hole_number=0 + hero) | `3de6b560` |

## EAS preview build in flight

**Build ID:** `9ba474d6-2319-47dd-af82-92b8771b63fa` — Android preview
APK. Status as of session end: `IN_PROGRESS` (15–20 min server-side).
Picks up the **Phase 405 wave 3 native config**:

- iOS: `NSLocationAlwaysAndWhenInUseUsageDescription` +
  `UIBackgroundModes: ["audio", "location"]`.
- Android: `ACCESS_BACKGROUND_LOCATION` permission.
- `expo-location` plugin with `isAndroidBackgroundLocationEnabled` +
  `isAndroidForegroundServiceEnabled`.

Once the build completes, Tim installs the new APK on the Z Fold and
the new bundle (all OTAs above) attaches automatically on launch.

## Empirical testing — what to verify

### Play tab

- **Course auto-detect banner** above CLOSEST LOCAL COURSES when
  player is within ~550y of a known course centroid. Reads
  "You're at <Course> — tap to use".
- **TEE BOX picker** below FORMAT — Gold / Blue / White / Red chips
  with colored dots. Tap to select, tap again to clear.
- **Distance pills** on each course row (Phase 407, already shipped).

### Round flow

- **Round-start toast** fires when Start Round is tapped: "Round
  started · <Course>".
- **Round-end toast** fires when End Round is confirmed: "Round
  ended · N holes · score".
- **GPS dev overlay** (toggle in Settings → "GPS Quality Debug
  Overlay"): two rows top-left.
  Row 1: accuracy · mode · fix age · outliers.
  Row 2: `H{hole} · {move-mode} ({speed}m/s) · {off-state} · tee:{color}`.
- **Movement mode pill** on data strip top-right: car-outline (cart)
  or walk-outline (walking). Hidden when stationary/unknown.
- **Off-course pill** on data strip top-right: amber
  "OFF COURSE · ~Xy" when sustained >20s beyond 200y from all holes.
- **GPS stale callout** toast: when accuracy stays weak (>15m) for
  45s sustained, fires "GPS weak (~Xm) — step into open sky or tap
  Mark."

### Voice intents

- "I'm at my ball" / "found my ball" / "got my ball" / "ball
  position" / "at the ball" — captures current GPS as end_location
  of the last shot on the current hole. Caddie responds "Got it —
  ball position locked." Handles edge cases (no round / no GPS / no
  shot / already closed) honestly.
- "Open SmartMotion" — Phase 403 quick swing capture (already live).
- "Switching to 7-iron" / "going to PW" — Phase BL club change
  (already live).

### Caddie voice (Phase 408)

- Restart the app cold ONCE to trigger filler regeneration with the
  new persona-tuned ElevenLabs settings (cache hash bumped v4 → v5).
- Each persona should feel distinct:
  - Kevin: warm, faster, upbeat (stability 0.45, style 0.55).
  - Serena: confident, energetic-professional (0.50, 0.50).
  - Tank: intense, fast, commanding (0.35, 0.70).
  - Harry: measured, quiet authority (0.65, 0.30).

### SmartVision (Phase 406 wave 1)

- Unfold the Z Fold while on SmartVision → split-screen activates.
- Image canvas left 65%, F/M/B yardages stacked vertically right 35%
  with bigger numbers (44px / 58px on emphasis).

### Course Detail (V3 redesign)

- Hero image gone. Page leads with course name + location, then
  CADDIE TIPS expanded, then HOLE PHOTOS grid (yardage overlay
  centered on each tile, circular hole-number badge bottom-left),
  then full HOLE GUIDE table with notes + TOTAL row.

### Recap

- Graceful landscape: FlatList content caps at 720dp max-width
  centered. Portrait unchanged.

### Tools menu

- **Reference Authoring** (Phase 405b) — Tank captures swing
  reference images per fault category; captures appear instantly in
  the side-by-side fault modal on the device. Share action exports
  files for repo inclusion + global distribution via EAS Update.
- **SmartMotion** (Phase 403) — quick course-mode swing capture
  with acoustic auto-stop.

## Still deferred (audit-anchored for follow-up sessions)

### Phase 405 wave 4 (background-GPS code wiring)

The native config is in place (next build's manifest declares the
right permissions + plugin entries). The CODE-side wiring
(`Location.startLocationUpdatesAsync` + `TaskManager.defineTask`)
still needs `expo-task-manager` npm dep + a focused refactor of
`services/gpsManager.ts` startGpsManager. TODO marker in place.
Schedule its own commit + build.

### 406 wave 2 — Caddie home + round flow split-screen

The 2900-line `app/(tabs)/caddie.tsx` is the highest-impact landscape
surface but biggest regression risk. The graceful-landscape pattern
(maxWidth + center) doesn't apply cleanly because Caddie home is
overlay-driven, not column-driven. Needs a dedicated layout pass
identifying which surfaces become split-screen panes (avatar left,
data strip + tools right per the brief).

### Other deferred items

- Manual shot-location correction (recap map UI)
- "I'm at my ball" UI button (currently voice-only; could surface as
  a Mark variant in the bottom strip)
- Per-tee coordinate data for SmartFinder math
- SmartFinder true split-screen (currently graceful-letterbox only)

## Build health

- `tsc --noEmit`: 0 errors, 0 warnings.
- `expo lint`: 0 errors, 0 warnings.

Standing rules met.
