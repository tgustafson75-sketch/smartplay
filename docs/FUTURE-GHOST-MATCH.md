# PARKED — Ghost match against an opponent who isn't you

Tim, 2026-08-26: *"maybe, like, a play against… I wanna play with or against [a named pro] on your
home course, and you're playing basically a ghost match against that person. We probably can't name
the player… we could start generic, like a ghost match against a college player with a certain
handicap, or a pro player with certain credentials."*

And, from the same conversation, the week-one idea: *"we were building something that was like, how
would I play Pebble Beach as part of the player's tendencies. I don't know where that went or if it
still exists."*

**Answer on the second one: it was never built.** No projection engine exists — no `predictRound`,
no expected-score model, nothing in git history or the docs. It was a conversation, not a commit.

**But these are the same feature**, and most of it is already here.

---

## What already exists

**The ghost engine takes any RoundRecord — it does not care whether a human played it.**
`ghostStore.activateGhost(record: RoundRecord)` compares hole-by-hole, keeps a running delta,
survives an app restart mid-round, and feeds the caddie through `ghostContext` in the payload. It
already renders "ahead/behind by N" in the round UI.

This is proven, not theorised: `app/ghost-debug.tsx` has a **`SYNTHETIC_GHOST`** — a hand-written
RoundRecord with nothing but `courseName`, `totalScore` and a `scores` map — and the engine drives
the full comparison off it. `shots: []` and `putts: {}` are fine.

So a synthetic opponent is: **a `scores: Record<hole, number>` map and a label.** That is the whole
contract.

**The arithmetic for a CREDIBLE opponent is already ours too**, in `services/handicapCalculator`:

| Need | Function that already does it |
|---|---|
| strokes an index gets on this course | `computeCourseHandicap(index, slope, rating, par)` |
| how those strokes spread across holes | `strokesReceivedOnHole()` + per-hole stroke index in `data/courses.ts` |
| realistic worst hole, no silly blow-ups | `netDoubleBogeyCap(par, strokes)` |
| what an index typically shoots | `expectedNineDifferential(index)` |

And for the player's OWN projection, `clubTendency.clubTendencies()` already yields per-club shape,
miss direction and carry — which is exactly "as part of the player's tendencies."

## What is missing

1. **A generator.** `(profile, course) → scores`. Profile = index + a couple of character dials
   (aggressive off the tee, deadly wedges, streaky putter). Course = pars + stroke indices, which
   bundled courses carry. Deterministic per (profile, course, date) so a rematch is the same
   opponent, not a re-roll.
2. **A picker.** Choose an opponent before the round; today the only ghost source is your own past
   rounds.
3. **A label.** `ghostStore.getLabel()` is hardcoded to `"${courseName} — ${totalScore}"`. Needs to
   carry an opponent name instead.

## The naming constraint — Tim is right

Real players' names and likenesses need a licence. **Archetypes are safe and read just as well:**

- *Club Champion* — 2 index, steady, no blow-ups
- *College Player* — +1, long, aggressive off the tee, occasional double
- *Tour Pro* — +5, birdies the par 5s, never worse than bogey
- *Your Old Man* — 18 index, straight, terrible from sand

The archetype is also the more interesting product: "beat a scratch player on your own course" is a
goal a 15-handicap can actually chase, and it composes with the handicap engine we already have —
give the player their strokes and it becomes a real match.

## Why it fits the ethos

It is a PREDICT → COMPARE loop, which is the shape [[predictive-tendency-engine-assessment]] argues
for: the app states what should happen before it happens, then measures itself against reality. A
ghost opponent makes that visible and fun rather than clinical, and every hole played is another
labelled data point for the player model.

## Order, when it is unparked

1. The generator, pure and unit-tested — profile + course in, `scores` out. No UI.
2. Feed it to `activateGhost` behind the owner flag and play one round against it.
3. Only then build the picker and the label.

Do NOT start with the picker. The ghost plumbing is the part that already works; the generator is
the part that has to be believable, and it is the only part that can be wrong.
