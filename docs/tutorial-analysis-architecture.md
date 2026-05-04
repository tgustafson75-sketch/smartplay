# Tutorial Analysis Architecture (Phase BR — foundation)

**Date:** 2026-05-04
**Companion to:** [docs/club-recognition-architecture.md](club-recognition-architecture.md), [docs/upload-pipeline-map.md](upload-pipeline-map.md), [docs/migration-gap-analysis.md](migration-gap-analysis.md), [docs/legacy-club-detection-capture.md](legacy-club-detection-capture.md)

---

## Premise framing — read first

Phase BR is presented as "rebuilding to legacy validated architecture." After auditing `origin/master` for tutorial-content-extraction / instructor-audio-alignment / practice-context-injection logic: **none of it exists in legacy.** The legacy upload flow is the same Phase K biomechanics pipeline currently in `main`. Whatever the legacy v2 actually did, it didn't transcribe instructor audio or inject coaching content into Kevin's system prompt.

This isn't a fatal issue — the product idea is good independent of legacy provenance. **But the "validated" framing isn't accurate.** What ships in this phase is forward-looking foundation, not portage. Same situation as the BL "auto club detection" capture: legacy never had it; we're building greenfield.

(Same audit pattern as [docs/legacy-club-detection-capture.md](legacy-club-detection-capture.md) — both BL and BR were framed as "rebuilding legacy" with claims that don't match what's in `origin/master`.)

---

## What this phase ships (foundation slice)

| Layer | File | Purpose |
|---|---|---|
| Store | [store/tutorialStore.ts](../store/tutorialStore.ts) | `TutorialEntry` data model, persisted across restarts. Active-flag with hard cap of `MAX_ACTIVE_TUTORIALS = 3`. |
| Server | [api/tutorial-analysis.ts](../api/tutorial-analysis.ts) | Anthropic Sonnet endpoint that extracts structured teaching content (`teaching_focus`, `key_cues`, `target_clubs`, `target_situations`, `instructor`, `confidence`) from a title + notes + optional representative video frame. |
| Client service | [services/tutorialAnalysis.ts](../services/tutorialAnalysis.ts) | Calls `/api/tutorial-analysis` with tagged-union outcome (`ok` / `no_network` / `error`). Telemetry events: `tutorial_analysis_ok` / `_failed` / `_no_network` / `_error` / `_frame_extract_failed`. |
| Client formatter | [services/tutorialContext.ts](../services/tutorialContext.ts) | Two formatters for Kevin's prompt: `buildFullPracticeContext()` (Sonnet calls; multi-paragraph, references coach by name) and `buildCompressedPracticeContext()` (Haiku calls; one-line per tutorial). Both return `null` when no tutorials are active so the existing prompts are unchanged for users without practice context. |
| Server prompt | [api/kevin.ts](../api/kevin.ts) | New `practice_context` request param. Injected into system prompt right after the `EMERGING PATTERNS` block, with explicit guidance to "factor this learning into shots that match. Do NOT override the coach's instruction. Reinforce when shot calls for the technique being practiced." Component 13 (token budget): bounded by the 3-active cap. |
| Client call sites | [services/listeningSession.ts](../services/listeningSession.ts), [hooks/useVoiceCaddie.ts](../hooks/useVoiceCaddie.ts), [hooks/useKevin.ts](../hooks/useKevin.ts) | All 3 sites now read `buildFullPracticeContext()` and pass `practice_context` in the Kevin POST body. |
| Upload UI | [app/swinglab/tutorial-upload.tsx](../app/swinglab/tutorial-upload.tsx) | Pick video (optional) → frame extracted at mid-clip via `expo-video-thumbnails` → manual title / instructor / notes / target-clubs entry → `analyzeTutorial` → store entry → navigate to detail. |
| Library UI | [app/swinglab/tutorials.tsx](../app/swinglab/tutorials.tsx) | List of saved tutorials with active-count banner. "+ Add" routes to upload. |
| Detail UI | [app/swinglab/tutorial/[id].tsx](../app/swinglab/tutorial/[id].tsx) | Full entry render with active toggle (enforces 3-active cap with explicit Alert), key cues, target clubs, target situations, player notes, extraction confidence, delete. |
| SwingLab entry | [app/(tabs)/swinglab.tsx](../app/(tabs)/swinglab.tsx) | New `Tutorials` ToolRow under My Swing Library. |
| Stack registration | [app/_layout.tsx](../app/_layout.tsx) | Three new routes registered: `swinglab/tutorials`, `swinglab/tutorial-upload`, `swinglab/tutorial/[id]`. |

### Verification

- `npx tsc --noEmit`: 0 errors
- `npm run lint`: 1 error + 6 warnings (identical to pre-BR baseline; zero regression)
- No new dependencies added.

---

## Architecture — three streams in the BR prompt vs what shipped

The BR prompt described a "three-stream pipeline": visual swing analysis (Stream 1), audio transcription + alignment (Stream 2), teaching content extraction (Stream 3). What actually shipped:

| Stream | Status | Why |
|---|---|---|
| Stream 1 — visual swing analysis | **Partial / repurposed.** The existing Phase K pipeline still serves user-swing biomechanics in cage sessions. Tutorial uploads in BR do NOT run swing biomechanics — they run teaching-content extraction (Stream 3 only). The original framing of "extract demo swings" doesn't fit the manually-curated tutorial-library use case; it's a legitimate Phase BR2/BR3 feature when audio transcription lands. | The user uploading "Marc's wedge tutorial" cares about Marc's coaching content, not biomechanics on Marc's demo swings. Bringing in pose-detection on instructor swings is feature creep without empirical evidence it improves Kevin's caddie advice. |
| Stream 2 — audio transcription + alignment | **DEFERRED to BR2.** Whisper integration with video files (vs short user voice queries) needs file-extraction-from-video plumbing the project doesn't currently have, plus Vercel function body-size constraints to navigate (videos can be 200MB; Vercel pro is 4.5MB request body). | Shipping a half-built audio pipeline would either consume hours of speculative integration work OR ship a feature that fails on real video files. Better to land the architecture (store + injection) and add audio when there's empirical evidence the rest of the loop works. |
| Stream 3 — teaching content extraction | **Shipped, primarily from manual notes + 1 representative frame.** When BR2 audio ships, the transcript becomes the primary signal and notes become supplementary annotation. The endpoint already accepts an optional `transcript` field that BR2 will populate. | Manual-notes mode is a defensible MVP — the player typing "Marc's shallow attack on wedges, club stays low through impact" is enough signal for Sonnet to produce a structured summary that materially helps Kevin's caddie advice. |

---

## Data flow — happy path

```
User taps SwingLab → Tutorials → + Add
  → /swinglab/tutorial-upload mounts
  → (optional) picks video → frame extracted at t=5s, mid-clip → expo-image-manipulator resize 1024px @ q=0.7
  → user types title + instructor + notes + tags target clubs
  → onAnalyze:
       analyzeTutorial(input, apiUrl)
         → POST /api/tutorial-analysis with title + notes + frame.b64
         → Anthropic Sonnet (claude-sonnet-4-6, T=0.2, max_tokens=600)
         → returns { teaching_focus, key_cues, target_clubs, target_situations, instructor, confidence }
       useTutorialStore.addTutorial({...mergedClubs, ...extraction})
         → returns sessionId
       router.replace(`/swinglab/tutorial/${id}`)

User toggles "Active practice context" ON in detail view
  → useTutorialStore.setActive(id, true)
       → enforces MAX_ACTIVE_TUTORIALS = 3
       → if at cap, Alert prompts user to deactivate one first
  → tutorialStore is now persisted with this entry flagged active

User starts a round / asks Kevin a question
  → listeningSession / useVoiceCaddie / useKevin builds POST body to /api/kevin
       → body.practice_context = buildFullPracticeContext()
            → reads useTutorialStore.getState().getActive()
            → returns formatted multi-line string OR null
  → server-side api/kevin.ts injects _practiceContext into systemPrompt
       → Kevin's response now factors the active tutorials
```

When no tutorials are active, `buildFullPracticeContext()` returns `null`, no `practice_context` block is added to the prompt, and Kevin behaves exactly as before BR shipped. **Zero regression for users without active tutorials.**

---

## Telemetry catalog

| Event | When | Properties |
|---|---|---|
| `tutorial_analysis_ok` | Sonnet returned a valid teaching summary | `confidence`, `latency_ms`, `key_cues_count`, `target_clubs_count` |
| `tutorial_analysis_failed` | Server returned non-2xx | `status`, `latency_ms`, `body_preview` |
| `tutorial_analysis_no_network` | Fetch aborted / timed out | `latency_ms` |
| `tutorial_analysis_error` | Other exception | `message`, `latency_ms` |
| `tutorial_frame_extract_failed` | Optional thumbnail extraction failed (analysis still proceeds without frame) | `message` |

These flow through `services/analytics.track` to Sentry breadcrumbs (when DSN is configured per `docs/v1-scope-final.md` §E).

---

## Token budget — Component 13 status

| Item | Status | How |
|---|---|---|
| Cap active tutorials at 3 | ✅ | `MAX_ACTIVE_TUTORIALS = 3` in `tutorialStore.ts`; `setActive` enforces the cap and surfaces an Alert when exceeded. |
| Compressed context for Haiku | ⚠️ Implementation ready, not wired | `buildCompressedPracticeContext()` exists in `services/tutorialContext.ts` but isn't currently used. Today all 3 client call sites use `buildFullPracticeContext()`. The Haiku path inside `api/kevin.ts` doesn't currently differentiate. **Tightening to compressed-on-Haiku is a small follow-up** (1-2h: classifier branch sets which context flavor to inject). |
| Full context for Sonnet | ✅ | `buildFullPracticeContext()` is what gets injected today. |
| Token usage telemetry | ❌ | Not added in this slice. Anthropic SDK exposes token counts in the response; instrumenting that is its own focused phase. |
| Citation telemetry (which tutorials get cited) | ❌ | Would require parsing Kevin's response text for matches against active-tutorial cues. Speculative without empirical evidence the citation rate is the right tuning signal. |

