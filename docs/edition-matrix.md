# Edition Matrix — SmartPlay Caddie Lite vs Full

**Decided 2026-08-19.** Mechanism shipped and tested; **switch is OFF and nothing is gated.**

> ⚠️ **Testers see none of this.** `SUBSCRIPTIONS_ENABLED = false`. No paywall renders, no trial
> clock runs, every feature is unlocked. Per Tim, 2026-08-19: *"don't put the paywall in for
> testers yet or start a 30 day clock."* Pinned by
> [`__tests__/logic/edition-matrix.test.ts`](../__tests__/logic/edition-matrix.test.ts).

---

## What was actually there before

The task was framed as *finalising the differences between the lite and full versions*. There
were none to finalise. `services/featureAccess.ts` read:

```ts
export function canAccess(feature: FeatureKey, status: SubscriptionStatus): boolean {
  if (!SUBSCRIPTIONS_ENABLED) return true;
  return status === 'active' || status === 'trial' || status === 'lifetime';
}
```

The `feature` argument was **accepted and never read**. All three paid states granted an
identical all-or-nothing bundle; there was no free tier; and the function had no way to express
"this feature yes, that one no" even if someone had wanted to. So this is a design decision plus
a new mechanism, not a reconciliation.

---

## The line, and why it sits there

**Lite is free and costs us nothing per user. Full is everything that spends inference on
someone's behalf.**

That is the only split where the wall sits exactly on our marginal cost. Three things follow
from that, which is why it beat the alternatives:

- **It is defensible in review.** A free tier that genuinely works, with paid AI on top, is a
  well-trodden App Store shape.
- **It is explicable in one sentence.** *You pay for the caddie, not for the scorecard.*
- **It cannot bankrupt us.** Every free user is a fixed-cost user. No inference is spent on
  someone who has not paid.

It also fixes an own-goal in the old scaffolding: `round_start` was a paywalled feature, meaning
a new player could not start a single round before paying. Round start is the front door. It is
Lite.

---

## The matrix

| Capability | `FeatureKey` | Lite | Full | Why |
|---|---|---|---|---|
| **Start a round** | `round_start` | ✅ | ✅ | The front door. Never behind the wall. |
| GPS yardages, hole advance | *(ungated)* | ✅ | ✅ | Fixed cost — Google/geometry, not per-user inference |
| Scorecard, scoring, undo | *(ungated)* | ✅ | ✅ | The player's own data. Never held hostage. |
| Round history, stats, handicap | *(ungated)* | ✅ | ✅ | Same |
| Bag, club distances, course book | *(ungated)* | ✅ | ✅ | Same |
| **SmartVision** (hole map, aim lines) | `smartvision` | ❌ | ✅ | Vision inference per use |
| **SmartFinder** (rangefinder) | `smartfinder` | ❌ | ✅ | Vision inference per use |
| **Cage Mode** (swing analysis) | `cage_mode` | ❌ | ✅ | The most expensive path in the app |
| **Advanced voice caddie** | `voice_advanced` | ❌ | ✅ | Brain + STT + TTS on every turn |
| **Send to Tank** (human review) | `send_to_tank` | ❌ | ✅ | Human coaching time — the costliest of all |

**Expired and free both land on Lite, not on nothing.** A lapsed subscriber keeps their
scorecard, their history and their bag. They lose the caddie, not their rounds.

---

## Mechanism

Three pieces in [`services/featureAccess.ts`](../services/featureAccess.ts):

```ts
export type Edition = 'lite' | 'full';

// Exhaustive over FeatureKey — adding a feature without deciding its edition
// is a COMPILE ERROR, not a silent default.
export const FEATURE_EDITION: Record<FeatureKey, Edition> = { … };

export function editionFor(status: SubscriptionStatus): Edition
export function canAccess(feature: FeatureKey, status: SubscriptionStatus): boolean
```

`SubscriptionStatus` (billing) and `Edition` (capability) are deliberately separate types.
Conflating them is exactly what made the old boolean unable to describe a free tier that still
works.

The exhaustive `Record<FeatureKey, Edition>` is the load-bearing detail. A silent default is how
a paid feature quietly ends up free — or, worse, how a free feature ends up behind a wall nobody
meant to build.

**All ~12 `canAccess` call sites are unchanged.** The signature is identical; only the body knows
about editions.

---

## Turning it on — what is still required

Flipping `SUBSCRIPTIONS_ENABLED` is a one-line change and is **not** sufficient on its own.

1. **IAP is mandatory, and does not exist.** App Store guideline 3.1.1: in-app digital
   subscriptions require Apple IAP. **Stripe inside the app is a rejection**, not a risk.
   RevenueCat is the standard wrapper. Stripe remains correct for web/direct sales and a US
   link-out only. **No billing SDK exists in this project today — this is the one hard stop on a
   paid launch.**
2. **Decide the trial.** `trialDaysLeft` currently implies 7 days. Whether there is a trial at
   all, and how long, is unmade. Nothing starts until Tim says so.
3. **Build the Lite experience deliberately.** A gated feature must not read as broken. Tapping
   SmartVision on Lite should say what it is and what it costs — not fail, and not nag. (Standing
   rule: no push nagging, no ads, ever.)
4. **Price it.** Out of scope here.
5. **Re-run §10 of the QA checklist** — which currently asserts the *opposite*, that nothing is
   gated. Those assertions invert on the day the switch flips, and the test file is where that
   inversion has to be made explicit.

---

## Guard

[`__tests__/logic/edition-matrix.test.ts`](../__tests__/logic/edition-matrix.test.ts) — 8
assertions:

- the kill-switch is off
- every feature unlocked in **every** billing state
- **no trial clock runs even when the profile already carries a `trial_started_at`** — the
  dangerous case is not a null timestamp, it is a countdown quietly starting off one the boot
  lifecycle already stamped
- every billing state resolves to `full` while the switch is off
- every feature has an assigned edition
- `round_start` is Lite
- every inference-spending feature is Full
- Lite is a strict subset of Full
