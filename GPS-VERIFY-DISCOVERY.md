# GPS-VERIFY Voice Slice — Integration Discovery

**Date:** 2026-05-24
**Mode:** Read-only. No source files modified. Only this report is written.
**Scope:** Map the 8 integration points needed to wire three new voice flows into Kevin's brain on the round critical path:
- **A** — *Speak raw yardage to the pin* (Golfshot-comparable, never PLAYS).
- **B** — *Confidence-gated "what hole are you on?"* (fires only when GPS accuracy is below threshold AND trust level allows).
- **C** — *Declared-position → cross-check GPS → offer Mark on divergence.*

This is the integration map the build will be written against. Feasibility flags at the bottom — three flows are not equally clean.

---

## A. Voice intent routing

Classifier emits `intent_type` → router dispatches to a handler → handler returns `IntentResult`. The auto-speak path (the corrected version of what the prior session might assume) lives one layer up: handlers return `voice_response: string | null` and **the existing useVoiceCaddie path auto-calls speak()** — handlers do NOT need to import `speak` themselves (verified — only 1 of 18 handlers does so, for a special case).

| Component | file:line | Role |
|---|---|---|
| Classifier prompt (Vercel) | [api/voice-intent.ts:14-30](api/voice-intent.ts#L14) | Intent enum + examples (kept in lockstep with the Expo Router mirror) |
| Classifier prompt (Expo) | [app/api/voice-intent+api.ts:13-30](app/api/voice-intent+api.ts#L13) | Same enum + examples, deployed via local dev |
| Router dispatch | [services/voiceCommandRouter.ts:47-95](services/voiceCommandRouter.ts#L47) | `dispatch(intent, context)` — three miss types instrumented (classifier_unknown / no_handler / handler_error) |
| Handler registry | [services/intents/index.ts:21-41](services/intents/index.ts#L21) | 21 handlers registered via `registerHandler()` |
| **Auto-speak** | [hooks/useVoiceCaddie.ts:795-827](hooks/useVoiceCaddie.ts#L795) | Caller of `voiceCommandRouter.dispatch()` auto-calls `speakResponse(result.voice_response)` |
| Reference handler shape | [services/intents/logScoreHandler.ts:99-174](services/intents/logScoreHandler.ts#L99) | Clean example to mirror for new intents |

**Build inserts for new intents:**
- Flow A: extend `query_status` examples (no new intent needed). Add `query_topic: "shot_distance_raw"` or similar; queryStatusHandler picks up the new topic. Or — cleaner — create a dedicated `gps_yardage` intent + handler since the field set is small and orthogonal.
- Flow B/C: new intent `confirm_hole` (for B) and `declare_hole` (for C). Both register the same way.

**Important:** the classifier prompts in `api/voice-intent.ts` and `app/api/voice-intent+api.ts` diverge slightly (different `tool_name` enums per the earlier audit) — any addition to one must mirror to the other.

---

## B. GPS → yardage + accuracy signal

| Component | file:line | Role |
|---|---|---|
| GPS source | [services/gpsManager.ts:577-579](services/gpsManager.ts#L577) | `getLastFix()` — cached `GpsFix` |
| One-shot | [services/gpsManager.ts:589-612](services/gpsManager.ts#L589) | `getOneShotFix({ maxAgeMs })` — forces fresh when needed |
| `GpsFix` type | [services/gpsManager.ts:27-33](services/gpsManager.ts#L27) | `{ lat, lng, accuracy_m \| null, speed \| null, timestamp }` — `accuracy_m` is the ONLY accuracy signal |
| Poor-signal subscriber | [services/gpsManager.ts:436-462](services/gpsManager.ts#L436) | **Existing precedent** — fires callbacks when `accuracy_m > 15m` sustained for ~45s; today the only consumer is a toast in `app/_layout.tsx` |
| Pin coord resolver | [services/smartFinderService.ts:222-269](services/smartFinderService.ts#L222) | `resolveGreenCoords(holeNumber)` — override > courseHoles > geometry cache > none |
| Tee coord resolver | [services/smartFinderService.ts:282-300](services/smartFinderService.ts#L282) | `resolveTeeCoords(holeNumber)` — added in Mark-the-Tee; mirrors green resolver |
| Sync yardage compute | [services/smartFinderService.ts:424-454](services/smartFinderService.ts#L424) | `getGreenYardagesSync()` — front/middle/back via haversine, synchronous, no plays-like adjustment |

**Critical for Flow B:** `accuracy_m` is the only confidence signal. Typical bands from the existing poor-signal threshold:
- `< 5m` → strong
- `5-15m` → moderate
- `> 15m` → weak (this is the threshold the existing `subscribePoorSignal` uses)
- `null` → no lock

The infrastructure for "GPS is bad" is already in place — `subscribePoorSignal` is a working pub/sub. Flow B just needs to subscribe to it AND fire a `speak()` instead of (or in addition to) the existing toast.

---

## C. Raw yards vs PLAYS

| | file:line | Notes |
|---|---|---|
| **RAW** (use this for Flow A) | [services/smartFinderService.ts:440-442](services/smartFinderService.ts#L440) | Inside `getGreenYardagesSync()` — `haversineYards(syncFix.location, front/middle/back)`. Pure haversine, no adjustments. Apples-to-apples with Golfshot. |
| **PLAYS-like** (avoid for Flow A) | [utils/playsLike.ts](utils/playsLike.ts) (called in [services/intents/queryStatusHandler.ts:7](services/intents/queryStatusHandler.ts#L7)) | Adjusts for elevation, wind, temperature. Used by `query_status` topic `plays_like`. |

**Build constraint:** Flow A's handler must call `getGreenYardagesSync()` and read `.middle` (or `.front`/`.back` by request) — must NOT route through any `playsLike()` adjustment. If users want "plays-like", that's a separate utterance (`plays_like` topic already exists in queryStatusHandler).

---

## D. Golfcourseapi hole data

Per-hole tee + pin coordinates live on `roundStore.courseHoles[i]`:

**`CourseHole` shape** ([store/roundStore.ts:19-35](store/roundStore.ts#L19)):
```ts
interface CourseHole {
  hole: number;
  par: number;
  distance: number;
  front: number; back: number;      // scorecard tee→front / tee→back distances
  teeLat: number; teeLng: number;   // tee box GPS (or 0 if not provided)
  middleLat: number; middleLng: number;
  frontLat: number; frontLng: number;
  backLat: number; backLng: number;
  note: string;
  estimated: boolean;
}
```

**Access for Flow C** ("declared hole N → expected tee coords"):
- Direct: `useRoundStore.getState().courseHoles.find(h => h.hole === N)?.teeLat, .teeLng`
- Or via helper that already does the override-or-courseHoles cascade: [services/smartFinderService.ts:282-300](services/smartFinderService.ts#L282) `resolveTeeCoords(holeNumber)`

`resolveTeeCoords` is preferred — it respects a player-marked tee override if one exists. The cross-check should compare current GPS to the resolved tee, not to the raw `courseHoles` value.

---

## E. Manual Mark publish API

Both Mark Tee and Mark Green expose `setX` exports that persist to AsyncStorage with no UI required.

| | file:line | API |
|---|---|---|
| Mark Tee | [services/courseTeeOverrides.ts:72-83](services/courseTeeOverrides.ts#L72) | `setTeeOverride(courseId, hole, { lat, lng }): Promise<void>` |
| Mark Green | [services/courseGreenOverrides.ts:77-88](services/courseGreenOverrides.ts#L77) | `setGreenOverride(courseId, hole, { lat, lng }): Promise<void>` |

For Flow C, the handler can call `setTeeOverride()` directly (silent mark — invisible to the user) OR fire a toast + offer the existing screen. The "silent mark" path is the lightest — single function call, no UI step. Trade-off in feasibility section.

---

## F. Trust spectrum

| Component | file:line | Role |
|---|---|---|
| Store | [store/trustLevelStore.ts:31-46](store/trustLevelStore.ts#L31) | Numeric `level: 1-5` (Quiet → Cockpit); persisted |
| Read pattern | `useTrustLevelStore.getState().level` | Synchronous |
| **Voice gate** | [services/voiceService.ts:287-303](services/voiceService.ts#L287) | `isVoiceAllowed(opts?)` — returns false when `trustLevel === 1 && !opts.userInitiated`; the gate IS already wired |

**Auto-memory rule (from prior sessions):** any proactive `speak()` (not in response to a user tap) MUST pass `{ userInitiated: true }` if the caller wants L1 users to hear it. Per spec for Flow B, the confidence-gated ask should NOT fire in L1 — so callers should NOT pass `userInitiated: true`. Default (false) blocks L1 by design. ✓

**Precedent for proactive Kevin questions:** none today. The only proactive speech in the codebase is `app/_layout.tsx` round-start handoff. All other Kevin replies are reactive to mic-tap utterances. This is the architectural seam Flow B has to cross.

---

## G. Kevin speak path

| Component | file:line | Role |
|---|---|---|
| `speak()` signature | [services/voiceService.ts:587-593](services/voiceService.ts#L587) | `(text, gender, language, apiUrl, opts?) => Promise<void>` |
| `SpeakOpts` | [services/voiceService.ts:234](services/voiceService.ts#L234) | `{ userInitiated?: boolean }` |
| Timeout | [services/voiceService.ts:204-213](services/voiceService.ts#L204) | `SPEAK_TIMEOUT_MS = 30_000`; scales up to 120s for longer text via `playbackTimeoutForText()` |
| Auto-speak (router caller) | [hooks/useVoiceCaddie.ts:795-827](hooks/useVoiceCaddie.ts#L795) | `speakResponse(result.voice_response)` — fires automatically when `IntentResult.voice_response` is non-null |

**Handler integration pattern (the corrected version):**
- Standard handler: return `IntentResult { voice_response: "..." }` — caller auto-speaks. Handler does NOT need to import `speak`.
- Custom handler (rare — 1 of 18 today): import `speak` from voiceService for non-default behavior. Only do this for special cases (custom persona routing, multi-line, etc.).
- For Flow A: standard pattern is correct. Handler returns the yardage line as `voice_response`. Done.
- For Flow B/C (proactive — no user utterance): standard pattern does NOT apply because there's no IntentResult round-trip. The build needs to call `speak()` directly from a GPS-event subscriber. This is the architectural gap.

---

## H. Owner debug card pattern

| Component | file:line | Role |
|---|---|---|
| Existing card | [app/swing-analysis-debug.tsx](app/swing-analysis-debug.tsx) | Owner-gated; reads from store, renders verdict + key/value detail |
| Store pattern | [store/swingAnalysisDebugStore.ts:26-72](store/swingAnalysisDebugStore.ts#L26) | Single `last` entry, persisted; `record(entry)` + `clear()` |
| Settings link | [app/settings.tsx:1185-1198](app/settings.tsx#L1185) | Settings → Owner Tools row |
| Route reg | [app/_layout.tsx:107,622](app/_layout.tsx#L107) | `/swing-analysis-debug` in DEBUG_ROUTES + Stack.Screen |

**For GPS health card:** mirror the pattern with a new `gpsHealthStore` carrying `{ at, accuracy_m, lastDeclaredHole, lastDeclaredVsGpsDivergence_m, confidenceGateFiredAt }`. New screen `app/gps-health-debug.tsx`, new Settings row, register in `_layout.tsx`. Total: 4 file touches, all mirroring shipped patterns.

---

## I. Feasibility flags (the honest section)

### Flow A — *Speak raw yardage to the pin* → **CLEAN ✅**

- Voice classifier extension: add examples to `query_status` ("how far to the pin", "what's my yardage", "yards to the green") in both classifier files
- Handler change: extend `queryStatusHandler.ts` with a new `query_topic: 'shot_distance_raw'` branch — calls `getGreenYardagesSync()` from smartFinderService, reads `.middle` (raw haversine), returns `voice_response: "${middle} yards to the middle"`
- Auto-speak path picks it up via `useVoiceCaddie.ts:800` — no new infrastructure
- **No awkward seams.** The full pipeline (GPS → resolveGreenCoords → haversine → spoken reply) is proven daily.

### Flow B — *Confidence-gated "what hole are you on?" ask* → **AWKWARD 🟡**

The core problem: **no precedent for a proactive Kevin question that fires without user voice input**. The router-handler model is reactive (utterance → handler → reply). Flow B is inverse (GPS event → speak directly without an intent).

What exists:
- `subscribePoorSignal` ([gpsManager.ts:436-462](services/gpsManager.ts#L436)) — accuracy threshold subscriber that already fires on `accuracy_m > 15m` for 45s sustained. The pattern is wired; only consumer today is a toast.
- `isVoiceAllowed(opts)` ([voiceService.ts:287-303](services/voiceService.ts#L287)) — trust-level gate that already handles L1 suppression when `userInitiated` is false.

What's missing:
- A subscriber that wires `subscribePoorSignal` to `speak()`. This is small (~10 lines in `_layout.tsx` or a new orchestrator module).
- A debounce/cooldown so the question doesn't fire repeatedly when accuracy hovers around the threshold. Spec'd as "fires only when below threshold" but in practice needs "fires at most once per N minutes" — new state.
- A way to capture the user's spoken answer ("I'm on hole 4") and route it back to set `currentHole`. The `navigateHandler` already handles "I'm on hole 4" → `setCurrentHole(4)`, so the answer path is wired — just need to confirm the proactive-ask flow keeps the mic open / listening for the response.

**Recommended path:** new lightweight orchestrator `services/gpsConfidenceAsk.ts` that:
1. Subscribes to `subscribePoorSignal`
2. On callback: checks trust level, checks cooldown
3. If allowed: calls `speak("Hey — I'm losing GPS lock. What hole are you on?")` directly (no `userInitiated` — L1 users skipped automatically)
4. Listens for the next utterance, routes through `navigateHandler` (which handles "I'm on hole 4" today)
5. Cooldown set, debug entry recorded to `gpsHealthStore`

Build cost: medium. The pieces all exist; what's new is the orchestration glue.

### Flow C — *Declared-position → cross-check GPS → offer Mark* → **AWKWARD 🟡**

User utterance triggers this one (not proactive) — so the intent-handler pattern fits. But the "offer Mark on divergence" step has two paths and neither is fully clean:

- **Silent mark:** handler calls `setTeeOverride(courseId, hole, currentGps)` directly. Invisible to user; surprising. Doesn't match the "ask before destroying state" discipline.
- **Routed Mark screen:** handler returns `IntentResult` with a side-effect that routes to `/mark-tee?hole=N&prefill=1`. Mark Tee already supports current-hole pre-selection. Less surprising, but the user is dropped into a screen they didn't ask for.

What exists:
- `resolveTeeCoords(holeNumber)` to read the expected tee per hole ([smartFinderService.ts:282](services/smartFinderService.ts#L282))
- `setTeeOverride(courseId, hole, { lat, lng })` for direct write ([courseTeeOverrides.ts:72](services/courseTeeOverrides.ts#L72))
- `getLastFix()` for current GPS ([gpsManager.ts:577](services/gpsManager.ts#L577))
- `haversineYards` for distance ([utils/geoDistance.ts](utils/geoDistance.ts))

What's missing:
- A new intent `declare_hole` in both classifier prompts with examples ("I'm teeing off on hole 4", "starting hole 7", "on hole 3 now")
- A new handler that does the cross-check + decides between silent / offer
- A divergence threshold (suggest: 20m for tee divergence — wider than green because tees can be 20-30 yards wide)

**Recommended path:** handler does the cross-check, then:
- If divergence > 20m → return `voice_response: "Your GPS says you're 40 yards from hole 4's tee. Marking your current position as the tee for hole 4 — say 'undo' to revert."` AND silently call `setTeeOverride()`. Records to `gpsHealthStore` for the debug card.
- If divergence ≤ 20m → `voice_response: "Hole 4 — got it."` Just sets currentHole via `setCurrentHole(4)`, no Mark.

The "undo" affordance addresses the silent-mark surprise issue without forcing a screen routing. Needs a separate `undo_last_mark` intent OR a global recent-action stack — additional scope.

Build cost: medium. The data and APIs are all there; the UX-around-silent-mark decision is the real cost.

---

## Summary of build readiness

| Flow | Status | Build cost | Awkward seam |
|---|---|---|---|
| A — Speak raw yardage | ✅ CLEAN | Small | None |
| B — Confidence-gated hole ask | 🟡 AWKWARD | Medium | Proactive ask has no precedent — new orchestrator module needed |
| C — Declared vs GPS Mark | 🟡 AWKWARD | Medium | "Offer Mark" UX (silent vs routed) — both options have trade-offs |
| (Optional) GPS health debug card | ✅ CLEAN | Small | None — mirrors shipped pattern exactly |

Pieces in place that make all three flows possible: GPS source-of-truth + accuracy signal, pin/tee resolvers with override fallback, raw-vs-plays separation, Mark publish APIs, trust-level gate, persona-aware speak with `userInitiated` semantics, auto-speak from IntentResult, debug-card pattern. **No missing primitives — the build is glue, not new infrastructure.**

The only architectural new-build is the **proactive ask orchestrator** for Flow B (small module subscribing to `subscribePoorSignal` and dispatching `speak()` with cooldown + debug logging). Once that exists, Flow C's "offer Mark" can reuse it as the same outbound channel if you want the divergence message to feel like part of the same caddie voice.

Recommend: **ship Flow A first** (small, validates the new-intent pipeline end-to-end), then layer Flow B's orchestrator, then Flow C on top. Each is independently OTA-shippable.
