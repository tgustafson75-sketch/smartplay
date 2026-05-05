# Audit 109 — Shot Tracking End-to-End

Phase 109 deliverable. Walks the existing shot pipeline (input → persistence → aggregation → recap) and identifies gaps.

## What exists

**Schema — `store/roundStore.ts:64`** — `ShotResult` interface with: id, hole, timestamp, club, feel/shape/direction, distance_yards, outcome, penalty_strokes, gps_location/start_location/end_location, raw_utterance, logged_via, shot_in_round_index, weather_snapshot. Comprehensive. No new fields needed.

**Persistence — `store/roundStore.ts:229`** — `logShot(shot: ShotResult)` action. Persists into the round-store-v1 AsyncStorage-backed Zustand store. Survives cold launch within an active round.

**Input methods (current):**
1. **Conversational orchestrator** (`services/conversationalLoggingOrchestrator.ts`) — auto-detected via shotDetectionService (GPS pattern recognition: significant position change after pause). Orchestrator opens a session, asks "what'd you hit?", listens, parses, calls logShot.
2. **Tap path: rules resolution** (`app/(tabs)/caddie.tsx:815`) — when a shot has a rules decision (penalty / OB), user taps the resolution sheet, logShot fires.
3. **Tap path: scorecard placeholder** (`app/(tabs)/scorecard.tsx:254`) — when user enters a hole score without per-shot data, a placeholder shot is logged so totals tie up.
4. **Debug** (plan-debug, patterns-debug) — test harness only.

**Aggregation — services & stores:**
- `services/patternEngine.ts` — pattern insights from shot history
- `services/patternDetection.ts` — generatePatternInsights surfacing in pre-round briefing
- `services/recapGenerator.ts` — post-round recap consumes shots[]
- Stats tab + scorecard render aggregates

**Recap — `api/recap.ts` + `services/recapGenerator.ts`** — per-hole + overall summary, uses shots[] when available.

## Gaps Phase 109 calls out

### G1 — No `log_shot` voice intent

`api/voice-intent.ts` voice intent classifier emits: `open_tool`, `query_status`, `change_setting`, `acknowledge`, `set_trust_quiet`, `set_trust_companion`, `unknown` (per the system prompt enumeration in voice-intent.ts). **No `log_shot` intent.**

The Phase 109 prompt specifies:
> "I hit driver 240 left" → log shot with club=driver, distance=240, outcome=left

This isn't currently parseable as anything but `unknown` — it falls through to Kevin's brain, which generates a chat response instead of logging the shot. The conversational orchestrator covers post-detection logging, but proactive "let me tell you what I just hit" doesn't route to logShot.

**Fix:** add `log_shot` intent type to the voice-intent classifier system prompt + parameters schema, register a handler that calls `useRoundStore.getState().logShot()` with parsed club/distance/outcome.

### G2 — No proactive ad-hoc tap-log entry

User can only log via auto-detection's conversational sheet OR via the rules-resolution sheet (after a rules-flagged shot). No "open a sheet, pick a club, distance, outcome, log it" tap entry from caddie home.

**Decision: defer to Phase 109-followup.** The existing conversational orchestrator covers most cases (auto-detection fires, sheet opens, user taps club + distance there). The proactive tap-log is enhancement — small UX win, but adding a new sheet + club picker + outcome chips is a real surface that needs design. Document and move on.

### G3 — No automatic acoustic / motion detection for on-course

Per Phase 109 spec C4: "Per Phase BJ research, watch IMU is queued (separate build). Acoustic in cage but on-course is harder. For this phase, assume voice + tap are primary methods. Auto-detection is enhancement."

Already deferred per spec. Confirmed.

### G4 — No edit / delete UI for logged shots

`logShot` only appends. There's no `editShot` / `deleteShot` action in roundStore for correcting typos or removing accidentally-logged shots. Phase 109 spec C8 lists this as edge-case handling.

**Decision: defer to Phase 109-followup or v1.2.** Schema supports it (id field exists per shot); just need actions + UI.

### G5 — Bulk shot input ("forgot to log several, catch up")

Same as G4. No UI flow for bulk-entering retroactive shots. Defer.

### G6 — Network failure / Supabase sync

Currently shots persist locally only. Supabase sync isn't wired (per audit-100-functional-state.md). Defer to v1.2.

## What this audit does NOT touch

- Conversational orchestrator (already works)
- Persistence schema (already comprehensive)
- Recap pipeline (already consumes shots correctly)
- Auto-detection of shot events (deferred per spec)

## Phase 109 fix sequence

1. **Add `log_shot` voice intent** — closes G1, the only structural gap blocking the spec's primary use case.
2. **Document G2 / G4 / G5 / G6 as deferred** — already marked.

## Empirical verification (Tim, Galaxy Z Fold)

After fix:
- Round active. Say "I hit driver 240 left." → shot logs to current hole with club=driver, distance=240, outcome=left.
- Open Stats / Scorecard. Logged shot appears.
- Continue: "7-iron 165 to the green" → logs as second shot of hole.
- End round. Recap reflects logged shots.
- Cold launch mid-round (force-stop the app, relaunch). Logged shots persist.
