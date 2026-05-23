# MediaPipe Pose Landmarker — SmartPlay Integration

On-device 33-keypoint pose detection via Google's MediaPipe Tasks Vision (BlazePose). Becomes the **primary** path in [`services/poseEstimator.ts`](../services/poseEstimator.ts) when the native module is present; the cloud `/api/pose-analysis` route stays the defensive fallback.

## Why on-device

| Path | Latency | Cost | Privacy | Reliability |
|---|---|---|---|---|
| Cloud (`/api/pose-analysis`) | 300-800ms per frame, network-bound | per-call billing | frames travel to server | flaky under cellular |
| **MediaPipe on-device** | **20-80ms per frame** | **$0** | frames stay on device | **deterministic** |

For Phase K (5 keyframes per swing), this means ~150ms total inference vs ~2-4s for cloud — a feel-instant difference.

## What's shipped

| Layer | File | Status |
|---|---|---|
| Expo config plugin | [`plugins/withMediaPipePose.js`](../plugins/withMediaPipePose.js) | ✅ |
| Android Kotlin module | [`android-native/MediaPipePoseModule.kt`](../android-native/MediaPipePoseModule.kt) | ✅ |
| Android RN package | [`android-native/MediaPipePosePackage.kt`](../android-native/MediaPipePosePackage.kt) | ✅ |
| iOS Swift module | [`ios-native/MediaPipePoseModule.swift`](../ios-native/MediaPipePoseModule.swift) | ✅ (Apple enrollment pending) |
| iOS RCT bridge | [`ios-native/MediaPipePose.m`](../ios-native/MediaPipePose.m) | ✅ |
| JS service | [`services/mediaPipePoseService.ts`](../services/mediaPipePoseService.ts) | ✅ |
| poseEstimator integration | [`services/poseEstimator.ts`](../services/poseEstimator.ts) | ✅ |

## Setup — one-time before first EAS build

The config plugin handles everything at prebuild time **except one prerequisite**: the BlazePose model file needs to be checked into the repo at:

```
assets/mediapipe/pose_landmarker_full.task
```

Download it from Google's model zoo:

```bash
mkdir -p assets/mediapipe
curl -L -o assets/mediapipe/pose_landmarker_full.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
```

This file is ~9 MB. If you want the lite (~3 MB) or heavy (~30 MB) variant too, download alongside it; the JS service's `setPreferredQuality('lite' | 'heavy')` selects which one to load. The default is `full` — balanced precision and inference latency.

After the model lands in `assets/mediapipe/`, the next prebuild copies it into both `android/app/src/main/assets/mediapipe/` and `ios/SmartPlayCaddie/Resources/mediapipe/`.

## How it's wired

```
SmartMotion / PuttingLab / Phase K
       │
       ▼
services/poseEstimator.estimatePose({ frames | imageUri })
       │
       ▼ (try on-device first)
services/mediaPipePoseService.detectPoseFromBase64 / detectPoseFromUri
       │
       ▼ (NativeModules.MediaPipePose)
Native module (Kotlin / Swift)
       │
       ▼ (BlazePose 33-landmark model)
33 landmarks  ─►  projection to COCO-17  ─►  existing biomechanics pipeline
       │
       └─► (on failure / unavailable)  ─►  fall back to cloud /api/pose-analysis
```

The projection step is the seam. BlazePose produces 33 landmarks; the existing biomechanics pipeline ([`services/poseAnalysisApi.ts`](../services/poseAnalysisApi.ts)) consumes 17 (COCO order). [`services/mediaPipePoseService.ts:BLAZEPOSE_TO_COCO17`](../services/mediaPipePoseService.ts) maps the relevant subset (nose, ears, eyes, shoulders, elbows, wrists, hips, knees, ankles) so every downstream consumer (`swingComparisonEngine`, `juniorSwingAnalyzer`, the swing detail biomechanics card, the visual hotspot renderer) reads the same `PoseFrame` shape whether the keypoints came from on-device or cloud.

## Quality presets

| Preset | Model | Inference | Use case |
|---|---|---|---|
| `lite` | pose_landmarker_lite.task (~3 MB) | ~25ms | Live-preview overlays; backgrounded auto-downshift |
| **`full`** | pose_landmarker_full.task (~9 MB) | **~50ms** | **Default — Phase K keyframe analysis, swing detail, comparison engine** |
| `heavy` | pose_landmarker_heavy.task (~30 MB) | ~120ms | Reference-clip ingestion where precision matters more than speed |

Override per-call: `detectPoseFromBase64(b64, { quality: 'lite' })`. Override session-wide: `setPreferredQuality('lite')` — the next call picks it up.

