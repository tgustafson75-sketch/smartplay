# Critical Path Verification Gates

Phase AO discipline. The four end-to-end paths that define v1.0 readiness.
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

Cold install → onboarding screens → Caddie home with profile populated.

**Touched files (typical):**
- `app/onboarding/welcome.tsx`
- `app/onboarding/name.tsx`
- `app/onboarding/mode.tsx`
- `app/onboarding/home-course.tsx`
- `app/onboarding/ready.tsx`
- `app/onboarding/meet-kevin.tsx`
- `store/playerProfileStore.ts`
- `store/trustLevelStore.ts`

**Pass criteria:**
- Each screen displays long enough to read (≥2.5s minimum gate on welcome).
- Kevin photoreal portrait visible from welcome.tsx forward.
- No two message blocks visible simultaneously on any screen.
- Trust level lands on L2 (Companion) by default.
- Profile saved to playerProfileStore before navigating to caddie.
- Lands on `/(tabs)/caddie` with bottom tab bar visible.

**Diagnostic markers (grep `[path1:onboard]`):**
- `[path1:onboard] welcome shown`
- `[path1:onboard] name screen`
- `[path1:onboard] mode screen`
- `[path1:onboard] home-course screen`
- `[path1:onboard] ready screen`
- `[path1:onboard] meet-kevin shown trust=N`
- `[path1:onboard] complete -> caddie profile_set=true|false`

**MIN VERIFY (~10 min):**
1. Fresh install (or wipe app data).
2. Open app → confirm welcome.tsx with Kevin portrait visible.
3. Tap through each onboarding screen, reading the text on each.
4. Land on Caddie home → confirm L2 default trust level chip visible.
5. Confirm bottom tab bar shows 5 tabs (Caddie / Play / Score / Swing / Stats).
6. Verify in playerProfileStore: name set, handicap set, has_completed_onboarding true.

**Failure modes to watch:**
- Kevin badge instead of portrait (regression on Phase AJ asset swap).
- "Let's go" CTA enabled before 2.5s gate (regression on Phase AJ pacing).
- Two message blocks visible after voice response (regression on Phase AJ overlap fix).
- Lands on a non-caddie tab.
- Profile not persisted across install.

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

**Diagnostic markers (grep `[path3:cage]` — many already in V6-DIAG via `[V6-DIAG]`):**
- `[path3:cage] setup overlay_visible=true`
- `[path3:cage] check_position result=ready|not_ready`
- `[path3:cage] recording_start`
- `[path3:cage] recording_stop seconds=X`
- `[path3:cage] analyze_result kind=ok|no_frames|error frames=N`
- `[path3:cage] primary_issue id=X confidence=Y`
- `[path3:cage] drill_opened id=X issue=Y`

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
- `services/positionMarkBus.ts` (when "mark my position" voice intent shipped)
- `hooks/useVoiceCaddie.ts`
- `hooks/useVoiceActivityDetection.ts` (auto-listen mode)
- `api/kevin.ts` (response generation)

**Pass criteria:**
- Earbud tap **OR** on-screen badge tap engages listening within 200ms.
  - NOTE: native Bluetooth media-key listener is currently a stub (Phase AC). On-screen tap is the working fallback until a Kotlin module ships.
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
- `[path4:voice] filler_start category=X cached=true|false`
- `[path4:voice] filler_end ms=X`
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

## Beta-readiness verdict

**External beta requires:** all four critical paths verified end-to-end on a real
device within the last 7 days, on a real round (not just simulated). Until that's
true: internal personal beta only. No external testers.

**Last verification dates** (update after each MIN VERIFY pass):
- Path 1 ONBOARD: _not verified_
- Path 2 ROUND: _not verified_
- Path 3 CAGE: _not verified_
- Path 4 VOICE: _not verified_

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
