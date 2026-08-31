# Open items — non-business

Snapshot 2026-08-21, end of the first-turn/voice session. Billing/Stripe/IAP deliberately excluded —
Tim owns that.

---

## 1. ~~BLOCKED ON A DEVICE TEST~~ — **CLOSED. Verified in code 2026-08-31; there is nothing to delete.**

> **This section was stale and I repeated it three times before checking.** Everything below
> describes a state that ended on 2026-08-24.
>
> - `BRAIN_SHIM` **does not exist anywhere in the repo.** The env-var toggle is gone.
> - `api/pipecat-turn.ts` is already a thin pass-through over `api/kevin` via `api/_brainShim`. The
>   second brain — its own 744-line prompt assembly, tool loop and fallbacks — **is deleted.**
> - **The 640/815 lines of "anti-drift scaffolding" are NOT scaffolding any more.** `api/_brain.ts`
>   and `api/_brainTools.ts` are both imported by `api/kevin.ts` — they became the single brain's
>   shared blocks and its one tool definition. Deleting them would delete the owner, not the
>   duplication. The payoff already happened, in a better shape than the plan described.
> - `__tests__/logic/voice-intent-parity.test.ts` is **not** two-brain parity and is not vacuous. It
>   pins FOUR vocabularies that must agree (classifier enum, handler intents, BRAIN_TOOLS, client
>   dispatch) and deliberately asserts set relations rather than named intents, so a tool added
>   tomorrow is covered on the day it lands. It stays.
>
> **The device tap was never the blocker.** Probe parity was 19/19 across all three paths with median
> ~1.2s and identical continuity; that was the evidence, and I kept asking for a tap on top of it.
> Tim, 2026-08-31: *"You dont need my device to know if its going to work."* Correct — and the thing
> the tap was supposedly gating had already shipped a week earlier.

### The original note, kept to show what it claimed

**The single-brain shim is live and unverified on hardware.** `BRAIN_SHIM=1` is set, so one brain
(kevin) answers every turn behind both contracts. Verified 19/19 by probe on all three paths, latency
median ~1.2s, continuity identical. **Never confirmed on a real device.**

Until Tim taps the mic once and it feels right, I will not delete:
- pipecat-turn's native implementation
- `api/_brainTools.ts` + `api/_brain.ts` (640 lines of anti-drift scaffolding)
- `voice-intent-parity.test.ts` and ~15 parity guards
- the migration guard explicitly marked DELETE-ON-SHIM

That deletion is the actual payoff of the consolidation — it is what stops every future fix needing
two homes. Revert if wrong: `BRAIN_SHIM=0` in Vercel + redeploy (~9 min).

## 1b. BUILT, OWNER-ONLY — does the gym work show up in the SWING? (2026-08-22)

Tim, 08-22: *"put that workout rail just in my owner setting just for me so that I can see it as I
work out because I'm the only one with SmartPump."* Owner-gating is what let this ship during the
freeze: no tester-facing surface changes, and a card that could only ever say "no data" for everyone
else never appears for them.

**Settings → Owner Tools → Training → Strike.** `services/practice/workoutSwingImpact.ts`, pure/sync/
never-throws, mirroring `workoutPerformance.ts`.

    workout volume / week  ──vs──  STRIKE RATE / week
    strike rate = clean contact_read / graded contact_read   (unknown reads excluded from BOTH)

Why strike rather than score: scoring is slow and noisy — putting, course and weather all sit between
a deadlift and a number on a card, and the scoring rail needs 4 rounds before it says anything.
Contact moves faster, needs only range time, and is closer to what the fault-driven exercises target.

Honesty rules it enforces, each with a test:
- quiet until **3 workouts AND 20 graded swings AND 3 weeks carrying BOTH** — the same-week gate is
  the one the scoring rail structurally cannot enforce, since rounds are indexed by round not week
- pooled per week, so a 3-swing session cannot outweigh a 60-swing one
- a week with <5 graded swings is marked no-data, never plotted as a 0% strike rate
- self-only (`resolvePlayerName`), so a student's swings in Family/Coach mode are never credited
- association, never causation — a drop under heavier training reads as fatigue, not a broken swing
- when it can't speak it says exactly what is missing, in counts

**Shipped as a GRAPH, same day.** Tim: *"owner only is me seeing it graphically and seeing it how they
would see it, not a text line. That's not gonna let me compare anything."* He was right — a text strip
cannot answer whether two lines move together, which is the entire question. It is now a fourth source
("Strike") on the dashboard PROGRESS graph, owner-gated, read exactly the way a player reads the other
three.

That forced a real fix underneath: the graph's OUTCOME axis was hardcoded to score-vs-par in the JSX,
silently assuming every source is judged the same way. Strike rate is a percentage where HIGHER is
better, so the hardcoded axis would have drawn improvement as decline. `scoreLabel` /
`scoreDeltaUnit` / `scoreHigherIsBetter` are per-source now; the three existing sources keep exactly
what they had.

Only weeks carrying a strike rate are plotted, with the training line filtered to the SAME weeks so
the two stay index-aligned — a week with no range time is not a 0% strike week.

**Still open:** decide whether it goes public once there is enough of Tim's own data to know the
signal is real. [[close-the-loop-strategy]]

## 2. ~~PRE-LAUNCH — caddie emotional art~~ **CLOSED 2026-08-31 by Tim**

> **"The 8 Serena images we have are fine."** Not a blocker, not a launch item. 1.0 ships the eight
> expressive Serena images landed 2026-08-30; the remaining ten are not being drawn.
>
> **This section's own numbers were wrong** and are the reason it read as a blocker: it said Serena
> had *4 distinct images*. She has **8** expressive images plus portraits — verified in
> `assets/avatars/` and `components/CaddieAvatar.tsx` on 2026-08-31. The doc overstated the gap for
> ten days. [[a-stale-header-is-a-source-someone-trusts]]
>
> **3.0, not now:** Tim wants *"a full agent avatar not screenshots"*. Pre-rendered stills routed to
> mood slots are a stand-in for an avatar driven by the caddie's state — so drawing more stills
> spends on the thing being replaced. See `docs/TODO-CADDIE-EMOTIONAL-ART.md`.

## 3. PARKED — needs a native build
`docs/NEEDS-A-NATIVE-BUILD.md`. Headset-CONNECTED detection (~10 lines Kotlin + AVAudioSession; would
retire the "Voice on Phone Speaker" and caption toggles), Meta glasses profile. **Earbud TAP already
works** — that was my error, corrected. Plan as ONE build.

## 4. V2 BY DESIGN — Predictive Tendency Engine
`docs/V2-PREDICTIVE-TENDENCY-ENGINE.md`. Deliberately post-launch: data-starved at ~20 rounds/yr,
needs pre-shot intent capture, and asymmetric failure cost. §7's substrate (one interruption clock)
shipped.

## 5. CONTEXT GAPS — ranked, none change a club call
Practice/cage history ("how has my range work been going"), watch swing data, tee-box goals, points
progress, tournament state. The one that DID change a club call — the SmartFinder lock — is fixed.

