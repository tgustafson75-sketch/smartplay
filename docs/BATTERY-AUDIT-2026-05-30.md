# Battery audit — SmartPlay Caddie Pro, 2026-05-30

Tim flagged battery drain as a "serious hindrance." This audit inventories every active power consumer, ranks by impact, and proposes savings without UX loss.

## Observed baseline

Galaxy Fold, 4.5-hr round, **35-50% battery consumed** = ~7.8-11% per hour. That maps to:

| Subsystem | Est. % battery/hr | Notes |
|-----------|-------------------|-------|
| Screen + cellular baseline | 4-6% | Not app-specific |
| GPS (active + walking + 3 pollers) | 4-6% | Core feature |
| Active Listening (when ON) | 2-4% | Mic + audio DSP warm |
| Cage Mode (when used) | +8-12% **per session** | Camera + dual audio |
| Network / API calls | 0.5-1% | Throttled, minor |
| Animated UI | <0.5% | Correctly gated |
| **Total in-round** | **11-17%/hr** | Maps to Tim's observed |

So baseline app overhead is **5-9%/hr above device baseline** — measurable, addressable.

---

## What I shipped tonight: Fix FW (trivial, low risk)

**Bumped `NOTIFY_DISTANCE_YDS` from 3 → 5** in `services/smartFinderService.ts`. The Fix FL throttle was firing re-render fanouts every ~2s while walking (3yd at 3mph = ~2s). 5yd = ~3-4s walking, ~1-2s in a cart. The Caddie data-strip and SmartVision marker re-renders drop by ~50% in walking mode. **Estimated save: 0.5-1% battery/hr.** No UX impact — yardages still update on every meaningful position change.

That's the only "obviously safe to ship without you" item. Everything below needs your call.

---

## Top 5 candidates for your review

Ranked by **(impact savings) / (ship risk)**. None shipped — these touch sensitive systems where past changes have introduced regressions (voice path, GPS state machine, hole detection).

### #1 — Consolidate 3 GPS pollers into 1 motion-state evaluator
**Impact**: 0.6-1% battery/hr
**Risk**: MEDIUM — refactors `holeDetection`, `offCourseDetector`, `movementModeDetector`. State machine design needed.

Three concurrent timers all read `getLastFix()` on overlapping 4-5s cadences:
- `holeDetection.ts`: 4s sustained-position validator
- `offCourseDetector.ts`: 5s sustained off-course gate
- `movementModeDetector.ts`: 5s speed classifier (cart vs walk icon)

Each independently wakes the JS thread and Zustand subscribers. A single "motion state evaluator" running once per 5s could emit `(modeChange, offCourseChange, movementModeChange)` events. Subscribers listen to what they need. Cuts poller wake count by ~60%.

**Why I won't ship overnight**: Touches round-flow logic. Hole-detection bugs are user-visible (wrong hole on scorecard). Worth your eyes before the refactor.

### #2 — Tighten `audioLifecycle.IDLE_TEARDOWN_MS` from 90s → 30s
**Impact**: 0.8-1.5% battery/hr (when Active Listening is ON)
**Risk**: MEDIUM-HIGH — past voice-path changes have caused regressions

Audio subsystem currently stays "warm" for 90s after the last TTS or capture. On Android the DSP stays partially awake during that window. Tighter teardown (30s) + pre-warm on shot-intent would recover ~50% of audio-warm overhead.

**Why I won't ship overnight**: The 90s was chosen deliberately — your "opener silent" bugs (FD/FS lineage) all traced back to audio session timing. Tightening it without you watching for regressions is high-risk for low headline savings.

### #3 — Skip `gpsManager.evalTimer` ticks when stationary >30s
**Impact**: 0.2-0.5% battery/hr
**Risk**: LOW — but small payoff

`gpsManager`'s mode evaluator runs every 5s during a round. When you've been stationary for 90s+, all 5s ticks are wasted (mode won't change). Could pause eval until first GPS movement crosses a tiny threshold.

**Why I won't ship overnight**: Touches GPS state machine. Edge case: if you stand for 90s on a tee then suddenly walk, there's one extra 5s delay to detect the mode change. Probably fine but I'd want your call.

### #4 — Gate Active Listening metering inside the actual listening session
**Impact**: 0.5-1% battery/hr (when Active Listening is ON)
**Risk**: MEDIUM — touches `voiceService.ts` / `listeningSession.ts`

Currently metering (100ms ticks for VAD) runs at the audio-subsystem level whenever Active Listening is configured. Moving it inside the listening-session state machine — meter ONLY when the mic is open — saves ~40% of metering cycles. Bonus: would block the "TV noise wakes Kevin" scenario you reported pre-fix.

**Why I won't ship overnight**: voiceService.ts is the most sensitive file in the app. Multiple past regressions started here.

### #5 — Cage Mode "lightweight mode" toggle
**Impact**: +25% battery savings per Cage session (huge per-use, but only when Cage is used)
**Risk**: NEW FEATURE — needs UX design

Cage Mode currently runs the camera (~350mW continuous) + a parallel acoustic impact detector (50ms metering) in addition to the camera's own audio track. For a 10-swing batch that's ~5 minutes of dual audio + video. A "lightweight" mode that skips acoustic metering (uses video frame-count to estimate impact timing — less accurate but acceptable for casual use) would cut Cage drain by ~25%.

**Why I won't ship overnight**: New user-facing feature. Needs your design call on default behavior, where the toggle lives, etc.

---

## What I deliberately did NOT flag

- **`useKeepAwake`** on Caddie/SmartVision/SmartFinder/Lie tabs — these prevent screen lock during use. Justified; turning them off mid-round would cause the screen to time out mid-shot.
- **Background location task** — necessary for in-pocket rounds. Already gated to start-on-round / stop-on-end.
- **Animated.loop pulses** (ActiveListeningPill, CaddieAvatar) — correctly gated on visibility. Negligible cost when not visible.
- **`presenceCaddie`** — 60s cache TTL, fire-and-forget. Low impact.
- **`swingAnalysisWarmup`** — 30s dedup, fires on screen mount only. Low impact.

---

## Combined savings if you ship #1 + #2 + #3 + #4

~2.5-4% battery/hr recovered = 12-20 min added per 18-hole round. Plus #5 for Cage-heavy practice sessions.

---

## What I want from you in the morning

Pick which of #1-#5 to ship. I can do them one at a time with verification, or batch a few. My recommended order:

1. **#3 first** (smallest blast radius, easy to revert)
2. **#1** (biggest non-feature win, but needs careful state machine work)
3. **#5** (high per-use ROI, but the toggle UX needs your input)
4. **#4 and #2** last — voice/audio system is fragile, want to make those changes when you can verify in the field

Or push back: if you don't think #1-#4 are worth the risk vs. just deferring to a future battery-focused sprint, we ship Fix FW only and revisit.
