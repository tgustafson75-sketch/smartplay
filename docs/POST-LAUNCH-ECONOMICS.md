# Post-launch economics — the plan of record

**Written 2026-09-05, the night both stores were submitted.** Companion to the full model at
`~/Desktop/SmartPlay-Project-Files/trial-economics.html`. That document explains the reasoning; this
one is the list of things to do, in order, with the numbers that decide when.

Cost drivers were read out of the code, not assumed — model choices from `api/_aiProvider.ts` and
the individual routes, the cached system prompt measured at ~3,800 tokens, on-device pose confirmed
as primary in `services/poseAnalysisApi.ts`, and the 60/min default from `api/_inferLimit.ts`.

---

## The numbers this plan rests on

| | |
|---|---|
| Blended cost of a 14-day trial | **$2.26** per signup ($0.66 tourist → $7.26 obsessive) |
| One 18-hole round | **$0.214** — 71% of it text-to-speech |
| One analysed swing | **$0.034** — 59% of it club-path on Sonnet |
| Monthly subscriber, net of store fee | $8.49 revenue vs ~$4.00 cost |
| Annual subscriber at $79, net | $5.60/month vs ~$4.00 typical, **~$10.08 obsessive** |
| Trial payback at 10% conversion | **5.0 months** |

**The two numbers that decide the company are conversion and retention.** At 10% conversion the
trial repays in five months, so an average subscriber life above five months is profitable and below
it is not. Everything else here is a rounding error next to those two.

---

## 1. Instrument first — three counters make this document factual

The cost *structure* above is solid. Every *volume* — 45 voice turns per round, 8-second captures,
20-swing sessions, the 50/35/15 persona split — is an informed guess about behaviour nobody has
observed. Measure these three and over 90% of variable cost becomes known rather than estimated:

- [ ] **Synthesised characters per round.** The single largest cost line in the product.
- [ ] **Analysed swings per user per week.** The driver that separates a $0.66 trial from a $7.26 one.
- [ ] **Pose-fallback rate** — how often on-device MediaPipe returns nothing and
      `services/poseAnalysisApi.ts` falls through to `/api/pose-analysis`.

The third is an alarm, not a metric. On-device pose is worth ~$0.03 per swing and fails **silently**
to a cloud path an order of magnitude more expensive, with no user-visible symptom beyond slowness.
If MediaPipe breaks on a popular device, the first thing that notices must not be the invoice.

---

## 2. The two levers that matter, in the order they pay

### Lever 1 — stop paying to say the same sentence twice
Yardage callouts and hole transitions are formulaic; "One forty-seven to the middle, front one
thirty-two" differs only in its numbers. Cache synthesised audio by phrase, or route routine
confirmations to device TTS while the cloud voice handles real conversation.

**Saves ~$0.06/round at a 40% character cut** — $0.42 per blended trial, ~$0.60/month per subscriber.

### Lever 2 — measure club-path on Haiku
`api/club-path.ts` runs `claude-sonnet-5` at ~$0.020, which is 59% of the cost of a swing and the
most expensive single call in the app. It is on the strongest model because it is the hardest vision
read — but it has never been measured against Haiku with the shaft-anchored prompt it now has.

**Saves ~$0.015/swing if accuracy holds** — $0.90 per obsessive trial. Do not ship this on cost
alone; the trace is a marquee feature and a worse reading is not worth $0.015.

### Together
A heavy player drops from **~$10.08 to ~$6.03/month**. That is what makes annual viable at any
price — see §4.

---

## 3. Bound the trial tail

`allowInference` caps 60 requests/minute per IP per route. That is a burst guard against a runaway
loop, **not a budget.** A single trial account can legitimately run a thousand swings across
fourteen days and cost ~$34 before converting, or not converting.

- [ ] Add a **cumulative trial allowance** — a soft cap around 250 analysed swings covers the
      obsessive persona ten times over and no real golfer will meet it.

Bounds the worst case at roughly $8 instead of $34+. Insurance, not savings.

---

## 4. The annual price rise — $79 → $99

**$79 is a founding price.** Recorded in `lib/pricing.ts` next to the number itself.

**Trigger, whichever comes first:**
- **250 paying ANNUAL subscribers** (not installs, not total subscribers), or
- **annual exceeding ~40% of new subscriptions** — the tripwire overrides the count.

**Why 250 rather than 50.** Exposure is ~$34/month at 50 annual subs, ~$170 at 250, and only
material near 5,000. Cost is not the binding constraint at this scale — information is. Fifty
subscribers cannot tell you a conversion rate.

**Why the tripwire.** If annual passes 40% of new subscriptions, heavy users are self-selecting into
the worst-priced plan and waiting for a count would only collect more of the wrong ones.

**The price is the smaller half of the fix:**

| | Net/month | Obsessive cost | Result |
|---|---|---|---|
| $79/yr | $5.60 | $10.08 | −$4.48 |
| $99/yr | $7.01 | $10.08 | −$3.07 |
| $79/yr + levers 1&2 | $5.60 | $6.03 | −$0.43 |
| **$99/yr + levers 1&2** | **$7.01** | **$6.03** | **+$0.98** |

**$99 alone does not fix the heavy user. It narrows the loss.** Land the levers first.

**Mechanics when the trigger fires:** changing `lib/pricing.ts` is not the whole change — the store
products must be repriced in App Store Connect and Play Console to match, and raising an *existing*
subscriber's price is a separate action in both stores with its own consent flow. Existing
subscribers keep $79 by default, which is the intent: the founding cohort grandfathers itself.

---

## 5. Where NOT to spend effort

**Hosting.** Vercel, Supabase, Sentry, EAS and the domains together stay under $3,000/month even at
50,000 signups a month, against ~$509,000 of revenue at that scale. Margin holds near 30% at every
tier because almost all cost is variable. This is an inference business, not a hosting business —
every dollar of headroom is in the model calls.

---

## 6. The cash-flow risk, which is not the same as the margin risk

The steady-state table is flattering. During ramp, trial spend **leads revenue by five months**:
growing from 1,000 to 10,000 signups a month means carrying roughly **$100k of trial cost** before
the resulting subscriptions have paid for themselves.

The business works at steady state and is cash-hungry while it grows. Those are two different
problems and they need two different answers — one is a margin question, the other is a financing
or growth-throttling question. Do not let a healthy margin table hide the second one.
