# BACKTRACK — verifying the 2026-08-24 handoff against the code

Tim: *"We have so much evidence of half done work… I'm stuck in a 2-month cycle of fixing loops that
only partially work, and finding later that things were built and not connected."*

This is the adversarial pass on the 08-24 handoff. Method: assume every claim is FALSE, trace it in
the code, and separately sweep the whole repo for the "built, never connected" shape rather than only
re-reading what the handoff says it fixed.

Repo state at audit: `2de31035`, working tree clean, 40 commits after `612b192b`
(handoff says 41 — off by one, immaterial).

---

## 1. GATES — re-run here, not quoted

| Gate | Handoff claim | Measured now |
|---|---|---|
| `tsc --noEmit` | 0 | **0** ✅ |
| `jest` | 1535 | **1539 passed / 130 suites** ✅ (4 more than claimed) |
| `npm run sim` | 787/787 | **787/787, 639 guard source paths resolved** ✅ |
| `cost-per-user.ts` | $0.61/round · $2.43/mo | **$0.6080 · $2.4322 · $29.19/yr** ✅ |

**Not re-run: the influence suite (18/18) and the tool probe (32/33).** Those spend real money on the
app's Anthropic key and both harnesses now refuse above $1.50. I did verify the refusal guards are
real (`probe-signal-influence.ts:355`, `probe-brain-tools.ts:257`). **So 18/18 is the one headline
claim in the handoff that remains unverified by me** — treat it as reported, not confirmed.

## 2. CLAIMS THAT HOLD UP

- **The prompt-cache fix is real AND on the live path.** `liveFactsBlock` is out of the cached system
  prompt and prefixed onto the message (`api/kevin.ts:1642,1667`), guarded in the sim
  (`run-sim.ts:9988`). Critically: **no client fetches `/api/pipecat-turn` any more** — zero call
  sites across `app/ components/ services/ hooks/`, and `voiceWarmup.ts:26` removed it from the warm
  list. So the fix lands on the brain players actually talk to. This was worth checking, because the
  shim in `pipecat-turn.ts:363` is still `OFF by default` — had a client still been posting there, the
  $50 fix would have missed the live path entirely.
- **`toCageContact` now has a caller** — `components/CageSessionOverlay.tsx:235`. Real.
- **`heardStrikeCount` is set AND read** — set at `smartmotion.tsx:3531`, read at `:5465`, rendered as
  `heard N · analysed M` in `SmartMotionHud.tsx:470`. Failure #9 genuinely closed.
- **Mic-owner registry** is a `Set` with both real owners joined, and the sim guard asserts the SHAPE
  (a collection + a loop) rather than a membership list — so a third owner can't be added without
  joining. `run-sim.ts:10066-10090`. This is the correct fix for failure #8.
- **The 35-second silence fix is real** — `useVoiceCaddie.ts:2270`: all three probes false → degrade
  now, skip the dead retry. Ping-or-GET alone still earns it.
- **AggregateError unwrapping** — `voiceErrorLog.ts:131`, handles both `AggregateError` and the
  duck-typed `.errors` array.
- **Payload contract is aligned.** I diffed every key `caddieRequestBody.ts` sends against every key
  `api/kevin.ts` destructures. The only apparent mismatches were nested sub-object keys
  (`weather.tempF` etc.) and `personaIntensity`, which IS sent — nested inside the `brainSettings`
  spread at `caddieRequestBody.ts:212`. **No field is sent-and-ignored, and none is read-and-never-sent.**
  The "ten payloads, one brain" consolidation held.
- **WHATS_NEW is current** — every user-meaningful change from 08-23/08-24 has a player-facing entry,
  newest first, 11 `howTo` entries present. The standing rule was honoured.

## 3. WHAT THE SWEEP FOUND THAT THE HANDOFF DIDN'T

