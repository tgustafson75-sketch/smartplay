# The release lens — "like them, but better, for verifiable reasons"

Tim, 2026-08-26: *"we don't wanna be like 18Birdies, Arccos, The Grint. We want all of their
functionality, but better purpose, better flow… it can't be the same. It needs to stand out.
Like those but better and verifiable reasons."*

So this file holds **claims we can prove**, each with the measurement that proves it. Anything that
cannot be demonstrated on demand does not belong in a store listing, and does not belong here.

---

## The structural difference

They are **recorders**. You hit a shot, they store it, and a dashboard tells you what happened.

This app is a **caddie that remembers you**. The same shot goes into a player model, and the model
changes what it says to you on the NEXT shot. That is the difference between a stats app and a
caddie, and it is the only claim worth leading with — because it is the one they cannot copy
without rebuilding around it.

## Proven, with the measurement

Measured against production, 2026-08-26, via `scripts/probe-signal-influence.ts`. Each case asks the
caddie the SAME question with and without the signal, and only passes if the answer actually changes.

| claim | the caddie's own words | what they do instead |
|---|---|---|
| **It aims you for YOUR miss** | *"Seven iron — it's exactly your number. Aim at the left edge of the green and let your natural shape bring it back to center."* | give the number; aiming is on you |
| **It knows your history at THIS course** | *"47 through nine — your best here is 44, so you're a few back of your best, but solidly in range of it."* | show a stats page you go and read |
| **It clubs you for the conditions, computed** | *"Four iron — it's playing 176 into that wind."* | show wind; you do the maths |
| **It clubs you from YOUR carries** | *"Five iron — it's right at your number."* | average distances in a table |
| **It knows where you are in the hole** | *"Stroke 3, 150 to go — you're still making par work."* | a scorecard you tap |

Full suite: 18 signals, and the tool layer answers 33/33.

## Also true, and worth saying plainly

- **The drills open on YOUR fault**, not a generic list — the issue your swings actually come back
  with, with how often. Silent until it has read enough swings to have earned the claim.
- **Practice rotates the clubs you actually carry.** A hybrid instead of a long iron means it asks
  for the hybrid.
- **The tempo drill trains against your own measured tempo**, and opens on the preset matching your
  own backswing speed.
- **It says when a read is rough.** Lose connection mid-analysis and the card says so, rather than
  presenting a smeared read as a clean one.
- **It reads the putt out loud.** A caddie that hands you a note on the green is not a caddie.

## Where we are at PARITY, and should not pretend otherwise

GPS yardages, scorecard, shot tracking, a bag, round history, stats. These are table stakes: they
must be excellent because their absence is disqualifying, but they are not the reason to switch.
**Yardage on the watch is in this category** — a minimum, not a differentiator.

## The honesty rule that IS a differentiator

This app refuses to fabricate. Vs-par is null when pars are unknown and it says so; an impossible
biomech number is reported as unread rather than coached; grip is not guessed at swing speed; a
drill answers the thing its card promised or admits it cannot. Competitors routinely fill gaps with
plausible numbers. Being the one that says "I could not read that" is a trust position, and trust is
the whole product when the app is telling you which club to hit.

## How to keep this file honest

Every row above is reproducible in one command. If a claim here cannot be demonstrated on request,
it is not a claim — delete it. The failure mode this file exists to prevent is a store listing that
describes an app we do not have.