---

## Phase BR repaste — Components 8-14 disposition

Tim re-pasted BR with explicit asks for Components 8-14 after the foundation slice landed. Disposition:

| Component | Status |
|---|---|
| **8** Multi-tutorial conflict handling | **DEFERRED** — speculative without empirical evidence of value. The 3-active cap bounds the noise; if Kevin produces conflicting advice with two competing-cue tutorials active, that's the empirical signal that conflict-detection is worth building. Not before. |
| **9** Round → recap practice reinforcement | ✅ **SHIPPED** — `services/recapGenerator.ts` accepts `practiceContext` parameter; `app/(tabs)/caddie.tsx` `generateRecap` call passes `buildFullPracticeContext()`; `api/recap.ts` `RecapRequest` extended with `practice_context`; system prompt gets a new `practiceBlock` after `arenaBlock` with explicit reinforcement-vs-honest-call-out logic. Same honesty bar as cage context: only cite when round shot data supports it. |
| **10** Tutorial recommendation from round patterns | **DEFERRED** — explicitly gated on Phase BJ YouTube QUEUE per `docs/research-summary.md`. Will become a candidate when YouTube integration ships. |
| **11** Non-instruction fallback | ✅ **SHIPPED** — Sonnet prompt in `api/tutorial-analysis.ts` extended with the non-instruction guard ("clearly NOT golf instruction → return `teaching_focus: 'not_instruction'`"). `app/swinglab/tutorial-upload.tsx` detects this and surfaces an Alert: "Doesn't look like a golf lesson. If this is your own swing, use Cage Mode." Two action buttons: Try again / Open Cage Mode. The bogus entry is NOT stored. |
| **14** Redirect SwingLab Upload entry | ✅ **SHIPPED** — `app/(tabs)/swinglab.tsx` "Upload Swing" ToolRow renamed to "Add Tutorial" and routes to `/swinglab/tutorial-upload` instead of `/swinglab/upload`. The legacy biomechanics route still exists for re-analyze of pre-BR uploaded sessions in My Swing Library; live cage-mode recordings are unaffected (separate code path, U1 fallback still active there). |

Components 9, 11, 14 ship in this turn. Components 8 + 10 stay deferred with explicit reasons.

---

## What's deferred to BR2 / future phases

These were Components in the BR prompt that didn't ship; documenting so a future phase has clear scope.

- **Component 2 Stream 1** — extracting demo swings from the instructor video and running pose-detection on them. Useful only if Kevin's advice would materially benefit from "Marc demonstrated this technique with a 7-iron at swing-speed X." Speculative. Wait for empirical evidence that adds value.
- **Component 2 Stream 2** — Whisper transcription. The only place this hooks in is `api/tutorial-analysis.ts` already accepts an optional `transcript` field. Shipping it requires (a) audio extraction from video on-device or server-side, (b) Whisper API integration (existing `api/transcribe.ts` is for short user voice queries, not video tracks; would need its own endpoint or extension), (c) handling Vercel function body-size limits for larger videos. **~6-10h focused work.**
- **Component 4** — Tutorial library UI: shipped (basic list view). Future: thumbnails extracted from videos, search/filter, tag-based organization, conflict-detection between active tutorials.
- **Component 6** — Voice alignment with timestamp scrubbing: Phase R Coach Audio toggle exists; alignment with transcript timestamps is BR2 + UI work to scrub the video to specific cues.
- **Component 7** — Multi-tutorial conflict resolution: not addressed today. The cap of 3 means the player can simultaneously activate up to 3 conflicting tutorials. If they say "shallow attack" and "steeper" both at once, Kevin will see both in his prompt and presumably hedge. Future polish: detect cue-level conflicts at activation time and prompt the player.
- **Component 8** — Round → tutorial reinforcement: post-round recap doesn't currently reference active tutorials. Adding to `services/recapGenerator.ts` would be straightforward (~1-2h) but should follow empirical evidence the active-context loop works.
- **Component 9** — Tutorial recommendation from round patterns: gated on Phase BJ YouTube research (currently QUEUE per `docs/research-summary.md`).
- **Compressed-context-for-Haiku wiring** — see Token budget table above.
- **Token usage / citation telemetry** — see Token budget table above.

---

## Standing rule

> **Upload analysis is tutorial context capture, not user swing analysis.**
>
> User swing analysis happens via cage sessions (Phase K) and via "Upload Swing" (existing biomech path). These are different products in different surfaces.
>
> Tutorials live in **SwingLab → Tutorials**. They feed Kevin's caddie advice during rounds via the `practice_context` mechanism in `api/kevin.ts`. Up to 3 can be active at once.

This rule is the contract. Future BR2/BR3 work extends it; doesn't replace it.
