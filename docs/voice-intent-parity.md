# Voice vocabulary parity — the four lists that have to agree

**Written 2026-08-19** during a dedicated reconciliation pass on the "drifting lockstep twin"
voice-intent prompts. Enforced by `__tests__/logic/voice-intent-parity.test.ts`.

---

## The headline: the twin you were told about is gone; a worse one had replaced it

`api/voice-intent.ts` opened with an eight-line banner:

```
// CRITICAL: LOCKSTEP TWIN
// This file has an identical twin:
// - api/voice-intent.ts (Vercel serverless)
// - app/api/voice-intent+api.ts (Expo Router)
```

`app/api/voice-intent+api.ts` was deleted on **2026-08-13** along with the other ten Expo Router
dev twins (commit `59281f61`, "Delete all 11 dev-server twins — the shape, not one instance").
The banner survived it. So did step 1 of the "adding a new voice intent" checklist in
`docs/VOICE-INTENT-REGISTRY.md`, which still read *"Add to the `intent_type` union in
`app/api/voice-intent+api.ts`"* — the first instruction in the canonical process doc, pointing at
a file that had not existed for six days.

Both are corrected. But the interesting finding is what the stale banner was **hiding**: while
everyone was watching a twin that no longer existed, two live ones were drifting unwatched.

---

## The four vocabularies

| # | Vocabulary | Lives in | Answers |
|---|---|---|---|
| 1 | **Intent enum** | `api/voice-intent.ts` → `INTENT_TYPE_ENUM` | What may the cloud classifier emit? |
| 2 | **Intent handlers** | `services/intents/*.ts` → `intent_type` | What can the app act on? |
| 3 | **Brain tools** | `api/_brainTools.ts` → `BRAIN_TOOLS` | What may the conversational brain call? |
| 4 | **Client dispatch** | `services/voice/conversationalToolDispatch.ts` | What can the device actually do? |

1 and 2 are the *command* path (deterministic: you said a thing, the app does it).
3 and 4 are the *conversational* path (the brain decides a tool is warranted).
They are separate systems. Both drifted, in the same shape, for the same reason: **a list was
maintained by hand in two places.**

---

## Drift 1 — two brains, two tool sets, one conversation

This is the one with real field consequences.