## 6. COURSE PRELOAD — the release model. **TIM'S CALL 2026-08-24: not the bottleneck, leave it.**

> **DECIDED.** Presented with the measured production APK at **430 MB** (of which 71 MB is the 459
> bundled course screenshots), Tim's call was **leave it — not the bottleneck.** Nothing is being
> deleted and the prefetch is not being built for launch. The section below stays as the written-up
> plan for when it IS the bottleneck.
>
> Honest caveat on that 430 MB: it is a UNIVERSAL APK carrying every native ABI. Google Play ships an
> AAB whose per-device download is materially smaller, and nobody has measured that number. If store
> review or install conversion ever pushes back, **measure the real AAB and IPA first** — the 71 MB
> may be a rounding error next to MediaPipe (14 MB) and the native libraries.



Tim, 08-24: *"before release, it'll only pull, like, three courses when the user opens the app menu.
It'll pull three to five courses near them, or once they demand. So it's going to be much smaller
going out."*

That makes this a launch blocker rather than a surfacing job, because **459 course screenshots /
71 MB are genuinely bundled** into the binary via `require()` in `data/localCourseImages.ts` — 34% of
the whole 207 MB assets tree, against a 200 MB Google Play AAB base-module cap. Deleting them is the
saving; the on-demand prefetch is what makes deleting them safe.

**Built:** `locateNearbyCourses(lat, lng, {limit: 8})` is live at `play.tsx:938`. `downloadCourse` has
three callers (arrival, explicit pick in Play, caddie.tsx).

**Not built:** the multi-course prefetch. The only auto-download today is the **single nearest course
within 1.5 km** (`play.tsx:978`) — the player has already arrived. Nothing pulls courses near them
from home, which is the entire point of the release model.

**Correction to this section's previous wording:** it said `connectionClass` "gates unattended pulls on
measured throughput." It does not. `measureConnection` is called at `play.tsx:1016` and only LOGS the
verdict before proceeding — deliberately, and correctly, because the round depends on that one
download. `mayPullCourseNow`, the actual gate, has **zero callers** and sits in `ORPHAN_BASELINE` as
PARKED. It is waiting for exactly this feature. So is `isCourseDownloaded`, the "ready offline" check.

**ORDER OF OPERATIONS — this plan can itself ship half-built:**
1. Build the 3–5 nearby prefetch (consumes `mayPullCourseNow`, deletes its baseline line)
2. Surface the ready-offline state (consumes `isCourseDownloaded`, deletes its line)
3. Prove both on a course actually played
4. **Only then** delete the 459 images and the `*_HOLE_IMAGES` maps

Reverse 3 and 4 and a user opens the app on the first tee with no imagery. Keep
`LOCAL_COURSE_CENTROIDS` in every case — it is a pure lat/lng table read by `courseGeometryService`
and `courseDataOrchestrator`, independent of the image maps.

Done 08-24 (`3d278d0e`): the 27 files referenced by nothing at all (all of `rancho-california` and
`webster-dudley`, whose maps are literally `{}`) were deleted. `assets/courses` is now 459 on disk /
459 required — a clean 1:1. That was repo weight, not binary weight; those were never bundled.

## 7. UNSWEPT CODE — **SWEPT 2026-08-31.** One live defect, one untested honesty rule

> **`holeGeometryDerivation` came out CLEAN**, which is worth saying plainly rather than padding.
> Every `Number.isFinite` guard is present, `found_green=false` genuinely returns null, the >800m
> sanity check on an estimated green holds, and `estimated: true` is force-stamped on write. Derived
> geometry lives under a PHYSICALLY SEPARATE storage key from real geometry, and both consumers
> prefer real (`getHoleGeometry(...) ?? getDerivedHoleGeometry(...)`). Its header's claims all held.
>
> **But the honesty rule it exists to serve had ZERO test coverage.** `courseDataOrchestrator` was
> untested, and it asserted the important part in a COMMENT — "which the confidence scorer below
> down-weights" — the exact shape of claim that has been false repeatedly here. It is TRUE, and now
> proven: `__tests__/regression/an-ai-guessed-green-is-never-surveyed-truth.test.ts` shows "High
> confidence" is **unreachable** with an estimated green by maximising every other input across 112
> combinations, not by sampling one case — while the same hole with real geometry still reaches 80+,
> so the cap is the estimate rather than a broken scorer. Break-tested red twice.
>
> ### The live defect: a server-side fix does not reach a client-side cache
>
> `locateNearbyCourses` caches the discovery list and serves it **when the live call fails — on a
> golf course, the one place it has to work.** Until 2026-08-31 the server matched courses by NAME
> only, so **every device that located before the fix is holding a poisoned list**: the course the
> player is standing on missing, and at Sawgrass a hotel offered as the nearest place to play.
>
> The cache has **no TTL by design** (courses do not move, and it is only read after a live call has
> already failed), so the version segment is the ONLY invalidation that exists. Left at `v1`, those
> devices would keep being handed the wrong club offline **indefinitely, long after the server was
> right**. Bumped to `course_locate_v2`. [[no-half-fixes-enforce-every-surface]]
>
> A guard now pins the version past the poisoned generation, asserts the cache is strictly a
> post-failure fallback **by code position** (a live answer returns before `readCache` is reached),
> and that an empty list is never cached — which would pin "no courses here" onto a real place. Its
> first draft asserted a sentence from a comment and the harness's own prose ratchet rejected it,
> correctly.
>
> **Still device-only (Tier C, Tim):** the actual download path — bytes on disk, resumability, and
> behaviour on a real flaky course network. Code-traced and invariant-checked; not field-verified.

## 8. ⚠️ SYSTEMIC — guards that pin defects. **SWEEP RUN 2026-08-31; 2 more found and fixed**

