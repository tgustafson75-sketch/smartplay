# SmartPlay Caddie — Learning Layer Capability Audit

**Read-only diagnosis. 2026-08-17. No application code was modified.**

Method: capability states were assigned from (a) import-graph reachability computed from every
file under `app/` as entry points, then (b) call-site analysis of each module's exports, then
(c) tracing whether the output reaches an actual model prompt. Reachability alone was never
treated as WIRED — several modules are import-reachable and functionally dead.

---

## 1. Capability Matrix

| Layer | State | Evidence | Note |
|---|---|---|---|
| **L0** Event log substrate | **PARTIAL** | `store/roundStore.ts:138`, `store/conversationLogStore.ts:26` | Shots, scores, and dialogue are durably recorded. The **recommendation is never recorded**, so the substrate cannot support policy learning. |
| **L1** Derived player model | **WIRED** (distances) / **PARTIAL** (tendencies) | `services/shotStrategy.ts:27` → `store/clubStatsStore.ts:232`; `services/golferModel.ts:296` | Club distances are genuinely derived from logged samples and reach the live prompt. The richer `golferModel` tendency snapshot reaches only a dead endpoint. |
| **L2** Context assembly | **WIRED** | `services/pipecatContext.ts:22` | One builder feeds both mics. No token budget, no priority ordering, not inspectable after the fact. |
| **L3** Cross-session semantic memory | **WIRED** | `services/caddieMemoryRetrieval.ts:26` (`= true`), `store/caddieMemoryStore.ts:565` | CNS store → retrieval → prompt is live, bounded, versioned, and backed up. The one layer that works end-to-end. |
| **L4** Policy adaptation | **ABSENT** | no code found | Nothing changes advice based on measured outcomes. See §6. |
| **L5** Model layer / API abstraction | **PARTIAL** | `api/_aiProvider.ts`; 27 of 60 routes reference it | A real abstraction exists and is majority-adopted; 9 files still build provider-specific requests directly. |
| **Eval** Behavior harness | **ABSENT** | `__tests__/`, `scripts/simulations/run-sim.ts` | 984 unit tests + 762 static guards, zero of which evaluate what Kevin *says*. |

---

## 2. Archaeology Findings

Four distinct prior attempts at this layer exist. They were built in sequence, none replaced its
predecessor, and all four are still in the tree.

### 2.1 Pattern Engine — 2026-04-25 (`0cb7b109`)
`services/patternEngine.ts` (281 LOC), `services/relationshipEngine.ts` (91 LOC).
- `analyzeSession` is **live** — called from `app/cage/history.tsx`, `app/cage/summary.tsx`.
- `processSwingAnalysis` is **live** — `services/videoUpload.ts`, `app/cage/summary.tsx`.
- `getKevinShotResponse` (`services/patternEngine.ts:222`) and `getDominantMissLabel`
  (`services/patternEngine.ts:269`) have **no caller anywhere** outside the file. These are the
  two functions in the module whose purpose was to shape what Kevin says.

### 2.2 "Kevin Knows You" — 2026-04-27 (`9e2aa3f1`)
`services/patternDetection.ts` (322 LOC). Commit message claims "plain-English insights wired into
Kevin's context".
- `generatePatternInsights` is **live**, called at `app/(tabs)/caddie.tsx:2341` and
  `app/round/briefing.tsx:125`.
- **But** the `app/(tabs)/caddie.tsx` call site is inside the end-of-round recap generation, and the
  `briefing` call site renders a pre-round card. Neither passes the insights into
  `buildPipecatContext`. The claim in the commit message was true of `api/kevin.ts`'s prompt at the
  time; it is not true of the brain that serves turns today (§4).
- `learnedMissDirection` **is** live and does reach advice, via
  `services/effectiveMiss.ts` → `services/localStatusResponder.ts` and `app/smartfinder.tsx`.

### 2.3 Learning Golfer Model — 2026-05-22 (`d9b346b0`)
`services/golferModel.ts` (449 LOC). Header states the output is "fed back into the brain.ts system
prompt builder". **This is the most significant archaeology finding.**

The producer chain is intact and correct:
- `buildGolferModel()` (`services/golferModel.ts:154`) is called live from
  `services/metaCourseIntelligence.ts:159`, `services/smartAnalysisEngine.ts`,
  `services/swingComparisonEngine.ts`.
