# Meta Wearables DAT — SmartPlay Integration Guide

Definitive reference for how Smart Play Caddy wires the Meta Wearables DAT v0.7 SDK into its caddie stack. Captures the end-to-end path from Ray-Ban Meta glasses → native module → JS bridge → existing consumers (Kevin multimodal, PuttingLab, SmartMotion, SmartVision, lie analysis).

## What's shipped

| Layer | File | Platform | Status |
|---|---|---|---|
| Expo config plugin | [`plugins/withMetaWearablesDAT.js`](../plugins/withMetaWearablesDAT.js) | Android + iOS | ✅ |
| Android Kotlin module | [`android-native/MetaWearablesFrameModule.kt`](../android-native/MetaWearablesFrameModule.kt) | Android | ✅ |
| Android RN package class | [`android-native/MetaWearablesPackage.kt`](../android-native/MetaWearablesPackage.kt) | Android | ✅ |
| iOS Swift module | [`ios-native/MetaWearablesFrameModule.swift`](../ios-native/MetaWearablesFrameModule.swift) | iOS | ✅ (built once Apple Developer enrollment lands) |
| iOS RCT bridge header | [`ios-native/MetaWearablesFrame.m`](../ios-native/MetaWearablesFrame.m) | iOS | ✅ |
| JS bridge | [`services/metaWearablesBridge.ts`](../services/metaWearablesBridge.ts) | Cross-platform | ✅ |
| React hook | [`hooks/useGlassesStatus.ts`](../hooks/useGlassesStatus.ts) | Cross-platform | ✅ |
| Status badge | [`components/GlassesStatusBadge.tsx`](../components/GlassesStatusBadge.tsx) | Cross-platform | ✅ |

## Data flow once a build is live

```
Ray-Ban Meta glasses
       │
       ▼ (Bluetooth Classic, DAT SDK)
Native module (Kotlin/Swift)
       │
       ▼ (DeviceEventEmitter "MetaWearableFrame")
services/metaWearablesBridge.ts
       │
       ▼ (submitVisionFrame)
services/glassesVisionInput.ts (rolling queue, auto-mode detection)
       │
       ├─► hooks/useKevin → multimodal Sonnet (every brain call when a frame is queued)
       ├─► services/puttingAnalysisService → frames_base64 auto-fold (mode=putting/green_read)
       ├─► services/lieAnalysisService → acoustic + vision composite
       └─► services/smartAnalysisEngine → vision_sources used in routing
```

**Nothing on the JS side needs to know about DAT.** Every consumer was already reading from `glassesVisionInput`; the native module just plugs in as a new producer.

## Public JS API

```ts
import {
  isMetaWearablesAvailable,
  getMetaWearablesStatus,
  startMetaWearablesStreaming,
  stopMetaWearablesStreaming,
  onGlassesStatusChange,
  getGlassesStatusSync,
  type GlassesStatus,
} from '../services/metaWearablesBridge';

import { useGlassesStatus } from '../hooks/useGlassesStatus';
```

- **`startMetaWearablesStreaming(quality, fps)`** — quality is `'high' | 'medium' | 'low'` (504×896 medium is the default, balanced for BT Classic bandwidth); fps is `2 | 7 | 15 | 24 | 30` (closest-match if you pass a different value).
- **`stopMetaWearablesStreaming()`** — idempotent.
- **`useGlassesStatus()`** — React hook that returns `{ available, connected, streaming, device, effectiveFps, multimodalReady }`. Subscribes on mount, cleans up on unmount.

## Status badge

`<GlassesStatusBadge />` is the canonical visual indicator. Drop it into any surface header; it renders:
- **GLASSES OFF** (neutral) when paired but not streaming
- **GLASSES PAIRED** (amber) when session is up but no recent frame
- **MULTIMODAL ON** (green) when frames are actively flowing

When the native module isn't present (web, iOS pre-Apple-enrollment, Android pre-DAT-build), the badge collapses to `null` so non-DAT builds stay clean.

Currently mounted in:
- [`app/swinglab/smartmotion.tsx`](../app/swinglab/smartmotion.tsx) — header under "Swing Analysis" subtitle
- [`components/swinglab/PuttingAnalysisCard.tsx`](../components/swinglab/PuttingAnalysisCard.tsx) — alongside the PUTTING label
- [`app/smartvision.tsx`](../app/smartvision.tsx) — under the hole/par chip

## Permissions + setup flow (user-facing)

1. **Pair the glasses** with the phone via the Meta AI app (one-time, system-level Bluetooth pairing).
2. **Open Smart Play Caddy** → Settings → Connect Ray-Ban Meta (TODO: ship the toggle row; the bridge API is ready).
3. **First-time approval:** the Meta AI app deeplinks back asking the user to grant camera-frame access ("Allow once" / "Allow always").
4. **Streaming starts:** the badge in SmartMotion / PuttingLab / SmartVision flips to MULTIMODAL ON.

## Battery + thermal awareness

`metaWearablesBridge.ts` listens to `AppState` transitions and downshifts to quality=low + fps=7 when the app backgrounds. This is a conservative proxy for thermal state until a real thermal-state API ships across both platforms. When the app returns to active, the bridge re-applies the user-requested quality/fps via a stop+start (DAT doesn't expose hot reconfigure yet).

Frame staleness: if no frame arrives for 12s while `streaming === true`, the bridge flips `streaming` back to `false` so subscribers (badges, status row) reflect reality without polling.

## Concurrency constraints

DAT enforces **one session per device**. When the caddie is mid-TTS through HFP → glasses speakers, starting a new camera stream errors out. Today the bridge runs hot — the cost is a single rejected DAT call, not a crash. TODO: voice-service pause/resume hooks in the bridge so the stream pauses during TTS and resumes after.

## Known follow-ups (first EAS build with DAT enabled)

1. **`GITHUB_TOKEN` EAS env var** — gradle Maven repo auth for `maven.pkg.github.com/facebook/meta-wearables-dat-android`. Needs a GitHub PAT with `read:packages` scope.
2. **MainApplication.kt `getPackages()` injection** — Expo prebuild regenerates this file; a small second config-plugin pass needs to add `packages.add(MetaWearablesPackage())`. Until then `NativeModules.MetaWearablesFrame` resolves to `null` on Android and the bridge collapses to no-op.
3. **iOS Bridging-Header.h** — the Expo iOS template usually provides one. If not, the Swift module won't see `RCTEventEmitter`; the config plugin can add a missing header in a future pass.
4. **Settings toggle row** — JS bridge API is ready; the UI seam is a single Pressable + `useGlassesStatus()`.
5. **Apple Developer Program enrollment** — gates iOS native build entirely.
6. **DAT credential rotation** — App ID + Client Token are baked into [`plugins/withMetaWearablesDAT.js`](../plugins/withMetaWearablesDAT.js). If `tgustafson75-sketch/smartplay` is public, rotate via the Wearables Developer Center after testing. The `META_WEARABLE_APP_ID` / `META_WEARABLE_CLIENT_TOKEN` env-var override seam is in place.

## Reference

- SDK docs (LLM-friendly): https://wearables.developer.meta.com/llms.txt?full=true
- SDK docs (human-friendly): https://wearables.developer.meta.com/
- Internal snapshot: [`android-native/META_WEARABLES_DAT_SDK_REFERENCE.md`](../android-native/META_WEARABLES_DAT_SDK_REFERENCE.md)