> **The sweep OPEN-ITEMS asked for has now been done deliberately rather than by accident.** Two
> classes were searched across all 230 negative assertions and every count threshold in the harness.
>
> **1. A guard that FORBADE its own fix — `api/course-locate` (see §13).** It asserted
> `!/[?&]type=golf_course/`, calling the legacy type filter "the phantom type". Fixing course
> discovery turned it RED. It was not merely failing to catch the bug: the wrong belief had been
> written down as an assertion, and an assertion reads as settled, which is why the bug sat for six
> days behind a Cloud Console change. Now asserts the relationship, break-tested red twice.
>
> **2. A count threshold that REQUIRED the duplication a fix would remove — `Voice: one voice at a
> time`.** It asserted `Speech.stop()` appears **at least three times** in voiceService. Consolidating
> those four one-line defensive calls into one owner — exactly the change this codebase makes
> constantly — would have failed it on a correct fix. It was also asserting the weaker half: what
> guarantees one voice is that device speech can never START, and `Speech.speak(` was only checked in
> ONE file when the guarantee must hold repo-wide. It now sweeps every shipped directory, count-free.
> **Proven both ways:** consolidating 4 copies → 1 now passes, and reintroducing device speech fails
> red and names the file.
>
> **Found alongside it — a header that lied in the direction that costs time.** `speakDeviceNotice`
> said it speaks "straight through the DEVICE voice (expo-speech)" and "audibly says 'no signal'",
> citing [[caddie-failsafe-no-walls]]. All false since 2026-08-22: `Speech.speak(` exists nowhere and
> `deviceSpeakFallback` is a breadcrumb-only no-op. Anyone trusting that comment would have concluded
> the offline path was broken and "fixed" a deliberate decision.
>
> **The real finding of the sweep is a pattern, not a count.** FOUR times in one session a guard was
> defeated by prose naming the very thing it forbids — the Places guard, the gender guard, §10's
> duration assertion, and this file's own `no-robot-voice` test (which broke the moment the lying
> header was corrected to say the token appears nowhere). Every one now strips comments first. That
> is a systematic weakness in how these guards are written, not four coincidences. **Any new guard
> that greps source MUST strip comments before matching.**
>
> **3. The magic-literal class — swept, and it found a MISSING guard rather than a bad one.**
> Number-matching is a dead end here: round numbers like `1000` and `1024` collide constantly across
> unrelated constants (48 "hits", all coincidence). The tell that works is SEMANTIC — a literal that
> must stay ordered against values owned in other files.
>
> `course-locate` has had a budget-ordering guard since 2026-08-25. **The analysis path — slower,
> hotter, and the one that already produced a shipped defect of exactly this kind — had none.** Its
> three numbers live in three files, one of them `vercel.json`:
>
> | value | where | meaning |
> |---|---|---|
> | `ORCHESTRATION_TOTAL_MS` 48s | `api/swing-analysis.ts` | what the server allows itself |
> | `maxDuration` 60s | `vercel.json` | when the platform kills it |
> | `REQUEST_TIMEOUT_MS` 63s | `services/poseDetection.ts` | how long the client waits |
>
> Correctly ordered today; nothing said so, and nothing would have noticed if one moved. Drop the
> client below the platform cap and the app aborts a request the server is still legitimately working
> on — the player is told the analysis failed when it was about to succeed, which is precisely how
> the old `130_000` literal behaved. The guard also pins `ANALYSIS_WORST_CASE_MS` as DERIVED so it
> can never revert to a copied number. Break-tested red both ways, and it PRINTS the three numbers.
>
> **§8 is now swept across all three classes.** The generalisable rule, stated once: **assert the
> RELATIONSHIP, never the literal, and never a headcount** — a guard that copies a number out of
> another file cannot tell a correct value from a stale one, and a guard that counts copies cannot
> tell a fix from a regression.

### Original note
**Six guards this week were green BECAUSE a bug was present**, and would have gone red on the fix:
the swing gate, the probe-abort, the persona handoff, "the mic tap re-arms", "earbud 25s
first try", and — 2026-08-25 — **the analysis hang guard**, which asserted the literal `130_000`
while that number had drifted BELOW the sum of the budgets it wraps, so the slowest run that could
still succeed was killed and shown as "Analysis timed out". Two of those were written specifically
to PROTECT the thing they were keeping broken.

The sixth is the clearest statement of the pattern yet: **a guard that asserts a magic number
copied out of another file cannot tell a correct value from a stale one.** It is now re-pointed at
a DERIVED constant (`ANALYSIS_WORST_CASE_MS`), which is the general fix — assert the relationship,
never the literal.

689 `check()` calls exist. The stale-guard sweep on 08-20 checked for *vacuous* guards (absence
assertions over missing files) and found the harness clean — it did NOT look for this class: guards
that assert a behaviour EXISTS where that behaviour is itself the defect. That sweep is worth doing
deliberately, because the pattern is now established rather than anecdotal.

## 9. COGNITIVE-LOAD AUDIT — agreed, not started
Ethos §6: count what a golfer must read and tap to get ONE decision. The rule AI most easily violates.

## 10. ANALYSIS LATENCY — **FIXED 2026-08-31.** The pose decode now runs inside the network wait

> **DONE.** The warm starts the identical pose extraction as soon as the POST is in flight, so the
> decode happens during the vision round-trip instead of after it. The review-phase effect finds
> `poseExtractCacheRef` already populated and computes biomech immediately.
>
> **The effect was NOT re-gated**, exactly as the plan below insisted — moving the analysis state
> machine is how a latency tweak becomes an outage. Nothing about state changed: the warm is fired
> with `void`, writes only the cache, and swallows every failure, so a slow or failed warm degrades
> to precisely today's serial behaviour.
>
> **The part the plan did not anticipate, and it would have made the fix cost MORE than it saved:**
> the cache key included `videoDurationMs`, which is measured TWICE by two different mechanisms —
> `probeDurationMs` on the warm path, and the review player's own `onLoad durationMillis`. Those
> disagree by milliseconds on the same file, so the warm and the read would have missed each other
> over measurement noise: decode, then decode again. Duration is now out of the key entirely — the
> clip URI already identifies the clip, and its duration is a property OF that clip, not an
> independent input. The two helpers live in `services/swing/poseExtractKey.ts` so the warm and the
> read cannot compute different keys. [[two-owners-is-the-root-cause]]
>
> Same class of trap on the second axis: the warm had to start AFTER `persistClipToDocuments`
> resolves, because the review reads the DURABLE uri — warming on `rawUri` is a guaranteed miss.
>
> Locked by `__tests__/regression/pose-warm-runs-inside-the-network-wait.test.ts` (7 tests) and a sim
> guard that pins what a unit test structurally cannot see: the ORDER (warm starts after the POST is
> created and before the verdict is awaited). Break-tested red three ways — warm moved after the
> await, warm keyed on rawUri, and duration put back into the key.

### The original 2026-08-25 write-up, kept because its reasoning held up

**Pose/biomech extraction does not overlap the vision call. It waits for all of it.**

I told Tim these ran concurrently, reasoning from the fact that they live in separate effects.
That was wrong, and re-checking is what caught it:

- `app/swinglab/smartmotion.tsx` — the biomech effect returns early unless `phase === 'review'`.
- `runAnalysis` sets `setVideoDurationMs(null)` at its very start, and that effect also requires
  `videoDurationMs != null`. So it is doubly blocked for the whole analysing phase.
- `phase` only becomes `'review'` in the `finally` AFTER `await analysisP` — the vision round-trip.

So the order is strictly: extract vision frames -> POST /api/swing-analysis (the long pole) ->
flip to review -> ONLY THEN decode frames again for pose. The entire network wait is dead time
during which the decoder sits idle and the body read has not started.

**Why this was not fixed in the same pass:** it moves the analysis state machine, and the request
was to work surgically with a release next week. It is a deliberate, testable change, not a
one-line tweak, and it deserves its own pass.

**The shape of the fix (additive, low risk):** do NOT re-gate the effect. Warm the same cache
instead — `poseExtractCacheRef` is already keyed by the real extraction inputs (clip / window /
selected swing / handedness, deliberately NOT angle), which is exactly why an angle-only re-run
reuses frames today. Kick off the identical extraction right after the POST is in flight so it
consumes idle decoder time; the review-phase effect then finds frames ready and computes biomech
immediately. Nothing changes state, so a failure degrades to today's behaviour.

