# CNS Visibility — spec (2026-07-07)

## The problem (from the fresh integration-seam audit)
The Caddie CNS (`store/caddieMemoryStore.ts`) learns a rich model — the player's
dominant miss, per-hole tendencies, bag, course notes. But the **screens the user
actually looks at read from *parallel* stores or from CNS fields that nothing ever
writes.** So the learning reaches the LLM voice brain (via
`services/pipecatContext.ts` → the prompt block) but NOT the deterministic/visible
surfaces. The brain learns; the glass stays dumb.

Goal: **make the visible, deterministic surfaces read the learned brain**, and make
every "the caddie remembers…" promise actually have a writer.

---

## The seams to wire (each: writer → reader, current gap, fix)

### S1 — Learned dominant miss → the deterministic on-course read  [PARTIAL, split-brain]
- **Learned:** `caddieMemoryStore.tendencies.dominantMiss` (written by `recordSwingFault`, `smartmotion.tsx:1463`; reaches the LLM via `pipecatContext.ts:96`).
- **Read by cards:** `composeShotRead` callers pass `profile.dominantMiss`, NOT the CNS value — `app/smartfinder.tsx:1262`/`:1457`, `services/localStatusResponder.ts:654`. And `profile.dominantMiss` is written ONLY by the Settings manual picker (`app/settings.tsx:861`); `setMissType` has ZERO callers.
- **Gap:** SmartFinder's "you miss X — favor the safe side" + the offline plays-like read stay silent/wrong unless the user hand-typed their miss in Settings. Voice knows it; the cards don't.
- **Fix (contained):** in the `composeShotRead` callers, pass the CNS `tendencies.dominantMiss` (via `getCaddieContext()` / a `caddieMemoryStore` read) with `profile.dominantMiss` as a fallback. One source of truth: CNS-learned wins, manual pick fills gaps. Optionally: on `recordSwingFault` crossing a confidence threshold, also mirror into `profile.dominantMiss` so every legacy reader benefits.

### S2 — Per-hole line + green notes → recall  [DEAD-END: read, never written]
- **Read:** `caddieMemoryRetrieval.ts:79`/`:136`/`:202`/`:208` (`promptBlock` + `getCourseHoleGuidance`); `composeShotRead`'s `holeLineNote` param.
- **Written:** NONE. `recordRoundEnd` (`caddieMemoryStore.ts:299-336`) writes par/typicalClub/scoringAvg/trouble but never `bestLine`/`greenBehavior` (stay `null` from init `:141`). `smartfinder.tsx:1454` passes `holeLineNote: null` unconditionally.
- **Gap:** "you usually tee 7-iron here; favor left" and "green: back-to-front, fast" can never materialize.
- **Fix (medium):** in `recordRoundEnd`, derive per-hole `bestLine` from the round's tracked shots (start location → outcome direction on the hole's best-scoring attempts) and `greenBehavior` from any captured green-read/putt data; write them onto the course-hole memory. Then feed `holeLineNote` in `smartfinder.tsx` from `getCourseHoleGuidance`. Honest: only write when there's real shot data; leave null otherwise (readers already handle null).

### S3 — Preferences (tone / respondsTo) + emotional state → CNS  [DEAD-END: never learned]
- **Writer:** `recordPreference` (`caddieMemoryStore.ts:355`) has ZERO callers. No emotional/feel pipeline writes CNS. `preferences` isn't even surfaced by `getCaddieContext`.
- **Gap:** "the brain learns how you respond / your tone / your emotional state" is inert. Emotional state lives only in the round-scoped `emotionalLog` (reset each round).
- **Fix (bigger):** (a) call `recordPreference` from the conversation distiller when the player expresses a preference ("keep it short", "don't lecture me"); (b) route `log_emotional_state` + the round `emotionalLog` into a durable CNS emotional-tendency (e.g. "tightens up on tee shots after a bad hole") at round end; (c) surface both in `getCaddieContext.promptBlock`. This is the "performance psychologist that remembers" layer.

### S4 — Off-round narrative → CNS  [PARTIAL: round-scoped only]
- `distillConversation` runs ONLY from `endRound` (`roundStore.ts:1479`). Off-round chats never distill.
- **Fix (medium):** add an off-round trigger — on app background (or a short idle timer) when NO round is active, if there are new un-distilled conversation-log turns, run `distillConversation` → `recordReflection` with `round_id: null`. Likely also enhance the distiller to capture general practice-intent + emotional narrative, not just miss/focus/carry patterns.

### S5 — CNS learns the REAL fault, not the weak signal  [contained — doing in the cleanup batch]
- `recordSwingFault` is fed `result.analysis.detected_issue` (biased to 'none' → often no write). The saved report now uses `classifySession(...).issue_id` (the evidence-gated fault). Feed the CNS the same rolled-up fault so it actually learns + uses the same vocabulary as the report.

---

## Phasing
1. **S5 + S1** (contained, high-value): CNS learns the real fault, and the on-course cards read the learned miss. Biggest visible payoff, lowest risk. OTA-able.
2. **S2 + S4** (medium): per-hole line/green recall written at round end; off-round narrative distills.
3. **S3** (bigger): the emotional/preference "psychologist memory" layer.

Each phase ships behind honest gates — only surface a learned insight when there's real data behind it (never fabricate a tendency from thin samples; `caddieMemoryStore` already uses MIN_SAMPLES floors).

## Verify
Re-run the integration-seam audit after each phase: every seam should read WIRED end-to-end (writer → the surface the user sees), not just reach the LLM prompt.
