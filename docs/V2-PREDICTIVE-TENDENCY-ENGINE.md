# V2 — The Predictive Tendency Engine

**Status:** post-launch (V2). Deliberately NOT built before the App Store release.
**Owner:** Tim. Authored 2026-08-21. Engineering assessment appended by Claude, same day.

---

## The idea, in one line

Today the caddie answers *"what should you hit?"*. The Predictive Tendency Engine asks a different
question first: **"what is this player about to do, and does it match their own goals and demonstrated
tendencies?"**

That inserts two new stages into the intelligence loop:

```
OBSERVE → UNDERSTAND → PREDICT → COMPARE → INTERVENE → EXECUTE → OBSERVE RESULT → LEARN → UPDATE
                       ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲
                       new       new
```

The caddie becomes a **cognitive counterweight**: it does not share the player's emotional state,
which is precisely its value. It brings memory, probability and pattern recognition to a decision the
human is making with intuition, ego, fatigue and momentum.

**Adversarial reasoning, never adversarial intent.** It may disagree, challenge, and say no. Its
objective function is to help the player get the outcome they want — never to win the argument, prove
the player wrong, or maximise its own authority.

**The north star question:** *what is this player about to do, why, is that consistent with their
goals and demonstrated tendencies, and if not, what is the SMALLEST intervention that meaningfully
improves the outcome?*

Full philosophical text: `~/Desktop/smartplay-ETHOS-AND-STRATEGY.md`.

---

## What already exists (do not rebuild)

The substrate landed 2026-08-20/21 while closing the learning loop:

| stage | component | state |
|---|---|---|
| OBSERVE — emotion | `log_emotional_state` + `detectEmotionalState` | fires; was firing ~never before 08-20 |
| OBSERVE — result | `log_shot` + `extractShotReport` | fires; was intermittent |
| INTENT (pre-shot) | `plan_shot` | fires reliably — the only pre-shot channel today |
| advice + adherence | `recommend_club` → `kevin_adhered` | fires; had NEVER fired before 08-20 |
| LEARN | `services/adviceOutcome.ts` | judges DECISIONS, not results — clean strikes only |
| primitive PREDICT | `consecutiveBadHoles`, `voicedDistress` → spiral block | already intervening today |
| INTERVENTION COST | `mayInterject()` / `noteInterjection()` | one shared clock, all four proactive voices |

**Missing: PREDICT, COMPARE, and the intervention threshold itself.**

---

## Three engineering risks — read before building

### 1. The prediction is data-starved
*"When Tim is frustrated after a double he becomes aggressive"* is a conditional probability over
(emotional state × situation × distance × lie). A golfer plays ~20 rounds a year. Conditioned that
tightly, that is **two or three observations annually** — nowhere near enough to assert a tendency.

**Mitigation — tier tendencies by evidence cost.** Cheap signals (club distance bias, miss side) need
few samples and already speak honestly via `clubTendency`'s evidence bars. Behavioural conditionals
need many, and must stay **silent** until the sample supports them. Inherit the existing discipline:
an empty line beats a confident sentence about three shots.

### 2. Prediction needs PRE-SHOT intent; we mostly observe AFTER
The canonical example ("the player reaches for a 6-iron") assumes we can see the club being pulled.
We cannot, unless: the player narrates it (`plan_shot`), the watch tags the club, or the camera sees
it. **Pre-shot intent capture is a hard prerequisite**, and today `plan_shot` is the only reliable
channel — which depends on the player choosing to narrate.

### 3. The failure mode is asymmetric — the biggest product risk
A wrong yardage is a mistake. A wrong *"I know you're about to get aggressive"* is **being managed by
something that misread you**. One bad prediction costs more trust than ten silences earn.

**Therefore precision must beat coverage.** Tune the intervention threshold to be wrong-rarely, not
helpful-often. Same asymmetry that shaped the advice extractors: a false positive poisons the very
thing it is trying to improve.

---

## Build order when V2 starts

1. **Pre-shot intent capture** — widen beyond `plan_shot` (watch club tag, camera). Nothing predictive
   works without it.
2. **Tendency tiering** — evidence bars per tendency class; behavioural conditionals silent until n.
3. **PREDICT** — expected decision given player + situation.
4. **COMPARE** — divergence between expected and optimal, weighted by consequence.
5. **Intervention threshold** — value = benefit − interruption cost, on the shared clock that already
   exists. Needs a cost signal: whether an intervention was followed, dismissed, or ignored.
6. **Success signature** — reinforce what the player looks like when playing well. The model must not
   become a mistake detector; that is how it turns into a nag and loses the player.
