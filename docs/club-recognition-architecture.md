# Auto Club Recognition — Architecture (Phase BL)

**Date:** 2026-05-04
**Scope:** Cage practice mode. Other surfaces (rounds, scorecard, swing library) are not affected.
**Premise:** Manual club selection breaks practice flow when the player switches clubs frequently. Recognition replaces or supplements the manual tap-grid with vision OCR + voice triggers, while keeping the tap-grid as the always-accessible fallback.

---

## What shipped vs the original BL prompt

The BL prompt described a **three-tier trigger architecture**:
1. PRIMARY — motion-sensed approach detection (camera frame-difference)
2. SECONDARY — voice trigger
3. TERTIARY — manual selector

**What actually shipped:** a different three-tier shape that achieves the same recognition outcome without requiring infrastructure that doesn't exist on the current camera stack:

1. **PRIMARY — explicit photo capture.** User taps an "ID club" button in the cage session header → camera opens via `expo-image-picker.launchCameraAsync` → user snaps the club sole → vision reads stamped number/letters → confidence-tiered UX registers / confirms / falls back.
2. **SECONDARY — voice trigger.** "switching to 6-iron" / "going to PW" / "now I'm on driver" → `club_change` intent → high-confidence parse auto-registers; ambiguous phrases like bare "wedge" prompt for clarification.
3. **TERTIARY — manual picker.** Tap the club label in the header (or say "show clubs" / "club menu") → modal with the same 17-button grid that already exists in `app/cage/index.tsx` → tap to switch.

**Why the swap from motion-sensed to explicit photo:** the BL prompt assumed Phase K maintains a "rolling buffer" of live camera frames, and that frame-difference motion analysis is feasible on the existing stack. Neither holds: `services/poseDetection.ts` samples frames from a *finished swing clip* via `expo-video-thumbnails` (not a live buffer), and `expo-camera` (~17.0.10) does not expose continuous frame access at all. Live frame-processor motion detection requires `react-native-vision-camera`, which Phase BJ research classified as QUEUE due to open Expo SDK 54 / New Architecture / Xcode 26 issues. Explicit photo capture achieves the same recognition outcome with a clear user-mental-model, no new dependencies, and no fragile motion heuristics. See `docs/research-mediapipe.md` for the BJ findings that motivated this swap.

---

## File map

