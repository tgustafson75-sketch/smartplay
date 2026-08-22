# Cognitive-load audit — ethos §6

*"The intelligence should become more sophisticated while the experience becomes simpler. The golfer
shouldn't experience the complexity. The golfer should experience the answer."*

Measured 2026-08-21. **Nothing here was built** — the freeze holds, and the main finding is a product
decision, not a defect.

---

## THE HEADLINE FINDING: the standing surface shows DATA, not a DECISION

Mid-round, the always-visible strip (`components/CaddieDataStrip.tsx`) shows:

| shown | |
|---|---|
| TARGET | the yardage |
| PLAYS | plays-like |
| STROKE | shot number |
| LIVE / STATIC / OFF COURSE | source honesty badge |

**There is no club.** `grep` for a club recommendation anywhere on the Caddie tab returns nothing.

The ethos §6 example of what a golfer should receive is:

```
154 yards
7 IRON
START LEFT-CENTER
MISS: SHORT
Smooth swing. Commit.
```

We deliver line one. Lines two through five require the player to **initiate a conversation** — tap
the mic, speak, wait for a round trip.

That is the exact problem the ethos opens with: *"The average golfer doesn't need more golf
information… That's a decision problem."* The app currently hands the golfer numbers and asks them to
do the conversion, or to know to ask.

**And the caddie already has everything needed to answer unprompted:** learned bag distances, per-club
tendencies, miss side, its own advice calibration, hazards, wind, lie. The intelligence exists. It is
gated behind the player knowing to request it.

### Inconsistency worth noting
**SmartFinder DOES show a club unprompted** (`recommendClubForDistance`, plus a conservative
alternative). So the app already believes a standing club recommendation is correct — on one surface.
The primary on-course surface is the one that withholds it.

## SECONDARY: what competes for attention

Code-level interactive elements per surface (upper bound — includes conditional branches):

| surface | lines | tappables | text nodes |
|---|---|---|---|
| SmartVision | 2,811 | **14** | 13 |
| SmartFinder | 2,676 | 72 | 84 |
| Play | 2,712 | 89 | 73 |
| Caddie | 4,991 | **101** | 52 |
| SmartMotion | 6,059 | 100 | 96 |

SmartVision is the model: one job, almost no chrome. The Caddie tab carries the most controls of any
surface while being the one a player looks at between shots, when attention is scarcest.

## RECOMMENDATIONS — ranked, none built

1. **Put the decision on the strip.** Club + start line + miss, from data already in hand. This is the
   single largest §6 win available and needs no new intelligence — only surfacing what exists.
2. **Make the ask unnecessary, not easier.** Every improvement to voice latency this week made
   *requesting* the answer faster. §6 asks for the answer to be *there*.
3. **Audit the Caddie tab's 101 controls against "does this help the next shot?"** SmartVision proves
   the team can build a one-job surface.
4. **Resolve the split**: SmartFinder recommends a club, the Caddie tab does not. Either a standing
   club recommendation is right or it isn't; today the app says both.

## WHY THIS IS NOT A BUG LIST
Every item is a deliberate product call, and #1 in particular changes what the app *is* between shots.
That belongs to Tim, not to a refactor — and it is the highest-leverage thing on the ethos list once
building resumes.
