# Phase BJ — Research Summary + Build Decisions

**Date:** 2026-05-04
**Scope:** 10 capabilities researched; concrete build/queue decision per capability with reasoning.

---

## Decision matrix

| # | Capability | Verdict | Scope | Doc |
|---|---|---|---|---|
| 1 | MediaPipe pose detection | 🟡 QUEUE | 22-30h (exceeds 8h threshold) | [research-mediapipe.md](research-mediapipe.md) |
| 2 | Watch IMU integration | 🟡 QUEUE | 30-60h+ (separate native build) | [research-watch-imu.md](research-watch-imu.md) |
| 3 | Background haptics (literal) | 🟡 QUEUE — iOS prohibits | n/a | [research-haptics.md](research-haptics.md) |
| 3' | **Local-notification haptics (pivot)** | 🟢 **BUILD-TODAY CANDIDATE** | **6-9h** | [research-haptics.md](research-haptics.md) |
| 4 | Audio classification (cage strikes) | 🟡 QUEUE | Multi-week (training data) | [research-audio-classification.md](research-audio-classification.md) |
| 5 | Hand tracking | 🟡 QUEUE | Depth feature, post-foundation | [research-hand-tracking.md](research-hand-tracking.md) |
| 6 | AR overlay | 🟡 QUEUE | 4-6 weeks | [research-ar-overlay.md](research-ar-overlay.md) |
| 7 | Voice biometric for player ID | 🟡 QUEUE — bind to multi-player phase | n/a until 1.1 | [research-voice-biometric.md](research-voice-biometric.md) |
| 8 | **Streaming TTS via OpenAI** | 🟢 **BUILD-TODAY CANDIDATE** | **~11h** | [research-streaming-tts.md](research-streaming-tts.md) |
| 9 | iOS Live Activities + Dynamic Island | 🟡 QUEUE — Tim has no iOS device | n/a | [research-live-activities.md](research-live-activities.md) |
| 9' | Android persistent-notification equivalent | ⚪ DEFER (subsumed by #3' if shipped) | 3-5h | [research-live-activities.md](research-live-activities.md) |
| 10 | Health Kit / Google Fit | 🟡 QUEUE — low priority pre-beta | 4-16h | [research-health-integration.md](research-health-integration.md) |

**Total BUILD-TODAY candidates surfaced: 2**

---

## What was *almost* BUILD TODAY but didn't make the bar

- **MediaPipe** — closest mature library (`cdiddy77/react-native-mediapipe`) requires `react-native-worklets-core`, but this project uses `react-native-worklets` 0.5.1 (different package; required by `react-native-reanimated` 4.x). The Expo SDK 54 / Fabric / worklets stack hasn't yet stabilized against any MediaPipe wrapper. Re-check in 3-6 months. If forced today, `@quickpose` v0.2.5 is the lowest-risk pick at ~22-30h scope.
- **Background haptics** — iOS literally prohibits at the platform level (no entitlement exists). Pivoting to local notifications gets the same user experience cross-platform; that's the green-lit candidate above.
- **Streaming TTS true SSE** — feasible (OpenAI ships `stream_format: "sse"` + PCM chunks) but `expo-av` can't consume PCM chunks; would need `@mykin-ai/expo-audio-stream` (unmaintained-shaped). Path 1A (sentence-pipelined) achieves the headline latency win without that dependency.

---

## Recommended next phases (BUILD-TODAY queue)

Each becomes its own focused phase prompt. Tim greenlights individually.

### Phase BO — Round-state haptic notifications (~6-9h)
- Adds `expo-notifications` + permissions onboarding step
- New `services/proximityNotifier.ts` watches GPS for threshold crosses
- Custom vibration patterns per event type (yardage / hole / mark)
- Settings toggle for each event class
- Galaxy Z Fold empirical verification on locked-screen pocket scenario
- **Why this phase:** delivers concrete value before next round attempt — phone in pocket vibrates on yardage threshold, no app interaction required. Cross-platform from day one.
- **Privacy impact:** zero new processors (notifications are OS-fired locally); only adds a Notifications section to the in-app explainer.

### Phase BP — TTS sentence pipeline (~11h)
- Sentence splitter + bounded-concurrency TTS request pool
- `services/voiceService.ts` `speakFromBase64` queued sequential `Audio.Sound` chain
- New `services/ttsQueue.ts`
- TTFA / total instrumentation
- **Why this phase:** voice latency is the single most-felt "is this app useful?" signal. Cuts TTFA from ~3-6s to ~600ms-1.2s for typical Kevin responses. Cost-neutral. No new deps. No native module work.
- **Risk:** sentence-boundary prosody on Kevin's incomplete-sentence caddie register. Tunable; mitigated by min/max chunk-length bounds.

### Phase BQ (optional, only if you want it) — Persistent round-state notification (3-5h)
- Android-only persistent notification with current hole + yardage
- Glanceable on lock screen / notification shade
- Subsumed by Phase BO if BO ships first (the threshold notifications already cover the same surface)
- **Why this phase:** glanceable status without unlocking phone. Smaller scope than iOS Live Activities (which is QUEUE'd anyway).

---

## What's *not* on the candidate list and why

These could also be argued as BUILD-TODAY but explicitly aren't:

- **Phase K timeout + heuristic fallback** — already surfaced as URGENT-1 in [migration-gap-analysis.md](migration-gap-analysis.md). Not a Phase BJ research output, but adjacent. Should ship before either BO or BP. Unrelated to research findings.
- **Avatar dual-import audit** — also URGENT in migration gap analysis. Doesn't depend on any of the BJ research.
- **Onboarding routing canonicalization** — HIGH in migration gap analysis. Independent.

These three plus BO + BP form a reasonable next-phase queue. Suggested sequence:
1. **U1** Phase K timeout + fallback (1-2h) — smallest risk reduction
2. **U2** Avatar dual-import audit (1-2h) — clears CLAUDE.md ambiguity
3. **BO** Haptic notifications (6-9h) — round-attempt readiness
4. **BP** TTS sentence pipeline (11h) — voice-quality improvement before external beta

Total: ~20-24 hours of focused phase work, zero net QUEUE overhead from BJ research.

---

## What this phase does NOT do

- Build any of the candidate phases (BO / BP). Those become separate, focused prompts after Tim greenlights.
- Reverse any of the QUEUE classifications. The research evidence supports each QUEUE; future re-evaluation triggers are listed in each per-capability doc.
- Add any new dependencies to `package.json`. Research-only.

---

## Update for `master-compendium.md`

A `master-compendium.md` doesn't currently exist in the repo. If/when Tim wants one, the seed structure would be:

```
docs/master-compendium.md
├── Active phases (in-flight)
├── Build-today queue (BO, BP candidates from this research)
├── Queued capabilities (Watch IMU, MediaPipe, AR, Audio classification,
│   Hand tracking, Voice biometric, Live Activities, Health Kit)
├── Verified-shipped phases (per git log + commit-message inventory)
└── Decisions log (link to v1-scope-final.md, audits/, research/, etc.)
```

This is its own deliverable and would be ~2-4h to populate fully from current docs. Out of Phase BJ scope; flagging as a candidate maintenance task.
