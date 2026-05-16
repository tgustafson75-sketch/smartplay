# Phase 401 Audit: SmartVision Render Pipeline

**Audit Date:** 2026-05-15
**Scope:** aerial imagery fetch, coordinate→pixel projection, marker
placement, viewport fit, drag behavior
**Methodology:** full read of `app/smartvision.tsx`,
`services/mapboxImagery.ts`, `services/courseGeometryService.ts`,
`data/localCourseImages.ts`, and the round store's `CourseHole` shape

---

## 1. Image source

**Two parallel sources, switched by user-selected imagery mode:**

- **GPS satellite tile (Mapbox Static Images API)**
  `services/mapboxImagery.ts:89` — `getHoleImageryUrl()`
  Endpoint: `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/{lng},{lat},{zoom},{bearing}/{width}x{height}`
  Token: `EXPO_PUBLIC_MAPBOX_TOKEN`
  Cached to disk per `{course, hole, zoom, w×h}` (`services/mapboxImagery.ts:126`).
- **Curated bundled JPG** for Palms / Lakes / Rancho California (Tim's
  hand-captured aerial screenshots): `data/localCourseImages.ts`. Loaded
  via `require()` at module load.

`imageryMode` (in `useSettingsStore`) cycles `auto → curated → gps` and
chooses which source feeds the `<Image>` (`app/smartvision.tsx:678–687`).

## 2. Bounding box / center / zoom

`services/mapboxImagery.ts:100–114`:

```ts
center.lat = tee.lat + (green.lat - tee.lat) * 0.55
center.lng = tee.lng + (green.lng - tee.lng) * 0.55
bearing    = bearingDegrees(tee, green)   // tee→green vector, north=0°
zoom       = autoZoom(yardage, par)        // par 3 or <180y → z18; <400y → z17; else z16
```

- **No margin computed.** Auto-zoom buckets are fixed yardage thresholds.
  A 600y par 5 at z16 leaves ~9% margin top and bottom; a 395y par 4 at
  z17 leaves only ~7%, and on tall containers can leave near-zero
  margin below the tee. Long doglegs that aren't bearing-aligned end up
  with the green or tee clipped.
- **Center is offset to 55% tee→green** — pushes the green into the upper
  third (golfer expectation), but makes margin asymmetric (more space
  beyond green, less below tee).
- `bearing` rotates the Mapbox camera so the tee→green axis is vertical
  in the rendered tile.

## 3. Coordinate-to-pixel projection

`app/smartvision.tsx:108–134` — `projectToPixels()`

Web-Mercator math, correct:

```ts
mpp   = 156543.03392 * cos(lat * π/180) / 2^zoom    // meters per pixel
dEast = (point.lng - center.lng) * 111320 * cos(center.lat * π/180)
dNorth = (point.lat - center.lat) * 110540
px = dEast / mpp;  py = dNorth / mpp
// Inverse-rotate by bearing so the bearing axis points +y up:
ix = px*cosθ − py*sinθ
iy = px*sinθ + py*cosθ
```

Inverse `pixelsToLatLng()` at `app/smartvision.tsx:141–159` — also
correct.

**The math is sound.** Audit could not reproduce drift in forward or
inverse projection at typical zoom 16–18.

## 4. Marker defaults

`app/smartvision.tsx:408–423`:

- **T**:
  1. User override (drag) → wins.
  2. Else if `geometry.tee` from `fetchCourseGeometry()` (golfcourseapi)
     → projected pixel position.
  3. Else **static fallback** `(50% W, 85% H)` — container-relative, not
     coord-driven.
- **P** (`pinDefaultCanvas`):
  1. User override (drag) → wins.
  2. Else if `geometry.green` → projected.
  3. Else **static fallback** `(50% W, 15% H)`.
- **Y**: defaults to **canvas midpoint of T and P** (`smartvision.tsx:445–448`).
  Not coordinate-driven. Free-drag for layup planning.

`CourseHole.teeLat/teeLng` from the round store **is never consulted**
even when `geometry.tee` is null. Local courses (Palms / Lakes / Rancho)
have these coords populated, but SmartVision falls straight through to
the (50%, 85%) static fallback.

## 5. Viewport fit

`app/smartvision.tsx:679 / 681 / 687`:

```tsx
<Image source={…} style={{ width: imageW, height: imageH }} resizeMode="cover" />
```

`imageW = W` (window width)
`imageH = H − insets.top − insets.bottom − 56 − 96` (`smartvision.tsx:272`)

**`resizeMode="cover"` scales the image, preserving aspect, until both
container dimensions are covered — then crops whichever dimension
overflows.**

