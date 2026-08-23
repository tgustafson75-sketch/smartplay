# Critical Path Verification Gates

Phase AO discipline. The **six** end-to-end paths that define v1.0 readiness.
(Four originally; GPS and SCORECARD promoted out of Path 2 on 2026-08-19.)
No phase touching one of these paths is "shipped" until that path verifies
empirically on a dev-client install. Past pattern was code-level audits
passing while real-device runs failed; this replaces that pattern with
tight verification gates.

## How to use this document

1. Before starting a phase, identify which critical path(s) it touches.
2. After shipping the phase, run the **MIN VERIFY** for each touched path.
3. If the path passes, the phase is shipped. If it fails, ship the targeted
   fix before any other phase work.
4. Each path has path-specific log markers. Filter logcat to those markers
   to confirm the flow ran end-to-end.

## Path 1 — ONBOARD

Cold install → welcome screen (name / caddie / handicap / consent) → Caddie home
with profile populated.

> **Rewritten 2026-08-19 (critical-path audit).** Everything in this section was
> previously wrong. It documented a six-screen `app/onboarding/` subtree —
> `welcome.tsx`, `name.tsx`, `mode.tsx`, `home-course.tsx`, `ready.tsx`,
> `meet-kevin.tsx` — that was **deleted on 2026-05-17** ("get rid of that whole
> stupid onboarding nonsense"). It listed seven `[path1:onboard]` markers; a
> repo-wide grep found **one**, in `services/contextSynthesizer.ts`, which is not
> on this flow at all. So the Path 1 MIN VERIFY — grep logcat for
> `[path1:onboard]` — returned nothing whether the path was healthy or broken,
> and had done since May. The gate was unrunnable, and CLAUDE.md's phase
> discipline has been citing it as a gate the whole time. Markers were added on
> 2026-08-19 to the flow that actually exists.

**Touched files (real):**
- `app/index.tsx` — the routing decision (consent + name → welcome or caddie)
- `app/welcome.tsx` — the single onboarding screen
- `app/greeting.tsx` — cold-launch greeting hop (once per process)
- `store/playerProfileStore.ts` — name, handicap, `termsAcceptedAt`, `first_opened_at`
- `store/settingsStore.ts` — `caddiePersonality` (NOT the profile store; see below)
- `store/trustLevelStore.ts`

**Pass criteria:**
- Fresh install lands on `/welcome`, not straight on the Caddie tab.
- The Get Started CTA is inert until the Terms checkbox is ticked.
- Name, caddie persona and (optional) handicap persist **before** navigation.
- `termsAcceptedAt` is stamped — this, not `first_opened_at`, is what stops the
  screen re-firing. (`first_opened_at` is stamped during `_layout.tsx` hydration
  by the trial lifecycle, *before* this gate runs, so gating on it silently
  skipped consent capture on real installs — fixed 2026-07-20.)
- Lands on `/(tabs)/caddie` with the bottom tab bar visible.
- Kevin's portrait matches the locked canonical framing (see CLAUDE.md).
- Returning users skip welcome entirely.

**Diagnostic markers (grep `[path1:onboard]`):**
- `[path1:onboard] route_decision terms_accepted=… name_set=… -> welcome|caddie`
- `[path1:onboard] welcome shown returning=…`
- `[path1:onboard] blocked reason=terms_not_accepted`
- `[path1:onboard] complete name_set=… handicap_set=… persona=… terms_at=… first_opened=… -> /(tabs)/caddie`

The `complete` line reads the values back **out of the stores**, not off the form
inputs. The pass criterion is that the write landed; echoing the inputs would
report success even when persistence failed.

**MIN VERIFY (~5 min):**
1. Wipe app data (or fresh install). Launch.
2. Confirm `route_decision … -> welcome` and that the welcome screen appears.
3. Tap Get Started **without** ticking Terms → expect the nudge alert and
   `blocked reason=terms_not_accepted`.
4. Tick Terms, enter a name, pick a caddie other than Kevin, tap Get Started.
5. Confirm `complete name_set=true persona=<the one you picked> terms_at=true`.
6. Confirm you land on the Caddie tab and the caddie greets by name.
7. Force-quit and relaunch → expect `route_decision … -> caddie` (no welcome).

**Failure modes to watch:**
- Welcome skipped on a fresh install (the `first_opened_at` vs `termsAcceptedAt`
  regression — check which field the gate reads).
- `persona=kevin` in the complete line after picking Tank/Harry/Serena — persona
  lives in `settingsStore`, and reading it off `playerProfileStore` returns
  undefined and folds to Kevin. This is the same store-confusion that renders
  Tank and Harry as "Kevin" across ~30 surfaces (CLAUDE.md, Phase 100).
- Caddie sits silent for ~10s on first launch (`signalGreetingComplete()` not
  fired before the `router.replace`).
- Welcome re-fires every cold launch (consent not persisted).

---

## Path 2 — ROUND

Open app → find course → start round → play through holes → log shots →
end round → see recap on scorecard.

**Touched files (typical):**
- `app/(tabs)/caddie.tsx` (Start Round modal, runStartRound)
- `app/(tabs)/play.tsx` (course picker)
- `app/(tabs)/scorecard.tsx`
- `app/round/briefing.tsx`
- `store/roundStore.ts`
- `services/holeDetection.ts`
- `services/shotDetectionService.ts`
- `services/positionMarkBus.ts` (Mark)
- `services/courseGeometryService.ts`
- `store/courseGeometryOverrideStore.ts` (anchor capture)

**Pass criteria:**
- Course search returns results.
- Start Round dispatches `roundStore.startRound()` with non-empty `courseHoles`.
- ROUND ACTIVE dev indicator (top of screen) flips to green and STAYS.
- Hole 1 yardage shows a real number (live GPS) OR honest "No live yardage on this course" + anchor capture available.
- Walking to next hole triggers auto-advance (via hole-detection sustained position) within ~30s.
- Mark button captures fresh GPS, fires through positionMarkBus to all subscribers.
- Shot logging writes to `roundStore.shots`; persists across tab switches.
- End Round routes to Scorecard tab; scorecard shows accurate scores per hole + club summary + Kevin recap (when available).

**Diagnostic markers (grep `[path2:round]`):**
- `[path2:round] start course=X holes=N courseId=Y`
- `[path2:round] gps_prewarm granted=true|false`
- `[path2:round] hole transition prev=A next=B reason=auto|manual|mark`
- `[path2:round] shot logged hole=X club=Y`
- `[path2:round] anchor_tee hole=X lat=A lng=B accuracy=C`
- `[path2:round] anchor_green hole=X lat=A lng=B accuracy=C`
- `[path2:round] mark hole=X accuracy=Y subscribers=N`
- `[path2:round] end totalScore=X holesPlayed=Y`
- `[path2:round] recap generated id=X kevin_summary_chars=N`

**MIN VERIFY (~15 min):**
1. From caddie home, tap into Start Round modal.
2. Pick course (Menifee or any). Confirm the modal closes and ROUND ACTIVE indicator goes green.
3. Open hole-view on hole 1 → confirm yardage card shows a number OR honest "No live yardage" with anchor buttons.
4. Tap Mark on caddie home → confirm "Marked (accuracy ~Xm)" caddie response.
5. Log 2 shots manually via the shot card.
6. Walk simulated 1 hole transition (or use simGPS to advance).
7. End Round → confirm landing on Scorecard tab with scores + club summary visible.

**Failure modes to watch:**
- ROUND ACTIVE flashes on then collapses to off (rehydration race regression).
- courseHoles empty after start (course load failed silently).
- Yardages show "—" with no honest message (course-geometry empty + no anchor).
- Hole transition doesn't fire after sustained position.
- Mark button on caddie home doesn't fire (positionMarkBus subscriber missing).
- End Round routes anywhere other than scorecard tab.

---

## Path 3 — CAGE

Open SwingLab → Cage Mode setup → record session → analysis → drill recommendation
→ open drill.

**Touched files (typical):**
- `app/swinglab/cage-drill.tsx`
- `components/swinglab/CageOverlay.tsx`
- `services/cageApi.ts`
- `services/poseDetection.ts`
- `services/swingIssueClassifier.ts`
- `services/relationshipEngine.ts`
- `services/drillRecommendation.ts`
- `app/cage/summary.tsx`
- `app/swinglab/swing/[swing_id].tsx` (uploaded swings + re-analyze)

**Pass criteria:**
- CageOverlay renders during SETUP (amber body box + bullseye + strike zone).
- "Check Position" call returns; phase advances to READY (green overlay).
- Recording captures 12s of video successfully.
- Phase K analysis returns a structured PrimaryIssue (or honest "Couldn't analyze" with retry).
- Drill recommendation card renders for the detected issue.
- Re-analyze button on a previously-failed upload picks up V.6 + AF prompt fixes and produces a useful read.

**Diagnostic markers — grep `path3:cage` (NO closing bracket):**

> **Corrected 2026-08-19.** This section used to list markers in the form
> `[path3:cage] setup …` and told you to grep the literal `[path3:cage]`. The
> code has never emitted that form. `services/cageTelemetry.ts` emits
> **`[path3:cage:STAGE]`** — the stage name is *inside* the brackets — so a grep
> for `[path3:cage]` matches nothing while 61 live call sites log happily. The
> markers below were fiction; the instrumentation was not. Path 3 is in fact the
> best-instrumented path in the app.

Real format:
```
[path3:cage:<stage>] timestamp=<ISO> status=ok|fail|partial metadata={…}
```
Stage names are kebab-case and catalogued in `docs/cage-telemetry-map.md`.
Representative stages on the happy path:
- `[path3:cage:cage-index-start]` — club chosen, routing to session
- `[path3:cage:camera-perm-grant]` / `[path3:cage:mic-perm-grant]`
- `[path3:cage:overlay-mount]`, `[path3:cage:phase-preview]`
- `[path3:cage:summary-phase-k-start]` → `[path3:cage:summary-phase-k-result]`
  (`status=ok|partial|fail`)
- `[path3:cage:route-session-complete]`

`status=fail` on any stage is the thing to look for; the `metadata` blob carries
the reason.

**MIN VERIFY (~10 min):**
1. SwingLab → Cage Mode → confirm CageOverlay renders with amber body box + bullseye.
2. Tap "Check Position" → confirm overlay flips to green (READY) or amber pulsing (CHECKING).
3. Record 5 swings (12s each).
4. Confirm analysis returns either PrimaryIssue or honest "Couldn't analyze."
5. If PrimaryIssue surfaces: tap drill recommendation → confirm drill screen opens.
6. Open a previously-failed swing from library → tap Re-analyze → confirm new result.

**Failure modes to watch:**
- CageOverlay missing from camera viewfinder.
- Phase K returns null primary_issue on every attempt (vision API model issue).
- Drill recommendation card empty / "no drill found" for a real issue.
- Re-analyze button doesn't fire runPhaseKOnSession.

---

## Path 4 — VOICE

Earbud tap (or on-screen Kevin badge) → Kevin engages → query → response →
continuation or close.

**Touched files (typical):**
- `app/(tabs)/caddie.tsx` (handleMicPress, Kevin avatar tap)
- `services/listeningSession.ts`
- `services/voiceService.ts`
- `services/fillerLibrary.ts`
- `services/positionMarkBus.ts`
- `hooks/useVoiceCaddie.ts`
- `hooks/usePipecatVoice.ts`
- `hooks/useVoiceActivityDetection.ts` (auto-listen mode)
- `api/pipecat-turn.ts` — **the default brain** (turn 1)
- `api/kevin.ts` — the FOLLOW-UP brain only (`processFollowUp` → `sendToBrain`).
  The legacy main-turn fallthrough was deleted 2026-07-23.
- `api/_brainTools.ts` — the one tool contract both brains import (2026-08-19)

**Pass criteria:**
- Earbud tap **OR** on-screen badge tap engages listening within 200ms.
  - *Corrected 2026-08-19:* the "native BT media-key listener is a stub" note is
    stale. The caddie mic **is** `listeningSession.toggle()` — the same entry the
    earbud tap drives (2026-08-17). The live hazard is different and worse: there
    are multiple mic owners with no arbiter, and the tab avatar runs
    `useVoiceCaddie`'s own recorder. Watch for the cue speaking *before* the mic
    is claimed ("I'm here." → busy → "Didn't catch that.").
- Filler clip plays from local cache (or speaks live TTS fallback if cache cold).
- Response audio plays (TTFA target: <500ms direct intents, <1500ms Haiku, <8s Sonnet perceived).
- Role register shifts per surface (Caddie / Coach / Psychologist) per active screen.
- L1 Quiet: opener/filler suppressed; user-initiated reply still speaks.
- VAD doesn't cut user off mid-thought (silence threshold 2800ms, gated on Kevin-not-speaking).

**Diagnostic markers (grep `[path4:voice]`):**
- `[path4:voice] tap_open trust=N source=earbud|onscreen`
- `[path4:voice] opener_done allowed=true|false`
- `[path4:voice] capture_start`
- `[path4:voice] capture_done text_len=N cancelled=true|false`
- `[path4:voice] intent=X topic=Y`
- `[path4:voice] earcon_start` / `[path4:voice] earcon_end`
  *(corrected 2026-08-19 — documented as `filler_start`/`filler_end`, which the
  code has never emitted)*
<!-- 2026-08-23 — `local_primary` REMOVED. It marked the local-first intercept that answered 16
query types on-device without ever calling the brain, including yardage and wind. Tim's call:
"everything is everything… there should have been no way we went off reservation and started
creating separate paths." Every spoken question now reaches the caddie, so there is no on-device
answer to mark. Removed here as well as in code, because a documented marker nothing emits makes
the MIN VERIFY grep return nothing whether the path is healthy or broken. -->
- `[path4:voice] mic_handover` — a second owner took the mic
- `[path4:voice] capture_retry` — mic was busy/errored; retried once
- `[path4:voice] response_start ms_since_capture=X`
- `[path4:voice] response_end`
- `[path4:voice] close reason=natural|user_tap|state_change`

Existing `[ttfa]` log line at `services/listeningSession.ts:266` already captures TTFA timing — keep using it.

**MIN VERIFY (~5 min):**
1. Tap Kevin avatar on caddie home → confirm listening session opens (visual state change).
2. Ask: "How far to the green?" → confirm tactical response within ~5s.
3. Ask: "What should I think about over this shot?" → confirm conversational response within ~10s.
4. Ask: "Did you get that?" (hero moment) → confirm "Got it. That's yours." canned response.
5. Toggle Quiet (L1) → tap badge → ask question → confirm opener+filler silent, response speaks (user-initiated opt-in).

**Failure modes to watch:**
- Tap doesn't engage listening (stuck in idle).
- Filler library empty (voiceHash regen never fired) → silent bridge.
- Response cut off mid-sentence (SPEAK_TIMEOUT_MS regression).
- Opener speaks at L1 (Quiet leak regression).
- VAD finalises mid-thought (silence threshold regression).

---

## Path 5 — GPS TRACKING

Permission → first fix → live yardage → hole advance → background continuity.

> **Added 2026-08-19.** GPS was previously only implicit inside Path 2 ROUND.
> It earns its own path for two reasons. It is the **most common field failure**
> in this app's history (stale fixes, hard-clears wiping good fixes, wrong
> centroids, "why won't it tell me the yardage"), and it is the one subsystem
> whose failure is *silent by construction* — a stale fix and a fresh fix look
> identical on screen until the number is wrong.
>
> The instrumentation had the same asymmetry: `[gps]` logging was rich on
> FAILURE (`stale`, `hard-clear`, `outlier-rejected`) and silent on success, so
> a log could not distinguish "GPS is working" from "GPS never started."
> `[path5:gps]` markers for the happy path were added 2026-08-19.

