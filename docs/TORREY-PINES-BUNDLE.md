# Bundling Torrey Pines — the recipe, proven 2026-08-25

Tim: *"torrey pines, my bucket list course… we will build that course right before submission."*

This file exists so that step is MECHANICAL. Everything below was verified against the live APIs
today, so the night before submission is not when we discover a piece is missing. That is the same
lesson as the course prefetch: do the proving early, do the switching late.

## Why Torrey Pines replaces 27 bundled packs

The 459 bundled hole images (71MB) are screenshots taken from **18Birdies and Golfshot**. The
registry says so in its own comments, including one that calls for an "IP-clean replacement pass
before public release", and two packs (Maplewood, Pembroke Pines) were already deleted for exactly
this reason on 2026-06-04.

**Cropping the chrome does not fix it.** Removing the 18Birdies stats bar hides the evidence, not
the infringement — the underlying map rendering is still their copyrighted work. Only 3 of 27 packs
were even crop-processed; 4 are explicitly noted as raw; 20 have no provenance note at all.

Torrey Pines is built from sources we are licensed for, so it is the demo a reviewer sees AND the
proof that the on-demand model works.

## Verified available today (all licensed sources)

| piece | source | value |
|---|---|---|
| Course record | `api/course-proxy?action=detail&id=e9qqevf6` | "Torrey Pines Municipal Golf Course" · South · par 72 |
| 18 holes | same | `par` / `yardage` / `handicap` per hole, male + female tee sets |
| Centroid | `api/course-locate` (Google Places) | **32.9024628, -117.2462734** |
| Hole imagery | Mapbox satellite (`EXPO_PUBLIC_MAPBOX_TOKEN`) | runtime tiles, no bundled files |
| Green / tee geometry | `api/hole-scan` via `holeGeometryDerivation` | derived ON COURSE from live GPS |

The North course is `wzyyesjy` if we ever want it. South is the US Open course and the recognisable one.

## What we can and cannot pre-bundle — read before promising anything

The course API returns **no coordinates**: `location.latitude` is null, and each hole carries only
par/yardage/handicap. `holeGeometryDerivation` needs a SEED coordinate per hole and works from the
player's live GPS at the course, one hole at a time. So:

- **CAN bundle:** course record, centroid, 18 holes with par/yardage/handicap, Mapbox imagery.
- **CANNOT pre-bundle:** per-hole green/tee coordinates. There is no source for them from a desk,
  and inventing them would be exactly the fabrication this app refuses.

That is fine for what the bundle is FOR. A reviewer opening Torrey Pines from a desk sees the course,
its holes, pars and yardages, over licensed satellite. Live yardages need GPS at the course, which a
reviewer does not have either way. A player actually standing on it gets geometry derived on the spot.

## The steps, right before submission

1. Add `'torrey-pines-south'` to `LocalCourseSlug` and to `LOCAL_COURSE_CENTROIDS_RAW`
   (`data/localCourseImages.ts:743`) → `{ lat: 32.9024628, lng: -117.2462734 }`.
2. Add the course to `LOCAL_COURSES_RAW` (`app/(tabs)/play.tsx:170`) with `id: 'local:torrey-pines-south'`.
3. Register the golfcourseapi id `e9qqevf6` so hole pars/yardages resolve.
4. Add NO image pack. It falls through to Mapbox satellite by design — that is the point.
5. THEN delete `assets/courses/*` (459 files, 71MB) and their entries in `data/localCourseImages.ts`
   + `data/palmsImages.ts`.
6. Re-run the sim. Guards referencing deleted packs will fail loudly — that is intended, not a
   surprise, and is why deletion comes last.

## Marquee set — all verified through our own licensed pipeline, 2026-08-25

Bundling is now CHEAP: imagery is Mapbox at runtime, so a course costs a centroid, a course id and
18 pars — bytes, not megabytes. That is what makes a small marquee set possible at all.

| course | id | centroid | holes | verified |
|---|---|---|---|---|
| Torrey Pines **South** | `e9qqevf6` | 32.9024628, -117.2462734 | par 72 · 18 | ✅ |
| **Pebble Beach** Golf Links | `3j4b4ar8` | 36.5696553, -121.9497555 (117m) | par 72 · 18 | ✅ |
| **Streamsong Black** | `pfpwjgan` | 27.6699522, -81.9277421 (7m) | par 73 · 18 | ✅ |
| Streamsong Red (optional) | `4ad33747` | 27.6777052, -81.9325060 | par 72 · 18 | ✅ |

Streamsong is the Florida pick over the obvious ones for a concrete reason, not taste: **TPC
Sawgrass is not returned by Places at all** (see OPEN-ITEMS §13), and my seeds for Innisbrook, PGA
National and Bay Hill found only neighbouring clubs. Streamsong resolved to 7m even from a seed 7km
off, so it is solidly indexed — and it is a genuine golf-media favourite, which is the audience Tim
named.

North Torrey Pines is `wzyyesjy` if ever wanted; South is the US Open course.

## Order is not negotiable

Bundle Torrey Pines and prove it opens BEFORE deleting the 459. Deleting first means every bundled
course loses its imagery with nothing proven to replace it — the same trap as building the prefetch
and dropping the bundle in one pass.
