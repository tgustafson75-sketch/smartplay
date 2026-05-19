# Overnight Audit — 2026-05-19

Tim asked for a deep code walk through tonight's commits. This is the
written report. Throw it out when you've read it.

## Tonight's commits (newest → oldest)

```
46fd9b1  Persona handoff welcome + L1HolePreview cart direction fix
5c36f94  Strip shows running SCORE + T marker draggable mid-round
30106e7  Harness: bypass holeDetection for synthetic transitions + cart icon
474ce00  Harness: live event log in telemetry panel
8dd078f  Menifee Palms harness: extend mock to full 18 holes
45a8cee  Harness: slow pace + SmartVision player cart marker
edc17e4  Harness root-cause batch: fix-change notify + curated priority + groupings
f6f3b34  Harness: reactive run state + live player dot on companion preview
12faf5b  Contextual recap line, curated imagery priority, harness telemetry panel
3bbb067  Synthetic round: randomized per-hole scoring
ab83de5  Settings card-style headers + Menifee Palms harness
2fd7f4d  SmartFinder voice callout + yardage sanity clamps
a88336f  SmartFinder Standard: F/M/B strip + pinch zoom
beab949  Settings: collapsible sections + slim profile + search
58b7a46  Synthetic round: bypass startRound cascade + surface errors
911dbb2  Synthetic round harness: drive the round not just GPS
```

## What I verified

### Voice path
- `setCaddiePersonality` now speaks a per-persona intro on handoff.
  500ms delay clears prior speech; userInitiated:true bypasses L1.
- SmartFinder open callout has userInitiated:true, sanity-clamps middle
  yardage (skip if <30 or >600), 300ms delay so it doesn't preempt
  in-flight speech.
- Round-end summary (`generateRoundSummary`) always returns a
  contextual sentence — never silent — even when scores snapshot is
  empty.

### Hole view paths
- L1HolePreview: curated bundled image wins over Mapbox aerial when
  one exists. Cart icon now moves vertically tee→pin (was inverted
  in the prior commit). Yards-to-green badge top-left. Sanity-hides
  overlay if yardage >1500 (no more "629,441y" leaks).
- SmartVision full screen: curated image priority (matches L1).
  Player cart marker (orange disc + navigate icon) tracks live GPS
  via subscribeFixChange. T marker now draggable mid-round so you can
  re-anchor it when geometry drifts off the photo.

### Harness
- Synthetic round bypasses `startRound()`'s async cascade
  (Health Connect prompt, real-GPS bootstrap, etc) — does a
  surgical `useRoundStore.setState()` instead.
- 18-hole Menifee mock JSON. All 17 green→next-tee gaps ≥60y.
- Simulator default pace = 4 m/s. Per-hole walk ~57s; 18 holes ~17 min.
- Score-on-green: randomized score per par 3/4/5 distribution.
  Idempotent (won't re-log if hole already scored).
- Hole advance: simulator deterministically calls `setCurrentHole(n+1)`
  at each green so currentHole tracks the round, independent of
  holeDetection's polling timing.
- F/M/B `setSimulatedFix` now fires `notifyFixChange` so the entire
  fix-subscriber chain (markTick, Caddie strip, SmartVision cart)
  recomputes on every tick.
- GPS Test Bench has a SYNTHETIC ROUND HARNESS block at the top with:
  - Two play buttons (Menifee Palms green / Pebble Beach amber); only
    one round runs at a time (other button greys out)
  - Live telemetry: course, round_active, current_hole, sim_emits,
    waypoint, fraction_through, sim_position, pace_mps, off_course,
    scores_logged, per-hole score chips
  - Event log (last 20 events, color-coded by kind): start, waypoint,
    transition, score, off_course, error

### Data strip
- Last cell swaps from STROKE → SCORE once any hole is scored.
  Shows `12 +1` (total + vspar). Falls back to STROKE pre-round.

## Known issue I could NOT pin down

**End-Round → "Maximum update depth exceeded"** has hit you twice.
I audited every setState in my recent changes — none are in render,
none have bad useEffect deps that I can see. The ErrorBoundary IS
catching this (you'd see the orange/red error screen with STACK +
COMPONENT TREE sections), but I haven't seen a screenshot of the
COMPONENT TREE yet. **Next time it crashes, screenshot the
COMPONENT TREE section** — that names the specific component
looping and I can fix it in one commit.

## Latest EAS update

- Group: `87c590ba-f1a5-47a2-b12d-638bebdef5bc`
- Commit: 46fd9b1

Force-quit + relaunch to pick it up.

## To verify on next run

1. **Pinch zoom** on SmartFinder Standard
2. **F/M/B strip** on SmartFinder Standard (above lock area)
3. **Settings collapsed sections** are slim stacked cards
4. **Settings search bar** filters by title + body text
5. **Menifee harness** — current_hole advances 1→18 with cart icon
   sliding UP the photo, scores logged at each green, data strip
   shows running SCORE
6. **Switch caddie** (Settings → Active Caddie or via team handoff) —
   new persona introduces themselves audibly
7. **SmartVision** — orange cart marker over the satellite tile;
   T marker now draggable mid-round
