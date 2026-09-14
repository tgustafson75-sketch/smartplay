# Unguarded surfaces — inventory and triage (2026-09-13)

Tim: *"Mental must be audited. Check for any other unaudited surfaces and functions."*

The mental leg is audited and fixed (see the commit and
`__tests__/regression/the-psychologist-had-no-surface.test.ts`). This file is the **rest** of that
question, measured rather than estimated, so it can be worked down instead of re-discovered.

## Method

A file counts as *guarded* if any file under `__tests__/` or `scripts/simulations/` names it or its
basename. That is a generous definition — being named is not the same as being covered — so these
numbers are a **floor** on the gap, not a ceiling.

    154 files, 22,939 lines, named by no test and no sim guard

## Triage by risk

| Bucket | Files | Lines | Assessment |
|---|---|---|---|
| **LOGIC service/store** | 91 | 9,323 | The real gap. These decide things. |
| Presentational component | 39 | 6,619 | Low risk — layout and copy, and every player-facing string is now covered by the i18n guard. |
| KB content (curated data) | 11 | 2,913 | Exercised indirectly: `the-psychologist-had-no-surface.test.ts` performs real retrieval against them, which is what actually matters for content. |
| Screen | 6 | 2,183 | Medium. Worth a reachability check each, not unit tests. |
| Owner / debug surface | 7 | 1,901 | Low — owner-gated, excluded from i18n by the same predicate the codemod uses. |

Note the orphan lock already covers "has no callers" for `services/`, so nothing in the logic bucket is
*unwired* in that sense. The gap is **untested decisions**, plus the second half of the lens.

## Worked down on 2026-09-13 (after this file was written)

- **`services/putting/greenHeat.ts`** — the headline finding below is FIXED. It reaches the caddie as
  `puttingRecordBlock`, the putting floor has one owner, and what feeds the model has one owner
  (`greenHeatInput`). Guarded by `the-green-had-three-legs.test.ts`.
- **All three `services/intents/*Handler.ts`** named below as the place to start are done, and two of
  them had real defects:
  - `handicapQueryHandler` passed a HOLE NUMBER where WHS wants a STROKE INDEX, and stated the wrong
    max-for-handicap as fact. golfcourseapi supplies the scorecard's HCP column and `normalizeHole`
    always captured it — the mapping into `CourseHole` dropped it. Now carried, used, and honest when
    genuinely absent.
  - `confirmPositionHandler` read the hole number as the yardage: "I'm 140 out on hole 12" parsed as
    12, so the caddie announced GPS drift, force-refreshed, and clubbed a 140-yard shot as 12. Three of
    seven natural phrasings were wrong, on holes 10-18.
  - `openExternalHandler` had NO defect — query encoding, service aliases and both failure paths were
    already right. Covered anyway, since it is player-sayable and had nothing looking at it.
- **`services/caddieRewards`** — two defects, both fixed. The spoken drive celebration had NO upper
  bound, so the 500y+ corrupt capture the rest of the app rejects (`MAX_REAL_DRIVE`, `setLongestDrive`,
  `shotTracking`) made the caddie say "Hammered. That one's going." about a number nobody hit —
  celebrating a fabricated measurement on the one occasion it volunteers an opinion unprompted. And a
  variant line restated the threshold in prose ("Two-fifty plus." against `REWARD_DRIVE_YARDS = 250`),
  so tuning the constant would have made the caddie state a wrong number. Guarded by
  `the-caddie-never-celebrates-a-glitch.test.ts`.
- **Three TRIAGE/DUPE orphans resolved and deleted with evidence** (not wired): `data/courses.getHole` was a
  one-line wrapper keyed on a course NAME over the bundled catalog, while all 25 runtime hole lookups
  use `round.courseHoles` from the API — a different source. `localCourseImages.getDefaultPreviewImage`
  unconditionally returned null, and the empty state it existed for is rendered by SmartVision itself.
  `data/rulesReference.rulesByCategory` was a third accessor over the same array — `app/reference.tsx`
  does not group by category anywhere and the handler uses `findRelevantRules`. All three rules are kept
  as comments where they belong, and all three baseline entries are gone, so the orphan debt SHRANK
  rather than being re-explained.

Remaining from the list below: `TIER_LABEL` stays baselined as WIRE with its reason — it is a display
affordance waiting on a surface, which is a product decision rather than a wire. `getRuleById` and
`DEFAULT_TIER` are TEST SURFACES with stated reasons. That is the "one truth or a reason for other
structure" position for every one of them.

## Headline finding — `services/putting/greenHeat.ts` — FIXED 2026-09-13

Reaches `components/GreenHeatCard`, `components/swinglab/PuttReadLine` and `hooks/useGreenHeat`.
Reaches `services/caddieRequestBody` **not at all**.

So the player can SEE make-rate by distance band, the dominant break, and how many measured rolls it
came from — and cannot ASK about any of it. The caddie can answer putts-per-hole and three-putts
(`putt_stats` → `puttStatsFrom`), which is a thinner fact from a different source.

This is the exact class named in CLAUDE.md's second half of the lens, in putting — the area Tim
corrected on this same day ("putts should be always in Feet"). It was **not** fixed in that commit
because wiring it adds a block to `api/kevin`'s cached prompt, which trips the ratchet and must be a
deliberate decision with a stated reason and a prompt-cost answer, not a late addition on a long
session. **This is the next thing to do on the mental/putting leg.**

Same shape, lower value, same reason for not acting unilaterally:

- `services/patternEngine.ts` — consumed only by two practice-session screens.
- `services/offCourseDetector.ts` — consumed by `_layout`, the caddie tab and a data strip; a state the
  caddie arguably should know, since "am I on a course" changes what every answer means.

## The logic files with no guard, largest first

    354  services/audit/scenarioRunner.ts          (a harness itself — low player risk)
    267  services/patternEngine.ts
    256  services/practiceStorage.ts
    247  services/putting/greenHeat.ts             ← headline finding above
    233  services/swingCommentaryService.ts
    221  services/offCourseDetector.ts
    216  services/feelCaptureService.ts
    208  services/holeReconciliation.ts
    204  services/intents/confirmPositionHandler.ts
    199  services/gpsConfidenceAsk.ts
    197  services/tempoMetronome.ts
    191  services/intents/openExternalHandler.ts
    176  services/usageTelemetry.ts
    173  services/intents/handicapQueryHandler.ts
    163  services/caddieRewards.ts
    159  services/swing/smoothArc.ts
    158  store/referenceAuthoringStore.ts
    158  services/videoTranscription.ts

The three `services/intents/*Handler.ts` entries are worth doing first among the rest: every one of
them is a thing a player can SAY, so an untested handler is an untested sentence out of the caddie's
mouth. `handicapQueryHandler` in particular was the surface that mis-answered
"how do I change my handicap" until the instructional-question guard landed earlier today.

## What is NOT in this list

Being absent here means a test or the sim names the file. It does not mean the file is well covered —
`app/(tabs)/dashboard.tsx` is named by many guards and still produced four defects this morning.
Coverage of a FACT is what matters; this inventory only finds files nothing looks at at all.