- It computes `prompt_snippet` via `describeForPrompt()` at `services/golferModel.ts:261`.
- `hooks/useKevin.ts:229` sends `golfer_model_snippet` to `/api/kevin`.
- `api/kevin.ts:624` sanitizes it and `api/kevin.ts:991` injects it into the system prompt under
  `DERIVED TENDENCIES`.

Every link in that chain is real. The chain is nonetheless dead, because its only entry point is
`useKevin`'s `ask()` — defined at `hooks/useKevin.ts:75`, returned at `hooks/useKevin.ts:329` — and
**`ask` is never destructured by any consumer.** The single consumer of the hook,
`app/(tabs)/caddie.tsx:1619`, reads `isThinking` only:

```
const { isThinking: kevinThinking } = useKevin();
```

`services/golferModel.ts:282` `readPersistedGolferModel()` — the "read it back at cold start"
half — has no caller at all.

**Nothing broke this in a single commit.** `api/kevin.ts` is still live (it serves the speculative
brain call at `services/listeningSession.ts:914` and the small-talk fallback), so no dead-code sweep
flagged it. What happened is that the *turn* moved: conversational turns were handed to the pipecat
brain (`run-sim.ts:5902` records "the legacy /api/kevin fallthrough was deleted 2026-07-23"), and
`golfer_model_snippet` was never added to the replacement context builder. The producer kept
running against a consumer that real turns stopped reaching.

### 2.4 Caddie CNS — 2026-06-10 → 06-13 (`904e8483`, `aa81a2b4`, `73562017`)
`store/caddieMemoryStore.ts` (592 LOC), `services/caddieMemoryRetrieval.ts` (275 LOC),
`services/conversationDistill.ts`, `services/cnsShotRead.ts`.
- **This one is genuinely wired end-to-end** and is the only layer that is. `getCaddieContext` is
  called from `hooks/useVoiceCaddie.ts`, `hooks/useKevin.ts`,
  `components/swinglab/AskYourSwingCard.tsx`; `mergeMemoryIntoContext` from
  `services/conversationalBrain.ts`; and `services/pipecatContext.ts:177` puts `memory` into the
  live context object.
- `CNS_RETRIEVAL_ENABLED = true` at `services/caddieMemoryRetrieval.ts:26` — a literal constant, not
  an env var, so it ships **on**.
- `distillConversation` is live via `store/roundStore.ts:1859`; `initNarrativeIngest` is live via
  `app/_layout.tsx:625`.

### 2.5 Effect of the dead-code sweeps
The late-May/June sweeps referenced in the brief were not located as single large-deletion commits
in this history. The sweeps that *are* present (`59281f61` "Delete all 11 dev-server twins",
`a590dc20` "Delete the drifted brain twin", 2026-08-13) removed duplicate *server* twins, not
learning code. **No sweep gutted a learning consumer.** The golfer-model break was caused by
addition (a second brain), not deletion — which is why no sweep-related test caught it.

### Direct answer
**Has any version been wired end-to-end?** Yes — exactly one: the Caddie CNS (§2.4), which is live
today. The Learning Golfer Model (§2.3) reached a real prompt through a real endpoint but its entry
point is unreachable from any user action. Pattern Detection (§2.2) reaches the UI and the recap,
not the turn prompt. **No commit "broke" the golfer model; a parallel brain was introduced on
2026-07-23 and the tendency snippet was not carried across.**

---

## 3. Orphan List

Learning-relevant code no live path reads. Default recommendation is deletion.

| Symbol | Location | Verdict |
|---|---|---|
| `readPersistedGolferModel` | `services/golferModel.ts:282` | **Delete.** No caller. Its stated purpose (warm the prompt at cold start) was never implemented. |
| `getKevinShotResponse` | `services/patternEngine.ts:222` | **Delete.** No caller; superseded by the brain writing its own prose. |
| `getDominantMissLabel` | `services/patternEngine.ts:269` | **Delete.** No caller; `services/effectiveMiss.ts` is the live equivalent. |
| `ask` | `hooks/useKevin.ts:75`, returned `:329` | **Do not delete yet — decide first.** Deleting `ask` deletes the only path that carries `golfer_model_snippet` and `recent_analyses_snippet` to a prompt. This is the fork in the road: either rewire the snippet into `buildPipecatContext` and then delete `ask`, or delete `ask` and consciously accept that `services/golferModel.ts` becomes analytics-only. |
| `golferModel.describeForPrompt` output | `services/golferModel.ts:296` → `api/kevin.ts:991` | Reachable only through the above. Same decision. |

