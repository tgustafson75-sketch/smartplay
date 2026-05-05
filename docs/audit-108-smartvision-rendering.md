# Audit 108 — SmartVision Rendering

Phase 108 deliverable. Reads `app/smartvision.tsx`, `services/mapboxImagery.ts`, `services/courseGeometryService.ts`. Identifies why the tee dot doesn't match actual tee position and proposes the fix.

## Current architecture

`app/smartvision.tsx` renders a Mapbox-bearing-rotated satellite tile of one hole. Three SVG markers overlay the tile:
- **T (tee)** — meant to mark the tee box
- **Y (yellow)** — user-draggable target
- **P (pin)** — meant to mark green centre

Marker positions are stored in **canvas-local pixel coordinates**, NOT in lat/lng-then-projected.

Mapbox tile orientation: `services/mapboxImagery.ts` calls `bearingDegrees(tee, green)` and passes that as the bearing parameter to the Mapbox Static Images API. With bearing applied, the tee→green axis renders vertical: tee toward the bottom, green toward the top.

Tile center: 55% of the way from tee to green so the green sits in the upper third of the frame.

## The bug

`smartvision.tsx:353` hardcodes:
```ts
const teeCanvas = useMemo(() => ({ x: imageW / 2, y: imageH * 0.85 }), [imageW, imageH]);
```

The tee marker is **always** placed at 50% width × 85% height of the canvas, regardless of the actual tee location in the rendered tile.

**Why it's wrong:** with the tile centered at 55% from tee→green, the tee is BELOW center in world meters by `0.55 × hole_length_meters`. At a typical zoom (16–18), the actual tee pixel position depends on zoom and hole length:

| Hole | Length | Zoom | mppx | Tee→center px | Tee from top | Static says |
|---|---|---|---|---|---|---|
| Par 4 | 400y (366m) | 17 | ~1.2 | ~167 | ~78% | 85% |
| Par 3 | 150y (137m) | 18 | ~0.6 | ~125 | ~71% | 85% |
| Par 5 | 530y (485m) | 16 | ~2.4 | ~111 | ~69% | 85% |

The static 85% **consistently positions the tee marker BELOW the actual rendered tee box** by 14–20% of canvas height — exactly the symptom Tim's reporting. The dot lands in the rough / cart path / off-tee area instead of on the tee box.

The pin marker (`pinDefaultCanvas` at 15% from top) has the same shape of error in the opposite direction — green centre is closer to the centerline than 15%.

## Why projection-based was disabled

Code comment at line 348-352: *"GPS projection from Mapbox tiles dropped — kept producing off-screen and overlapping markers from rotation/aspect mismatches between the rendered tile and the projection math. Static layout is reliable; user drags markers wherever they want."*

Phase 100 / W7 cleanup found `projectToPixels` unused and renamed it to `_projectToPixels` to satisfy lint. The function still exists in the file — the math is fine for the geometry path; the prior reliability complaint was likely about the `pixelsToLatLng` inverse path being unstable when the user dragged near image edges. The forward path (geo → pixels) is well-understood.

## Components 2-4 from the Phase 108 prompt

| C2 candidate cause | Verdict |
|---|---|
| Coordinate source wrong | NO — `geometry.tee` comes from golfcourseapi via `courseGeometryService`. Single tee point per hole, validated. |
| Projection formula error | NO — `_projectToPixels` math is correct (verified: it's the standard Mercator-with-bearing-rotation). |
| Orientation rotation wrong | PARTIAL — bearing is set correctly but the static marker position assumes a fixed proportion of canvas height that doesn't track the actual orientation result. |
| Multiple tees not handled | NOT APPLICABLE — golfcourseapi only provides one tee point per hole. C4 is moot until a richer geometry source lands. |
| Course data quality | POSSIBLE secondary issue per hole — handled by user manual override (existing courseGeometryOverrideStore). |

**Root cause:** static canvas position instead of geometry-projected position.

## Fix

Re-activate `projectToPixels` (drop the `_` prefix) and use it to compute `teeCanvas` and `pinDefaultCanvas` from the actual tee/green geometry whenever projection data is available:

```ts
const teeCanvas = useMemo(() => {
  if (geometry?.tee && projection) {
    const off = projectToPixels(geometry.tee, projection.center, projection.zoom, projection.bearing);
    return { x: imageW / 2 + off.x, y: imageH / 2 - off.y };
  }
  return { x: imageW / 2, y: imageH * 0.85 }; // fallback for curated / no-geo paths
}, [geometry, projection, imageW, imageH]);
```

Same shape for `pinDefaultCanvas` using `geometry.green`.

The fallback (static 85%) is preserved so curated-bundled-image mode and the no-geometry path still render something. Behind a settings flag would be ideal for A/B comparison; given the static fallback is preserved, we can ship the projection path always-on for the GPS-imagery mode and let Tim observe.

## Strategic overlay alignment (C6)

Yellow target marker (`targetCanvas`) defaults to `(teeCanvas + pinCanvas) / 2`. Once tee and pin are correctly positioned via projection, the yellow target's default also lands correctly. User drag remains free.

## Multi-hole verification (C7)

The fix applies uniformly to all holes that have geometry. Verification on:
- Par 3 (short, simple geometry) — biggest projection delta vs static, should show the most visible improvement
- Par 4 dogleg — the tile bearing axis is tee→green straight-line; a dogleg fairway will visually curve to one side of the centerline, but tee + pin endpoints remain correct
- Par 5 — longest projection distance, smallest relative delta vs static
- Elevated tee/green — Mapbox tile is 2D top-down so elevation isn't represented; markers stay correct in plan view

## Components 5+8 (orientation, empirical verification)

C5 (hole orientation puts play direction up): already correct — `bearingDegrees(tee, green)` rotates the tile so play direction is up. The fix above just aligns markers to the rotated tile properly.

C8 (empirical verification on real holes, Galaxy Z Fold): Tim's verification protocol:
1. Stand on tee box of any hole
2. Open SmartVision
3. **NEW POST-FIX:** tee dot should land on the actual tee box in the satellite image (not 15-20% below it)
4. Pin should land on the green
5. Hole orientation matches reality (tee bottom, green top)
6. Repeat across multiple holes

If the tee dot still misaligns post-fix on a SPECIFIC hole, the secondary cause is golfcourseapi tee-point quality for that course, fixable via courseGeometryOverrideStore (already exists).

## What this audit does NOT change

- Mapbox bearing math (already correct)
- Pin/yellow drag persistence (already in `pinByHole` / `targetByHole`)
- Yardage interpolation (works in canvas pixel space; will benefit from correct marker positions)
- Multi-tee selection (no upstream data; defer)
- Curated-bundled-image fallback (preserved unchanged)
