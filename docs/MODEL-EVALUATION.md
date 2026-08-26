# Is it the right model for us?

Tim, 2026-08-26: *"we need to always be on the consistent lookout for less expensive agent models…
Is it the right agent for us? And is that a move we should make?"*

A standing checklist, so the answer is a decision rather than a reaction to a pricing email.

**Run the number first:** `npx tsx scripts/cost-per-user.ts` — it prints cost/user-month per
candidate. Add a row to `MODELS` when something ships. Rows with no rates print UNPRICED rather than
guessing; a cost model with an invented input is worse than none, because it looks like evidence.

---

## What we run today

| Route | Model | Why |
|---|---|---|
| `api/kevin` — the caddie brain | `claude-sonnet-4-6`, tier pinned `quality` on EVERY turn | see below |
| `api/_aiProvider` fast tier | `claude-haiku-4-5` | available, not used by the brain |
| `api/club-path` | **`claude-sonnet-5`** | already in production |
| ball-path, ball-departure, narrative-extract, swing-analysis (sub-calls) | `claude-haiku-4-5` | narrow extraction jobs |

**The `quality` pin is deliberate.** From api/kevin, 2026-08-23: the old rule was
`visionBase64 ? 'quality' : 'fast'`, and it *"treated a club recommendation as an easier problem
than looking at a photo. Deciding what to hit, from this lie, at this distance, past a bunker whose
carry we have measured, for a player who hooks it and swings left-handed, IS the hard problem in
this app."* There is no `classifyQuestion()` round trip and that stays removed: **one model every
turn, no routing decision to get wrong.**

Any "just route the cheap questions to Haiku" proposal is a proposal to reverse that. It may still
be right — but it has to argue with that paragraph, not around it.

## The four questions, in order

**1. Does it still do the arithmetic?**
This is the gate, and price does not inform it at all. The club call took three prompt rewrites and
a move into code before it was reliable (`docs/NEXT-CLUB-LOGIC-SWEEP.md`, and the worked examples in
the bag doctrine that exist because a model answered "six iron" to a 209-yard shot with a 170-yard
six iron). A cheaper model that reintroduces that is not cheaper — it is the product failing while
costing less.
→ **Run the influence suite at `--repeat=3` and the tool probe. 18/18 and 33/33 or it is not a
candidate.** Both harnesses print their spend and refuse above $1.50.

**2. What does it do to the 2.5s answer?**
The caddie's value is being fast enough to talk to while you stand over a ball. Median tool-probe
latency is ~2.3s today. A model that is cheaper and slower is usually a bad trade here — silence is
the failure mode players actually notice.
→ Watch for `thinking` defaults. Omitting the parameter on a Claude 5 model runs *adaptive*, which
raises latency. A migration needs `thinking: { type: "disabled" }` and its own verified pass.

**3. What breaks at the API surface?**
`temperature` is REMOVED on Claude 5 — sending it 400s immediately. Check the request shape before
assuming a model ID swap is a one-line change.

**4. Then, and only then, price.**
`scripts/cost-per-user.ts`. At 4 rounds/month the brain is ~24% of a $9.99 subscription on Sonnet
4.6 — comfortable. This is not currently a margin emergency, which means we can afford to choose on
quality. That changes if rounds/user rises sharply; re-run with `--rounds`.

## What actually moves the number

Ranked by what has already been measured, not by what sounds significant:

1. **The prompt cache.** Fixing it took the brain from $19.19 to $2.43/user-month — an 8× cut, far
   larger than any model swap on the table. It is guarded now (`LOCK: the cached system prompt holds
   nothing that changes shot to shot`). **Protect that before shopping for models.**
2. **Prompt size.** The system block is ~19,300 tokens and grew a lot in August. Every token is paid
   on every cache read. An audit for over-prescription is worth more than a tier change.
3. **Turns per round.** 40 is the assumption. A caddie that answers well in one turn instead of two
   halves the bill and is also a better caddie.
4. **The model.** Last, on this evidence.

## Recorded comparisons

**2026-08-24, measured, same assumptions:** Sonnet 4.6 $2.43/mo · Sonnet 5 $1.68 (intro, to 08-31;
recorded as identical to 4.6 afterwards) · Haiku 4.5 $0.92 · gpt-4o-mini $0.35.

Note what that says: **the Sonnet 5 saving was an introductory-pricing artefact with a date on it.**
If the intro has lapsed, the reason to move to Sonnet 5 is capability, not cost — and it is already
proving itself on `api/club-path`, which is the cheapest possible place to have learned that.

## When to re-run this

- A pricing email that names a model we could actually use.
- Any model appearing in a `MODELS` row for the first time.
- Before any subscription-price decision — cost/user is an input to that.
- If `--rounds` needs raising because real usage came in above the assumption.