`CNS_RETRIEVAL_ENABLED` and `MIN_HOLE_PLAYS_FOR_GUIDANCE` were initially flagged by the export scan
and are **not** orphans — both are consumed inside their own module
(`services/caddieMemoryRetrieval.ts:60`, `:253`, `:81`, `:260`). Recorded here because a naive
export-usage scan reports them as dead.

---

## 4. L2 — What Kevin Actually Sees

The live assembly point is `services/pipecatContext.ts:22` `buildPipecatContext()`. Its header
states it is "the SINGLE source of truth… so BOTH the caddie-tab mic AND the universal badge /
earbud / hands-free path build the exact same rich context." That claim is accurate for the two
mics — verified: `hooks/usePipecatVoice.ts:17` and `services/conversationalBrain.ts:16` both import
it.

**Sources contributing, in construction order, with supplying file:**

| # | Block | Source |
|---|---|---|
| 1 | `player` (name, handicap, dominantMiss, custom caddie, active persona, trustLevel) | `store/playerProfileStore.ts`, `store/trustLevelStore.ts`, `services/caddieResolver.ts` |
| 2 | `round` (hole, par, yardage, GPS-derived distance, score, mode) | `store/roundStore.ts` |
| 3 | `round.mentalState` / `consecutiveBadHoles` / `isSpiralRisk` / `emotionalLog` (last 5) | `store/relationshipStore.ts` |
| 4 | `round.priorRoundsAtCourse`, `priorGreenRead`, `holeNote` | `store/roundStore.ts` |
| 5 | `round.recentShots` — **last 5 only** | `store/roundStore.ts:149` |
| 6 | `bag.club_distances` | `services/shotStrategy.ts:27` → `store/clubStatsStore.ts` |
| 7 | `settings`, `gps` | `store/settingsStore.ts`, `services/gpsManager.ts` |
| 8 | `memory` (CNS) | `services/caddieMemoryRetrieval.ts` `getCaddieContext` |

**Not present in the live context:** `golfer_model_snippet`, `recent_analyses_snippet`,
`persistentPatterns`, `generatePatternInsights` output. All four exist and are constructed
elsewhere; none reaches this builder. Verified by search — `golfer_model_snippet` returns no hit in
`api/pipecat-turn.ts`, `services/pipecatContext.ts`, or `services/voice/brainSettings.ts`.

**Context budget:** none at the assembly layer. `buildPipecatContext` concatenates unconditionally.
The only limiting discipline is per-field character capping in the *other* brain
(`api/kevin.ts:607-655`, `capOrNull(..., 200|600|2000)`), which is prompt-injection defence, not
token accounting. There is no priority ordering and no truncation policy.

**Inspectability:** **no.** `services/roundTrace.ts` records event breadcrumbs but contains no
prompt capture. There is no way to reconstruct what Kevin was shown on a given turn after the fact.

**Cascade division:** the routing layer does *not* see player context. `services/listeningSession.ts`
calls `/api/voice-intent` with `{ text, voiceGender, persona }` only, while the substantive call
(`/api/kevin` at `:914`, or the pipecat turn) carries the full context. The classifier decides
*whether* a deterministic handler runs; it is deliberately context-free.

---

## 5. L0 — Event Log Detail