I swept every exported symbol in `services/ lib/ utils/ hooks/ store/ contexts/` for zero references
outside its own file, then narrowed to symbols that appear **only** at their definition line (so
internal-only helpers like `isCommunitySharingEnabled` — which IS enforced at `courseCloud.ts:83` —
don't produce false alarms). Then a second sweep over every `useState` in `app/` and `components/` for
setters that are never called.

### A. `historyPromptBlock()` — built 07-04, audited 07-30, wired to NOTHING  ← the real one

`services/caddieHistoryContext.ts` composes a `PLAYER HISTORY` block: last 4 real rounds (score, vs
par, course, date), courses played, and top practice focuses by session count. It was even given a
sim-contamination fix on 07-30. **Zero callers.** No brain has ever seen it.

The payload does carry `priorRoundsHere` — but that filters `roundHistory` **to the current course
only**. So:
- "How was my last round?" → can't answer
- "What courses have I played?" → can't answer
- "What have I been working on?" → can't answer

`docs/OPEN-ITEMS.md` §5 lists practice history as a *context gap* — as if unbuilt. It is built. This is
a one-line wire into `caddieRequestBody.ts` plus a destructure in `api/kevin.ts`.

### B. `services/getCaddieClip.ts` — the whole module, and 10 MB of video

Self-describes as *"a standalone draft you can wire into useCaddieVoice / round-flow triggers when
ready."* Written 2026-05-25. Never wired. `getCaddieClip`, `getCaddieClipPath`, `hasCaddieClip`,
`ALL_CADDIE_SLOTS` — all zero external callers. Meanwhile `assets/caddie/kevin/` is **10 MB of D-ID
clips shipping in every binary and never played.**

Decision needed: wire the 11 round-arc slots, or delete the module and the assets before store submission.

### C. `closeHoleAtTransition()` — shot end-locations never closed

`services/shotLocationService.ts`. Documented as "called when the player advances past a hole", sets
the just-finished hole's last shot `end_location` to the green centroid. **Zero callers.** Every
hole's final shot has no end location, which is a hole in shot-distance and shot-map data — the data
the player model learns carries from.

### D. Smaller, same shape

| Symbol | What it was for | State |
|---|---|---|
| `walkingDetector.cartModeSuggestion` | offer to flip cart mode when detection disagrees with the setting | computed, never offered |
| `poseTelemetry.getLatest/subscribe` | read the pose telemetry that IS being recorded | write-only bus |
| `mediaCapture.getRecentCaptures` | playback buffer for in-flight captures | never read |
| `coachLesson.planById` | select one of 3 lesson plans by id | never called |
| `patternEngine.getKevinShotResponse`, `getDominantMissLabel` | caddie-facing miss language | never called |
| `standardBag.personalCarryFor` | per-player carry lookup | never called — **relevant to the club sweep** |
| `clubBagReconcile.CLUB_SNAP_ORDER` | canonical club ordering | never read — **relevant to the club sweep** |
| `store/tournamentStore.getPlayerScore` / `getTeamScore` | tournament scoring selectors | never read |
| `lib/persona.getCaddieNameFor` / `getCaddieObject` / `getCharacterSpecFor` / `isActivePersona` | persona helpers | never called |
| `services/glassesVisionInput.*` (7 exports) | Meta glasses transport | expected — blocked on a native build |

### F. THREE CORRECTIONS TO MY OWN FIRST PASS

Building the detector caught me over-claiming, which is the point of building it:

- **`cnsBallFitting.classifyBall` is connected** — called at `cnsBallFitting.ts:230`. I was wrong.
- **`vocabularyProfile.saveProfile` / `mergeProfile` are connected** — both called by
  `saveGeneratedProfile`, which two cage-review screens call. The vocabulary profile IS written. My
  "the caddie reads a store with no writer" claim was wrong.
- **`smartVisionOverlay` is partly connected** — `unprojectTilePixel` (holeGeometryDerivation) and
  `canPlayerCarry` (queryStatusHandler) are used. It is specifically the **five strategy layers** —
  yardage rings, landing zone, danger carries, lay-up, tap-to-target — that no caller reaches.

`closeHoleAtTransition` survived the recheck and is a genuine orphan.

### E. The UI layer is CLEAN — worth saying out loud

Every `useState` in `app/` and `components/` has its setter called somewhere, with exactly one
exception (`tempo-trainer.tsx :: setKey`, a remount key — harmless). **There is no screen rendering a
value that is structurally always empty.** The "no deferred-wiring placeholders" rule is holding. The
half-builds are all in the *service → brain* seam, not the *service → screen* seam.

## 4. A MEMORY CORRECTION — the art job is half the size you think

`docs/TODO-CADDIE-EMOTIONAL-ART.md` and my own memory both say *"Kevin also routes 15 slots to ONE
image."* **That is wrong.** Counted from `components/CaddieAvatar.tsx`:

| Caddie | Slots | Distinct images | Worst offender |
|---|---|---|---|
| **Kevin** | 22 | **20** ✅ | 2× kevin-idle |
| **Harry** | 22 | 18 ✅ | 2× serious |
| **Tank** | 22 | 11 ⚠️ | 3× portrait |
| **Serena** | 22 | **4** ❌ | **15× serena-studio-portrait** |

The pre-launch art task is **Serena only** (~16 images), with Tank as a nice-to-have (~8). Kevin needs
nothing. That is a materially smaller job than the doc claims.

## 5. DEAD WEIGHT BEFORE SUBMISSION

- `api/pipecat-turn.ts` (744 ln) + `api/_brain.ts` (395) + `api/_brainTools.ts` (420) = **1,559 lines
  of second-brain and anti-drift scaffolding with no client callers.** `OPEN-ITEMS.md` §1 holds the
  deletion on a device test that, per the 08-24 handoff, has since been overtaken — clients now post
  to kevin directly. This is the single biggest source of "fixed it in one place, it's still broken in
  the other."
- **`assets/` is 207 MB** — courses 77 MB, avatars 70 MB, mediapipe 14 MB, intro 11 MB, caddie 10 MB.
  Google Play caps an AAB base module at 200 MB; iOS cellular-download limits bite well before that.
  `assets/courses/webster-dudley` (1.3 MB) has zero code references at all.

## 6. THE HONEST SCORECARD

The handoff is **substantially accurate**. Everything I could verify without spending money on the API
checked out, including the expensive-to-get-wrong ones (cache boundary, live brain path, payload
contract). The gates are better than claimed, not worse.

What it did **not** do is look outside its own work. The 08-24 session fixed nine half-builds it
tripped over; the sweep above found **eleven more of the identical shape** that nobody tripped over —
because a half-build is silent by construction. That is the 2-month loop: half-builds are found by
accident, one at a time, at the cost of a session each.

**The loop breaks with a sweep, not a fix.** The sweep in §3 took under an hour and is mechanical:

    exported symbol with zero references outside its own file
      → is this UNCONNECTED (should be wired) or genuinely dead (should be deleted)?

It should be a sim guard with an explicit allowlist, so a new orphan fails the harness on the day it
is written instead of surfacing two months later on a golf course.


---

## 7. THE GUARD — shipped the same day (`scripts/simulations/orphanExports.ts`)

Two `check()`s in run-sim, now **789/789**:

1. **`LOCK: no NEW orphaned export`** — anything built and unwired fails on the day it is written, by
   the person who wrote it, while the intent is still in their head. Negative-tested: adding a dummy
   export takes the count 141 → 142 and the guard goes red.
2. **`LOCK: the orphan baseline cannot rot`** — wiring something forces the deletion of its line, so
   the list can only shrink. A ratchet, not a graveyard.

Plus a printed debt line: **25 WIRE · 11 PARKED · 29 SURFACE · 1 DUPE · 75 TRIAGE.**

### Two traps hit while building it, both worth keeping

- **The guard blinded itself.** `scripts/` is in the corpus and the baseline names all 141 symbols as
  string keys, so every symbol read as "referenced elsewhere" and the detector returned **zero
  orphans**. A green guard that had quietly stopped looking — produced by the guard against exactly
  that shape, within an hour of writing it. Fixed by excluding the file from its own corpus.
- **Comments were counting as references.** `closeHoleAtTransition` read as connected because *its own
  docstring* says "called when the player advances past a hole". Stripping comments before counting
  surfaced **29 more orphans**, including the two biggest finds of the day:
  - **`store/clubStatsStore.ts :: getLearnedCarryDistances`** — the honest LEARNED CARRY bag. Its only
    other mention in the repo is a comment one file up saying *"For the honest CARRY bag use
    getLearnedCarryDistances()"*. Nothing does. Step 4 of the club sweep is carry-vs-total everywhere;
    the app has been learning real carries and no consumer reads them.
  - **`services/watchBridge.ts`** — `sendLiveScore`, `sendNotification`, `sendRoundState`,
    `sendVoicePrompt`. The Wear OS companion is running on the watch; four of the pushes to it are
    wired to nothing.
  - Also: `practicePlanStore.practicePlanPromptBlock` (same shape as historyPromptBlock — its own file
    says it "feeds this into the caddie"; it does not) and `personaKnowledgeBase.getPersonaAnswer`
    (Tank's doctrine layer answers nobody).

**A file's description of itself is not evidence of runtime behaviour** — that is the same lesson as
the earbud-tap NO-OP comment, and it has now cost this project twice.

## 8. COURSE IMAGERY — measured, and 27 files removed

Tim: *"we're not gonna be shipping a whole bunch of course data — the user's gonna use the course
engine to build on demand."*

- **459 screenshots (71 MB) are genuinely bundled** into the binary via `require()` in
  `data/localCourseImages.ts` — 27 courses built for testers. **These stay.**
- **27 files (6.4 MB) were referenced by nothing at all** — all of `rancho-california` and
  `webster-dudley`, whose maps in `localCourseImages.ts` are literally `{}`. Both courses already
  fall through to the on-demand engine. **Deleted.** `assets/courses` is now exactly 459 files on
  disk and 459 required — a clean 1:1.
- Note: this does **not** shrink the app binary, because those files were never bundled. It shrinks
  the repo. Binary savings would only come from the 459, and those are tester courses.
- `LOCAL_COURSE_CENTROIDS` in the same file is a pure lat/lng table used by `courseGeometryService`
  and `courseDataOrchestrator`. It is independent of the image maps, so whenever the images do go,
  the centroids stay.

**Gates after all of this: `tsc 0 · jest 1539/1539 · sim 789/789`.** No app code was modified.
