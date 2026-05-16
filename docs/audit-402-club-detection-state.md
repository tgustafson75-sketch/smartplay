# Phase 402 Audit: Auto Club Detection (Phase BL) — Real vs Stub

**Audit Date:** 2026-05-15
**Scope:** motion / voice / manual trigger tiers, Sonnet vision endpoint,
user-bag context, club-state propagation across cage + round + voice.
**Methodology:** read-only inspection of `services/clubRecognition.ts`,
`api/club-recognition.ts`, `store/cageStore.ts`,
`services/intents/clubHandler.ts`, `services/intents/index.ts`,
`components/CageSessionOverlay.tsx`, `app/cage/index.tsx`, and full grep
for call-sites of `recognizeClubFromBase64` / `recognizeClubFromUri`.

---

## 1. Trigger layer

| Tier | State | Notes |
|------|-------|-------|
| Motion | **MISSING** | Never implemented. The architecture doc abandoned it because expo-camera ~17 doesn't expose continuous frame access. `DeviceMotion` is used elsewhere for the rangefinder pitch/heading only. |
| Voice | **REAL — end-to-end** | `services/intents/clubHandler.ts` exports `clubChangeHandler`, `clubQueryHandler`, `clubMenuHandler`. Registered in `services/intents/index.ts:27-29`. Intents declared to the Anthropic voice classifier in `api/voice-intent.ts:141-162`. `parseSpokenClub` regex (`services/clubRecognition.ts:171-204`) handles iron / wedge / wood / hybrid / driver / putter, returns null on bare "wedge". Handler calls `cageStore.setActiveClub(club_id, 'voice', 'high')` + telemetry. **Works if a cage session is active and the user speaks a club phrase.** |
| Manual | **SCAFFOLDING ONLY** | `cageStore.clubMenuOpen` exists. `setClubMenuOpen()` action exists. `setActiveClub()` accepts source `'manual'`. **No UI modal renders this state.** The `club_menu` voice intent sets the flag and nothing consumes it. |

## 2. Vision pipeline

**Endpoint (`api/club-recognition.ts`, 159 lines):** **REAL.**
- Model `claude-sonnet-4-6`, temperature 0.1, max 200 tokens.
- System prompt (lines 49-84) instructs Sonnet to read the sole-stamped
  number / wedge stamp / hosel mark, validate against a club catalog,
  and return structured `{ club_id, club_type, confidence, reasoning }`.
- Catalog matches the cage store's `ClubId` union — DR, 3W/5W/7W,
  2H–5H, 3I–9I, PW/GW/AW/SW/LW, PT, unknown.
- Response parsing strips fences, validates against the catalog, falls
  back to `'unknown'` + low confidence on parse failure.

**Client wrapper (`services/clubRecognition.ts`):** **REAL.**
- `recognizeClubFromBase64(b64, apiUrl)` POSTs to
  `/api/club-recognition` with a 15s `AbortController` timeout.
- `recognizeClubFromUri(uri, apiUrl)` reads via `expo-file-system` and
  forwards to the base64 path.
- Tagged-union outcome: `ok | no_network | error` — never throws.
- Telemetry on every outcome (`club_recognition_ok`,
  `club_recognition_failed`, `club_recognition_no_network`,
  `club_recognition_error`, `club_recognition_read_failed`).

**Camera invocation / UI surface:** **MISSING.**
- Grep for `recognizeClubFromBase64`, `recognizeClubFromUri`, and
  `/api/club-recognition` returns **zero call sites outside the service
  file itself**.
- `components/CageSessionOverlay.tsx` (1066 lines) — the screen that
  hosts cage sessions — contains zero references to club recognition,
  club picker, vision capture, or `currentClub` display.
- The only camera capture in the codebase
  (`components/caddie/PhotoCaptureButton.tsx`) is for on-course round
  photos, unrelated to club ID.

## 3. User bag

**MISSING.** No onboarding flow, no settings screen, no AsyncStorage
record of the user's actual clubs. The `CLUBS` catalog hard-coded in
`app/cage/index.tsx` is the only club list — a static enumeration of
all standard clubs, not "this user owns these". Detected `7I` cannot
be cross-checked against "does the user actually carry a 7-iron".

## 4. Club identification & mapping

- Sonnet's structured response gives a `club_id` directly from the
  catalog, so mapping is identity (no normalization layer required).
- Ambiguity: prompt instructs Sonnet to prefer the specific wedge
  designation when stamped (PW/GW/SW/LW) and to return `'unknown'` with
  low confidence on unreadable images.
