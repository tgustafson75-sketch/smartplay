# SWINGSIM — the motion sim game (spec, 2026-07-07)

Tim: "combine indoor hotel mode and do a first version of a game using the sim and
harness models we have... a real motion sim game. Think DEEP on how futuristic we can
get. Truly the last piece until refinement."

## The deep idea — why this is bigger than a mini-game

Every golf sim on earth simulates A golfer. We simulate **THIS golfer**. The pieces
already exist in the app and just need to be composed:

| Existing piece | Role in the game |
|---|---|
| IndoorRepDetector (Hotel Mode) | THE CONTROLLER — your real swing motion, 100Hz |
| CNS learned bag (clubStats + caddieMemoryStore) | YOUR physics — your real 7i goes YOUR 152, not a default |
| CNS tendencies (dominantMiss, tempo tendencies) | YOUR miss pattern shapes the dispersion — the game plays like your game |
| Bundled course models + reprocessed aerials (Webster Dudley 18, Spessard...) | The board — real holes, real yardages, ball marker advancing on OUR imagery |
| roundStore `simulated: true` rounds | Scorecard/recap for free; already excluded from real stats/handicap |
| Caddie personas + local one-liner templates | The narrator — Tank talks trash, Kevin calls clubs, Serena coaches |
| practicePoints + streak + tee-goals | The meta-game — points, day streak, "break 85 at sim-Webster" |

**The moat loop:** playing the game IS golf practice (every swing is a real tempo/
transition rep) AND teaches the caddie (reps feed `recordSwingMetrics` — the same CNS
picture as the range). A game that makes you better and gets smarter about you. No
sim on the market is personalized by your actual measured game.

**Honesty stance:** it's explicitly a GAME (badged SIM everywhere, saved as
`simulated: true`). Outcome modeling is therefore allowed — the differentiator is that
the model is parameterized by REAL personal data, and we never let sim results leak
into real stats.

## v1 scope (one session of work)

`app/swinglab/simround.tsx` + `services/simGame.ts` (pure outcome engine, sim-testable).

1. **Setup:** pick a bundled course (default Webster Dudley — 18 via the nine twice),
   9 or 18 holes. Caddie greets: "Sim round at Webster. I've got your real bag."
2. **Per shot loop:**
   - Show hole aerial + ball marker + distance remaining. Caddie recommends a club
     from the REAL bag (distanceFor) — player can override via club picker.
   - Player swings the phone (IndoorRepDetector, 'swing' mode; haptic on read).
   - **Outcome engine** (`services/simGame.ts`, pure):
     - quality q ∈ [0,1] from tempo closeness to 3:1 + transition grade
       (smooth=1/quick=0.7/snatched=0.35 weight) — the SKILL is real rhythm.
     - carry = bagCarry(club) × (0.55 + 0.45·q) ± noise·(1−q)
     - direction: offset drawn toward the player's CNS dominantMiss, magnitude
       scaled by (1−q) — a snatched rep with a slice tendency slices.
     - lie model: simple corridor — |offset| < 12y fairway, < 25y rough, else
       trouble; hole-specific hazards later (course book hazards exist!).
   - Caddie one-liner per shot from local persona templates (no server): result +
     tendency call-outs ("that's the snatch — same one the range sees").
3. **On the green:** putt mode (IndoorRepDetector 'putt'); make probability from
   distance + decel read + tempo (decelerating from 8 feet = lip-out city). Max 3 putts.
4. **Scorecard + finish:** running scorecard; save via roundStore as `simulated: true`
   (recap works); award practice points (`indoor:sim` key); every swing rep feeds
   `recordSwingMetrics`. Final caddie summary references REAL tendencies.

## Futuristic ladder (post-v1, in order)
- **v1.1 Caddie brain commentary** — pipe hole context + result through the pipecat
  brain for real conversational color (offline falls back to templates).
- **v1.2 Family game night** — pass-the-phone match vs Tank (familyStore members),
  alternating swings, match-play scoring.
- **v1.3 Ghost mode** — play against YOUR OWN real round at that course (roundHistory
  shot data = the ghost). Beat your Wachusett 92 from the hotel.
- **v1.4 Watch haptics** — the watch buzzes tempo tones (Tank's tempo-tones idea) and
  shows the sim yardage; swing with the phone, glance at the watch.
- **v1.5 Course book hazards** — per-hole hazard corridors from the CNS course book so
  Webster's real trouble is the sim's real trouble.
- **v2 Live sim lobby** — two phones, two households, same course, turn-based over the
  backup/API rail (Supabase table = game state). Golf night with a buddy on the road.

## Guardrails
- SIM badge on every screen; `simulated: true` on the saved round (already excluded
  from handicap/stats by the realRounds filter).
- The engine is a GAME — but never fabricate a claim about the real swing beyond what
  the detector measured (tempo/transition/decel). Quality → outcome mapping is game
  design, documented in-code as such.
- Reuse, don't fork: IndoorRepDetector, clubStats.distanceFor, caddieMemoryStore,
  bundled COURSES + LOCAL_COURSE_IMAGES, roundStore sim path, practicePointsStore.