Since 2026-07-23 the legacy `/api/kevin` main-turn fallthrough has been **deleted**
(`hooks/useVoiceCaddie.ts` ~L2438). `sendToBrain` — which posts to `/api/kevin` — survives for
exactly one caller: **`processFollowUp`**, the follow-up listen loop
([useVoiceCaddie.ts:1536](../hooks/useVoiceCaddie.ts#L1536)).

So the brains split by *turn number*, not by feature:

```
Turn 1  ── "what club here?" ──────────→  /api/pipecat-turn   (23 tools)
                                             └─ recommend_club fires
                                                → advice recorded, pairable with the outcome

Kevin asks a follow-up question…

Turn 2  ── "what about into the wind?" →  /api/kevin          (21 tools)
                                             └─ recommend_club DOES NOT EXIST
                                                → no tool call, nothing recorded
```

`recommend_club` and `register_bag` were declared only in `api/pipecat-turn.ts`. The comment above
kevin's array read *"same definitions as api/kevin.ts AI_TOOLS"* — an assertion of parity that was
false at the time it was read.

This is the **same defect class found on 2026-08-17** at the caddie-tab dispatcher, where an
unknown-tool `default:` branch logged and dropped `recommend_club` and `register_bag` and thereby
killed advice→outcome pairing. It was fixed at that surface. It survived at this one. Per the
standing rule — *fix the instance, then ask whether it is a class* — the class is now closed
structurally rather than by a third hand-sync.

### It was not only the two missing tools

Diffing the two arrays produced **~255 lines** of divergence. Descriptions had drifted materially,
and always in the same direction: `pipecat-turn` had the newer text. Example:

| | `api/pipecat-turn.ts` (newer) | `api/kevin.ts` (older) |
|---|---|---|
| `open_smartvision` | "Trigger **ONLY** on an explicit ask to OPEN/SHOW it. Talking ABOUT the hole, hazards, or strategy is CONVERSATION — answer it, don't open a screen." | "Trigger this when the player says ANY of: *'show me the hole'*, *'what does the hole look like'*, *'what am I looking at'*…" |

The tightened wording is the **2026-08-06 over-sensitivity fix** ("if I say 'log an issue with
smart vision' it OPENS smart vision"). It landed in one brain. So the follow-up turn was measurably
*more* screen-happy than the first turn of the same conversation — the caddie got twitchier the
longer you talked to it. The regression test that covers over-triggering
(`__tests__/regression/voice-tool-open-not-oversensitive.test.ts`) guards the **precheck regex**,
not the brain tool descriptions, so nothing caught this.

### The fix

`api/_brainTools.ts` now owns `BRAIN_TOOLS`, `UI_TOOLS`, and `SERVER_TOOLS`. Both brains import it
and declare nothing locally. The newer (tightened) descriptions are canonical.

`api/kevin.ts` also gained a **`default:` case** in its tool-dispatch switch. It had none — so any
tool without a hand-written case returned the bare string `'Action triggered.'` while capturing
*nothing*: the model told the player it had done the thing, and no action ever reached the client.
That silent-drop path is precisely how `recommend_club` and `register_bag` were lost. A hand-written
case list is a drift machine; every future tool was one forgotten `case` from the same failure.

---

## Drift 2 — `set_club_distance`, the fourth repeat of one bug

`services/intents/setClubDistanceHandler.ts` has existed since 2026-08-08. It was **not** in
`INTENT_TYPE_ENUM`. Its only route in was a precheck regex
([localIntentPrecheck.ts:449](../services/localIntentPrecheck.ts#L449)) matching the GOES/CARRIES
form:

```
"my 7-iron goes 165"        → matched   → registered ✅
"set my 7 iron to 165"      → no match  → cloud classifier → not in enum → conversational ✗
"my pitching wedge is 130"  → no match  → conversational ✗
"put my driver at 250"      → no match  → conversational ✗
```

On the failing phrasings the caddie agreed warmly and stored nothing. No error, no log line.

**This is the fourth time this exact shape has shipped:**

| Found | Intents | Same cause |
|---|---|---|
| 2026-07-25 | `undo`, `find_my_data`, `open_course` | handler + precheck regex, never added to the enum |
| 2026-08-08 | `correct_last_shot` | handler + precheck regex, never added to the enum |
| 2026-08-19 | `set_club_distance` | handler + precheck regex, never added to the enum |

Each previous fix patched the specific intent. The hole is structural: nothing tied "a handler
exists" to "the classifier can emit it". That is now assertion #1 in the parity test, expressed as
a set relation, so intent number 43 is covered on the day it lands.

Fixed by adding `set_club_distance` to the enum plus a numbered prompt section (§15c) with the
boundaries it is easiest to confuse with: past-tense one-swing reports are `log_shot`, number-less
questions are `club_query`, and a whole bag in one breath rides the brain's `register_bag` tool.

---

## Drift 3 — the living doc was 57% behind

`docs/VOICE-INTENT-REGISTRY.md` §3 mapped **18 of 42** intents. The 24 shipped after it was written
were never added. It is labelled a living doc that reviewers should check new intents against, which
makes a stale one worse than none — a reviewer consulting it got a confident, wrong answer.

The table is now complete and the parity test covers the pieces a table cannot.

---

## Not drift, but worth knowing: the third tool list

`pipecat-server/kevin_tools.py` declares **9** tools. It is the Phase-3 Railway/Python scaffold and
**is not deployed** — the live path is Vercel-only (`QA/model/voice-flow.md` states this explicitly).
It is therefore not in the parity guard: guarding a vocabulary nothing serves would just produce a
red test that teaches people to ignore red tests.

**If that server is ever brought up, it must import its tools from a generated artifact of
`api/_brainTools.ts`, not from a hand-copied list** — at 9 vs 23 tools it starts life two full
drift-generations behind.

---

## What the guard enforces

`__tests__/logic/voice-intent-parity.test.ts`, 16 assertions, none naming a specific intent or tool:

- Every handled intent is emittable by the classifier *(drift 2)*
- Every classifiable intent has a handler, or is a declared routing sentinel (`conversational`, `unknown`)
- Every classifiable intent has prompt guidance beyond its enum line — an enum entry with no "when to pick this" is near-dead
- Neither brain declares a tool array of its own *(drift 1)*
- Both brains import `BRAIN_TOOLS`
- Every UI tool has a client dispatch case — a tool the device cannot dispatch is a tool the caddie will claim to have used
- Every declared tool is routed as either server-executed or client-dispatched
- No source or doc presents a deleted `app/api/*+api.ts` twin as a live edit target
- The `app/api` twin directory is still empty

Two assertions are about source text (does an endpoint declare its own array?). That is normally the
grep-guard smell — a string standing in for behavior. Here the source text *is* the contract: the
defect was literally "a second copy of this array exists."

---

## Standing rule

> A brain tool is added in `api/_brainTools.ts` and nowhere else.
> An intent is not shipped until it is in `INTENT_TYPE_ENUM` **and** has a numbered prompt section.
> A precheck regex is an optimization on top of those two, never a substitute for them.
