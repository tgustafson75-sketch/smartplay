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
**Five guards this week were green BECAUSE a bug was present**, and would have gone red on the fix:
the swing gate, the probe-abort, the persona handoff, "the mic tap re-arms", and "earbud 25s
first try". Two of those were written specifically to PROTECT the thing they were keeping broken.

689 `check()` calls exist. The stale-guard sweep on 08-20 checked for *vacuous* guards (absence
assertions over missing files) and found the harness clean — it did NOT look for this class: guards
that assert a behaviour EXISTS where that behaviour is itself the defect. That sweep is worth doing
deliberately, because the pattern is now established rather than anecdotal.

## 9. COGNITIVE-LOAD AUDIT — agreed, not started
Ethos §6: count what a golfer must read and tap to get ONE decision. The rule AI most easily violates.
