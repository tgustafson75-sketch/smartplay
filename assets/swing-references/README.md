# Swing reference illustrations (Phase 404)

Per-fault reference images shown side-by-side with the user's
fault frame in the "See the moment" modal of the swing detail screen.

## What goes here

One PNG per fault category, named exactly `illustration.png`, placed
under the matching subfolder. The system registry at
[`services/swingReferences.ts`](../../services/swingReferences.ts) maps
each canonical-issue ID from the Sonnet vision schema to the asset
path. Until an asset is registered (via `require()` in that file), the
modal gracefully falls back to a single-frame view — no regression.

## Catalog

| Folder | Canonical issue | Swing position to depict |
|--------|----------------|---------------------------|
| `club-face-open/` | `club_face_open` | Impact — clubface square to target |
| `club-face-closed/` | `club_face_closed` | Impact — clubface square to target |
| `swing-path-outside-in/` | `swing_path_outside_in` | Downswing — club approaching from inside |
| `swing-path-inside-out/` | `swing_path_inside_out` | Downswing — club on plane |
| `attack-angle-steep/` | `attack_angle_steep` | Impact — shallow level approach |
| `attack-angle-shallow/` | `attack_angle_shallow` | Impact — slight descending blow |
| `early-extension/` | `early_extension` | Impact — hips kept back, posture intact |
| `over-the-top/` | `over_the_top` | Transition — club dropping into slot |
| `chicken-wing/` | `chicken_wing` | Follow-through — lead arm fully extended |
| `reverse-pivot/` | `reverse_pivot` | Top of backswing — weight on trail side |

## Asset standards

- **Format:** PNG, sRGB. Transparent background preferred (so the
  rendering on dark theme reads cleanly without a contrasting box).
- **Aspect:** roughly 4:3 (landscape) or square. The side-by-side
  modal sizes each image to half the available width.
- **Resolution:** 1024×768 or 1024×1024 long-edge. The modal scales
  down; oversampling avoids stairstep artifacts on the Fold's
  high-DPR display.
- **Style:** illustration > photo. Illustrations communicate the
  position cleanly without lighting / equipment noise that distracts
  from the lesson.
- **Annotation:** subtle is fine (a dotted line marking the shoulder
  plane, a small arrow on the clubhead). Heavy overlays make the
  side-by-side feel busy when paired with the user's photo.

## How to register a new asset

1. Drop the PNG in the right folder (above).
2. Open [`services/swingReferences.ts`](../../services/swingReferences.ts).
3. Find the matching entry in `REGISTRY` (`club_face_open` for the
   "club-face-open" folder, etc.).
4. Replace `image: null` with
   `image: require('../assets/swing-references/<folder>/illustration.png')`.
5. Optionally edit the `callout` string — that's the one-line caddie
   cue rendered under the reference image.

No other code changes. The modal autodetects.

## What this directory does NOT include

- AI-generated reference visuals. Per the Phase 404 brief, the
  accuracy risk is too high — a wrong reference hurts more than no
  reference. Leave the slot null until a vetted asset lands.
- Video clips. Phase 404 is illustration-only. Video references are
  scheduled for v1.2+ once revenue covers production costs.
- User's own swings as references. The "good rep" tag system in the
  cage store is for the user's personal library, not the public
  reference catalog.