**Touched files:**
- `services/gpsManager.ts` — the single ingest seam (`processFix`) + watch lifecycle
- `services/holeDetection.ts` — sustained-position hole advance
- `services/backgroundLocationTask.ts` — background keepalive
- `services/courseGeometryService.ts` + `store/courseGeometryOverrideStore.ts`
- `services/simulatedGPS.ts` (desk verification only — never a substitute for a real round)

**Pass criteria:**
- Permission prompt appears once; denial produces a **user-visible** toast, not
  just a console line.
- A first accepted fix arrives with a plausible accuracy (single-digit metres
  outdoors).
- Yardage to the green is a real number, or an honest "No live yardage on this
  course" with anchor capture offered — never a bare "—".
- Standing still does **not** starve the watch of fixes (`distanceInterval: 0`;
  regression risk — a non-zero filter suppresses all callbacks while a golfer
  reads a putt, which cascades to stale → hard-clear → no yardage).
- Walking to the next tee auto-advances the hole within ~30s.
- Backgrounding the app (pocket) keeps positions flowing.
- An outlier fix is rejected without poisoning the smoothing buffer.

**Diagnostic markers (grep `path5:gps`, plus the existing `[gps]` family):**
- `[path5:gps] permission granted=true|false`
- `[path5:gps] watch_started accuracy=N wanted=M interval_ms=X` — an `accuracy`
  below `wanted` means the device fell down the accuracy ladder