- **No bag-membership check** — vision returns `7I`, the system
  accepts `7I` regardless of whether the user owns one.

## 5. Propagation

**Cage session:** `setActiveClub()` correctly closes the prior
`ClubSegment` and opens a new one; `addShot()` auto-tags new shots with
`activeSession.currentClub`; `endSession()` closes the open segment.
**No screen displays `currentClub` or renders `clubSegments`.**

**Round shot logging:** `roundStore` shot logging has its own `club`
field unrelated to the cage's `currentClub`. The two stores don't
communicate. Detection on the course is out of scope today.

**Voice context (Kevin/Tank/Serena):** No code reads
`cageStore.currentClub` into the prompt-building path. The voice
caddies don't know which club is active.

## 6. Honest assessment matrix

| Component | Code state | Would run? |
|-----------|-----------|------------|
| Motion trigger | MISSING | No |
| Voice trigger | REAL | Yes — cage active + spoken phrase |
| Vision endpoint | REAL | Yes — if called |
| Vision client wrapper | REAL | Yes — if called |
| Vision UI surface | MISSING | No call sites |
| Manual picker UI | SCAFFOLDING | State updates but no modal |
| Bag awareness | MISSING | No store |
| `currentClub` display | MISSING | No UI consumer |
| `clubSegments` consumer | MISSING | No UI consumer |
| Telemetry | REAL | Yes when callers fire |

## STATE OF AUTO CLUB DETECTION

**Phase BL is high-quality scaffolding plus one working tier.** The
Sonnet vision endpoint and the typed client wrapper are production-ready
and well-instrumented. The voice path works end-to-end. **What's
missing is the UI: there is no button in the cage screen to capture a
photo, no modal to pick a club manually, and no on-screen indication of
which club the session believes you're currently hitting.** The vision
code is dead-wired — a complete pipeline with no call site.

This is the opposite shape of the SmartFinder concern. SmartFinder
*was* honest about its math; Phase BL has honest math that nobody can
reach.

## WHAT NEEDS WORK — priority order

1. **Wire the vision pipeline into the cage UI.** An "ID club" camera
   button on the cage session header that captures via
   `expo-image-picker.launchCameraAsync({ base64: true })`, calls
   `recognizeClubFromUri()`, and routes by confidence:
   - high → `setActiveClub(id, 'vision', 'high')`, brief toast
   - medium → "Looks like your 7-iron — confirm?" — accept/decline
   - low / unknown / no_network / error → fall through to manual picker
2. **Manual club picker modal** that renders from `clubMenuOpen` and
   writes back via `setActiveClub(id, 'manual', 'high')`. Tap target
   on the cage header opens it; voice intent `club_menu` already
   opens it; the camera fallback opens it on low confidence.
3. **Current-club chip** in the cage session header — always visible,
   tappable to open the manual picker.
4. **Bag context** (deferred): onboarding step or settings screen
   capturing the user's actual clubs; vision results cross-checked.
5. **Round shot logging integration** (deferred): plumb `currentClub`
   through to `roundStore.addShot` so on-course shots inherit it.
6. **Voice prompt context** (deferred): inject `currentClub` into the
   Kevin/Tank/Serena system prompt so the caddie knows.

This phase's substantive work is items 1–3. Items 4–6 are listed for
the next phase that touches this area.

## Phase 402 — what shipped after the audit

Per Tim's "no regressions, additive + upgrade only" rule, the following
were implemented in this commit:

- **`components/cage/ClubIdentifyControls.tsx`** — chip + camera button
  in the cage session header. Camera button launches
  `expo-image-picker.launchCameraAsync`, calls `recognizeClubFromUri`,
  and routes by confidence tier (auto-accept high, ask on medium,
  fall through to manual on low / unknown / network failure).
- **`components/cage/ClubPickerModal.tsx`** — manual club picker that
  reads `clubMenuOpen` from `cageStore` and writes `setActiveClub`
  on selection. Same modal triggered by the existing `club_menu`
  voice intent.
- **CageSessionOverlay wiring** — header chip + modal mount.
- **Current-club chip** — always visible during an active session,
  shows the club from `setActiveClub`'s last write (or session start),
  tappable to open the manual picker.

Empirical accuracy validation (Component 2 of the prompt) requires
photographing real clubs and is deferred to Tim's Z Fold pass — the
audit doc here is the code-level state of the pipeline.
