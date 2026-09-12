# Owner 2.0 — The Fitting Session

**Raised by Tim, 2026-09-12.** Written up the day the per-club variant tracking shipped, because
that feature turned out to be the bottom half of something much bigger.

> "Add a card for me with Owner 2.0 for a range session with SmartMotion where I enter 1–3 different
> clubs for 10 shots then compare results. In this example, like my multiple drivers, or 3 different
> sets of irons or — sorry I keep going — but we never considered grips and grip sizes. So like
> seeing maybe not universal truth but a what's working for me, and then maybe there is a
> quantifiable why."
>
> "That's real fitting session beta in theory."

That last line is the point of this document. It is not a range drill with a comparison bolted on.
It is a **club fitting**, done with a phone, by the player, on their own range bay.

---

## Why this is bigger than it looks

A real fitting costs money, takes an appointment, happens on someone else's launch monitor, and ends
with a recommendation from a person whose employer sells clubs. The player then takes the club home
and finds out over six months whether it actually helped.

We already hold the pieces that make the honest version of that possible:

| Piece | Where it already is |
|---|---|
| Which physical club is in play | `store/clubVariantStore` + `ShotResult.club_variant` (shipped 09-12) |
| Comparison that refuses to over-claim | `services/clubVariantPerformance` — straighter beats longer, 12-shot floor |
| Swing capture and pose | SmartMotion, on-device MediaPipe |
| Tempo, club path, contact | `services/swing/clubPath`, the fault engine |
| Carry vs total, per club | `store/clubStatsStore` — two ladders + a roll model |
| Ball in play | `playerProfileStore.currentBall`, stamped per round (shipped 09-12) |
| What it did on the course | the whole round history |

**The differentiator is the last row.** A fitting bay can tell you what a club did for ten swings
indoors. We are the only one that can then tell you what it did over the next twenty rounds, because
we are there for both. A fitting that validates itself on the course afterwards is not a feature a
launch-monitor company can copy — they are not in the round.

---

## The session

Owner 2.0 card. Range mode, SmartMotion running.

1. **Declare the contenders — 1 to 3.** Anything that differs: three drivers, three iron sets, the
   same head with two shafts, *the same club with two grips*.
2. **Ten shots each**, prompted in rotation rather than in blocks. Rotation matters: ten in a row
   with one club measures how warm you got, not the club.
3. **Compare**, on what we can actually measure, and say plainly which of those is a real gap and
   which is inside the noise.
4. **Carry it to the course.** The winner becomes the declared variant, and the next twenty rounds
   either confirm it or do not — and we say which.

### Grips — the part nobody models

Tim's aside is the most interesting thing in the ask. Grip and grip size are fitted almost nowhere,
are cheap to change, and plausibly move exactly the things our pose read is good at: hand position at
address, face rotation through impact, and grip pressure as it shows up in tempo.

We cannot claim a mechanism. We *can* honestly say "with the midsize grip your face is four degrees
less closed at impact across twenty shots" — and that is a quantifiable why, which is more than a
player gets from a shop wall.

---

## What this must not become

The failure mode is obvious and it is the one every launch monitor falls into: **fake precision**.
Ten shots is a small sample. A phone is not a TrackMan. The honest product is:

- Report the gaps that are real and say "nothing in it" for the rest — the comparison already works
  this way and must keep doing so.
- Never report a universal truth. Tim said it himself: *"maybe not universal truth but a what's
  working for me."* That framing is the product. It is also the only defensible claim.
- A "why" only where there is a measurement behind it. No mechanism-sounding prose over a number we
  did not take.

## Status

**SPEC ONLY. Not built.** The bottom half — declaring a variant and comparing it from real shots —
shipped 2026-09-12. This card is the session that makes it deliberate rather than incidental.

Depends on nothing new: it is an orchestration of SmartMotion capture, the variant store and the
comparison. The work is the session flow and the rotation prompting, not new measurement.
