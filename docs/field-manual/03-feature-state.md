# 03 — Feature state

Reads `working` / `partial` / `stubbed` / `deferred` per shipped feature, as of commit `017e56b` (end of pre-beta sprint).

## SmartMotion

**Status: WORKING** (with honest gates).

- **Real Sonnet vision read** — `/api/swing-analysis` returns a structured `PrimaryIssue` with `primary_fault`, `cause`, `fix`, `drill`, `evidence`. NOT a stub.
- **S1.1 evidence-gated fault selection** — when evidence is weak, the fault is `inconclusive` or `no_dominant_fault`, not a default "over-the-top." Killed the early-extension default; see commit `f468c52`.
- **TEMPORAL ANALYSIS prompt block** at [api/swing-analysis.ts:145-151](../../api/swing-analysis.ts) — prevents frame-1-anchoring (BUG #1 fix).
- **Acoustic ball speed** — parallel `Audio.Recording` via [services/acousticImpactDetector.ts](../../services/acousticImpactDetector.ts) runs alongside camera capture. Single-shot mode for SmartMotion. Renders as `~148 mph (acoustic, club-typical, med)`.
- **Skeleton overlay `__DEV__`-gated** — `StubSkeletonOverlay` never renders in production. The honest empty state is silence, not a fake pose trace. Commit `57aaa90`.
- **Club wiring** — `clubIdToSmashKey` / `clubIdLabel` helpers in [services/clubMetrics.ts](../../services/clubMetrics.ts); ClubPickerModal made props-overridable so SmartMotion + Quick Record + Cage all use the same picker. No fake "7I" default — when the user didn't pick a club, the metric is computed against `unknown` (1.36) or omitted. Commit `0ac173c`.
- **Feel capture (owner-only)** — when `feelCaptureEnabled` in Settings is on, the clip audio is Whisper-transcribed and stored on the shot as `feel_narration_transcript`. Paired with `perShotAnalysis` for future feel-vs-real calibration. NOT a user-visible feature; surfaces only on `/cage-debug`. Commit `ff30d6d`.

## SmartVision

**Status: WORKING** as a state container; rendering goes through Golfshot + Vector strategies.

- Two render strategies live in [components/SmartVisionLiveStrategy.tsx](../../components/SmartVisionLiveStrategy.tsx):
  - **Golfshot strategy** — satellite imagery overlay with F/M/B markers. Default.
  - **Vector strategy** — bundled SVG hole layouts (data/palmsImages.ts and the bundled per-hole vector set).
- Both render paths read green coords through `resolveGreenCoords` (Section 2 cascade) so spoken + visual yardages agree.
- Honest fallback: when there's no geometry, the strip renders `no_geometry` with a Mark Green prompt — NOT a silent `ok`. See Consolidation 5 Part 1.

## TightLie

**Status: WORKING** — single-frame lie analysis via Sonnet vision.

- Entry: voice intent "open TightLie" / "check my lie" → `/api/lie-analysis`.
- Returns `lie_category` + `recommendation` payload; persisted as `pendingLieAnalysis` on roundStore, then attached to the next logged shot's `lie_analysis` field.
- Surfaces at [app/lie-analysis.tsx](../../app/lie-analysis.tsx) (capture screen) and inline on shot detail cards.
- One-shot consumption: lie analysis is consumed by the next logged shot, NOT every subsequent shot, so a stale capture doesn't haunt the round.

## PLAY pillar

**Status: PARTIAL** — the visible scaffolding ships; the PLAY-specific social / arena experiences are pre-beta.

- Play tab ([app/(tabs)/play.tsx](../../app/(tabs)/play.tsx)) ships as a course-discovery / round-start surface (course locator, recent courses, GPS-sorted, "Start Round" CTA + pre-round factor pickers).
- Dashboard tab ([app/(tabs)/dashboard.tsx](../../app/(tabs)/dashboard.tsx)) shows weather + recent rounds + a high-level stats roll-up.
- Recap generation lives at [services/recapService.ts](../../services/recapService.ts) and renders via [components/recap/](../../components/recap/).
- Arena drills are scaffolded under [app/drills/](../../app/drills) but the social / sharing aspect is post-beta. See `BUILD-STATE-AUDIT.md` §C.

## Feel capture

**Status: OWNER-ONLY** dataset capture. Not for general users.

- Toggle: Settings → Owner Tools → Feel Capture.
- Pipeline: clip audio → `/api/transcribe` (Whisper) → `setShotFeelTranscript(sessionId, shotId, transcript)` on cageStore.
- Goal: build a labeled `{clip, transcript, analysis}` tuple corpus for future feel-vs-real calibration. See [services/feelCaptureService.ts](../../services/feelCaptureService.ts).
- Surfaces only on [app/cage-debug.tsx](../../app/cage-debug.tsx) (owner debug surface).

## Club recognition (sole-photo CV)

**Status: WORKING** end-to-end via Sonnet vision read of the club number.

- Pipeline: photo of club sole → `/api/club-recognition` → returns `{club_id, confidence}` → club picker pre-fills.
- Source confidence labeled as `vision` (med ceiling) so any caller can defer to manual user pick when needed.
- Architecture doc: [docs/club-recognition-architecture.md](../club-recognition-architecture.md).

## Voice / hands-free spine

**Status: WORKING** (with platform-build dependencies).

- Voice classifier auto-detects ES / ZH from transcribed text (commit `85e1ef8`) — no Settings change required for foreign-language utterances.
- Acoustic mic-tap, "Watch this," Quick Record fallback, ES/ZH text path all shipped (commit `291a207`).
- Meta glasses photo + video ingest (Android + iOS) shipped (commits `85259fc`, `fa7cadd`) — the watcher polls Photos / Google Photos for new Meta Glasses media and surfaces a banner; analysis flows through the existing swing-analysis path.
- **Bluetooth media-button** earbud-tap is currently a no-op on both platforms (react-native-track-player removed for New-Arch incompat); native bridge lives in the `.claude/worktrees/bt-media-button` worktree, needs an EAS Build cut to ship.

## Trust Spectrum

**Status: WORKING.** L1–L5 implemented per Section 2; UI slider uses the `TRUST_LEVEL_SLIDER_ORDER` (=[1,5,2,3,4]) so L5 sits adjacent to L1 (both minimal-surface).

## Caddie rewards (250+ drive, 1-putt)

**Status: WORKING** (this sprint). Persona-aware, trust-gated to L2–L4, measured-only for drives (requires `distance_yards > 250` AND `logged_via` set). 5 variants per event, randomized, no immediate repeat, per-event dedupe. See [services/caddieRewards.ts](../../services/caddieRewards.ts).

## Acoustic ball speed

**Status: WORKING** as an `estimate` tier metric.

- Parallel recorder approach: `Audio.Recording` runs alongside camera capture; metering peaks identify impact; club-typical smash factor derives ball speed from impact loudness × club lookup. Commit `516aab9`.
- Single-mic, no doppler — honest about the precision ceiling. `~148 mph (acoustic, club-typical, med)`.
- Cage-distance derivation from echo-delay (server-side `api/acoustic-detect.ts`) is real geometry; `ball_speed_mph: null` when no club (no silent 7I fallback — commit `532fbe5`).

## Pose-analysis

**Status: 200-WITH-NULL** (intentional honest stub).

- `/api/pose-analysis` is wired but returns `200 { keypoints: null, source: 'unavailable' }` when the RapidAPI pose-detection key isn't configured. Commit `232f7cc` (Fix H).
- SmartMotion shows the `~` pose-derived club speed only when keypoints land; otherwise omits the metric entirely.

## Swing-tempo backend

**Status: 501-STUB** (intentional v1.2.3 placeholder).

- `/api/swing-tempo` returns 501 — ffmpeg pipeline deferred to post-beta because Vercel Edge can't bundle ffmpeg under 50 MB; needs an external worker.

## Truth-first resolver

**Status: WORKING** (Section 2). On-foot ground truth coords from `services/courseTruth.ts` win over override + courseHoles + geometryCache. Captured via [app/dev/CourseTruth.tsx](../../app/dev/CourseTruth.tsx). Per-courseId+hole AsyncStorage keys; cloud sync is a 1.x follow-up.

## Scenario harness

**Status: WORKING** (this sprint). Owner-gated test harness at [/harness](../../app/harness.tsx) runs 17 scenarios (9 critical + 5 high-value + 3 nice-to-have) against the real Zustand stores + production voiceCommandRouter. Each scenario has explicit seed + teardown. See [services/harness/](../../services/harness/).