## Battery / thermal

`services/mediaPipePoseService.ts` listens to `AppState` transitions. On background, it auto-downshifts to `lite` regardless of the user-requested quality. Returns to the user-requested setting on foreground.

This is a conservative thermal proxy — real `expo-thermal` integration replaces this when the module lands in the dependency tree.

## Defensive behavior

| Failure | Behavior |
|---|---|
| Native module not linked (web, pre-build) | `isMediaPipeAvailable()` returns false; `detectPoseFromBase64` returns null; `poseEstimator` falls back to cloud |
| Model file missing from app assets | Native init throws `MP_INIT_FAILED`; JS service returns null; cloud fallback fires |
| GPU delegate unavailable on Android | Auto-retries with CPU delegate at init time (Kotlin module branch) |
| Bad base64 input | `MP_DECODE_FAILED`; JS service returns null |
| MediaPipe inference threw | `MP_INFERENCE_FAILED`; JS service returns null |
| No pose found in frame | Returns null (not an error — model didn't detect a person) |

Every public function on the JS side returns null or false on failure — never throws to the caller.

## API quick reference

```ts
import {
  isMediaPipeAvailable,
  getMediaPipeStatus,
  setPreferredQuality,
  detectPoseFromBase64,
  detectPoseFromUri,
  smoothPoseFrames,
} from '../services/mediaPipePoseService';

// Status — for the "On-device • 92% conf" badge
const status = await getMediaPipeStatus();
// → { available, modelLoaded, loadedQuality, lastInferenceMs }

// One-shot detection
const frame = await detectPoseFromBase64(b64Jpeg);
// → PoseFrame | null  (COCO-17 shape; same as poseAnalysisApi)

// From a file:// URI
const frame2 = await detectPoseFromUri('file:///path/to/frame.jpg');

// Multi-frame smoothing — picks best-of-best for each joint
const composite = smoothPoseFrames([frame1, frame2, frame3, frame4, frame5]);
```

## Troubleshooting

### Build fails: "Could not find com.google.mediapipe:tasks-vision"
The Maven repo for MediaPipe is `mavenCentral()` — already in the Expo template's default `allprojects.repositories` block. If you've customized the project-level `build.gradle`, confirm mavenCentral is present.

### Runtime: "pose_landmarker_full.task not in app bundle" (iOS)
The model file didn't land in `ios/SmartPlayCaddie/Resources/mediapipe/`. Re-run prebuild; the config plugin's `withIOSSourceCopyAndModel` mod copies it from `assets/mediapipe/`. If the source file at `assets/mediapipe/pose_landmarker_full.task` is missing, see the Setup section above.

### Runtime: `NativeModules.MediaPipePose is null` on Android
MainApplication.kt's `getPackages()` is missing `packages.add(MediaPipePosePackage())`. The config plugin's `withMainApplication` mod injects this at every prebuild — confirm the EAS Build log shows `[withMediaPipePose] injected MediaPipePosePackage into MainApplication.kt`.

### Runtime: low confidence on every frame
Check the input frame's resolution. Below ~256×256, BlazePose accuracy drops sharply. The Phase K thumbnail pipeline targets 1024px wide, well above that floor.

### iOS pod install fails: "MediaPipeTasksVision could not be found"
Run `pod repo update` in `ios/` then `pod install` again. CocoaPods sometimes lags on new pod versions. Pinned version in the config plugin: `0.10.14` — if MediaPipe ships a new minor and you want it, bump `MP_VERSION` in [`plugins/withMediaPipePose.js`](../plugins/withMediaPipePose.js).

## Example usage in SmartMotion

```ts
// app/swinglab/smartmotion.tsx (illustrative — the real wiring lives
// inside the existing analyzeSwing call path, which now uses the
// poseEstimator facade)
const estimate = await estimatePose({
  videoUri: clipUri,
  durationMs: 3500,
  context: { age: 35, handedness: 'right', club: '7i' },
});
// estimate.source === 'frames' → on-device MediaPipe path
// estimate.source === 'video'  → cloud per-frame path
// estimate.confidence captures the blended confidence either way.
```

## Example usage in PuttingLab

`services/puttingAnalysisService.ts` already consumes glasses POV frames via `getActiveVisionFrameBase64()`. Once MediaPipe is loaded, the same frame can be run through `detectPoseFromBase64` to extract a 33-landmark putt setup pose — pose data improves the analyzer's read of stance width, ball position, and shoulder alignment without re-architecting the service.

## References

- MediaPipe docs: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
- BlazePose paper: https://arxiv.org/abs/2006.10204
- Model zoo: https://storage.googleapis.com/mediapipe-models/pose_landmarker/