**The one thing to verify first:** the warm needs a duration, and `runAnalysis` has just nulled it.
Source it from `probeDurationMs` (already serialized through the media chain) rather than
re-introducing a wait on the review player's `onLoad` — that dependency was itself a shipped
latency defect ("the tap was loading the video").

**Expected win:** the pose decode set, currently serial after the network, moves inside it.

A related consequence, already fixed: the analysing screen briefly advertised a "body ✓" tick that
is structurally impossible in that phase, because biomech cannot populate until review.


## 11. PROMPT CACHE — FIXED AND MEASURED 2026-08-25 (was silently costing ~8x)

The 08-24 fix was **verified with a false positive**: it measured `cacheRead 19188 / cacheWrite 0`
on a turn with NO ROUND ACTIVE, so the on-course branch rendered as nothing and changing the
yardage changed no bytes. It proved the fix in the one situation where the defect cannot occur.

Three things were still inside the 1-hour cached block, each alone enough to guarantee a miss:

1. ~5.2KB of per-shot round text — hole, par, PLAYING THEIR STROKE, how the round is going,
   DISTANCE REMAINING RIGHT NOW, the lie, where they are standing, risk posture, score, holes.
   Also a SECOND OWNER of facts the message already carried, which is how it stayed invisible.
2. The running CONVERSATION TRANSCRIPT, which changes every turn by definition.
3. BOTH knowledge bases, selected BY THE QUESTION — `retrieveKB(_message)` and
   `buildPersonaKBPromptBlock(persona, message)`. In a real round every question differs.

All now ride the message. Doctrine is cached; state and question-selected reference travel with the
turn. **The cache is all-or-nothing** — one moving value invalidates the whole block, so a partial
fix buys nothing, and nothing FAILS when it breaks: the bill just doubles.

**Measured on live production**, four FRESH different questions with the yardage and stroke moving:
identical `systemFp`, turn 1 writes 17,585, turns 2-4 read 17,585 with ZERO writes.
Behaviour re-verified after the move: yardageInsight, currentStroke, riskMode, roundStats, weather,
clubDistances all still INFLUENCE the answer, 1/1 each.

**Tools this left behind** (use these instead of reasoning about the cache):
- `npx tsx scripts/probe-cache-in-round.ts` — measures in the state where the defect lives.
  NEVER reuse a question: a repeat matches its own earlier entry inside the 1h TTL and reads as a
  hit that proves nothing. That contaminated one of the runs today before it was caught.
- `_debug.systemFp` (whole-prompt fingerprint) and `_debug.systemChunks` (per-2KB hashes) — two
  turns with different questions must match. Chunk hashes localise a buster to one window; that is
  how the persona KB was found at ~char 22,000 rather than by guessing.
- Sim `RATCHET: nothing new may be interpolated into the cached system prompt` — freezes the
  allowed set (57) with a DENY list of everything proven to move. The OLD guard was a name list
  that could only see the two blocks it was written for, and it sliced ~450 lines past the
  template's closing backtick, reasoning over code that is not in the prompt at all.

**Still inside the cached block and worth a later pass** (they did not move in these probes, so they
do not bust the cache today, but each is request-derived and could): `_screenContext`,
`_smartFinderContext`, `_unifiedContextBlock`, `_holeContextBlock`, `clubAdviceBlock`,
`is_proactive`, `responseMode`, `modeLabel`, `insightLines`.

## 12. TIER GATING — audited 2026-08-25 pre-submission

`services/featureAccess.ts` declares six gateable features and states the rule plainly: **"Full is
everything that spends inference on someone's behalf."** The mechanism is real — `canAccess` is
called at a dozen sites across the caddie tab, play, the tools menu, the cockpit, tank review and
the voice dispatcher. It is not an orphan.

**But two of the six keys were enforced at ZERO call sites, and they were the two biggest inference
spenders in the app:**

| key | before | now |
|---|---|---|
| `cage_mode` (SmartMotion / Cage analysis) | never checked | gated in `app/swinglab/smartmotion.tsx` |
| `voice_advanced` (the voice caddie) | never checked | **still open — see below** |

Throwing `SUBSCRIPTIONS_ENABLED` would have left both free forever. Nothing fails when a gate is
merely absent, which is exactly why this survived: the paid tier's two most expensive features,
given away silently.

`cage_mode` is gated at the SCREEN, not at each entry point — the hub card, Drills, Shot Shapes, the
`record_swing` voice tool and the cage all arrive there, and an allowlist of doors would have to be
right five times. Inert today (`SUBSCRIPTIONS_ENABLED = false`).

### `voice_advanced` — CLOSED 2026-08-25

All five caddie payload senders now pass through one owner, `featureAccess.mayTalkToCaddie()`:
`caddieBrain`, `conversationalBrain`, `presenceCaddie`, `listeningSession` (the earbud speculative
call) and `sceneReadService`. The ratchet has **no baselined exceptions left**.

Done as a shared gate rather than the full consolidation on purpose. Merging five senders into one
is the right end state and is still open work — but it is a large change to the hottest path in the
app during submission week, and gating SOME of them would have been worse than gating none: a Lite
player who reaches the caddie through one mic and not another has a bug, not a paywall, and would
blame the caddie rather than billing. A guard now fails if any sender stops asking.

It degrades rather than going dark — a blocked turn raises the paywall instead of returning silence,
because a caddie that simply stops answering reads as broken. Inert today
(`SUBSCRIPTIONS_ENABLED = false`).

### Original note, kept for the reasoning