- `[path5:gps] first_fix accuracy_m=N source=live|background|sim` — fires **once**
  per session; its absence is the single clearest signal that GPS never worked
- `[gps] lastFix stale — degraded to low confidence` — 60s with no fresh fix
- `[gps] lastFix hard-cleared` — 300s; a good fix has just been discarded
- `[gps:outlier-rejected] …`, `[gps:sim-rejected]`, `[gps:mark-rejected]`
- `[holeDetection] …` — hole advance decisions
- `[path2:round] hole transition prev=A next=B reason=auto|manual|mark`

**MIN VERIFY (~20 min — must be OUTDOORS, on a real course):**
1. Fresh launch on the course. Confirm `permission granted=true`, then
   `watch_started`, then `first_fix` with a single-digit `accuracy_m`.
2. Stand still on a tee for 2 full minutes. Confirm **no** `stale` degrade — this
   is the exact Green Hill failure and it only reproduces while stationary.
3. Confirm the hole-1 yardage is a real number and moves as you walk.
4. Walk to the next tee. Confirm auto-advance within ~30s and a
   `hole transition … reason=auto`.
5. Pocket the phone for one hole. Confirm positions still flow and the hole
   advanced on arrival.
6. Check for `hard-cleared` anywhere in the trace — one occurrence during a
   normal round is a defect, not noise.

