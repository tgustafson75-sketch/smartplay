# AUDIT — Metric Provenance & Path Routing

**Date:** 2026-05-24
**Mode:** Read-only. No source files modified. Only this report is written.
**Scope:** Every numerical / categorical metric the app surfaces, the path that produces it, and whether the path can legitimately produce it. Flag fake precision. Surface unused captured data. Confirm pipeline order.

---

## A) Paths

| Path | Trigger | Routing signal | Endpoint | Citation |
|---|---|---|---|---|
| Full-body video upload | User picks video from camera roll, perspective `pov_self` or `watching_someone`, non-putt | `getAnalyzerKind() === 'swing'` | `/api/swing-analysis` | [services/swingLibrary.ts:57-72](services/swingLibrary.ts#L57) |
| Putt/chip video upload | tag `putt`/`chip` OR (pov_self + putt/chip tag) | `getAnalyzerKind() === 'putting'` | `/api/putting-analysis` | [services/swingLibrary.ts:64-65](services/swingLibrary.ts#L64) |
| Glasses POV download | Meta Ray-Ban downward POV, `source_device: 'meta_glasses'`, perspective resolution from familyStore | source_device + perspective | putting or swing per Fix #9 routing | [services/swingLibrary.ts:62-66](services/swingLibrary.ts#L62) |
| SmartMotion phone record | User records in SmartMotion | family override → perspective + swinger threaded by Fix #7 | `/api/swing-analysis` | [app/swinglab/smartmotion.tsx:137-150](app/swinglab/smartmotion.tsx#L137) |
| Cage Mode live | 12s cage video + watch + acoustic | source=`live_cage` | Local acoustic + `/api/acoustic-detect`; full-swing analysis only on request | [app/swinglab/cage-mode.tsx:344-359](app/swinglab/cage-mode.tsx#L344) |
| `mediaCapture` voice "record this" | Voice trigger → glasses or phone capture | kind=`swing`/`shot`/`highlight` | swing → cage library; shot/highlight → round attribution | [services/mediaCapture.ts:171-200](services/mediaCapture.ts#L171) |

Routing logic per Fix #9 is correct and the Fix #7 attribution layer threads `perspective` + `swinger` through every record path.

---

## B) Metrics surfaced

**SmartMotion metrics strip** ([app/swinglab/smartmotion.tsx:818-822](app/swinglab/smartmotion.tsx#L818)): Club Speed (mph), Ball Speed (mph), Smash Factor, Carry (yds).

**Cage Mode watch card** ([app/swinglab/cage-mode.tsx:795-815](app/swinglab/cage-mode.tsx#L795)): Tempo ratio, Club mph (watch-derived), Backswing/Downswing ms, Peak Wrist Speed.

**Cage Mode acoustic card** ([app/swinglab/cage-mode.tsx:838-849](app/swinglab/cage-mode.tsx#L838)): Strike Time (s), Peak dB, Cage Distance (yds), Ball Speed (~mph, "estimate (single-mic, club-typical × peak)").

**PuttingAnalysisCard** ([components/swinglab/PuttingAnalysisCard.tsx:80-95](components/swinglab/PuttingAnalysisCard.tsx#L80)): Setup quality, Stroke quality, Green slope, Read accuracy, Overall score 0-100.

**PrimaryIssueCard** ([components/swinglab/PrimaryIssueCard.tsx:47-96](components/swinglab/PrimaryIssueCard.tsx#L47)): Issue name, severity, occurrence count, confidence.

**Caddie data strip** ([components/CaddieDataStrip.tsx:328-331](components/CaddieDataStrip.tsx#L328)): Round state only (hole / plays / target / strokes) — no swing metrics. ✅

---

## C) Provenance matrix

### SmartMotion full-swing upload

| Metric | Provenance | Source-of-truth | Confidence range |
|---|---|---|---|
| Club Speed | **SYNTHESIZED** (pose-estimated via heuristic constant) | [services/swingMetricsService.ts:161-183, 313](services/swingMetricsService.ts#L313) | 0.20–0.70 |
| Ball Speed | **SYNTHESIZED** (`club_speed × typicalSmash[club]`) | [services/swingMetricsService.ts:185-206](services/swingMetricsService.ts#L185) | 0.45–0.60 |
| Smash Factor | **DERIVED but tautological** when both inputs are synthesized (ratio = typicalSmash[club]) | [services/swingMetricsService.ts:208-224](services/swingMetricsService.ts#L208) | 0.36–0.56 |
| Carry | **SYNTHESIZED** (`ball_speed × 1.4` irons / `× 1.65` woods) OR profile dict if populated | [services/swingMetricsService.ts:226-245](services/swingMetricsService.ts#L226) | 0.225–0.75 |
| Detected fault / severity / observation | **MEASURED** (Sonnet vision read of 5 keyframes) | [api/swing-analysis.ts:314](api/swing-analysis.ts#L314) | high–low (model-stated) |
| Biomechanics verdicts (hip/shoulder/weight/posture) | **MEASURED** when pose API returns frames; **null** otherwise | [services/poseAnalysisApi.ts](services/poseAnalysisApi.ts), [app/swinglab/swing/[swing_id].tsx:800-818](app/swinglab/swing/%5Bswing_id%5D.tsx#L800) | varies |

### Cage Mode

| Metric | Provenance | Source-of-truth |
|---|---|---|
| Watch tempo / backswing-ms / downswing-ms / peak wrist | **MEASURED** (Galaxy Watch IMU) | [store/watchStore.ts:7-20](store/watchStore.ts#L7); matched to swing at [cage-mode.tsx:405-407](app/swinglab/cage-mode.tsx#L405) |
| Watch club speed | **MEASURED → DERIVED** (watch IMU peakWristSpeed → empirical club-speed estimate) | [services/watchService.ts:106](services/watchService.ts#L106) |
| Strike time | **MEASURED** (client acoustic peak detector) | [app/swinglab/cage-mode.tsx:344](app/swinglab/cage-mode.tsx#L344) |
| Cage distance | **MEASURED → DERIVED** (acoustic echo delay × speed-of-sound) | [services/acousticDetectApi.ts:22-23](services/acousticDetectApi.ts#L22) |
| Acoustic ball speed | **DERIVED (heuristic)** — labeled "estimate (single-mic, club-typical × peak)" in the UI | [app/swinglab/cage-mode.tsx:847-848](app/swinglab/cage-mode.tsx#L847) |

### Putting (`/api/putting-analysis`)

| Metric | Provenance |
|---|---|
| Setup (alignment, ball position, stance, grip) | **MEASURED** (vision over POV frames) |
| Stroke (path, tempo, face angle, deceleration) | **MEASURED + DERIVED** (vision + frame timestamps) |
| Green slope (direction, severity, break inches) | **MEASURED** (vision + spoken read + optional GPS green geometry) |
| Read accuracy | **MEASURED** (vision compare) |
| Overall score 0-100 | **SYNTHESIZED** (weighted roll-up by Sonnet) — confidence surfaced as percentage |
| Fix #5 synthesized PrimaryIssue (glasses POV) | **DERIVED** from putting result, labeled severity/category by `synthesizePrimaryIssueFromPutting` | [services/puttingAnalysisService.ts:240-340](services/puttingAnalysisService.ts#L240) |

---

## D) `services/swingMetricsService.ts` deep-dive

**Inputs:** `poseFrames?` (MediaPipe/TFJS keypoints, 5 phases — P1/P2/P4/P6/P10), `clubDurationMs?`, `club?`, `profile?` (handicap + per-club distances dict), `measuredClubSpeedMph?` (watch — rarely populated outside Cage Mode), `measuredBallSpeedMph?` (acoustic — rarely populated outside Cage Mode).

**Returns:** `SwingMetricSet { club_speed, ball_speed, smash_factor, carry_yards }`. Each `SwingMetric` carries `value | null`, `unit`, `source: 'measured' | 'pose_estimated' | 'profile_estimated' | 'placeholder'`, `confidence: 0-1`.

**The load-bearing constant.** [services/swingMetricsService.ts:313](services/swingMetricsService.ts#L313):

```ts
// Conversion: normalized image units → real-world m/s.
// Empirical constant ~150 m/s per normalized-unit-per-ms for a
// typical full-body downswing capture at ~3s total clip length.
// Then m/s → mph: × 2.237.
const mph = peakVelocity * 150 * 2.237 * (3000 / duration);
const clamped = Math.max(45, Math.min(130, mph));
```

`150` is an empirical constant with no validation study cited. It is **load-bearing** for every pose-estimated club-speed value on the SmartMotion full-swing path. The clamp to [45, 130] mph guarantees the number always looks plausible, which **masks** when the underlying estimate is junk (cropped frames, glasses-POV, partial body). Ball speed → smash → carry all chain off this constant.

**Presentation in UI:** [app/swinglab/smartmotion.tsx:854-883](app/swinglab/smartmotion.tsx#L854) — `MetricCell` renders value + unit + a tiny source tag (`measured` / `pose` / `profile` / `est`). When `value === null`, shows "—". No "~" prefix on the number itself, no error bound, no confidence value surfaced. The source tag is the only caveat the user sees, and it requires knowing what `pose` vs `measured` means to interpret.

---

## E) Path correctness — fake-precision flags

### 🚩 SmartMotion full-swing video shows launch-monitor-class metrics without a launch monitor

User sees "Club Speed: 95 mph · pose" on the SmartMotion strip after uploading a swing video. The number is real (returned), but underneath it is `peakVelocity * 150 * 2.237 * (3000 / duration)` — a heuristic with:
- No published ground-truth validation against a launch monitor / TrackMan
- A clamp [45, 130] mph that always returns a plausible-looking number, masking failure modes
- No "~" / "est." prefix on the displayed value
- No error-bound range
- A `pose` source tag that requires reading the source code to interpret correctly

The same chain applies to ball speed (derived from club speed × `typicalSmash[club]`) and smash factor (tautological — it just returns `typicalSmash[club]`) and carry (derived again with a second heuristic constant). **All four numbers chain off the one untested constant.**

What would make this legit (described, NOT a build proposal): (a) ground-truth study vs a TrackMan / Foresight / GC Quad on 50+ diverse swings to fix the empirical constant + publish error bounds, OR (b) drop the four numbers from the SmartMotion strip and show only the categorical fault read ("over-the-top detected at impact"), OR (c) gate the strip behind a "show estimates" toggle with explicit error-bound text.

### 🚩 SmartMotion doesn't gate metrics on pose validity

[app/swinglab/smartmotion.tsx:807-829](app/swinglab/smartmotion.tsx#L807) — metrics render whenever pose frames exist, regardless of capture quality. The fallback ("Metrics paused — record a swing with your full body in frame") only shows when `!analyzing && !validity.valid`. A bad clip that mid-flight returns valid-but-low-quality pose still produces a 95 mph club-speed number with `pose` tag. Confidence is computed internally (line 320, `Math.min(0.7, avgScore * (wrists.length >= 5 ? 1 : 0.8))`) but never surfaced to the UI.

### ✅ Cage Mode is honest about its mix

- Watch metrics correctly labeled `measured` ([app/swinglab/cage-mode.tsx:795](app/swinglab/cage-mode.tsx#L795))
- Acoustic ball speed explicitly marked `~X mph · estimate (single-mic, club-typical × peak)` ([app/swinglab/cage-mode.tsx:847-848](app/swinglab/cage-mode.tsx#L847))
- Both real and synthesized are visually distinguishable

### ✅ Putting analysis surfaces confidence on each block

- Green slope chip shows confidence percentage ([components/swinglab/PuttingAnalysisCard.tsx:171](components/swinglab/PuttingAnalysisCard.tsx#L171))
- `partialCapture` flag warns when inputs were thin ([components/swinglab/PuttingAnalysisCard.tsx:62-65](components/swinglab/PuttingAnalysisCard.tsx#L62))
- No fake precision — metrics are qualified by confidence numbers visible to the user

---

## F) Data captured but not used

1. **Audio from SmartMotion / phone-camera swing recording** — Cage Mode runs acoustic impact detection on captured audio ([app/swinglab/cage-mode.tsx:344](app/swinglab/cage-mode.tsx#L344)), but the SmartMotion / video-upload path does not. [services/videoUpload.ts](services/videoUpload.ts) never fires acoustic analysis on uploaded swings.
2. **Watch IMU outside Cage Mode** — `watchStore` is read only from `cage-mode.tsx`. SmartMotion doesn't correlate watch tempo / wrist-speed samples with the recorded video timestamps, even when the watch is connected and producing data.
3. **17-joint MediaPipe keypoints** — only the wrist trajectory at P6 is consumed for club-speed estimation ([services/swingMetricsService.ts:279-322](services/swingMetricsService.ts#L279)). Hip turn, shoulder turn, weight shift, head movement, posture stability — all derivable from the existing keypoints, all not computed.
4. **`fault_frame_index` from Sonnet** — server returns the 0-based index of the most diagnostic frame ([api/swing-analysis.ts:54](api/swing-analysis.ts#L54)). Both `cage-mode.tsx:479` and `smartmotion.tsx:223` set `visual_reference_path: null` — the frame is never persisted as a JPEG and the "see this frame" visual anchor never reaches the user. (This is exactly the input the BBQ-roadmap visual-annotation feature needs.)
5. **GPS displacement** — `services/shotDetectionService.ts:230` computes `estimated_distance_yards` between consecutive shots. Used only for shot-detection triggering, never displayed or used to back-fill "previous shot distance" without manual user input.
6. **Glasses POV rolling frame queue** — `services/glassesVisionInput` feeds Kevin's brain prompts and putting analysis but is not consumed by the full-swing endpoint, even though it's a live first-person stream during a real swing.
7. **Unified vision context** — `services/unifiedVisionContext.ts` composes GPS + green geometry + hazards + lie + glasses frames. Used only by putting analysis and junior-swing-analyzer. Full-swing fault analysis ignores it entirely.

---

## G) Pipeline order check

Canonical sequence on the full-swing video-upload path:

1. User records / picks video → [app/swinglab/smartmotion.tsx:137-150](app/swinglab/smartmotion.tsx#L137)
2. Video mounted → `ingestUploadedSwing` creates `CageSession` in library
3. Parallel fan-out: `extractPoseFramesFromVideo` → `/api/pose-analysis` (MoveNet) AND `analyzeSwing` → `/api/swing-analysis` (Sonnet vision)
4. When pose returns → `setPoseFrames`; when analysis returns → `setAnalysis`
5. `synthesizeSwingMetrics(poseFrames, duration, club, profile, …)` is called inside the render function for the metrics strip at [app/swinglab/smartmotion.tsx:809-814](app/swinglab/smartmotion.tsx#L809)
6. `MetricCell` renders the strip

**Order: correct in principle, inefficient in practice.** The synthesis recalculates on every render because it lives inline in the render function. Should be memoized or moved into a `useEffect` keyed on `poseFrames` + `duration`. Not a correctness bug, but cumulative across re-renders during analysis.

**Metrics never display BEFORE analysis returns** thanks to the `overlaysGated` gate ([app/swinglab/smartmotion.tsx:808](app/swinglab/smartmotion.tsx#L808)) — so ordering itself is not broken. Putting-path metrics gated behind `session.putting_analysis` non-null per Fix #5 render rules.

---

## Summary

**Fake-precision case worth a real call:** SmartMotion's four-metric strip (club / ball / smash / carry) is synthesized end-to-end from one untested constant ([services/swingMetricsService.ts:313](services/swingMetricsService.ts#L313)) with no ground-truth validation. The number always looks plausible because of the [45, 130] mph clamp. The `pose` source tag is too quiet to function as a caveat for a non-engineer user. This is the only fake-precision flag in the audit — Cage Mode and putting analysis are both honest about their hedging.

**Biggest data-maximization opportunities:** acoustic impact analysis on uploaded swings (parity with Cage Mode), watch IMU correlation with SmartMotion videos, fault-frame JPEG persistence (already returned, just never saved → directly enables the visual-annotation roadmap item), and a biomechanics engine that uses all 17 keypoints not just wrist velocity.

**Routing is correct. Pipeline order is sane. Provenance labels on Cage Mode and Putting are honest. The one fake-precision area is the SmartMotion launch-monitor-class metrics strip — flag for a future fix, not implemented this run.**
