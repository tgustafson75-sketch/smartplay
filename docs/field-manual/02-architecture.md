# 02 — Architecture

## Brain / persona cascade

The caddie brain is an abstracted LLM layer that flows through:

```
voice text or tap → /api/voice-intent (classifier) → VoiceIntent
                  → voiceCommandRouter.dispatch
                  → IntentHandler.execute(intent, AppContext)
                  → IntentResult { voice_response, side_effects, tool_action }
                  → auto-speak voice_response via voiceService.speak
                  → optional tool_action (navigate, open camera, etc.)
```

Key entry points:
- [services/voiceCommandRouter.ts](../../services/voiceCommandRouter.ts) — the dispatcher (intent → handler).
- [services/intents/index.ts](../../services/intents/index.ts) — the singleton router with all handlers registered.
- [api/voice-intent.ts](../../api/voice-intent.ts) — Anthropic-backed classifier that turns transcribed text into a `VoiceIntent` (language auto-detect for ES/ZH triggers).
- [api/brain.ts](../../api/brain.ts) + [api/kevin.ts](../../api/kevin.ts) — free-form conversation (non-tool-use) and tool-use intent routing.
- [services/voiceService.ts](../../services/voiceService.ts) — TTS layer; `speak(text, gender, language, apiUrl)` is the production speech path. Trust-gated via `isVoiceAllowed`.
- [services/caddieResolver.ts](../../services/caddieResolver.ts) — which persona is "active" for the current surface (pillar assignment).

### Abstracted LLM layer

The app does NOT bake "Claude" into any UI copy. The model selection is server-side (Anthropic Sonnet 4.6 for vision + brain, OpenAI Whisper for transcribe, ElevenLabs for TTS). Switching providers is a route-level swap, not a client refactor.

### Tool-use intent routing

`api/kevin.ts` returns a structured `tool_action` payload that the client routes through handlers (open SmartFinder, start cage session, log a shot). The same shape feeds the voice path so a typed instruction and a spoken instruction produce the same result.

### voice_response auto-speak