**Failure modes to watch:**
- `first_fix` never appears → GPS never produced a usable position; everything
  downstream (yardage, hole advance, shot distance) is fabricated or blank.
- `stale` while standing still → the `distanceInterval` regression.
- `hard-cleared` during play → a good fix discarded; yardage goes blank and the
  caddie starts asking the golfer for distances.
- Hole advances on the wrong hole, or advances while sitting in a cart at the
  turn.
- Accuracy silently degrading (ladder fallback) with no user-facing signal.

---

## Path 6 — SCORECARD

Enter a score (any surface) → it persists → it survives the round → the scorecard
and the recap agree.

> **Added 2026-08-19.** Scoring was implicit in Path 2, which only asserted that
> the scorecard "shows accurate scores per hole". That is not enough for the
> failure this path exists to catch: **scores are writable from four different
> surfaces** — scorecard tap, cockpit stepper, voice, and brain tool dispatch —
> and the recurring bug is that a score lands on the *wrong hole* or a correction
> *appends* instead of *replacing*. Those look identical on screen to a normal
> entry.
>
> All four surfaces funnel through one seam, `roundStore.logScore`, which is the
> only place a marker can prove "what the player entered is what was stored"
> regardless of surface. Instrumented 2026-08-19.

**Touched files:**
- `store/roundStore.ts` — `logScore` (the one seam), `logShot`, `endRound`, undo
- `app/(tabs)/scorecard.tsx` — the grid, quick-score chips, share
- `components/caddie/CockpitCaddieScreen.tsx` — the stepper
- `services/intents/logScoreHandler.ts`, `services/intents/logPuttsHandler.ts`
- `services/voice/conversationalToolDispatch.ts` — the `log_score` tool case
- `services/courseImport.ts` — scorecard-photo ingest