Not a one-line fix. **Five modules build caddie payloads** — `caddieBrain` ("ONE CALL TO THE
CADDIE"), `conversationalBrain` ("EVERY MIC, ONE CADDIE"), `presenceCaddie`, `listeningSession`,
`sceneReadService`. Gating some but not all would let a Lite player reach the caddie through one mic
and not another, which is worse than an honest gap and impossible to explain to a user. The senders
need consolidating behind one call first — the tail of the 08-23 "one caddie, one payload" work.

Baselined in the sim (`RATCHET: every gateable feature is actually enforced somewhere`). The
baseline cannot rot: fixing `voice_advanced` forces deleting its line from the guard.

### None of this can ship as paid in 1.0 regardless

No billing SDK exists. App Store guideline 3.1.1 requires Apple IAP for in-app digital
subscriptions; Stripe in-app is a rejection. So 1.0 ships free either way, and this work is about
making the switch behave as documented on the day it is thrown — not about launch revenue.

**Guard note:** the first version of that ratchet passed with the real `canAccess` call deleted,
because the key was still named in the `triggerPaywall` line beside it. It now requires the key to
reach an actual gate function (`canAccess` / `navOrPaywall` / `gatedOpen`), and was break-tested red.

## 13. TPC SAWGRASS — **FIXED AND VERIFIED LIVE 2026-08-31.** Root cause was OURS, not Google's

> **RESOLVED.** `TPC Sawgrass - Dye's Valley Course` (67m) and `TPC Sawgrass` (121m) now come back
> first in production. Verified live at Pebble Beach, Torrey Pines and Streamsong too — each resolves
> to the actual nearest course.
>
> **Everything below this box diagnosed the wrong cause.** It blamed Google's Places coverage and
> parked the fix behind a Google Cloud Console change nobody here could make. The console setting is
> real and still worth fixing — it restores the faster, properly-typed primary path — but **discovery
> never depended on it.**
>
> **What was actually wrong:** `isGolfPlace` was discarding the course. Google files the Stadium
> Course as `restaurant,food,lodging` (the clubhouse restaurant is the business record) and the name
> contains no word the name-regex knew. The rows contained TPC Sawgrass on every single query, the
> whole time.
>
> **How it was found:** by echoing what the endpoint threw away (`debug: true`), instead of reasoning
> about it. Six days of reasoning got this wrong twice — once blaming Google, once (mine, 2026-08-31)
> asserting `golf_course` is a legacy place type. It is not; legacy silently IGNORES an unknown
> `type` and returns an unfiltered sweep, and that accident is the only reason the evidence appeared.
> [[missing-log-entry-is-the-evidence]] [[my-measurement-is-the-least-reliable-part]]
>
> **A second defect fell out of it:** `Sawgrass Marriott Golf Resort & Spa` was being returned as the
> NEAREST course at 1.1km, ahead of every real club. A hospitality-only record must now name itself a
> course. Handing a player a hotel to play is the same defect class as handing them the wrong club.
>
> Locked by `__tests__/regression/tpc-sawgrass-is-a-golf-course.test.ts`, built from the 26 REAL rows
> captured in production with types verbatim — because reasoning is what was wrong both times.

### Original 2026-08-25 diagnosis, kept because it is instructive about how it misled

Checking marquee courses for bundling turned up a defect that affects real players, not just the
bundle: **`api/course-locate` does not return TPC Sawgrass.** Two seeds placed directly on the
Stadium Course returned only *Sawgrass Country Club* — a DIFFERENT club 2.4-2.5km away — plus Marsh
Landing and Windsor Parke.

So a player standing on the most famous golf property in Florida is offered the wrong club, and
would play a round with another course's card and yardages. The course API knows it perfectly well
(`mkdn7b4e`, Stadium Course, par 72, 18 holes) — it is the Places lookup that misses it.

### ROOT CAUSE FOUND, and it is a console toggle — not a code fix

Every live query returns `source: places_legacy`. The Places API (New) path — the documented
PRIMARY, the only one where `includedTypes: ['golf_course']` actually binds — fails on **every**
call, and has been silently falling back for as long as anyone can tell. Production now reports why:

```
http_403: Requests to this API places.googleapis.com method
          google.maps.places.v1.Places.SearchNearby are blocked.
```

**CORRECTION 2026-08-25 — the API IS enabled. Tim confirmed it, and Google's wording agrees.**

Two different 403s exist and they mean different things:
- a *disabled* API returns "…has not been used in project X before or it is disabled"
- **"Requests to this API … are blocked" is the API-KEY RESTRICTION message**

Corroborating evidence: **legacy Places works on the same key.** Legacy is
`places-backend.googleapis.com`; New is `places.googleapis.com`. Same key, one allowed, one not.

**➜ ACTION: it is the KEY's API-restrictions list, not the project.** In Google Cloud Console →
Credentials → the key behind `GOOGLE_API_KEY` → *API restrictions* → add **"Places API (New)"** to
the allowed list (it is a separate entry from "Places API"). If the key is instead set to "Don't
restrict key", check the *Application* restrictions — an HTTP-referrer restriction blocks
server-side calls from Vercel outright.

The response now names the offending key (`primary_failure` carries the key's name + short
fingerprint, never the secret), so if more than one project is configured it says which one to fix.
No deploy needed after the console change — the code already prefers the New API.

**Why it matters more than one course.** Legacy Nearby Search filters by the KEYWORD "golf course",
so any course whose *name* lacks the word is invisible to discovery. TPC Sawgrass is the example
that surfaced it, but the class is "every course not named '… Golf Course'". The failure mode is
the worst kind: not "no course found", but a confidently wrong one — the player is handed another
club's card and yardages, and nothing looks broken.

**How it stayed hidden.** The 403 WAS logged, server-side, where no caller could see it. The
response now echoes `primary_failure` whenever it served from the fallback, so a permanently
degraded path can never again look like a healthy one.

Bundling Torrey Pines / Pebble / Streamsong does not depend on this.

## 14. 2.0 IDEA — "circle the shoulders": a focused second analysis pass

Tim, 2026-08-26 (explicitly 2.0, asked while under build hold): after the first analysis finishes
and playback is up, the player says *"circle the grip"* / *"circle my hands"* / *"circle the
shoulders"* / *"circle the club"*, and the analysis re-runs focused on that part.

**Feasibility: high, and most of the substrate already exists.** This is assembly, not invention.

### What can be circled today, from signals already computed

| ask | source | status |
|---|---|---|
| shoulders | `left_shoulder` / `right_shoulder` landmarks | ✅ already drive tilt, turn, sway |
| hips | `left_hip` / `right_hip` | ✅ already drive weight shift + sequencing |
| wrists / hands (as JOINTS) | `left_wrist` / `right_wrist` | ✅ position and path |
| elbows, knees | landmarks present | ✅ |
| the club | the clubhead trace (shaft-anchored) | ✅ — clubhead-or-nothing, never a wrist fallback |

### The one that must NOT be faked

**Grip cannot be read at swing speed.** The hands are small, occluded by the club and unresolvable
in 2D — this is already a settled, tested position in `services/swing/drillFocusRead`, which
refuses it in those words and points at Setup Check, which reads grip properly from a STILL address
photo. So "circle the grip" should route to a Setup Check capture, not draw a confident circle
around three unreliable pixels. Getting that one right is what makes the other five trustworthy.

### Why it is cheaper than it looks

The frame cache shipped 2026-08-25 means a second pass over the SAME clip reuses decoded frames
instead of re-decoding them, and decodes are serialized app-wide. A focused re-ask is therefore
mostly free — which is precisely the cost that would otherwise make "ask again about a different
part" feel slow enough that nobody would use it twice.

### Shape it should take

1. Primary analysis completes and stops (unchanged).
2. The player asks by voice; the intent carries a body-part parameter.
3. A focused pass reads the CACHED pose frames for that part across address → top → impact, and
   draws the overlay on landmarks that already exist.
4. The caddie speaks only about that part, from measurement — and says plainly when a part is not
   resolvable rather than narrating a guess.

Not started. Recorded so the substrate that makes it cheap is not accidentally dismantled.

## §15 — useVoiceCaddie still hand-declares 57 keys the shared union already builds (2026-08-26)

`services/caddieRequestBody` is the one payload. `hooks/useVoiceCaddie` spreads it in and then
follows with a literal of **58 keys** — and the literal WINS. 57 of those shadow a key the builder
already produces; only `forceTier` (Local Mode tier pin) is genuinely the caller's.

Three were removed on 08-26 because they were actively wrong or exactly duplicated:
`currentYardage` (the builder RESOLVES stated > GPS > card; the hook sent the raw card number, and
api/kevin's headline distance line is built from it), `yardageInsight`, `unified_context_block`.
A jest guard now forbids re-declaring any key on that list.

**The rest is per-key work, not a blanket delete** — four are NOT safe to drop:

| key | why it must not just be deleted |
|---|---|
| `courseContext` | builder has `courseContext: null` — a documented placeholder for a caller-supplied record |
| `penaltyContext` | builder reads `extras.overrides?.penaltyContext`; the hook does not pass extras |
| `smartVisionContext` | builder reads `extras.smartVisionContext`; same |
| `coachKnowledgeContext` | keyed off the CURRENT MESSAGE — the builder would need the message threaded in |

The remaining ~53 are the same store read twice (17 imperative `getState()` reads, ~36 reactive
`useShallow` selectors) or a pure call the builder already makes (`bagDistances()`,
`getActiveCaddie()`, `screenContextForPrompt()`, `buildFullPracticeContext()`, `new Date().getHours()`).
Each needs a one-line confirmation that the builder's derivation is identical, then deletion.

**Order:** thread the four caller-owned values through `CaddieRequestExtras` FIRST, so the builder
is complete; then delete the literal wholesale and let the guard hold the line. Doing it in the
other order drops real data on the primary mic surface.

**Why it matters beyond tidiness:** every regression test for the payload exercises the BUILDER.
While a call site can override, a green builder test proves nothing about what the caddie was
actually sent — which is how the yardage defect survived its own fix for two days.

## §16 — The shot map's lateral axis has exactly one source (2026-08-26)

Tim: *"if we can find one point of direction for a shot and the acoustic signal and the club picked,
we should be able to kind of almost populate that shot map."*

Two of the three work. The third is the wrong axis.

| Axis | Signal | State |
|---|---|---|
| **Downrange (Y)** | club → learned carry, scaled by effort | ✅ wired (`carryEstimate.fullCarryYards`) |
| **Lateral (X)** | vision ball-trace (DTL) | ⚠️ the ONLY source; needs DTL + ball box + departure point |
| **Lateral (X)** | acoustic strike | ❌ **cannot** — see below |
| **Lateral (X)** | `CageShot.direction` | ⚠️ field exists, **never written** |

**The acoustic read cannot tell left from right.** `acousticsAnalyzer` resolves `strike_location` to
`flush` / `fat` / `thin` / `unknown` only. `heel` and `toe` are in the type and are never assigned —
the code says why, in place: *"asymmetric / mid-range → unknown (better than guessing heel/toe
without lateral mic data)."* One microphone gives the DEPTH axis (turf-first vs ball-first), not the
lateral one. Using it for left/right would be exactly the fabrication the shot map's header comment
forbids.

**`CageShot.direction` is the real opportunity, and it is one wire from working.** The field is on
the type, initialised `null` at both creation sites, and `cageStore.updateShotTags` — which sets it —
**has zero callers.** Give it a writer and the map gets an honest second lateral source:

1. voice — `logShotHandler` already parses direction phrases ("that one went right"); route it to the
   active cage session's last shot, or
2. a three-tap left / straight / right chip in the review bar.

Label the dot by source (`measured` vs `stated`), the way the map already labels `est`.

**And the trace itself gets better on the native build.** The lateral read comes from ball departure
over the first frames after impact, so it is frame-rate bound — see §17. On the expo-camera path
(~30fps, today's default) there are very few frames in that window, which is a large part of why the
map is empty so often.

## §17 — 120fps is built and blocked on the native build (2026-08-26)

`react-native-vision-camera@4.7.3` is in package.json and registered in app.json plugins.
`SwingVisionCamera` requests `PREFERRED_CAPTURE_FPS = 120` and takes max resolution at that rate; the
owner toggle lives on native-modules-debug. **This needs the build packet, not new work** — the
shipped TestFlight binary cannot load the native module, so no OTA can enable it.

Done 2026-08-26: `capturedFps` records what the device actually resolved, and `MIN_TRACE_FPS` (an
orphan since 06-13) now gates the drawn trace. Gated on a known fps only, so the currently-shipping
expo path is untouched.

**On arrival, in order:** flip the engine on the debug screen → confirm `capturedFps` reads 120 on
the Pro Max → re-shoot a DTL swing and check the trace and the shot map populate → only then judge
whether §16's `direction` wire is still needed.

## §18 — PARKED: ghost match vs a synthetic opponent (2026-08-26)

Tim's idea (play a ghost match against an archetype opponent — "college player off +1", "tour pro")
and his week-one idea ("how would I play Pebble Beach, from my tendencies") are the same engine.

**The week-one one was never built** — no projection engine exists anywhere in code or history.
**The ghost half already works and is proven against a synthetic record.** Full write-up, including
the four handicap functions that already do the hard arithmetic, in `docs/FUTURE-GHOST-MATCH.md`.

Parked deliberately: post-freeze, post-launch.

## §19 — PARKED: 3.0 immersion control (2026-08-26)

*"Hey Caddie, show me my shoulder rotation"* → auto-zoom to the region, slow-mo it, step frames.
Full write-up: `docs/FUTURE-3.0-IMMERSION-CONTROL.md`.

Worth knowing before it is scheduled: **the computer vision is largely already there** — 33 pose
landmarks per frame on-device, shoulder/hip turn already derived, playback rate and seek already
built, and a voice command bus into the screen. The new work is a body-part→region map, a zoom that
feels good, and a CONTINUOUS command grammar (every voice surface today is one-shot).

Build §14 first (circle a region, re-read it — tap-driven): it forces the region map into existence
against a UI that cannot mis-hear you. Depends on §17's 120fps build — "forward three steps" means
nothing at 30fps.

## §20 — **DECIDED 2026-08-31: leave it deleted.** (found 2026-08-27)

> Tim's call. Restoring the overlap means firing a brain call BEFORE knowing whether a deterministic
> handler claims the turn, so every "start my round" / "log a bogey" / "open SmartFinder" pays for an
> answer it throws away. The 8× prompt-cache cut (08-25) was a far larger latency and cost move than
> this ever was, and [[speed-is-the-wow]] is already served by it. **Not revisiting without new
> evidence** — if it ever comes back, `voiceHitRateStore` already records the handler-vs-cloud split
> and that number is the thing to look at first.

Deleted today: a speculative `/api/kevin` fired in parallel with the classifier on every
precheck-miss, so the brain's network + LLM time overlapped the classify (~0.7-1s per conversational
turn). It was written 06-16 and **stopped working on 07-01**, when the mic convergence put
`conversationalBrainTurn` in front of its only consumer behind a gate that is unconditionally true.
From then on it was fired and discarded 100% of the time — a full union payload, a Lambda
invocation and model tokens, per conversational earbud turn, for eight weeks.

Removing it costs nothing that was actually working. **Restoring the overlap is a real product
choice with a real bill attached**, which is why it is here and not done:

- The classifier decides IF a deterministic handler runs; the brain takes the raw utterance. To
  overlap them you must fire the brain BEFORE you know whether a handler will claim the turn.
- So every handler turn ("start my round", "log a bogey", "open SmartFinder") pays for a brain
  answer it throws away. That is the trade the original design accepted silently.
- It also needs `askCaddie` to defer its history write (`appendPipecatTurn`) until the answer is
  actually used, or a discarded speculative reply pollutes the shared conversation with something
  the player never heard. ~6 lines plus an explicit commit at the consumer — small, but it must be
  done or the amnesia fix goes backwards in the other direction.

**Rough shape of the bill:** one extra brain call per conversational turn that routes to a handler.
The share of turns that do is the number to look at before deciding; `voiceHitRateStore` already
records precheck vs cloud routing and could answer it.

Worth knowing: **the 8× cache cut (08-25) was a bigger latency + cost move than this ever was**, and
`speed-is-the-wow` is still the standing rule. If the answer is "buy it back", do it after launch
with the history fix, not before.

## §21 — **DECIDED 2026-08-31: both stay frozen until after launch.** (found 2026-08-27)

> Tim's call. `classifyLayout` is the ONE responsive classifier written to end per-screen breakpoint
> drift, and wiring it touches sizing on every screen — inside the 07-29 whole-app layout freeze he
> signed off as "BEAUTIFUL". `deriveSwingAnchors` is plausibly wanted by the 3.0 work. Neither costs
> anything frozen, and `ISLAND_BASELINE` already stops anything NEW joining them. **Not deleted** —
> deleting working, tested capability is the other wrong answer.

Found by the new wire-integrity marshal, which sees them where the orphan sweep structurally cannot
(that one counts any MENTION of a symbol as a reference, so a guard naming an export makes it look
wired — a guard is not a caller).

- **`hooks/useLayout.ts` — `classifyLayout`.** Written 07-26 as the ONE responsive classifier,
  because "every screen used its own W/H breakpoints → drift + per-size bugs". Six sim guards certify
  it against iPhone, Fold-Z folded, Pro Max and iPad geometry and all pass. **No screen imports it**,
  so the drift it was written to end was never ended. Wiring it means touching sizing on every
  screen, which is inside the whole-app layout freeze (07-29, "BEAUTIFUL") — hence Tim's call.
- **`services/swing/poseMotion.ts` — `deriveSwingAnchors`.** 07-21 "pose-first foundation": finds
  top-of-backswing and impact from the hand-velocity signal, with a synthetic-swing test that really
  exercises the maths. Only the guard calls it. Plausibly wanted by §19.

Neither deleted: deleting working, tested capability the day before a ship date is the other wrong
answer. Both are frozen in `ISLAND_BASELINE`, so nothing NEW can join them quietly.

**`components/caddie/CockpitCaddieScreen.tsx` is the third and is PARKED, not stray** — Tim 08-27:
keep it hidden, may come back.

## §22 — CLOSED 2026-08-29: the setting that could not vary is deleted (found 2026-08-28)

> **RESOLVED — verified in code 2026-08-31.** Everything below was written while it was open and is
> kept for the reasoning. What actually happened: `voiceOrchestrator` and all three dead arms were
> deleted on 2026-08-29, and the sim LOCK inverted — its allowlist is now EMPTY, so the name may not
> appear in shipped code at all. Re-verified today: no field, no setter, no branch anywhere.
>
> **The strategy engine was NOT collateral damage.** `smartAnalysisEngine.analyze({kind:
> 'shot_strategy'})` has two live callers in `app/(tabs)/caddie.tsx` (1390, 1457) — the proactive
> stop-detection read. Only the dead route through `queryStatusHandler` went. (Two further callers
> live in `CockpitCaddieScreen.tsx`, which is itself an island — parked, not stray.)
>
> **What is still open is the "Related" paragraph at the end**, and only that. See §22b.

Found by adversarial audit 2 ("is anything built but unreachable?").

**`voiceOrchestrator` looks like a user setting and is a CONSTANT.** The v15 migration force-sets
`'pipecat'` for every existing install, the store defaults to it for every new one, and
`setVoiceOrchestrator` has **no caller in any screen, service or handler**. It can only ever hold one
value. Three modules still branch on it, and each keeps a legacy alternative alive that cannot run:

1. **`services/listeningSession.ts`** — FIXED 08-27. The always-true branch aborted a speculative
   brain call before anything could read it: eight weeks of a full billed `/api/kevin` request
   discarded on every conversational earbud turn.
2. **`services/intents/queryStatusHandler.ts:290`** — **NOT fixed, and the biggest one.** The pipecat
   branch returns `route_to_brain: true` *unconditionally*, so the entire deterministic
   shot-strategy engine below it is **unreachable** — while the comment above it says "the engine
   stays the read for kevin-mode + non-voice callers". There is no kevin-mode any more. That is a
   substantial block of club-strategy code that cannot execute, and its own comment misdescribes it.
3. **`app/(tabs)/caddie.tsx:2182`** — `processTranscriptOverride: voiceOrchestrator === 'pipecat' ?
   pipecatVoice.processTurn : undefined`. The `undefined` arm (legacy in-hook processing) can never
   be chosen.

**Not deleted, deliberately.** #2 is a real behavioural surface and this is the day before a ship
date; ripping it out unverified is how a "cleanup" becomes an outage. A sim LOCK now freezes the
three and fails on a fourth, so the class cannot grow while the decision waits.

**The decision:** either delete the setting and the three dead arms (a genuine simplification —
`brain-consolidation-two-to-one` says this is the payoff of the shim), or restore a real toggle if
the legacy path is still wanted for anything. Doing neither leaves three pieces of code that read as
live choices and are not.

## §24 — TIM'S CALL: course-geometry abandons up to 40s of work the server is still doing (2026-08-31)

Found sweeping every client timeout after Tim's Menifee field report. **`course-locate` was the
clear-cut instance and is FIXED** (client 9s → 20s; it was quitting 6s before the platform, with only
2s of margin over the server's own 7s budget — a cold Lambda alone exceeded it). A sim guard was
asserting the INVERTED ordering and pinning it; corrected, break-tested.

**`course-geometry` is the same shape but is a genuine trade-off, so it is not changed:**

| | |
|---|---|
| server budget | **70s** (`OVERPASS_TOTAL_BUDGET_MS`) |
| platform ceiling | 90s |
| client gives up | **30s** |

So up to 40 seconds of legitimate server work is abandoned. This is the "green screen" symptom — for
a course with nothing cached the abort returns `null` and the hole view has nothing to draw.

**Why it was NOT simply fixed either way.** The obvious move — cut the server budget to fit inside
30s — is wrong: the header records measured live builds where **slow-but-successful runs took ~80s**.
Cutting it would discard real successes and cause MORE green screens. The other move — raise the
client past 70s — means a player can wait over a minute before the fallback appears.

**The decision is which failure you prefer**, and it is a product call:
- **(a) Raise the client to ~75s.** New courses map correctly far more often; a bundled course whose
  fetch hangs waits a long time before showing its bundled fallback.
- **(b) Render the fallback IMMEDIATELY and upgrade when the fetch lands.** Strictly the best UX and
  the real answer, but it is a change to how the hole view loads, not a constant — real work.
- **(c) Leave it.** Bundled courses are unaffected; only new/discovered courses on a slow Overpass
  see it.

**(b) is the right end state.** Recommend it post-launch rather than during submission week.

## §23 — SmartFinder tilt cap: **CLOSED 2026-08-31. The ray math already existed; the CANDIDATES were the gap**

> Tim's call: ray-intersect hole geometry. Building it turned up that **it was already built** —
> `services/aimedFeature.featureOnAimLine` has cast the aim ray and measured lateral offset since
> 2026-08-24, correctly. I started writing a second one and caught it against the existing owner.
>
> **The real defect was its INPUT.** The candidate list was built inline in `app/smartfinder.tsx` and
> held only the green, its front, its back, and the coarse `hazards` array. `geometry.bunkers` and
> `geometry.water_hazards` — already traced as polygons, already drawn by the map overlay — were
> **never offered to the aim line.** Point the reticle at the bunker you are trying to carry and the
> screen said nothing was there, which reads exactly like a broken rangefinder. That is what was
> reported three times.
>
> Now `services/aimCandidates.buildAimCandidates()` — one owner, testable, deduped against the coarse
> list, preferring the traced green outline over a coarser centre point. The tilt cap itself is
> untouched because it is physics, not a gate.
>
> **Nearest-wins was NOT adopted**, deliberately: `aimedFeature` selects by smallest lateral offset,
> and its header explains why — nearest-wins would let a bunker permanently shadow the green behind
> it. My draft had that backwards, which is the second reason not to have shipped a second owner.
>
> `REFERENCE_HEIGHTS` stays unwired and is now a deliberate PARK, not an oversight: it needs the
> player to tap a reference every time, which breaks [[hands-free-zero-setup-is-the-product]].

## §22b + §22c — **BOTH CLOSED 2026-08-31.** §22 is finished end to end

**§22b — the three dead setters are deleted.** All 49 settingsStore setters were swept for callers
outside the store; exactly three had none, and they were the three §22 named.

- `pipecatServerUrl` + `setPipecatServerUrl` — **deleted.** Zero readers; its last mention was a
  comment narrating the WebSocket scaffold removed 2026-08-23. Persisted copies fall out of storage
  on the next write, exactly as `voiceOrchestrator` did.
- `cockpitMode` + `setCockpitMode` — **deleted.** The STORE field had zero readers:
  `app/(tabs)/caddie.tsx` declares its own local `const cockpitMode = false`, a different binding.
  Reviving the parked cockpit screen means adding a setting then, not keeping a dead one now.
- `setVoiceGender` — **deleted.** `voiceGender` is now a derived mirror with no setter at all (§22c).

**The guard now forbids the SHAPE, not the instance.** `LOCK: no persisted setting may have a setter
nothing calls` sweeps every settingsStore setter for a real caller, with comments stripped so a
mention is not mistaken for a call. Baseline **EMPTY** and swept. Break-tested red by adding an
uncalled setter — it names the offender. [[run-the-second-pass-yourself]]

## §22c — CLOSED: `voiceGender` has ONE owner

Three writers answered "what gender is the caddie" and disagreed for the custom caddie. There is now
`services/caddieGender.ts :: genderForPersona()`, and all three call it:
`settingsStore.setCaddiePersonality`, `voiceService.speak`, and **both** branches of the
`app/_layout.tsx` boot reconcile — including the `custom → kevin` branch that used to set the persona
without the gender, leaving Kevin carrying the custom caddie's.

**The duplicate CONTROL is gone too, which is where this actually started.** `customCaddieGender` was
a male/female picker labelled "Male · Kevin" / "Female · Serena" — precisely what
`customCaddieBasePersona` has done since 2026-07-30, with Harry as a third option. Two controls owned
one question and were free to disagree. The field, its setter and its picker are deleted;
**playerProfile migration v3** folds an existing female pick into base persona `serena`, so nobody's
caddie changes voice on the update, and an explicit base persona is never overridden.

Why base persona wins: `voiceService` always sends an explicit `voice` for custom, and `api/voice`
resolves `clientVoice ?? personaVoice ?? gender` — so the gender argument never reached the custom
caddie's cloud voice at all. Anything else would let the pronoun and the voice disagree by
construction.

**Trap hit on the way, worth recording:** the first `caddieGender.ts` re-typed
`['kevin','serena','harry']` to validate the store value, and a guard rejected it — that would have
been the **sixth** list owning a persona question, in the same week five lists owning one question
was the bug being fixed. The type is borrowed from the store now and no list is restated.

Locked by `__tests__/regression/one-owner-of-caddie-gender.test.ts` (13 tests, including the
migration) and three re-pointed sim guards that had been asserting the old inline ladder.

## §22c — NEW, needs Tim: `voiceGender` has three owners that disagree for the CUSTOM caddie (2026-08-31)

Found while verifying §22b's claim that "voiceGender is fine — it is DERIVED from the persona now
(one owner)". It is derived, but not from one place. Three writers each compute it differently, and
for `caddiePersonality === 'custom'` they disagree:

| writer | what it says a custom caddie is |
|---|---|
| `settingsStore.setCaddiePersonality` | `p === 'serena' ? 'female' : 'male'` → **always `male`** |
| `voiceService.speak` (`effectiveGender`) | from `customCaddieBasePersona` → **`female` if the base is Serena** |
| `app/_layout.tsx:322` boot reconcile | from `customCaddieGender` → **whatever the user picked** |

`customCaddieGender` and `customCaddieBasePersona` are two independent user-set fields, so all three
can differ at once. Consequences, all verified:

1. **Activating a female custom caddie sets `voiceGender` to `male`.** `applyCustomCaddie` calls
   `setCaddiePersonality('custom')`, which cannot see the base persona. The boot reconcile corrects
   it — so the caddie's gender silently CHANGES at the next app restart.
2. **The cloud voice and the device-TTS voice can disagree.** `speak()` overrides with the
   persona-derived `effectiveGender` (correct), but every `speakDeviceNotice(...)` / offline-clip
   call passes `settings.voiceGender` (stale). Same caddie, two genders depending on the network.
   [[feels-like-a-real-caddie]] — a robotic moment is a defect, and so is a gender-swapping one.
3. **UI pronouns follow the wrong one.** `components/VocabBanner.tsx:38` and `app/tutorials.tsx:131`
   both render `he`/`she` straight from `voiceGender`.
4. **`app/_layout.tsx:328` leaks a stale gender.** The `custom → kevin` fallback branch (fired when
   the persona is `custom` but the custom caddie is off or its name was cleared) sets
   `caddiePersonality` and `caddieAssignments` but **not** `voiceGender` — so Kevin inherits the
   custom caddie's gender. Its sibling branch four lines above does set it.

**Not touched: this is the voice path** ([[voice-path-change-freeze]]), and #2 changes what the
player hears. The fix is one owner — a `genderForPersona(persona)` resolver that reads
`customCaddieBasePersona`, called by all three writers, with `voiceGender` becoming a pure mirror.
Needs Tim's per-item OK.
