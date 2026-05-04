# Research — MediaPipe pose detection (Phase BJ Component 1)

**Capability:** On-device real-time pose extraction (33 body landmarks per frame) to replace or augment the current Sonnet-vision-based Phase K swing analysis. Candidate use: `services/poseDetection.ts` (currently 252 LOC returning `null` placeholders) reads pose landmarks per frame and either feeds them to `swingIssueClassifier.ts` or sends a structured pose-time-series to Sonnet for reasoning.

**Verdict: QUEUE — no library compatible with this project's stack ships ready-to-use today**

---

## Library evaluation summary

| Library | Latest | New Arch | Worklets fit | Expo plugin | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| `cdiddy77/react-native-mediapipe` | 0.6.0 (Dec 2024) | Not stated | Requires `react-native-worklets-core` (project uses `react-native-worklets` 0.5.1 — different package) | None | 75 stars, 37 open issues, last commit ~16 mo ago | ❌ stack mismatch |
| `@thinksys/react-native-mediapipe` | (npm 403'd in research) | Not confirmed | Not confirmed | Not confirmed | Org-maintained, low community traction | ❌ unverified on critical compatibility |
| `react-native-mediapipe-posedetection` | (npm 403'd) | Unknown | Unknown | Unknown | Unknown | ❌ unverified |
| `@quickpose/quickpose-react-native-pose-estimation` | 0.2.5 (Mar 2026) | Vendor claims Fabric-native | No worklets dependency (native SwiftUI/Android view) | Not confirmed — likely needs prebuild + Podfile work | Vendor-driven, single-purpose, low GitHub activity | 🟡 lowest-risk *if* forced; still 18-28h scope |
| `react-native-vision-camera` v5 (transitive dep for some MediaPipe wrappers) | 5.0.8 (Apr 2026) | Yes (NitroModules) | Migrated to unified `react-native-worklets` | Yes | Active | ⚠️ open issue [#3743](https://github.com/mrousavy/react-native-vision-camera/issues/3743) — fails to compile on EAS Build with Xcode 26 + Expo SDK 54 |

No first-party Google React Native MediaPipe binding exists. Multiple unanswered RFE issues on `google-ai-edge/mediapipe`.

## The core blocker

`react-native-worklets` 0.5.1 (this project's installed worklets library — required for `react-native-reanimated` 4.x) is **not the same package** as `react-native-worklets-core`. They have overlapping but distinct APIs and cannot be cleanly co-installed. The most-stars MediaPipe wrapper depends on the wrong one. Vision-camera v5 has migrated to unified worklets, but the MediaPipe wrappers built on top haven't followed yet.

The result: any RN MediaPipe path today either (a) requires downgrading or branching the worklets dep — risky for the rest of the app, or (b) commits to `@quickpose` (no worklets dep, but unproven, vendor-driven, single-vendor lock-in).

## Scope estimate (if forced to BUILD TODAY anyway)

Recommended path *if* this had to ship now: **`@quickpose` v0.2.5**.

| Step | Hours |
|---|---|
| Install + EAS prebuild + custom Podfile | 4 |
| Wire native pose stream into `services/poseDetection.ts` | 6 |
| Translate landmark coords → existing `swingIssueClassifier.ts` schema | 4 |
| Galaxy Z Fold 5 device verification (FPS, accuracy across foldable aspect changes, foldable camera-switching) | 4-8 |
| Fallback path for unsupported devices | 4-8 |
| **Total** | **22-30** |

Threshold for BUILD TODAY in the phase prompt was **<8 hours**. This exceeds it by 3-4×.

## What would make this BUILD TODAY in a future phase

- A new RN MediaPipe library lands with confirmed Expo SDK 54 + new architecture + `react-native-worklets` 0.5.1 compatibility, OR
- Vision-camera v5 stabilizes against Xcode 26 + Expo SDK 54 + a MediaPipe wrapper migrates to the unified worklets library, OR
- Vision-camera + MediaPipe is extracted into a single Expo config plugin (~8h work itself, but then any team can use it)
- Tim accepts a worklets-core / worklets parallel install with empirical verification that nothing else breaks — risky but might unlock `cdiddy77`'s lib.

Re-check this in 3-6 months. The RN MediaPipe ecosystem is moving but not stabilized on the project's stack today.

## Holding pattern

Phase K continues with the current Sonnet-vision pipeline. Per the migration gap analysis URGENT-1 finding: add `Promise.race` timeout + `analyzeSession` heuristic fallback so the existing pipeline doesn't stall when CV fails. That fix is high-value regardless of the eventual MediaPipe decision and doesn't depend on it.

## Decision

**QUEUE.** Re-evaluate when one of the unblocking conditions above becomes true. Note in the project queue as "Phase K' — on-device pose extraction (deferred for stack compatibility)."
