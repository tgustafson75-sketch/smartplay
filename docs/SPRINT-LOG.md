# SmartPlay Caddie — Consolidation Sprint Log

**Sprint goal:** clean, consolidate, kill duplication, make it intuitive, prove it works on device. Target: app ready by June.
**Sprint start date:** 2026-05-20

The full sprint plan lives in [docs/audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md). This log is the running daily record. The short "where are we right now" pointer is [docs/SPRINT-RESUME.md](SPRINT-RESUME.md).

---

## Day 1 — 2026-05-20

### Shipped today (Day 1 / Fix 1 addendum)
- **End Round "Maximum update depth exceeded" crash — FIXED** ([app/recap/[round_id].tsx:172](../app/recap/[round_id].tsx#L172)). Root cause: the `useRoundStore` selector for `roundPhotos` used an inline `?? []` fallback. When `round_photos` was `undefined` (every round without photos — Tim's synthetic rounds in particular), the selector returned a FRESH `[]` literal each evaluation. Zustand's `useSyncExternalStore` saw the new reference as a snapshot change, re-rendered, re-ran the selector, got yet another fresh `[]`, looped forever → crash. Fix: extracted `const EMPTY_PHOTOS: RoundPhoto[] = []` at module scope and use it as the fallback so the reference is stable. Same pattern Tim already fixed in `components/dev/GpsQualityOverlay.tsx` (2026-05-16 — see in-file comment there).

### Shipped today
- **Phase 416 cleanup** (`77014bb`) — SmartMotion direct camera, overlay toggles, integrated record button. Earlier today.
- **Tools FAB + persona-aware Kevin TTS** (`a63d1b3`) — Caddie tab giant green pill replaced with small right-side chevron that expands left into tool icons. `/api/kevin` no longer hardcodes Kevin's voice for every persona (Tim flagged: "motherfucking Kevin keeps talking for Serena too"). ElevenLabs persona routing + OpenAI gender-mapped fallback (nova for Serena).
- **Phase 418 — SmartMotion validation gate** (`3cf8d11`) — Single source of truth for "is there an analyzable swing." Pose overlay, metrics, and Insight card now share one gate; floor footage no longer produces fake skeleton or fake "82 mph club speed." Added `services/swingValidity.ts`, framing tips + retake CTA, pre-record framing guide.
- **Bundle hash bump** (`e872f9b`) — trivial change to bypass an Expo asset processor that kept timing out on the prior bundle id.
- **Phase 420 — full state-of-codebase audit** (`bb3db35`) — 12 audit docs covering structure, routes, duplication, dead code, pillars, caddie, tools, recent phases, data models, build health, UX walk, and the synthesized SPRINT MAP.
- **Phase 421 — sprint context infrastructure** (this commit) — `SPRINT-LOG.md`, `SPRINT-RESUME.md`, CLAUDE.md discipline section.

### Verified on device (Z Fold)
- **Nothing this session.** All work today is "git-diff verified" / Vercel-deploys-itself. The Tools FAB layout change and the Phase 418 client-side gating are on `main` but the OTA push to preview did not land (see Notes).

### Open / carried to tomorrow
- **OTA push for `e872f9b`** failed five times with Expo asset processor timeouts on `entry-*.hbc`. Vercel will pick up the server-side validation prompt automatically; the client-side gating is in the next EAS push (or the next APK).
- **End-Round crash** ("Maximum update depth exceeded") was flagged in the prior session and is still unverified on the current bundle. P0-4 in the Sprint Map.
- **Empirical verification debt** — Phase 416, 418, the persona TTS fix, and the Tools FAB are all unproven on a real Z Fold. Day 2 should start with on-device confirmation before any new code lands.

### Notes
- **Date drift mid-session:** the conversation began on 2026-05-19 and rolled over to 2026-05-20 mid-work. Both the persona-aware Kevin fix and Phase 418/420/421 are 2026-05-20 work; SmartMotion Phase 416 was earlier (2026-05-19).
- **Phase 418 ground truth (per request):** validation gate IS in. Files present:
  - `services/swingValidity.ts` — client-side evaluateSwingValidity() with server `valid_swing` + observation-text heuristic fallback
  - `api/swing-analysis.ts` — server emits `valid_swing` + `validity_reason`, system prompt requires validity decision FIRST
  - `app/swinglab/smartmotion.tsx` — wired to gate pose skeleton, shot tracer, metrics, and Insight card
  - `app/swinglab/quick-record.tsx` — added pre-record framing dashed-rectangle guide
  - Commit: `3cf8d11`. NOT verified on device. Server fix deploys via Vercel automatically; client fix needs an OTA or next APK build.
- **Audit headline blockers** (P0 from Sprint Map):
  1. `/arena/practice` is a 404 from the SwingLab Arena card
  2. `/swinglab/range` likely also missing — verify
  3. Two parallel SmartMotion UIs still reachable via voice-intent / Tools menu / Library
  4. End-Round crash unverified on current bundle
  5. `speaker_id` declared on Shots but never written — multi-player blocker
  6. Placeholder buttons in SmartMotion (Tag Club / Compare / View Full Data)
  7. 10 debug routes ungated for non-owners
- **One audit-agent calc error caught:** the routes audit claimed `scorecard.tsx` was 35,210 LINES. It is 772 lines (35,210 BYTES). Fixed in `docs/audit-420-routes.md` before commit. The real refactor target is `app/(tabs)/caddie.tsx` at 3,870 lines.
- **A new chat resuming tomorrow should:** read [SPRINT-RESUME.md](SPRINT-RESUME.md) first, then [audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md). The full audit evidence is in `docs/audit-420-*.md`.

---

## Template for future days

```
## Day N — YYYY-MM-DD

### Shipped today
- [phase / change, commit hash]

### Verified on device (Z Fold)
- [empirically confirmed]

### Open / carried to tomorrow
- [unfinished]

### Notes
- [decisions, gotchas, what a fresh chat needs to know]
```
