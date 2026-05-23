# Meta Wearables DAT SDK v0.7 — API Reference

> Snapshot fetched 2026-05-23 from https://wearables.developer.meta.com/llms.txt?full=true
>
> This is the missing transport piece for Smart Play Caddy's Meta Ray-Ban
> glasses integration. Until now `services/glassesVisionInput.ts` has been a
> rolling-queue stub waiting for Meta to expose live frames; with DAT v0.7
> there is now an actual frame stream we can wire into a native module.

## Platform support
- **iOS 15.2+** (Xcode 14.0+, Swift)
- **Android 10+** (Android Studio Flamingo+, Kotlin)
- Hardware: Ray-Ban Meta Gen 1/2, Ray-Ban Meta Optics, Meta Ray-Ban Display

## Data streams exposed
| Stream | Detail |
|---|---|
| Video / camera | 720×1280 high · 504×896 medium · 360×640 low at 2/7/15/24/30 FPS |
| Photos | Single JPEG capture during an active stream |
| Audio in | 8 kHz mono via Bluetooth Hands-Free Profile (HFP) — same channel `MetaCaddyVoiceHandler.kt` already uses for TTS routing |
| Audio out | Speaker playback over Bluetooth |
| Display | Ray-Ban Display only (FlexBox layouts, text, images, buttons, video) |
| Touch | Capacitive gestures + back-gesture detection |

**Notable gaps (NOT exposed by this SDK):** IMU / gyroscope, voice transcripts, GPS from the glasses. We still derive heading and motion from the phone where needed; the glasses ship optical frames + audio only.

## Authentication
- **One-time app registration:** deeplink to Meta AI app → user confirmation → return.
- **Per-feature permission:** camera-access dialog inside Meta AI ("Allow once" / "Allow always").
- **Developer Mode** (for our internal testing pre-launch): in Meta AI app → Settings → App Info → tap version 5× → toggle Developer Mode.
- Attestation uses `MetaAppID` + `ClientToken` from the Wearables Developer Center. No traditional API key in code.

### Credentials handling — do NOT commit the values
`MetaAppID` is identifier-shaped (like a Facebook App ID — semi-public) but `ClientToken` is sensitive. Both ride into the APK at build time via manifest placeholders, but the source of truth lives in EAS env, not in git. Once you have the values from the Wearables Developer Center, run (locally, terminal):
```bash
eas env:create --scope project \
  --name META_WEARABLE_APP_ID \
  --value <your-app-id> \
  --environment production --environment preview --environment development

eas env:create --scope project \
  --name META_WEARABLE_CLIENT_TOKEN \
  --value <your-client-token> \
  --environment production --environment preview --environment development
```
The AndroidManifest snippet references `${MWDAT_APP_ID}` and `${MWDAT_CLIENT_TOKEN}` placeholders, fed by gradle's `manifestPlaceholders` from the EAS env vars at build time. If those env vars aren't set when EAS Build runs, the placeholders resolve to empty strings → DAT session attestation fails at runtime with a clear "missing application id" error (same as forgetting to set them in the manifest the old way). No partial / silently-broken state.

## Concurrency + rate limits
- **One active session per device.** If our `MetaCaddyVoiceHandler` is mid-utterance we cannot also stream video — sequence them.
- Bluetooth Classic auto-scales bandwidth; SDK degrades resolution / frame rate under congestion.
- Frame rates: **only** 2 / 7 / 15 / 24 / 30 FPS (not arbitrary).
- Codecs: raw or H.265.

## Android install (paste-ready snippets)
**1. `settings.gradle.kts` — add the GitHub Maven repo:**
```kotlin
maven {
    url = uri("https://maven.pkg.github.com/facebook/meta-wearables-dat-android")
    credentials {
        username = ""
        password = System.getenv("GITHUB_TOKEN")
            ?: localProperties.getProperty("github_token")
    }
}
```

**2. `libs.versions.toml` — pin versions:**
```toml
mwdat-core   = { group = "com.meta.wearable", name = "mwdat-core",   version = "0.7.0" }
mwdat-camera = { group = "com.meta.wearable", name = "mwdat-camera", version = "0.7.0" }
```

