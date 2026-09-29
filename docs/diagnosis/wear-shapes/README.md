# Wear OS watch-shapes check — 2026-09-30

Play rejected Wear build 1030 ("Wear App Quality Guidelines: Watch shapes"). Fixed in `f6331717`
(BoxInsetLayout + pill buttons), shipped as versionCode **1031** on the **wear:production** track.

Emulators (Wear OS 5, API 34), debug build seeded with hole 7 / 147 and a 300-character caddie message:

| Screen | Size | Top | Bottom (scrolled) |
|---|---|---|---|
| Small round | 384×384 | small-round-top.png | small-round-bottom.png |
| Large round | 454×454 | large-round-top.png | large-round-bottom.png |
| Square | 360×360 | square-top.png | square-bottom.png |

Round screenshots are masked to the physical circle (grey = off glass, red = the edge).

Checked from the uiautomator hierarchy, not by eye: every on-screen TextView/Button's four corners must
be strictly inside the circle (round) or strictly inside the screen edge (square), at the top and the
bottom of the scroll, and the app's content must actually be on screen (a "Starting…" system screen
fails). All three PASS. The same check on the pre-fix layout FAILS in 6 places on the small round —
including ASK CADDIE [32,269][352,365], 236px from centre on a 192px radius.