| Event | Captured? | Written where | Fields carried |
|---|---|---|---|
| Shot taken | **Yes** | `store/roundStore.ts:138` `ShotResult` | club, hole, `distance_yards`, `measuredCarry`, `outcome_text`, direction/feel enums, start/end location |
| Kevin's recommendation | **No** | — | **Nothing records what was advised.** |
| Accepted or overrode | **No** | — | No field, no store, no counter. Searched `accepted`/`override`/`followedAdvice`/`acceptance` across `store/` and `services/`; only hits are T&C acceptance (`store/playerProfileStore.ts:150`), GPS fix acceptance (`store/roundStore.ts:660`), and `teamIntelligenceStore.acceptedHandoffs` (a different concept). |
| Outcome linked to recommendation | **No** | — | Impossible without the two rows above. |
| Hole / score entry | **Yes** | `store/roundStore.ts` scores/putts, snapshotted onto `RoundRecord` at `endRound` | hole, score, putts, `holeStats` |
| Swing capture with labels | **Yes** | `store/cageStore.ts` `sessionHistory`, `primary_issue`, `drill_recommendation` | issue name, severity, occurrence count, date |
| Conversation turns | **Partial** | `store/conversationLogStore.ts` | `{role, text, at}` — **capped at 60 turns** (`:26`), older dialogue discarded permanently |
| Tool invocations | **Counters only** | `store/agentBrainStats.ts` | aggregate stats, not per-invocation records |
| Intent classification + correctness | **Routing only** | `store/voiceHitRateStore.ts:32-33` | records `local` vs `cloud` routing. **Correctness is never labelled.** |

**Storage and durability.** All the above are Zustand `persist` stores over AsyncStorage via
`services/ssrSafeStorage.ts:20`. Survives app kill. Survives reinstall **only** for keys in
`services/cloudSync/snapshot.ts:68` `BACKED_UP_STORE_KEYS` — which does include `round-store-v1`
(`:70`) and `conversation-log` (`:102`), plus the learned set in
`services/cloudSync/growMostlyKeys.ts:24-38` (`caddie-memory-v1`, `club-stats-v1`, `club-bag-v1`,
`player-profile-v2`).

**Offline integrity.** Every event above is written to a **local store first**; none requires the
network at write time. Nothing is dropped on signal loss during a round. Server backup is a separate
later sync of whole store blobs, not a per-event queue — so a mid-round network drop costs nothing,
and a device loss before the next successful backup costs everything since the last one.

**Schema versioning.** Present and disciplined. `store/caddieMemoryStore.ts:568` is at `version: 2`
with a real `migrate`; `conversation-log`, `voice-hit-rate-v1`, `agent-brain-stats` all carry
`version: 1` with passthrough migrates.

**Identity fields.** This is a gap. `types/cage.ts:3` carries `player_id`. `ShotResult`
(`store/roundStore.ts:138`) carries hole and course via the enclosing round, but **no `player_id`,
no `session_id`, and no `speaker_id`.** Conversation turns carry neither `player_id` nor
`speaker_id` beyond a two-value `role`. In a single-player local app this is currently recoverable
(the device *is* the player), but it means no logged event is attributable once data leaves the
device — and `store/familyStore.ts` / guest profiles already admit more than one human per device.

---

## 6. L4 — Policy Adaptation

**ABSENT.** No mechanism was found by which advice changes based on measured outcomes.

- Recommendation acceptance rate: not tracked anywhere (§5).
- The Trust Spectrum (`store/trustLevelStore.ts`, surfaced in `services/pipecatContext.ts:44`) is a
  **user-set verbosity control**, not learning. It is set by the player in Settings or by the badge
  chip in `components/caddie/CaddieMicBadge.tsx:139`. Nothing writes it from observed outcomes.
- The nearest thing to adaptation is `services/effectiveMiss.ts:37` → `learnedMissDirection`, which
  derives dominant miss from logged shot directions and does reach advice. That is a **derived
  statistic**, not policy adaptation: it changes what Kevin *knows*, never how much he is trusted or
  which recommendation strategy is used.

Stated flatly: **beyond a user-set verbosity dial and one derived miss statistic, nothing in this
app adapts.**

---

## 7. L5 — Model Layer

- Shared abstraction exists: `api/_aiProvider.ts`, referenced by **27 of 60** `api/` routes.
- **9 files construct provider-specific requests directly**, bypassing it: `api/ball-departure.ts`,
  `api/ball-path.ts`, `api/club-path.ts`, `api/course-content.ts`, `api/course-intelligence.ts`,
  `api/golfbert-proxy.ts`, `api/narrative-extract.ts`, `api/owner-triage.ts`, `api/voice.ts`.
- **Swapping the Anthropic client** would therefore touch `api/_aiProvider.ts` plus those 9 files —
  call it 10 files, not 1. That is the honest measure of the abstraction.
