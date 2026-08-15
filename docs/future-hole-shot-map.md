# Future build — the per-hole shot map (Arccos-style)

**Status: NOT BUILT. Design reference only.** Tim, 2026-08-14: *"I like the lines to each shot, but
don't add it now. Put it as a future build."*

Reference screenshots came from Arccos, of his own round at **Berlin CC, 8/14/26** — so the data in
them is a round SmartPlay also has.

---

## What to copy (the per-hole map)

Full-bleed satellite hole view with the shot sequence drawn on it:

- **A single continuous line through every shot position**, in order, curving naturally between
  points rather than straight segments. This is the thing Tim called out.
- **A node at each shot location**, with a small lie indicator (Arccos shows a striped disc for
  fairway).
- **A pill beside each node: club + distance** — `3w 113y`, `9i 63y`, `Lw 62y`. Club abbreviation in
  a filled circle, distance in bold beside it.
- **The hole itself pinned** with a flag marker, and a pill showing `2p` (putts) and the score.
- **Header:** hole selector with prev/next, score-to-par chip, and `PAR 4 · 312y · HCP 15`.
- **Bottom bar:** `SCORE` with the number, `PUTTS` with −/+ steppers, and `+ SHOT`. Editable in
  place, which is how a player actually fixes a miscount without leaving the hole.
- **Share** action top-right.

## The share card (second screenshot)

A separate, simpler artifact — worth having, lower priority:

- One shot, one curved line, on the satellite image
- A callout banner (`GREAT DRIVE!`)
- One pill: club dot + carry (`222y`)
- Course name + date bottom-left, `HOLE 5` bottom-right
- Swipeable between several "top shots" from the round

---

## What we already have

This is a redesign of an existing surface, not new plumbing:

- `app/recap/hole/[round_id]/[hole].tsx` — the "View hole" screen, already routed
- `components/recap/HoleShotMap.tsx` — already receives `shots={shotsForHole}` and `geometry`
- Shot positions, club, and per-hole grouping already exist on `RoundRecord.shots`
- Green/tee coords + `green_polygon` now come back from the engine (2026-08-13/14 fixes)
- Watch swings are tagged by hole and persisted onto the record (2026-08-14)

## What it needs

- **Real shot positions**, which means `autoShotDetection` ON or shots logged by voice. With it off,
  the map has nothing to draw — that was the actual reason "View hole" looked empty for Tim.
- Distances between consecutive shots (derivable from the coords we store).
- A satellite tile per hole — `mapboxImagery` already produces these.

## The honest limit to respect

Arccos draws these lines from **sensor-confirmed shots**. Ours would be drawn from GPS-detected stops,
which over-count (cart movement, walking to a partner's ball). Tim's own idea is the answer and should
land with this: **a watch swing confirms a stop was a real shot.** GPS says you stopped, the watch says
you swung — the intersection is far stronger than either alone, and it is what makes the line
trustworthy enough to draw. See the 2026-08-13 log entry for that design.

Until that exists, a drawn line will inherit GPS's over-counting, so ship the confirmation pass with
the map, not after it.