**Pass criteria:**
- A score entered on ANY surface lands on the hole the player meant — not on
  `currentHole` when GPS or first-score auto-advance has moved it underneath.
- Re-scoring a hole **replaces**; it never accumulates. Quick-score placeholders
  (`qs-<hole>-<n>`) are cleared before the rewrite, or recap / GIR / fairway /
  club-usage stats silently corrupt.
- A bare score tap does **not** fabricate putts. Putts unset → the hole is
  skipped in putt/GIR stats (honest) rather than counted as a made-up two-putt.
- "Scratch that" restores both the prior score **and** the hole you were on.
- Totals and vs-par match the per-hole grid; vs-par is `null`, not 0, when no
  scored hole has a known par.
- After End Round the scorecard renders from the **persisted** record, and the
  hole count matches what was played.
- Multi-photo scorecard ingest merges rather than overwriting.

**Diagnostic markers (grep `path6:scorecard`):**
- `[path6:scorecard] score_write hole=N score=M prev=P kind=first|correction`
  — `kind` is the point: a correction that logs as `first` means the prior value
  was not read, and a `first` that logs as `correction` means a phantom score
  already existed on that hole
- `[path6:scorecard] round_persisted holes_with_scores=N shots=M total=T`
  — the boundary between live round state and the saved record. A "scorecard
  shows fewer holes than I played" report is answerable from this one line:
  either the record was written short, or the scorecard read it wrong. Those are
  different bugs and previously looked the same.
