# v2 SwingLab + Acoustic Audit
Date: 2026-05-03
Branch: fix/v2-wiring

## Executive summary
- **Critical:** `lastVideoUri` state is **declared but never written** (`app/tabs/swinglab.tsx:368`). Every Smart Vision trigger (`triggerShotVision`, `storeShotForPattern`, "View Shot" button) is fed `null` and silently bails — auto, pattern, and manual smart-vision drill paths are all dead.
- **Critical:** `swingVisionService.analyzeSwingVision` is **not imported anywhere on the live SwingLab path**. The recorded URI never reaches `services/swingVisionService.ts` — `triggerShotVision` only flips a viewer modal (`swinglab.tsx:1214`).
- **High:** `services/acousticEngine.js` is **0 bytes** (empty file). Only `AcousticShotDetector.js` is wired, and only inside SwingLab cage UI (`swinglab.tsx:63`); the actual `app/cage/session.tsx` flow does **not** import it.
- **High:** Acoustic detector calls `Audio.setAudioModeAsync({allowsRecordingIOS:true})` directly (`AcousticShotDetector.js:45`) and never coordinates with `configureAudioForSpeech` — TTS spoken from the same screen will collide; there is **no `isSpeaking` guard** to prevent self-trigger on caddie speech.
- **Medium:** `app/tabs/swinglab.tsx` imports `getAIResponse` from `services/aiService` (line 12), not from the SwingLab-relevant `services/aiCoach.ts`. Drills do not call `aiCoach.ts` at all.

## 1. SwingLab drill wiring

### Action inventory (label → handler → status)

| Action | Handler | file:line | Status |
|---|---|---|---|
| Drill tile select | `handleSelectDrill` | swinglab.tsx:1914 / press 3040 | WIRED — sets `selectedDrill`, mode, loads tutorial + video |
| Start free recording (main camera) | `startRecording` | swinglab.tsx:1430 / press 4772 | WIRED — `recordAsync` ✓ |
| Stop free recording | `stopRecording` | swinglab.tsx:1467 / press 4779 | WIRED |
| Start drill camera widget | `startDrillRecording` | swinglab.tsx:2109 / press 2160 | WIRED w/ camera+mic permission gating |
| Stop drill camera widget | `stopDrillRecording` | swinglab.tsx:2131 / press 2167 | WIRED |
| Save swing to library | `handleSaveSwingToLibrary` | swinglab.tsx:2025 / press 4864 | WIRED |
| Share swing | `handleShareSwing` | swinglab.tsx:2001 / press 4870 | WIRED |
| Replay save (inline) | inline (4581) | swinglab.tsx:4581 | WIRED |
| Play / pause replay | inline | swinglab.tsx:4575 | WIRED |
| Smart Vision auto trigger (post-shot) | `triggerShotVision(lastVideoUri)` | swinglab.tsx:1617 | **DEAD** — `lastVideoUri` always null |
| "View Shot" smart-vision manual btn | `triggerShotVision(lastVideoUri)` | swinglab.tsx:3470 | **DEAD** — render-gated by `lastVideoUri` so button never appears |
| Pattern store for swing-detect | `storeShotForPattern(lastVideoUri)` | swinglab.tsx:1620 | **DEAD** — same reason |
| `triggerShotVision` body | swinglab.tsx:1214 | NO-OP w.r.t. AI — just `setShotVisionUri` + `setShowShotVision` | DEAD-ROUTE — never calls `analyzeSwingVision` |
| Ask Caddie | `askCaddie` → `getAIResponse` | swinglab.tsx:2089 / 2096 | WIRED via `services/aiService` (not aiCoach) |
| Acoustic toggle (cage) | `toggleAcousticForCage` | swinglab.tsx:648 / press 2487 | WIRED |
| Auto-detect IMU toggle | inline `setAutoDetectEnabled` | swinglab.tsx:2492 | WIRED |
| Camera-permission CTA | `requestCameraPermission` | swinglab.tsx:2153, 4529 | WIRED, recoverable UI |
| Mic-permission CTA | `requestMicPermission` | swinglab.tsx:4537, 4765 | WIRED, recoverable UI |
| Log zone hit (bull/inner/outer/miss) | `logZoneHit` | swinglab.tsx:1550 | WIRED |
| Focus shot logger | `logFocusShot` | swinglab.tsx:1289 | WIRED |
| `setLastSwing` to swing store | swing-detect callback | swinglab.tsx:940 + IMU at 973 | WIRED |
| Glasses analyze | `handleGlassesAnalyze` | press 5045 | WIRED |
| Submit drill ratings (free) | inline `setSwingPercent` etc | various | WIRED |

### Bugs found (file:line, severity, fix sketch)