**3. `build.gradle.kts` (app) — wire in:**
```kotlin
implementation(libs.mwdat.core)
implementation(libs.mwdat.camera)
```

**4. `AndroidManifest.xml` — permissions + attestation metadata:**
```xml
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<meta-data android:name="com.meta.wearable.mwdat.APPLICATION_ID" android:value="${app_id}" />
<meta-data android:name="com.meta.wearable.mwdat.CLIENT_TOKEN"   android:value="${token}" />
```

**5. App startup:**
```kotlin
Wearables.initialize(context)
```

## Receiving live frames (Android Kotlin)
```kotlin
val session = Wearables.createSession(AutoDeviceSelector()).getOrThrow()
session.start()

val config = StreamConfiguration(videoQuality = VideoQuality.MEDIUM, frameRate = 24)
session.addStream(config).fold(
    onSuccess = { stream ->
        scope.launch {
            stream.videoStream.collect { frame ->
                // frame is a bitmap-shaped object — bridge to React Native
                // via expo modules to push into glassesVisionInput.submitVisionFrame
            }
        }
        stream.start()
    },
    onFailure = { error, _ -> showError(error.description) }
)
```

## Receiving live frames (iOS Swift, for the eventual iOS pass)
```swift
try Wearables.configure()
let session = try wearables.createSession(deviceSelector: AutoDeviceSelector(wearables: wearables))
try session.start()

let config = StreamConfiguration(resolution: .low, frameRate: 24)
let stream = try session.addStream(config: config)
stream.videoFramePublisher.listen { frame in
    guard let image = frame.makeUIImage() else { return }
    // Render OR forward to RN bridge
}
try await stream.start()
```

## Smart Play Caddy integration plan

The existing client surfaces are already shaped for this — DAT just provides the missing transport.

1. **Native module wrap**: `android-native/MetaWearablesFrameModule.kt` (new) exposes `startStreaming(quality, fps)` / `stopStreaming()` / `onFrame` event to React Native. The Kotlin side does the DAT session management + Bluetooth dance.
2. **Bridge into existing queue**: each `onFrame` event lands in JS land via `DeviceEventEmitter`, where it calls `services/glassesVisionInput.submitVisionFrame({ uri, source: 'glasses', captured_at: Date.now() })`. The rolling-queue + auto-mode detection + subscriber fanout are already in place — no JS-side work beyond plumbing.
3. **Putting auto-fold** already wired: `services/puttingAnalysisService.ts` (Day 5 batch) calls `getActiveVisionFrameBase64()` when `detected_mode === 'putting' | 'green_read'`. Once frames are flowing in from DAT, putting analysis automatically gets glasses POV without further code changes.
4. **Kevin multimodal** already wired: `hooks/useKevin.ts` pulls the active frame on every brain call. Same automatic upgrade — frame appears, Kevin goes multimodal Sonnet.
5. **Display surface** (Ray-Ban Display, future): the same DAT session has FlexBox / text / image / video capabilities for the on-glasses display. Out of scope for tonight but reserve the namespace.

**Sequencing constraint (one session per device)**: when `MetaCaddyVoiceHandler` is mid-TTS through HFP, DON'T also try to start a camera stream. The handler should signal "voice active" → the frame stream pauses → frame resumes after TTS completes. State machine for tomorrow.

## React Native / Expo viability
Moderate complexity — workable as an Expo native module:
- Camera frame streaming requires Kotlin / Swift wrapping (not in vanilla RN).
- Bluetooth + HFP path is already operational in our existing `MetaCaddyVoiceHandler` — that's the proof-of-concept for native-bridge plumbing.
- Mock Device Kit available for testing without glasses on the desk.
- Display capability is optional — start headless, add Display later.

**Risk:** EAS Build needs the new Maven repo + a `GITHUB_TOKEN` secret in expo.dev env to fetch `meta-wearables-dat-android` artifacts at build time. This is the same shape Tim already used for the Sentry env var (`EXPO_PUBLIC_SENTRY_DSN`) — add `GITHUB_TOKEN` via `eas env:create` before the next EAS native build.

## Reference link
Full SDK docs (HTML, human-friendly): https://wearables.developer.meta.com/
Full SDK docs (LLM-friendly text): https://wearables.developer.meta.com/llms.txt?full=true