- **TTS/Whisper** are less abstracted: `api/voice.ts` and `api/_kevinVoice.ts` own the OpenAI TTS
  wire format directly, and `/api/transcribe` is called from the client at
  `services/voiceService.ts` with a raw multipart body.
- Prompts, tool schemas, and wire format are **interleaved**, most visibly in `api/kevin.ts` (1,709
  LOC) where sanitization, prompt text, and the provider request are in one function body.
- **No request/response pair is persisted in a training-usable form.** `conversationLogStore` keeps
  `{role, text, at}` with **no model id, no provider, no prompt, no outcome link**, capped at 60
  turns. Every API call made today is discarded as training data.

---

## 8. Evaluation Harness

**ABSENT for behavior.** Existing infrastructure:
- `__tests__/` — 984 tests across 79 suites; pure-function and source-shape assertions.
- `scripts/simulations/run-sim.ts` — 762 scenarios; predominantly static source guards (regex over
  file contents) plus some pure-function scenarios.

**Can "did that prompt change make Kevin better or worse?" be answered without playing a round?
No.** There is no frozen input set, no golden output fixture, and no scoring of model responses.
Note the second-order risk already realised in this repo: source-shape guards can pass against code
that never runs — a test asserting a broken expression's text stayed green for weeks
(`__tests__/regression/watch-metrics-reach-the-app.test.ts`, corrected 2026-08-17). The same class
of blindness applies to any future "eval" built from string matching.

---

## 9. Anti-Pattern Check

**God object — confirmed, two of them.**
- `app/(tabs)/caddie.tsx` — **4,935 LOC**, referenced by 375 files. Owns routing, voice wiring, tool
  dispatch, round setup, recap generation, and rendering simultaneously.
- `store/roundStore.ts` — **3,160 LOC**, fan-in 187. Owns round state, shots, scores, watch swing
  snapshotting, recap assembly, trace mailing, and conversation distillation
  (`store/roundStore.ts:1859`).
- `hooks/useVoiceCaddie.ts` — 3,025 LOC, fan-in 31.
- By contrast `services/pipecatContext.ts` (226 LOC, fan-in 3) is correctly scoped — the context
  builder is *not* the god object.

**Competing stores of one concept.**
- Clubs are split across **three** stores: `store/clubStatsStore.ts` (measured distances),
  `store/clubBagStore.ts` (bag membership), `store/clubSelectionStore.ts` (last selected).
- Player identity is split across **three**: `store/playerProfileStore.ts`,
  `store/guestProfileStore.ts`, `store/vocabularyProfileStore.ts`.
- **Two brains** remain live on different paths: `api/kevin.ts` (speculative call at
  `services/listeningSession.ts:914`, plus small-talk fallback) and `api/pipecat-turn.ts` (the
  conversational turn). This is the direct cause of the §2.3 finding and is the single most
  important structural fact in this audit.

**Testable without booting the app:** L1 distance math (`store/clubStatsStore.ts` is pure Zustand,
already unit-tested), L3 retrieval shaping, and the `services/indoorSwing.ts`-style pure services.
**Not testable in isolation:** L2 assembly (reads eight stores via `getState()`), and anything in
the two god objects.

---

## 10. Counterfactual Verdict

**No. Past rounds cannot be replayed to reconstruct what Kevin advised.**

What the player *did* is well recorded — `ShotResult` (`store/roundStore.ts:138`) carries club,
hole, distance, measured carry and outcome, it is persisted, snapshotted onto the round record at
`endRound`, and backed up (`services/cloudSync/snapshot.ts:70`). What Kevin *advised* is recorded
nowhere: there is no recommendation row, no advice field on the shot, and no acceptance flag —
confirmed by searching `accepted`/`override`/`recommend` across `store/` and `services/`, which
returns only T&C acceptance, GPS-fix acceptance, and team handoffs. The conversational record that
might substitute is `store/conversationLogStore.ts`, which keeps only the last 60 turns of prose
with no link to any shot, hole, or timestamped decision. Consequently, for any past shot the pair
(*what was recommended*, *what was done*) does not exist and cannot be reconstructed. **No policy
learning is possible on this substrate regardless of what else is built on top of it**, and no
amount of later engineering recovers rounds already played.

---

## 11. Data-Loss Clock

