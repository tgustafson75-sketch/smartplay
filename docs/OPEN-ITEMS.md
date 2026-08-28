# Open items — non-business

Snapshot 2026-08-21, end of the first-turn/voice session. Billing/Stripe/IAP deliberately excluded —
Tim owns that.

---

## 1. BLOCKED ON A DEVICE TEST — highest value, costs one tap

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

## 2. PRE-LAUNCH — caddie emotional art (I cannot produce this)
`docs/TODO-CADDIE-EMOTIONAL-ART.md`. 22 mood slots exist. Serena has **4 distinct images**, one
portrait covering 15 slots; Kevin routes 15 slots to a single image. On the two caddies testers
actually use, the avatar barely moves. Filenames + prompt spec are written so wiring is a one-line
edit per slot. **Assets are OTA-safe.**

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

## 7. UNSWEPT CODE
`holeGeometryDerivation` and the download/orchestrator path — both network-bound, so device-only
verification. Everything else on the critical path has had an invariant sweep.

## 8. ⚠️ SYSTEMIC — guards that pin defects
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

## 10. ANALYSIS LATENCY — the remaining lever (found 2026-08-25, NOT yet fixed)

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

## 13. TPC SAWGRASS IS INVISIBLE TO COURSE DISCOVERY (found 2026-08-25)

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

## §20 — TIM'S CALL: the earbud's classifier/brain overlap is gone. Buy it back? (2026-08-27)

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

## §21 — TIM'S CALL: two built-and-tested capabilities nothing imports (2026-08-27)

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
