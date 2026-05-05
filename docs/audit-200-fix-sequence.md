# Phase 200 — Component 5: Targeted Fix Sequence

**Audit date:** 2026-05-05
**Bundle SHA:** `c170ec5`

Derived from Components 1–4. Sequenced by severity + dependency. Per Phase 200 spec: "no fix is shipped without empirical Z Fold verification."

## Critical insight from Components 1–4

**The single highest-leverage action in Phase 200 is empirical verification, not new code.** Eight phases shipped this session (105 / 106 / 107 / 108 / 109 / 110 / 111 + Common Faults collapse + DOMException hotfix + tee drag). All architectural — none verified on Z Fold yet.

Phase 200's fix sequence prioritises:

1. **F1 — Empirical verification gate** (no code, just Tim on Z Fold)
2. **Fixes targeted at gaps the verification surfaces** (we don't know which until Tim runs)
3. **Cleanup that's independent of verification** — not much; lint/tsc/doctor are already 0/0 + 17/17

## Severity legend
- **BLOCKING** — defeats core feature value or blocks external beta
- **SIGNIFICANT** — degrades feature quality or trust meaningfully
- **MINOR** — polish, edge case, technical debt

## Fix proposals

### F1 — Empirical verification on Galaxy Z Fold (no code; gate)

**Severity:** BLOCKING (everything else gated by this)
**Owner:** Tim

**Scope:** Run the four MIN VERIFY scenarios from `audit-200-critical-paths.md`. ~90 min on device.

| Path | Time | Test |
|---|---|---|
| PATH 1 | 10 min | Cold install / wipe → onboarding through to Caddie home with non-Kevin persona; no Kevin flash |
| PATH 2 | 30-45 min | Round on a real course or Apple Maps walk; SmartFinder yardages match Garmin within 2-3y; voice log_shot fires; recap renders persona-aware |
| PATH 3 | 20-30 min | Cage Mode with 5 controlled swings + 5 noise events; per-shot Phase K analyses render; drill recommendation surfaces; Tank handoff plays on entering cage pillar |
| PATH 4 | 10 min | Voice through 4 caddies; verify per-persona ElevenLabs voice + media_capture intent fires + handoff lines on pillar transition |

**Outcome:** every UNKNOWN in Component 1 resolves to WORKING / PARTIAL / BROKEN. PATH 1-4 statuses update. Phase 200 verdict (Component 9) becomes writable.

**Estimated time:** 60-90 min on device.

### F2 — Vercel deployment sync verification

**Severity:** SIGNIFICANT
**Owner:** Tim

**Scope:** Confirm all 11 commits since `94e7d29` (Phase 100 audit-1-5 baseline) are deployed to Vercel. The persona-aware api/* routes from Phase 100 / B4 + the Anthropic prompt caching from Audit 101 / W4 + the SDK timeouts from Audit 101 / S7 all need server-side. If Vercel build is stale, any voice / brain / recap call to /api/* runs the old code.

**Verification:** open Vercel dashboard → smartplay-beta project → confirm latest deploy SHA is `c170ec5` (current main). If not, trigger redeploy.

### F3 — Phase 110 camera lifecycle (deferred-but-callable)

**Severity:** SIGNIFICANT (Phase 110 voice intents fire but nothing actually records yet)

**Scope:** Phase 110 voice intents (`media_capture`, `media_playback`) and the orchestration boundary (`services/mediaCapture.ts`) shipped. Camera surfaces (CageSessionOverlay) need to subscribe via `subscribeCapture` and drive expo-camera through the recording lifecycle. Currently the voice intent fires + caddie ack plays + capture is logged in `recentCaptures` but no file gets written.

**Files to touch:** new `components/ShotCaptureOverlay.tsx` (mounted on Caddie home, hidden by default, listens to subscribeCapture for `kind: 'shot' | 'highlight'`); CageSessionOverlay extension to listen for `kind: 'swing'`.

**Estimated scope:** 4-6 hours.

**Decision:** **DEFER to v1.1.x or v1.2** unless Tim wants to run the full Phase 110 verification. The architecture lets us land this incrementally. Voice intents firing without a camera surface is honest fallback (the caddie says "Recording" but Tim can confirm nothing actually captured) — slightly worse than nothing for v1.1 ship.

**Mitigation:** add a no-capture-surface guard to mediaCaptureHandler so the caddie says "Camera path isn't wired yet — try cage mode for swings" instead of falsely claiming recording. (~10 min fix.)

### F4 — Voice intent classifier confidence on log_shot / media intents

**Severity:** UNKNOWN until F1 runs

**Scope:** New intents added in Phase 109 (log_shot) and Phase 110 (media_capture / media_playback) extend the classifier system prompt to 18 intents. Haiku 4.5 with temperature 0 should handle this fine, but classifier accuracy on the new intents under real speech (with background noise + non-perfect ASR) is empirically TBD.

**Dependency:** F1.

**If F1 surfaces classifier issues:** add few-shot examples + tighten intent guidance in api/voice-intent.ts. ~30 min per iteration.

### F5 — Persona handoff voice tuning

**Severity:** MINOR

**Scope:** Phase 105 voice handoff lines + Phase 106 suggestion handoff lines are static strings. Tim may want to vary them or tune tone after hearing them in context.

**Decision:** DEFER until F1 generates the empirical hearing.

### F6 — Asset orphan cleanup (24 PNG/JPG, ~5.1 MB)

**Severity:** MINOR

**Scope:** documented in `docs/v1.2-deferred.md`. Tim walks the list per-row and decides KEEP / DELETE / RENAME.

**Decision:** v1.2.

### F7 — Edit / delete logged shots

**Severity:** MINOR

**Scope:** Phase 109 audit identified — schema supports it (shot.id), no actions or UI. v1.2.

## Sequence

```
1. F1   Empirical verification on Z Fold     [60-90 min, Tim]    BLOCKING
   ↓ blocks every other BLOCKING/SIGNIFICANT decision
2. F2   Vercel deployment sync verification   [5 min, Tim]        SIGNIFICANT
3. F3   Phase 110 camera surface (or mitigation guard) [10 min mitigation OR 4-6 hours full] SIGNIFICANT
4. F4   Voice intent classifier accuracy      [variable, after F1] UNKNOWN
5. F5   Persona handoff voice tuning          [variable, after F1] MINOR

Deferred to v1.1.x / v1.2:
- F6   Asset orphan cleanup
- F7   Edit/delete logged shots
- (per Phase 110 spec) Camera pre-arm + ring buffer
- (per Phase 109 spec) Ad-hoc tap-log UI
- (per Phase 108 spec) Multi-tee selection (no upstream data)
```

## What's NOT in the sequence

- **No new feature work.** Phase 200 spec scope is "stop building new" + audit + clean.
- **No speculative fixes.** Every BLOCKING / SIGNIFICANT item above is either gated on F1 evidence or trivially actionable (F2 = a Vercel dashboard check, F3 mitigation = a 10-min guard line).
- **No regression on the lint / tsc / doctor baseline** — already 0 / 0 / 17/17.

## Estimated total time

- F1 (Tim runs): 60-90 min
- F2 (Tim checks): 5 min
- F3 mitigation (recommended): 10 min code
- Any F1-surfaced fixes: variable (1-4 hours typical)

**Total v1.1 testing-readiness: 75-100 min Tim work + ~10 min code (F3 mitigation) before push for empirical testing.**
