# Glasses Head-Motion — Beta Feasibility Audit

**Date:** 2026-05-24
**Mode:** Read-only diagnosis. No source modified.
**Decision needed:** Bake gross POV head-motion (head rose / swayed / stayed steady) into beta as a second signal corroborating the 2D early-extension call, OR defer to the fusion track?

**Verdict (TL;DR):** **DEFER TO FUSION TRACK.** This is a build, not a bake. Five concrete gaps between today and the proposed feature, three of them backend. The proposed corroboration signal cannot be wired end-to-end with the current pipeline. The far higher-value beta move is finishing the 2D evidence-gated early-extension guardrails already in [api/swing-analysis.ts:234-281](api/swing-analysis.ts#L234-L281), which directly address the exact false-default problem head-motion was meant to corroborate against.

---

## 1. Per-file state — glassesVisionInput.ts + metaGlassesBridge.ts

### [services/glassesVisionInput.ts](services/glassesVisionInput.ts) — **PARTIAL**

**Real, working:**
- Rolling 12-frame queue with 30s TTL, fanout to subscribers, lazy-cached `VisionContext` per frame ([lines 96-159](services/glassesVisionInput.ts#L96-L159)).
- Auto-mode detection from source + pitch + round context — returns `{ mode, confidence }` ([lines 304-337](services/glassesVisionInput.ts#L304-L337)).
- `getAggregateMode` weighted vote across the queue ([lines 193-215](services/glassesVisionInput.ts#L193-L215)).
- Family-recording session wrapper that auto-stamps `golfer_id` on every submitted frame ([lines 478-518](services/glassesVisionInput.ts#L478-L518)).
- `getActiveVisionFrameBase64` for multimodal Claude calls ([lines 250-278](services/glassesVisionInput.ts#L250-L278)).
- `GlassesVisionTransport` interface contract documented in full ([lines 375-397](services/glassesVisionInput.ts#L375-L397)).

**Stub:**
- `BluetoothGlassesTransport.start()` throws "not yet implemented" ([lines 419-427](services/glassesVisionInput.ts#L419-L427)). Quote:
  > "Glasses transport not yet implemented. Meta has not opened the camera frames API to third-party apps. PuttWatch + manual upload remain the supported capture paths."
- `prefersFrameRate()` returns `0` ([line 438](services/glassesVisionInput.ts#L438)).
- Module-header comment confirms the wire reality ([lines 15-19](services/glassesVisionInput.ts#L15-L19)):
  > "Meta currently does NOT expose live frames to third-party apps. PuttWatch + SmartMotion ship on a 'user records, uploads later' model."

**Net:** The transport seam is built; the transport itself is empty. Anything inside SmartPlay that wants live glasses frames has nothing to consume today.

### [services/metaGlassesBridge.ts](services/metaGlassesBridge.ts) — **FUNCTIONAL but unrelated to head-motion**

This is a **voice-query router**, not a frame pipeline. It takes a Meta-AI-style spoken query and routes it through the local `smartAnalysisEngine` (preferred) or `/api/meta-voice` (remote fallback). Local + remote paths both real; auto-mode races local against a 1.2s timeout ([lines 98-126](services/metaGlassesBridge.ts#L98-L126)).

It accepts `image_base64` on the request shape ([line 47](services/metaGlassesBridge.ts#L47)) but the local pipeline never consumes it. Intent classifier ([lines 80-87](services/metaGlassesBridge.ts#L80-L87)) is regex-driven over the query text only; no visual reasoning.

**Net:** Out of scope for head-motion. The "Meta voice asks Kevin a question" surface — not the "glasses recorded a swing, analyze it" surface.

---

## 2. Pipeline trace — recorded glasses POV video today

The audit goal asked about **async corroboration from recorded clips**, so the relevant pipeline is the photos-library + MP4 path, NOT the live transport above.

```
Ray-Ban Meta glasses
   ↓ (Meta View app, "Save to Camera Roll" ON)
iPhone Photos album "Ray-Ban" / "Meta"   OR   Android "SmartPlay Caddie" album
   ↓ (10s polling)
services/metaGlasses/importService.ts          ← FUNCTIONAL (needs next EAS Build for expo-media-library)
   getLatestMetaGlassesMedia()
   ↓ (60s "fresh" window)
app/hole-view.tsx:259-301                      ← only consumer; surfaces a banner
   ↓ (user taps Analyze)
   if photo → processMetaGlassesPhoto()        ← resizes; Alert.alert stub (line 294 // TODO POST to Tank vision API)
   if video → uploadMetaVideoForTempoAnalysis()
              ↓
              services/metaGlasses/videoAudioService.ts:43-99   ← FUNCTIONAL CLIENT
              POST /api/swing-tempo {video MP4 multipart}
              ↓
              app/api/swing-tempo+api.ts                         ← 501 STUB
              "Tempo analysis backend isn't deployed yet"
              ↓
              Alert.alert('Tank', tempo.tank_advice)             ← honest "not deployed" message
```

**The 2D early-extension call** lives on a **completely separate path**:

```
SmartMotion / Cage / Quick-Record on-device capture
   ↓ (extract 1-5 keyframes)
api/swing-analysis.ts                          ← FUNCTIONAL (multimodal Claude vision)
   returns { detected_issue, primary_fault, evidence, observation, ... }
   ↓
services/swingIssueClassifier.ts               ← maps to display fault catalog
   ↓
SmartMotion / Cage UI fault card
```

Plus a **local pose-based head/spine read**:
- [services/poseAnalysisApi.ts:421-424](services/poseAnalysisApi.ts#L421-L424) — `spineAngleDeltaDeg > 10` → verdict `"Posture changed — early extension or stand-up move"` (already lives BESIDE the multimodal call).
- [services/poseAnalysisApi.ts:329-337](services/poseAnalysisApi.ts#L329-L337) — `headDriftPxNorm` from nose x-position change, already exposed in the metrics rollup.

**Crucial gap:** the glasses MP4 route (`/api/swing-tempo`) and the swing-analysis route (`/api/swing-analysis`) are **two disjoint paths**. The glasses video does NOT feed `/api/swing-analysis`. There is no linkage today between "swing #7 the user just recorded with their phone in cage mode" and "the glasses MP4 that arrived 8 seconds later."

There is also no `/api/swing-tempo` backend — it's a 501 stub. So even if linkage existed, the glasses video isn't being decoded into frames anywhere.

---

## 3. Gap list — today → "head rose / steady / swayed" corroboration flag

Minimum viable feature: a POV optical-flow read of the recorded glasses MP4 produces a head-motion verdict (`rose | steady | swayed`) with a low/med/high confidence tier, surfaced as a SECOND chip beside the existing 2D fault on the SmartMotion / Cage fault card. Never overrides the 2D call.

What's missing between today and that:

| # | Gap | Where it'd live | Effort |
|---|---|---|---|
| 1 | **Backend video → frames pipeline.** `/api/swing-tempo` is a 501 stub ([app/api/swing-tempo+api.ts:19-30](app/api/swing-tempo+api.ts#L19-L30)). Vercel Edge can't bundle ffmpeg under 50 MB ([same file lines 6-9](app/api/swing-tempo+api.ts#L6-L9) document this). Needs an ffmpeg worker or external service. | new backend (Vercel function + ffmpeg layer, or Cloud Run worker) | **large** — new infra |
| 2 | **Optical-flow head-motion read.** Nothing in the tree does optical flow. Would need: extract address-frame ball/ground patches as fixed reference, frame-to-frame dense or sparse flow, vertical-component aggregation through the impact window, classify rose/steady/swayed. | new backend module (Python OpenCV or equivalent) | **medium** — well-trodden CV, but new in this codebase |
| 3 | **Linkage: glasses MP4 ↔ swing-analysis result.** Today the photos-library MP4 goes to `/api/swing-tempo` and the on-device cage/smartmotion frames go to `/api/swing-analysis`. No timestamp / session correlation exists. Need a fusion layer that pairs them (probably by capture window: "MP4 within ±10s of swing N → annotate swing N"). | new client logic in `services/swingLibrary.ts` + result shape additions in `api/swing-analysis.ts` | **small-medium** if response shape changes; **medium** if it's a separate `/api/swing-corroborate` route |
| 4 | **Corroboration field on the swing-analysis response.** Current shape ([api/swing-analysis.ts:284-299](api/swing-analysis.ts#L284-L299)) returns a single fault with `evidence`, `cause`, `fix`, `drill`, `layman_explanation`. NO field for secondary signals. Adding `corroboration: { source, signal, verdict, confidence }[]` is additive but touches the lockstep-twin pattern (response is consumed by both client + server flows). | `api/swing-analysis.ts` response + client consumers in [services/swingIssueClassifier.ts](services/swingIssueClassifier.ts) and SmartMotion / Cage fault-card UI | **small** API, **medium** UI |
| 5 | **UI second-signal chip.** The fault card today shows ONE primary fault with one evidence string. No visual pattern for "primary call + corroborating second signal." Would need design + a confidence tier (gray chip on low, colored on med/high). | SmartMotion + Cage fault-card components | **small** if the design is decided; **medium** with design back-and-forth |

Of these, #1 + #2 are the long pole. #3-#5 are tractable if #1-#2 land.

---

## 4. Verdict — DEFER TO FUSION TRACK

**This is a build, not a beta-bake.** The bake-pitch ("most of the pipeline is there, just add the optical-flow read") doesn't survive the trace: there is no recorded-video analysis pipeline today. The closest existing path (`/api/swing-tempo`) is an honest 501 stub. The proposed corroboration field has no response shape to slot into without an API change. The client linkage layer between glasses MP4 and swing-analysis result doesn't exist.

For **mid-beta-prep**, three reasons to defer:

1. **The actual false-default risk on early-extension is already being handled in-prompt.** See [api/swing-analysis.ts:234-281](api/swing-analysis.ts#L234-L281): the prompt enforces a phase-by-phase observation step, a differential, evidence-gated selection, and an **explicit anti-default guardrail** for early_extension specifically (line 281: "the most common fault in golf instruction content and tempting as a safe pick. Do NOT name it without explicit evidence"). Adding a noisy second signal *on top of* a still-being-calibrated primary signal makes diagnosis harder to trust, not easier.

2. **Pose-based posture verdict already exists locally.** [services/poseAnalysisApi.ts:421-424](services/poseAnalysisApi.ts#L421-L424) computes `spineAngleDeltaDeg` and emits a posture verdict from on-device MediaPipe data — no backend, no glasses, no ffmpeg. If the goal is "second signal beside the multimodal early-extension call," this is the **already-shipped** second signal. The honest beta move is making sure the SmartMotion / Cage card surfaces it next to the fault, not building a parallel optical-flow path that costs an infrastructure sprint.

3. **The transport reality hasn't changed.** [services/glassesVisionInput.ts:15-19](services/glassesVisionInput.ts#L15-L19) and [lines 419-426](services/glassesVisionInput.ts#L419-L426) both spell out that Meta doesn't expose live frames. Even the recorded-video path depends on the user enabling Meta View "Save to Camera Roll," waiting for sync, then explicitly tapping Analyze. The capture latency is fundamentally async-with-user-step. Treating that as a corroborating signal for an in-the-moment fault call is asking the user to do real work to validate a single phrase on the fault card.

**Recommend:**
- **For beta:** ship the 2D evidence-gated early-extension call as-is. If a second visible signal is desired, wire the existing `poseAnalysisApi.spineAngleDeltaDeg` verdict into the fault card UI as a "corroborated by on-device pose" chip. Zero new infrastructure. Days of work, not weeks.
- **For the fusion track (post-beta):** stand up the ffmpeg worker, define the optical-flow module, design the corroboration response shape, and design the fault-card second-signal chip together. This is a discrete project with a clear scope — fund it once, ship it once.

---

## Files referenced

- [services/glassesVisionInput.ts](services/glassesVisionInput.ts) — PARTIAL (queue + auto-detect real, transport stub)
- [services/metaGlassesBridge.ts](services/metaGlassesBridge.ts) — FUNCTIONAL (voice-query router, unrelated to head-motion)
- [services/metaGlassesIngest.ts](services/metaGlassesIngest.ts) — FUNCTIONAL (JSON voice-exchange import, unrelated)
- [services/metaGlasses/importService.ts](services/metaGlasses/importService.ts) — FUNCTIONAL (Photos-library polling, awaiting native module on next EAS Build)
- [services/metaGlasses/videoAudioService.ts](services/metaGlasses/videoAudioService.ts) — FUNCTIONAL CLIENT (uploads to 501 backend)
- [app/api/swing-tempo+api.ts](app/api/swing-tempo+api.ts) — STUB (501 Not Implemented)
- [app/hole-view.tsx:259-301](app/hole-view.tsx#L259-L301) — only consumer of the recorded-video path
- [api/swing-analysis.ts](api/swing-analysis.ts) — FUNCTIONAL (multimodal Claude vision, evidence-gated)
- [services/swingIssueClassifier.ts](services/swingIssueClassifier.ts) — FUNCTIONAL (display catalog)
- [services/poseAnalysisApi.ts:421-424](services/poseAnalysisApi.ts#L421-L424) — FUNCTIONAL (existing on-device posture verdict — the already-shipped "second signal")