Every `IntentResult.voice_response` that isn't null gets piped through `voiceService.speak` automatically when the path is voice-driven. Tap paths don't auto-speak (they may include a `voice_response` for the caption strip but rely on the user's tap → text echo). Trust-spectrum gating happens inside `speak`.

---

## Navigation

### ••• menu / badge model

Top-of-screen badges (brand row, caddie state badge, trial pill) live in `app/(tabs)/caddie.tsx` for the round surface and in the tab headers elsewhere. The ••• menu (global tools menu) sits under [components/tools/GlobalToolsMenu.tsx](../../components/tools/GlobalToolsMenu.tsx) — a single owner-aware sheet that surfaces SmartFinder, SmartVision, TightLie, debug tools, Settings.

The badge model means most tabs intentionally do NOT have header rows competing for the top of the screen — the brand wordmark + state badge + trial pill stack from `insets.top` and the rest of the screen is content.

### Tabs

[app/(tabs)/_layout.tsx](../../app/(tabs)/_layout.tsx) defines five tabs: Caddie (round), Play (course discovery), Dashboard, SwingLab (practice hub), Scorecard. Each is a single screen file in `app/(tabs)/`.

---

## GPS + hole rendering

Single adaptive subscription in [services/gpsManager.ts](../../services/gpsManager.ts) with three modes:
- **active** — 1 Hz BestForNavigation when a round transition is imminent.
- **walking** — ~3-5 s interval when the player is moving but not transitioning.
- **stationary** — 15 s / 30 s floor when standing still or backgrounded.

The orchestrator suppresses auto-fire above 4 m/s (cart speeds) per [[cart-is-default]] — the cart is the verification baseline, not walking.

### Hole rendering chain (Golfshot / Vector / override)

`resolveGreenCoords(holeNumber)` in [services/smartFinderService.ts](../../services/smartFinderService.ts) cascades in priority order:

1. **truth** — surveyed on-foot ground truth from [services/courseTruth.ts](../../services/courseTruth.ts) (`getCourseTruthSync`). Captured via the CourseTruth dev screen; one AsyncStorage key per courseId+hole.
2. **override** — user-captured Mark Green via [services/courseGreenOverrides.ts](../../services/courseGreenOverrides.ts).
3. **courseHoles** — Golfshot-style F/M/B yardage from the golfcourseapi cached `courseHoles` array on roundStore.
4. **geometryCache** — locally cached vector geometry from [services/courseGeometryService.ts](../../services/courseGeometryService.ts) (golfbert / fetchCourseGeometry).
5. **none** — no usable coords; UI shows `—` and an honest "we don't have geometry for this hole" hint.

The `source` field is returned so spoken yardage and on-screen yardage agree on the same number (no drift). [SmartVision](../../app/smartvision.tsx) and [SmartFinder](../../app/smartfinder.tsx) both go through this resolver.

---

## Metrics + honesty / confidence framework

[services/swingMetricsService.ts](../../services/swingMetricsService.ts) is the canonical metric composer. Every metric is a `SwingMetric`:

```ts
{
  value: number | null;
  unit: string;
  source: 'watch' | 'measured' | 'acoustic' | 'pose' | 'profile' | 'placeholder' | 'calibrated';
  confidence: number;            // 0-1
  confidenceLabel: 'high' | 'med' | 'low';
  range?: { lo: number; hi: number } | null;
  estimateNote?: string;         // human-readable methodology
  hidePrefix?: boolean;          // when true, omit the `~`
}
```

### Source taxonomy

- **truth-grade** — `watch`, `measured`, `calibrated`. Never gets the `~` prefix; can reach `high` confidence.
- **estimate** — `pose`, `acoustic`. Confidence ceiling is `med` regardless of input quality. Always prefixed `~`.
- **profile** — player's own historical typical (e.g. their actual driver carry). High-confidence in the sense that it's THEIR number, but rendered with the `~` so we're honest about it being an average.
- **placeholder** — null metric; renders `—` and an empty methodology note.

### Compounding gate

When a metric is derived from two parents (smash_factor = ball_speed / club_speed), confidence inherits worst-of-parents and the source falls through to the weaker parent. If EITHER parent is `low`, the derived metric is suppressed entirely (`—`) rather than printing a misleading number. See [services/swingMetricsService.ts:395-432](../../services/swingMetricsService.ts) for the gate.

### The `~` prefix rule

Any metric whose `source` is in `{pose, acoustic, profile}` renders with a leading `~` so the user reads "approximately." `hidePrefix: true` only fires for truth-grade sources. See [components/swinglab/MetricCard.tsx](../../components/swinglab/MetricCard.tsx).

---

## Capture pipeline

Three capture surfaces, one analysis pipeline:

### SmartMotion ([app/swinglab/smartmotion.tsx](../../app/swinglab/smartmotion.tsx))
Quick single-swing capture from any screen with the camera. Records a short clip → uploads to `/api/swing-analysis` (Sonnet vision) → returns a `PrimaryIssue` with `primary_fault`, `cause`, `fix`, `drill`, `evidence`. Also runs a parallel `acousticImpactDetector` so we can stamp acoustic-derived ball speed onto the swing. Two-card metrics layout per Phase 416.

### Cage Mode ([app/swinglab/cage-mode.tsx](../../app/swinglab/cage-mode.tsx))
Full practice session: multi-shot session with per-shot perShotAnalysis + a session-level rollup PrimaryIssue. Acoustic detection in multi-shot mode (peak-then-decay validation). Auto-coach loop drives Tank/Coach commentary between swings when enabled.

### Quick Record (on-course)
Record-this-shot voice trigger during a round → captures clip → flows through the same `/api/swing-analysis` path. Result lands in the round's shot card.

All three end at the same store: [store/cageStore.ts](../../store/cageStore.ts). Session lives at `activeSession.shots[]`; each shot can carry a `perShotAnalysis` + `feel_narration_transcript` (owner-only) + the session itself carries a `primary_issue` (GolfFix structured payload).

---

## Trust Spectrum (L1–L4 + L5)

[store/trustLevelStore.ts](../../store/trustLevelStore.ts) defines five levels:
- **L1 — Quiet** — silent except user-initiated taps. `voiceService.isVoiceAllowed` blocks proactive speech unless `opts.userInitiated === true`.
- **L2 — Companion** — proactive cadence dampened (debounce doubled). User wants the caddie available, not chatty.
- **L3 — Active** — standard proactive cadence (default).
- **L4 — Full** — more proactive. Auto-coach fires more readily.
- **L5 — Cockpit** — minimal surface (avatars hidden, focus on data). Treated like L1 for proactive speech in some code paths (e.g. `caddieRewards.ts` short-circuits at L1 + L5).

The trust level is a single source of truth read by:
- [services/voiceService.ts](../../services/voiceService.ts) — speech gate.
- [services/caddieRewards.ts](../../services/caddieRewards.ts) — 250+ drive + 1-putt celebration gate.
- [services/proactiveKevin.ts](../../services/proactiveKevin.ts) — proactive trigger debounce (L2 = 4-min, L3+ = 2-min).
- [services/gpsConfidenceAsk.ts](../../services/gpsConfidenceAsk.ts) — proactive "what hole are you on?" gate.

Settings UI exposes the slider with `TRUST_LEVEL_SLIDER_ORDER` (=[1,5,2,3,4]) so L5 sits visually adjacent to L1 (both minimal-surface), not at the top of the scale.