- `[path2:round] shot logged hole=X club=Y`
- `[roundStore] …` for store-level detail

**MIN VERIFY (~10 min):**
1. Start a round. Score hole 1 from the **scorecard tab** → expect
   `score_write hole=1 score=N prev=0 kind=first`.
2. Re-score hole 1 with a different number → expect `kind=correction` with the
   right `prev`, and confirm the grid shows the new value, not a sum.
3. Score hole 2 **by voice** ("I made a five on two") → confirm `hole=2`, not
   whatever `currentHole` has drifted to.
4. Score hole 3 from the **cockpit stepper**. Say "scratch that" → confirm the
   score AND the current hole both revert.
5. Confirm no putts were invented on any bare score tap.
6. End Round → check `round_persisted` counts against what you actually played,
   and confirm the scorecard and recap agree.

**Failure modes to watch:**
- Score lands on the wrong hole from the voice or cockpit path (the recurring
  class; four surfaces, one of them usually missed by a fix).
- Re-scoring accumulates → recap, GIR, fairway and club-usage all skew.
- Fabricated putts appearing in stats.
- Undo restores the score but not the hole.
- `round_persisted` count < holes played → the record was written short.

---

## Beta-readiness verdict

**External beta requires:** all **six** critical paths verified end-to-end on a
real device within the last 7 days, on a real round (not just simulated). Until
that's true: internal personal beta only. No external testers.

> **2026-08-19 audit.** Before this pass, instrumentation coverage was:
>
> | Path | Markers documented | Actually emitted | Verdict |
> |---|---|---|---|
> | 1 ONBOARD | 7 | **1** — and not on this flow | gate unrunnable |
> | 2 ROUND | 9 | 9 | healthy |
> | 3 CAGE | 7 | 61 call sites, different format | doc wrong, code fine |
> | 4 VOICE | 10 | 15 | two marker names wrong |
>
> Paths 1, 3 and 4 are corrected above; Path 1 is newly instrumented. **A gate
> that cannot fail is not a gate** — Path 1 had been cited as one in CLAUDE.md's
> phase discipline since May while returning an empty grep either way.

**Test fleet reality (2026-08-19).** Tier-C (device-verified) coverage exists for
**iPhone via TestFlight only**. Android, Galaxy Fold and Wear OS have no device in
the current fleet, so findings there are code-traced (Tier B) at best. Say so in
any readiness claim rather than implying parity — see `docs/device-os-matrix.md`.

**Last verification dates** (update after each MIN VERIFY pass):
- Path 1 ONBOARD: _not verified_ (newly instrumented 2026-08-19 — first run pending)
- Path 2 ROUND: _not verified_
- Path 3 CAGE: _not verified_
- Path 4 VOICE: _not verified_
- Path 5 GPS: _not verified_ (requires a real outdoor round)
- Path 6 SCORECARD: _not verified_

## Pre-deployment gating (applies to every future phase)

Before any phase that touches a critical path is declared shipped:
1. Phase report **explicitly states** which critical path(s) the phase touches.
2. Phase report **states expected behavior** per touched path.
3. **Tim verifies** that path works end-to-end on the dev-client before declaring
   the phase confirmed shipped.
4. If path verification fails, the phase is **not shipped** — it's pending fix.
   Targeted fix scoped to the failure (not bundled with other work). Re-verify
   after fix. Only then proceed with other phase work.

This gating discipline is the contract. It is also recorded in `CLAUDE.md` so
Claude Code applies it to every future phase response.