1. **CRITICAL — `lastVideoUri` never written.** `app/tabs/swinglab.tsx:368` declares `setLastVideoUri` but no callsite invokes it. Both `recordAsync` paths (1430–1465 main, 2109–2129 drill widget) write to `videoUri` and `sharedVideoUri` only. Result: `triggerShotVision(lastVideoUri)` at 1617 + 1620 + 3470 always receives `null` and exits at 1215 (`if (!uri) return;`). Fix: in `startRecording` after `setVideoUri(video.uri)` (line 1461) add `setLastVideoUri(video.uri);` and similarly in `startDrillRecording` after `setSharedVideoUri(video.uri)` (line 2124).

2. **CRITICAL — Smart Vision pipeline orphaned.** `services/swingVisionService.ts:203` `analyzeSwingVision` exists but no live screen imports it (`Grep "analyzeSwingVision"` returns only the file itself plus inspect_archive). `triggerShotVision` (swinglab.tsx:1214) just opens a video player modal. Fix: in `triggerShotVision`, call `await analyzeSwingVision({ videoUri: uri, shots: focusShots.map(...) })` and surface result in `setSwingAnalysis` (the existing display block at 3303 already renders `{clubPath, faceAngle, tempo}` — wire it).

3. **HIGH — `getAIResponse` wrong import.** `swinglab.tsx:12` imports from `../../services/aiService`. The AI Coach module the audit asked about (`services/aiCoach.ts`) is never called from SwingLab. If the intent was caddie-style swing feedback, route `askCaddie` through `aiCoach.ts` or accept aiService as the canonical path. (Both modules duplicate logic — likely refactor candidate.)

4. **HIGH — `services/acousticEngine.js` is empty (0 bytes).** Any future import will silently no-op. Either delete the file or implement.

5. **MEDIUM — `analyzeSwing` (`SwingAnalysisEngine.js`) is mock-only.** Lines 100–110 use `seededChoice` and a TODO; ball-flight law only used to override face angle. Treat output as placeholder.