- **Mapbox path**: image is fetched at `{ width: imageW, height: imageH }`
  (`smartvision.tsx:366`). Returned bitmap dimensions match the container
  exactly. With `cover`, no cropping occurs — unless either dimension
  hits the 1280 cap (`mapboxImagery.ts:96–97, 147–148`). On a Galaxy Z
  Fold unfolded inner panel (≈1812 dp wide × ≈2176 dp tall logical), the
  width and/or height *both* hit the cap. The returned bitmap is then a
  fixed 1280×1280 square scaled by `cover` to a portrait container — the
  square's left/right is clipped, but more critically the **scale ratio
  no longer guarantees top+bottom visibility of the entire hole**.
- **Curated bundled JPG path**: Tim's pre-rendered screenshots have
  whatever aspect he captured them at. If a curated image is *more
  portrait* than the container (e.g., 600×1500 vs 412×715), `cover`
  scales to fill the smaller dimension and **crops top+bottom**. This is
  the most likely explanation for the observed "tee cut off, P near
  top" pattern.

## 6. Drag behavior

`app/smartvision.tsx:537–566`:

Drag handlers store **pixel offsets in canvas-local coords**, not lat/lng.
No inverse `pixelsToLatLng()` is applied — drag persists raw pixel
positions per-hole into `targetByHole / pinByHole / teeByHole` zustand
maps. Bounds clamped to `[8, imageW−8] × [8, imageH−8]`.

Drag is **independent of imagery source**: drag a marker on a Mapbox
tile, switch to curated, the pixel offset remains — pointing at a
different real-world location.

## 7. Rotation / north-up

`bearing` is computed as the tee→green compass bearing and passed to
Mapbox as the `bearing` URL parameter. Mapbox rotates the camera so that
bearing direction points UP in the tile. `projectToPixels()` then
inverse-rotates GPS points by the same bearing so its outputs land at the
right pixel in the rotated tile.

For curated images Tim captured by hand, there is no bearing parameter —
he orients them tee-at-bottom by convention. The static (50%, 85%) tee
fallback assumes this convention.

## 8. The `usingGpsTile = false` line

`app/smartvision.tsx:440`:

```ts
const usingGpsTile = false;
```

Hard-coded false. The `yardages` `useMemo` (`smartvision.tsx:467–491`)
branches on this — when false, yardages are computed by **linear
pixel-axis interpolation along the tee→pin segment scaled to
`courseHoles[holeIndex].distance`**, NOT by haversine on the dragged
yellow target's projected lat/lng.

So even when geometry exists and markers are projected from real coords,
the displayed yardages still come from pixel-interpolation. Yardages in
Tim's screenshot (162 / 176 / 190) are **the pixel-interpolation
output**, not haversine.

---

## ROOT CAUSE

**Mixed: A + C + D**, with C dominant.

- **(C) `resizeMode="cover"` crops top+bottom** whenever the source
  image's aspect ratio is more portrait than the container. This is
  guaranteed to bite curated bundled JPGs and bites Mapbox tiles
  whenever the requested dimensions exceed Mapbox's 1280 cap (Galaxy
  Fold unfolded).
- **(A) Bounding box uses fixed-bucket auto-zoom + 55% offset with no
  margin computation.** Long holes hit z16 with the tee within 5–10% of
  the frame edge — any `cover`-induced cropping makes the tee
  disappear.
- **(D) Static fallback marker positions (50%, 85%) / (50%, 15%) are
  container-relative percentages, not coordinate-driven.** They are
  used whenever `geometry.tee` is null — and `CourseHole.teeLat/teeLng`
  from the round store is never consulted as fallback. Result: T marker
  defaults to "85% down the container" with no relationship to the
  actual tee location.
- **(unscoped)** `usingGpsTile = false` makes yardages pixel-interpolated
  regardless of marker source. Not a render bug, but it breaks the
  invariant Tim expects ("markers anchored to real coords ⟹ yardages
  from haversine on those coords").

## FIX PLAN

1. **Compute zoom from hole length + container aspect + margin** in
   `services/mapboxImagery.ts`. Replace fixed-bucket `autoZoom()` with
   `computeFitView({ tee, green, width, height, marginPct })` that
   returns `{ center, zoom, bearing }` guaranteeing the entire hole +
   margin fits the requested container.
2. **Shift center to 50% tee→green** so margin is symmetric above/below.
3. **Single source of truth** for `{ center, zoom, bearing }` —
   `smartvision.tsx` computes it once via `computeFitView()` and passes
   the same values to both `fetchHoleImagery()` and `projectToPixels()`.
4. **`resizeMode="contain"` for curated bundled JPGs** so the full
   pre-rendered image is always visible (letterboxed if aspect
   mismatches). Mapbox tile path keeps `cover` since dimensions match.
5. **`CourseHole.teeLat/teeLng` fallback** when `geometry.tee` is null —
   anchors T marker to real coords even without golfcourseapi tee data.
6. **Drop the `usingGpsTile = false` short-circuit** when projection is
   available: enable haversine yardages on the dragged Y so yardages
   are honest measurements from coords, not pixel ratios.
7. **T marker stays draggable** as user adjustment tool (per spec), but
   the default is now the real tee box position.

Empirical verification on the Z Fold deferred to Tim's testing pass.