What is permanently discarded on every round played right now, ranked by irreversibility.

1. **The recommendation itself, and whether it was taken.** Irrecoverable by any later job — it was
   never written. Every round played is a round of paired (advice, outcome) data destroyed at the
   moment it was generated. This is the only item on this list that cannot be reconstructed from
   something else.
2. **Conversation beyond 60 turns** (`store/conversationLogStore.ts:26`). A full round with an
   active caddie exceeds this comfortably; the earliest exchanges of every round are dropped. What
   the player *told* Kevin about their game is lost with them.
3. **Intent-classification correctness.** `store/voiceHitRateStore.ts` records that a turn went
   local or cloud, never whether the classification was right. Misroutes are invisible, so the
   classifier cannot be improved from production traffic.
4. **The assembled prompt.** Not captured anywhere (§4), so no past turn can be diagnosed or
   replayed against a changed prompt.
5. **Per-invocation tool records.** `store/agentBrainStats.ts` keeps counters only; which tool ran
   with which arguments on which turn is not retained.

Items 2–5 are recoverable in principle for *future* rounds by writing more. Item 1 is the only one
where the loss is structural, and it is also the one that gates every layer above it.

---

## 12. The Single Narrowest Next Increment

**Record the recommendation.**

One change: when the caddie produces a club/target recommendation during a live round, write a row
capturing what was advised, alongside the shot record that already exists. Nothing else in this
document is attempted in the same step — no acceptance inference, no comparison logic, no
adaptation, no UI.

Why this and not the golfer-model rewire (§2.3), which is smaller: the golfer-model snippet is
*recoverable at any future date* — the model is derived from stores that persist, so wiring it into
`buildPipecatContext` next month produces exactly the same result as wiring it today. The
recommendation is not recoverable. Every day it stays unwritten, the counterfactual record for that
day is destroyed permanently (§11 item 1). Highest irreversibility, therefore first.

**Files it touches:**
- `store/roundStore.ts` — add the record type and its writer alongside `ShotResult:138`; include it
  in the `endRound` snapshot so it inherits the existing backup path
  (`services/cloudSync/snapshot.ts:70`) and survives reinstall for free.
- One write site, at whichever seam already knows a recommendation was made — the tool-dispatch path
  where `plan_shot` / club advice is emitted (`types/toolAction.ts:24-27` defines both shapes).

**Reversible:** it is additive — a new field on a versioned, migrated store. Nothing reads it in this
increment, so nothing can regress. If it proves wrong, delete the writer.

**How to verify it worked:** play one hole, then read the persisted `round-store-v1` blob and
confirm the recommendation row exists with a hole number and a timestamp that precedes the
`ShotResult` for the same hole. If the recommendation cannot be ordered before the shot it was meant
to precede, the write site is wrong and no later analysis will be trustworthy.

Deliberately **not** in this increment: acceptance/override. Determining whether the player took the
advice requires comparing advised club to played club, which is a judgement (a player may take a
different club for reasons Kevin never saw). Recording both sides first, and deciding how to compare
them later against real data, is the reversible order.

---

## 13. Open Questions

1. **Is `api/kevin.ts` intended to survive?** Two live brains is the root cause of §2.3. The answer
   is a product decision, not a repo fact. Prior context: the 2026-08-13 attempt to collapse them
   was reverted after the simulation caught three pipecat-only capabilities — so a feature-by-feature
   prompt diff must precede any merge.
2. **Where do the ~1,500 and ~2,313 LOC sweeps live?** No commits matching those magnitudes were
   located in this repo's history under the searched terms. They may predate this repo, live in one
   of the lookalike repos named in `CLAUDE.md`, or have been squashed. The answer lives in the other
   working copies, not here.
3. **Does the Vercel deployment log request/response pairs?** `api/*` runs as Lambdas; any
   platform-side logging is outside this repo. If Vercel retains bodies, §11 item 1 may be partially
   recoverable for recent rounds from the platform, not the app. The answer lives in the Vercel
   dashboard.
4. **Multi-player identity.** `store/familyStore.ts` and guest profiles admit more than one human per
   device, but no logged event carries `player_id` (§5). Whether family rounds are expected to
   produce attributable learning data is a product question that determines whether the increment in
   §12 needs a `player_id` from day one.