6. **MEDIUM — `processCameraImage` is a stub.** `engine/cameraVision.ts:104–111` returns `{hazards:[], depthMap:null}` — `runVisionPipeline` (`services/visionPipeline.ts:28`) and `engine/visionRouter.ts:116` both run on empty data. Only relevant if a SwingLab drill ever routes through it (it doesn't on this path; precision pipeline is for the Play tab).

7. **LOW — `recordAsync` has no try/catch in `startRecording`.** swinglab.tsx:1455. Cancellation throws on iOS; would set `recording` permanently true except `setRecording(false)` is on line 1464 (only on resolve). Fix: wrap in try/finally.

8. **LOW — Smart Vision render gate prevents discovery.** Manual "View Shot" button (3468) only renders when `lastVideoUri && drill.smartVision === 'manual'`. Combined with bug #1, the button is unreachable.

### Dead imports / unreachable handlers
- `extractFrames` (swinglab.tsx:40) — imported, never called in this file.
- `analyzeSwing` (swinglab.tsx:41) — imported, never called.
- `analyzeSwingVideo`, `detectVideoSource`, `importFromCameraRoll` (swinglab.tsx:61) — only `importFromCameraRoll` used (glasses path); `analyzeSwingVideo` and `detectVideoSource` unused.
- `services/swingVisionService.ts` — not imported by any live screen.
- `services/PoseAnalysisEngine.js` (502 lines) — not imported anywhere (`Grep "PoseAnalysisEngine"` shows only its own file + AUDIT_LEGACY).

## 2. Acoustic shot detection

### Active call graph (where loaded, who calls)
- Defined: `services/AcousticShotDetector.js:38` `startAcousticDetection`, `:92` stop.
- Imported live by: **only** `app/tabs/swinglab.tsx:63`.
- Triggered by: `toggleAcousticForCage` (`swinglab.tsx:648`) — fired by Pressable at `swinglab.tsx:2487`, visible only inside the cage-mode SmartCard region.
- Callback `handleAcousticImpact` (`swinglab.tsx:592`) → `logZoneHit` → updates `cageHits` + `shotMapLog` + `sessionPoints`. It does **not** write to `store/swingStore.ts` or `store/cageStore.ts` directly; SwingLab uses local component state for the cage zone log.
- Cage canonical screen `app/cage/session.tsx` (1674 lines) **does not import** `AcousticShotDetector` (verified by Grep). So the "real" cage flow has no acoustic detection at all — only the SwingLab tab's mini-cage card does.
- `services/acousticEngine.js` — empty placeholder file, dead.

### Permission + audio session lifecycle
- Permission requested inside `startAcousticDetection`: `Audio.requestPermissionsAsync()` (`AcousticShotDetector.js:42`). On deny → silent return; **no UI feedback, no recovery path**. Toggle (`swinglab.tsx:648`) flips `setAcousticEnabled(true)` only after `startAcousticDetection` resolves — but `start` returns `void` whether granted or not, so `acousticEnabled` becomes `true` **even when permission was denied**. UI lies.
- Audio mode set directly: `Audio.setAudioModeAsync({allowsRecordingIOS:true, playsInSilentModeIOS:true})` (`AcousticShotDetector.js:45`). No call to `configureAudioForRecording` from voiceService.
- Cleanup: `useEffect` unmount handler at `swinglab.tsx:660` calls `stopAcousticDetection`. Good.

### Bugs found (file:line, severity, fix sketch)

A. **CRITICAL — TTS / mic conflict, no isSpeaking guard.** `AcousticShotDetector.js:62-81` polls metering every 80 ms while *also* the SwingLab caddie can `safeSpeak` from `logZoneHit` (`swinglab.tsx:1614`) and from the streak voice timers (1322–1334). Caddie speech routed through phone speaker will hit the meter and self-trigger another "impact" → spurious hits. Fix: gate inner check in the interval at `AcousticShotDetector.js:67` with `if (voiceService.getIsSpeaking()) { _lastImpact = now; return; }` — `getIsSpeaking` is exported from `services/voiceService.js:80`.

B. **CRITICAL — Audio mode not restored after stop.** `stopAcousticDetection` (`AcousticShotDetector.js:92`) clears interval and unloads recording but does NOT call `configureAudioForSpeech()` to flip `allowsRecordingIOS` back to false. Subsequent TTS may play through earpiece on iOS until next manual mode set. Fix: at `:106` add `try { await configureAudioForSpeech(); } catch {}`.

C. **HIGH — Permission denial silently flips toggle to "ON".** `swinglab.tsx:653` `await startAcousticDetection(...)` then `setAcousticEnabled(true)` regardless. `startAcousticDetection` returns nothing on deny (`AcousticShotDetector.js:43`). Fix: change start to `return granted;` then in toggle: `const ok = await startAcousticDetection(cb); setAcousticEnabled(!!ok);` plus an alert when `!ok`.

D. **HIGH — `acousticEngine.js` empty.** `services/acousticEngine.js` is 0 bytes. Delete or implement.

E. **MEDIUM — Threshold algorithm runs but is naive.** `AcousticShotDetector.js:73-79` is a simple dBFS gate (-22 net, -32 clean) plus 1500 ms cooldown. It is actually running (interval is set on line 62). No band-pass / impulse filtering — anything loud (voice, fan, door slam) classifies as 'clean'. For an acoustic-only "miss" path see `swinglab.tsx:583` — only fires if `acousticWindowRef.current` was set by IMU, otherwise impacts always log a hit (line 632), so any ambient noise = ghost shot in cage mode.

F. **MEDIUM — No platform branch.** `AcousticShotDetector.js` uses iOS-flavoured keys (`allowsRecordingIOS`, `playsInSilentModeIOS`). Android needs `shouldDuckAndroid` / `staysActiveInBackground` and metering support is patchier on Android `expo-av`. No graceful fallback for Android devices where `status.metering` may be undefined — the code does default to `-160` (`:69`), which means Android may sit silent forever. Acceptable degrade, but worth a `Platform.OS === 'android'` warning.

G. **LOW — Double permission prompt.** SwingLab already requests `useMicrophonePermissions` for video (`swinglab.tsx:804`). Acoustic detector requests again via `Audio.requestPermissionsAsync` — different API, may double-prompt. Fix: gate `startAcousticDetection` on `micPermission?.granted` first.

## Top fixes (ranked)

1. **swinglab.tsx:1461 + 2124 — wire `setLastVideoUri`.** Add `setLastVideoUri(video.uri);` after each `setVideoUri/setSharedVideoUri`. Single line each. Unblocks all Smart Vision drill triggers.
2. **swinglab.tsx:1214 — actually call `analyzeSwingVision`.** Replace the body of `triggerShotVision` with a call to `swingVisionService.analyzeSwingVision({ videoUri: uri, shots: focusShots.map(s => ({ direction: s.result === 'good' ? 'straight' : s.result, contact: 'clean', feel: 'good' })) })` and write result via `setSwingAnalysis`.
3. **AcousticShotDetector.js:67 — TTS self-trigger guard.** `import { getIsSpeaking } from './voiceService';` then early-return in interval when speaking.
4. **AcousticShotDetector.js:106 — restore speech audio mode on stop.** `await configureAudioForSpeech();`
5. **swinglab.tsx:653 — surface permission denial.** Change `startAcousticDetection` to return `boolean`, branch toggle on it, show alert when denied.
6. **services/acousticEngine.js — delete the empty file** to avoid future ghost imports, or replace with a re-export of `AcousticShotDetector` if a unified entry is desired.
7. **swinglab.tsx:40-41 — drop dead imports** (`extractFrames`, `analyzeSwing`) once `analyzeSwingVision` replaces them; otherwise wire them in `triggerShotVision`.
8. **app/cage/session.tsx — decide canonical acoustic owner.** The "real" cage flow has no acoustic hook. Either move acoustic into `cage/session.tsx` (next to `configureAudioForRecording` at 255) or delete the SwingLab cage card duplicate.