| Layer | File | Lines | Purpose |
|---|---|---|---|
| Server (Vercel) | [api/club-recognition.ts](../api/club-recognition.ts) | new | Anthropic Sonnet vision endpoint. Reads number/letters stamped on club sole. Returns `{ club_id, club_type, confidence, reasoning }`. Catalog matches `app/cage/index.tsx` `CLUBS` so values stored in cageStore align. |
| Client | [services/clubRecognition.ts](../services/clubRecognition.ts) | new | Three exports: `recognizeClubFromBase64`, `recognizeClubFromUri`, `parseSpokenClub` (regex parser for voice phrases), `clubLabel` (TTS-friendly label). Tagged-union outcome (`ok` / `no_network` / `error`) so callers render fallback UX rather than crashing. Inline `track()` telemetry per call. |
| State | [store/cageStore.ts](../store/cageStore.ts) | additive | New `ClubSegment` type + `currentClub?: string` + `clubSegments?: ClubSegment[]` fields on `CageSession`. New action `setActiveClub(club_id, source, confidence?)` closes the prior segment and opens a new one. New `clubMenuOpen: boolean` (NOT persisted) drives the manual picker modal. `addShot` auto-tags shots with `currentClub`. `endSession` closes the open segment. |
| State | [store/settingsStore.ts](../store/settingsStore.ts) | additive | `cageAutoClubDetection: boolean` (default `true`, persisted). When `false`, the photo button hides; voice + manual still work. |
| Voice intents | [services/intents/clubHandler.ts](../services/intents/clubHandler.ts) | new | Three handlers: `clubChangeHandler` (parses phrase via `parseSpokenClub`, calls `setActiveClub` with `source: 'voice'`); `clubQueryHandler` ("what club am I on" → reads `currentClub`); `clubMenuHandler` (sets `clubMenuOpen: true`). All round-gated on active cage session. |
| Voice intents | [services/intents/index.ts](../services/intents/index.ts) | additive | Registers the three new handlers with `voiceCommandRouter`. |
| Voice intents | [api/voice-intent.ts](../api/voice-intent.ts) | additive | Adds `club_change` (#13), `club_query` (#14), `club_menu` (#15) to the Anthropic classifier system prompt + intent_type union. |
| Cage UI | [app/cage/session.tsx](../app/cage/session.tsx) | additive | Header now reads `currentClub ?? club ?? '7I'`. Title is tappable (opens manual picker). New "ID club" camera button (gated on `cageAutoClubDetection`). New `handleIdentifyClub` runs the photo flow. New `applyClubSwitch` is the single registration entry point used by all three trigger paths (voice route reaches it via `setActiveClub` directly). New manual picker modal. |
| Settings UI | [app/settings.tsx](../app/settings.tsx) | additive | New "Practice" section with one toggle: "Auto Club Detection". |

**Files NOT touched** (intentional zero-regression surface):
- `app/cage/index.tsx` — the session-start manual picker stays exactly as it was. `CLUBS` constant there is not duplicated; the in-session picker has its own `CLUB_PICKER` array (slightly larger — adds 7W / 3-5H — to cover the catalog). De-duplicating would be a format-change refactor; out of BL scope.
- `services/poseDetection.ts` and the swing-analysis pipeline — untouched. BL is additive to cage flow, not a replacement.
- The Expo Router mirror at `app/api/voice-intent+api.ts` — already significantly drifted from the canonical Vercel `api/voice-intent.ts`. Mobile uses the Vercel deploy, so the mirror's drift is pre-existing and not a BL concern. **Worth a future cleanup phase.**

---

## Data flow per trigger

### Photo path
```
user taps "ID club"
  → ImagePicker.requestCameraPermissionsAsync (one-time)
  → ImagePicker.launchCameraAsync({ quality: 0.7, exif: false })
  → recognizeClubFromUri(uri, apiUrl)
     → FileSystem.readAsStringAsync (uri → base64)
     → POST {apiUrl}/api/club-recognition  with { image: { b64, media_type } }
     → Anthropic Sonnet vision (model: claude-sonnet-4-6, temperature: 0.1, max 200 tokens)
     → returns { club_id, club_type, confidence, reasoning }
  → confidence routing in handleIdentifyClub:
     - high   → applyClubSwitch(club_id, 'vision', 'high')        — auto-register + Kevin ack "Got it, 6-iron"
     - medium → Alert "Looks like X — confirm?"  [Yes] [Different] — confirm ack "Got it, X" or open picker
     - low/unknown → Alert "Couldn't read" → open picker
     - error  → Alert "Couldn't read" → open picker
  → applyClubSwitch:
     → cageStore.setActiveClub(club_id, source, confidence)   — closes prior segment, opens new
     → setClubMenuOpen(false)
     → speak() ack via configureAudioForSpeech + voiceService
```

### Voice path
```
user says "switching to 6-iron"
  → listening session → /api/voice-intent → { intent_type: 'club_change', parameters: { club_phrase: '6-iron' } }
  → voiceCommandRouter.dispatch
  → clubChangeHandler.execute:
     - parseSpokenClub('6-iron') → { club_id: '6I', club_type: 'iron' }
     - if null (ambiguous like bare "wedge"): voice_response "Which one — pitching, gap, sand, or lob wedge?", follow_up_needed: true
     - else: cageStore.setActiveClub('6I', 'voice', 'high')
     - returns voice_response "Got it, 6-iron"
  → listening session speaks the voice_response
```

### Manual path
```
EITHER  user taps the club label in the cage header
   OR   user says "show clubs" / "club menu" → clubMenuHandler → cageStore.setClubMenuOpen(true)
   OR   handleIdentifyClub falls back to manual on low confidence
  → Modal renders with CLUB_PICKER grid
  → user taps a club
  → applyClubSwitch(club_id, 'manual')   — same path as photo high-confidence
```

---

## Telemetry events (via `services/analytics.track`)

| Event | When | Properties |
|---|---|---|
| `club_recognition_ok` | Vision call returned 2xx with parsed result | `club_id`, `club_type`, `confidence`, `latency_ms` |
| `club_recognition_failed` | Non-2xx HTTP | `status`, `latency_ms`, `body_preview` |
| `club_recognition_no_network` | AbortController fired or fetch threw network-shaped error | `latency_ms` |
| `club_recognition_error` | Other exception | `message`, `latency_ms` |
| `club_recognition_read_failed` | FileSystem.readAsStringAsync failed | `message` |
| `club_recognition_low_confidence` | Vision returned `low` or `unknown` | `club_id` |
| `club_recognition_cancelled` | User cancelled `launchCameraAsync` | (none) |
| `club_recognition_exception` | Outer try/catch in `handleIdentifyClub` caught something | `message` |
| `club_voice_ambiguous` | `parseSpokenClub` returned null | `phrase` (truncated to 60 chars) |
| `club_switched` | Voice handler successfully registered a switch | `club_id`, `club_type`, `source: 'voice'` |

The analytics service today flushes to Sentry breadcrumbs only (`services/analytics.ts`). Sentry DSN is not configured (per the v1.0 audit and `docs/v1-scope-final.md` §E), so these events are buffered locally and consumed during dev. Once Sentry is wired, the success-rate / fallback-rate dashboards become trivial to build from this catalog.

---

## Empirical verification (Tim's checklist)

1. **Settings → Practice → Auto Club Detection** is ON by default. Toggle OFF then ON to verify persistence across an app restart.
2. **Cage session header** shows the current club label. Tapping the label opens the manual picker modal.
3. **"ID club" button** appears below the shot-count when Auto Club Detection is ON; absent when OFF.
4. **Photo path:**
   - Tap "ID club" → camera permission prompt (first time only) → camera opens.
   - Snap a 7-iron sole, well-lit → high-confidence path → Kevin/Serena says "Got it, 7-iron". Header updates to `7I`. New segment opens; subsequent shots tag `7I`.
   - Snap a worn / poorly-lit sole → medium-confidence path → "Looks like X" prompt → confirm or open picker.
   - Snap something unreadable (face cover, dark) → low-confidence → manual picker auto-opens.
   - Cancel the camera → no state change, no telemetry except `club_recognition_cancelled`.
5. **Voice path:**
   - Open a cage session (default 7I).
   - Tap Kevin badge / earbud → say "switching to PW".
   - Within ~2-3s: Kevin says "Got it, pitching wedge". Header updates to `PW`.
   - Say "what club am I on" → "You're on pitching wedge."
   - Say "switching to wedge" (ambiguous) → "Which one — pitching, gap, sand, or lob wedge?" (no state change).
   - Say "show clubs" → manual picker opens.
6. **Session end:** session summary should show the segment list (per-club shots). The `clubSegments` field is on the persisted `CageSession`. UI rendering of segments in the summary is a separate, future polish phase — not in BL scope.
7. **Toggle OFF:** "ID club" button hides. Voice intents still route, but `parseSpokenClub` results still register via `setActiveClub` — voice is independent of the toggle. Manual picker still works.

---

## What's explicitly NOT in BL

These were Components in the BL prompt that didn't ship; each is documented here so a future phase can pick them up.

- **Motion-sensed approach detection / pause-detection / camera-frame-diff** — see "Why the swap" above. Achievable only after `react-native-vision-camera` integration (currently QUEUE per BJ research) or a custom native frame-grab module.
- **Pose-based approach detection (BL Component 4 advanced option)** — same MediaPipe / vision-camera dependency. Same QUEUE.
- **Per-club distance estimation across sessions (BL "what this phase does NOT include")** — explicitly out of scope.
- **Voice biometric for multi-player ID** — separate phase, see `docs/research-voice-biometric.md`.
- **Cage overlay integration for "recognition mode indicator"** — Phase AM cage overlay shipped (`81d15bc`), but BL doesn't add a recognition-mode visual cue. The "ID club" button + camera UI is the obvious cue.
- **Per-segment cage analysis output rendering** — segments are stored; the summary screen still renders the legacy single-club aggregate. A small follow-up phase can swap to per-segment rendering using existing `clubSegments` data.

---

## Security / privacy notes

- The club-sole photo is sent to Anthropic Sonnet vision. This is the **same data path** the existing `/api/swing-analysis` endpoint uses for swing frames; no new sub-processor is added.
- The privacy policy ([docs/privacy-policy.md](privacy-policy.md)) §4 already covers Anthropic for "voice query transcripts, swing/lie context" — it should be updated to mention "club-sole photos for auto club detection during cage practice" the next time the policy is touched. Not a BL-blocking change since the processor is already disclosed.
- `expo-image-picker` does not retain photos in the device gallery unless `allowsEditing: true` (which we don't set). Photos are read once into base64 and discarded after the network call.

---

## Verification log

- ✅ `npx tsc --noEmit` — 0 errors after all edits
- ✅ `npm run lint` — 1 error + 8 warnings (identical to pre-BL baseline; zero regression)
- ⏳ Empirical on Galaxy Z Fold 5 — pending Tim's run

---

## Commit summary (when committed)

```
Phase BL — auto club recognition for cage (vision OCR + voice + manual)

- api/club-recognition.ts: Anthropic Sonnet vision endpoint reading the
  number/letters stamped on a club's sole. Catalog matches the existing
  CLUBS array in app/cage/index.tsx so values align with cageStore.

- services/clubRecognition.ts: client service. recognizeClubFromUri /
  recognizeClubFromBase64 with tagged-union outcome (ok / no_network /
  error). parseSpokenClub regex parser. clubLabel TTS helper.

- store/cageStore.ts: ClubSegment + currentClub + clubSegments[] on
  CageSession (additive, optional, back-compat). setActiveClub action
  closes prior segment / opens new. clubMenuOpen state.

- store/settingsStore.ts: cageAutoClubDetection toggle (default true,
  persisted).

- services/intents/clubHandler.ts: club_change / club_query / club_menu
  voice intent handlers. Round-gated on active cage session.

- api/voice-intent.ts: classifier prompt + intent_type union extended
  with the three new intents.

- app/cage/session.tsx: header reads currentClub. Tap-to-open manual
  picker. "ID club" camera button (gated on setting). handleIdentifyClub
  drives the three-tier confidence UX. applyClubSwitch is the single
  registration entry point. New manual picker Modal.

- app/settings.tsx: new Practice section with the toggle.

Architecture doc: docs/club-recognition-architecture.md.
```
