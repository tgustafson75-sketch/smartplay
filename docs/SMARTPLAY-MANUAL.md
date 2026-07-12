# SmartPlay Caddie — Master Manual

**Status:** IN PROGRESS (consolidation started 2026-07-11) — not yet complete.
**Supersedes:** `docs/MASTER_COMPENDIUM.md` (2026-05-17), `docs/SMARTPLAY-COMPENDIUM.md`
(2026-05-21), `docs/USER_COMPENDIUM.md` (2026-05-17), and `docs/field-manual/` (2026-05-24).
Those are retained for history until this manual is complete, then archived.
**Bundle head at consolidation:** `8d86a37c` (glasses live-stream toggle + real Android DAT bridge).
**Channel state:** `preview` + `production` OTA on `1.0.0` runtime; API on `api.smartplaycaddie.com`.

> This is the single authoritative reference for SmartPlay Caddie — one document that serves
> both the builder (architecture, file map, conventions, ship status) and the user (how to use
> every surface, full voice vocabulary, flows). Read top-to-bottom for orientation; jump to a
> section for targeted work. Designed to export cleanly to PDF for review and editing.

---

## How this manual is built (consolidation map)

This manual merges four prior docs into one. Each section notes its sources and update state.

| Section | Backbone source | Also folds in | Update state |
|---|---|---|---|
| 1. Product & Vision | field-manual/01-product | MASTER §1, USER Overview | ⏳ bring current |
| 2. Using the App (User Guide) | USER_COMPENDIUM (all) | SMARTPLAY §3–5 | ⏳ bring current |
| 3. Voice — Full Vocabulary | USER "Voice Vocabulary" | SMARTPLAY §6 intent catalog | ⏳ bring current |
| 4. Architecture | field-manual/02 | MASTER §3, SMARTPLAY §10 | ⏳ bring current |
| 5. Feature State (REAL / STUB / DEFERRED) | field-manual/03 | SMARTPLAY §8 | ⏳ bring current |
| 6. Conventions & Standing Rules | field-manual/04 | MASTER §5 | ✅ portable (verify) |
| 7. File Map | field-manual/05 | MASTER §4 | ⏳ bring current |
| 8. Ship Status & Beta Readiness | field-manual/06 | MASTER §8 | ⏳ bring current |
| 9. Known Issues & Roadmap | field-manual/07 | MASTER §7 | ⏳ bring current |
| 10. Glossary & Reference | SMARTPLAY Appendix A | MASTER §9 | ⏳ bring current |

---

## What's NEW since the last docs (2026-05-24 → 2026-07-11) — to fold in

These are shipped since the newest prior doc and are **absent** from all four old compendia:

- **Live Ray-Ban Meta glasses** — Meta Wearables DAT v0.8, **Android** (real native module +
  Settings "Connect Ray-Ban Glasses" toggle; POV frames → SmartVision / green reads / Kevin).
  *(NOTE: old docs say the Meta SDK "doesn't expose the camera" — now FALSE, it's built.)*
- **Wear OS watch app** (`wear-os-app/`) — companion, same signing key, Data Layer messaging.
- **Unified Caddie Brain / CNS** — local-first deterministic + CNS retrieval, cloud on miss;
  one pipecat brain across SmartMotion + Caddie; provider cascade (OpenAI→retry→Gemini→local).
- **SmartMotion rebuild** — merged with Cage + quick-record; 3 skeleton view modes
  (mechanics-over-user / mechanics / user); contact honesty; per-swing analysis.
- **SmartFinder unified read** + **Course Book (CNS)** — per-hole offline range book.
- **Server-mediated backup + email-OTP account** — app → our API → Supabase (supersedes the
  old "no cloud sync / auth is a stub" framing).
- **SmartPump third rail** — golf-workout import → TRAINING→PERFORMANCE dashboard correlation.
- **SwingSim + Hotel Mode** — phone-as-club sim with real bag + aerials; gyro tempo.
- **SmartPlay Light** — installable web app (Smart Motion + Dashboard), wired to the live API.
- **Infra** — custom domain `api.smartplaycaddie.com` + dual-host failover (fixes the
  *.vercel.app DNS-filter outage); single-provider brain default OpenAI.
- **Two whole-app bug audits** (2026-07-10) + fixes; yardage plausibility gate.

## What's now STALE/WRONG in the old docs — to correct

- Auth = "Coming soon stub" / "no cloud sync" → **backup + account shipped**.
- "Meta SDK doesn't expose the camera" → **live glasses streaming built (Android)**.
- Persona roster, Harry status, subscription kill-switch — re-verify against current code.
- Repo path `/Users/timothyg/Documents/smartplay` → now `/Users/timothyg/smartplay`.
- Co-author trailer / model names, dev environment (Windows→macOS) — update.
- Model IDs (Sonnet 4.6 etc.) — refresh to current.

---

## 1. Product & Vision

### What it is
SmartPlay Caddie is a conversational AI golf companion (Android + iOS, Expo / React Native; plus
a browser **SmartPlay Light** and a **Wear OS watch** companion). It blends a four-character caddie
team, GPS-based shot detection, phone-sensor swing analysis (camera + acoustics + pose), course
imagery, and tools for practice and on-course play — with **no extra hardware**: the phone's
cameras, microphones, and GPS plus AI are the whole system (the north star), now optionally
extended by Ray-Ban Meta glasses and a Galaxy Watch when the player has them.

The differentiator over conventional rangefinder + scoring apps is **personality and presence**: a
caddie that talks to you, learns you, and adapts to context — pre-round, mid-round, between shots,
on the range, in the cage. The design ethos is **Simplified Sophistication**: it can do almost
anything, but must feel effortless — complexity is pushed into the brain, the surface stays clean.
The target user is the **time-constrained but capable golfer**, not the range rat; every feature is
filtered through "is this time-honest and the highest-ROI use of their attention?"

### Hands-free, zero-setup is the product
The #1 principle: open the app and the caddie is **already helping** — zero taps, zero setup.
Every gate between cold-open and help is treated as a defect. The voice path is a protected
invariant.

### Honesty-as-differentiator
Every metric carries a **source label + confidence bucket**, and the app would rather say "I don't
know yet" than print fake-precision. Examples: a pose-derived club speed reads `~96 mph
(pose-estimated, med)`; an acoustic ball-speed reads `~148 mph (acoustic, club-typical, med)`; a
value it can't honestly conclude renders `—` with an explanation. Swing analysis returns
`inconclusive` rather than a default fault; a chunked/mishit is never shown as a good swing; mockup
numbers are never shipped as real — real signals populate or the field says "Coming Soon"/omits.

### The Caddie Brain (unified, local-first)
All caddie intelligence routes through one **Caddie Brain / CNS** (central nervous system). It
answers **local-first** — deterministic rules + on-device learned data (bag, course, tendencies) —
and only pings the cloud on a miss. The cloud path is a resilient cascade (primary provider → retry
→ secondary → graceful local fallback); the caddie **always attempts** and degrades gracefully
rather than throwing up walls. The same one brain drives both the on-course Caddie and SmartMotion.
The evaluation lens for any new capability is "does this belong in the Caddie Brain, routed through
the CNS?"

### Three pillars
| Pillar | Surfaces | Primary register | Verify path |
|---|---|---|---|
| **ROUND** | Play tab, Caddie tab, Scorecard, Hole View, Cockpit, SmartFinder, SmartVision | Caddie (tactical) | Path 2 |
| **PRACTICE — SwingLab** | SwingLab tab, Cage/Range Mode, SmartMotion, Quick Record | Coach (instructional) | Path 3 |
| **PLAY** | Dashboard, Arena drills, Recap, sharing | Psychologist (cross-round) | — |

Path 1 (Onboarding) and Path 4 (Voice / hands-free) cross all three pillars.

### The four-caddie team (equal, user-selectable)
From `lib/persona.ts`: **Kevin** (balanced default), **Serena** (analytical, calm, female voice),
**Tank** (Marine-vet intensity, scoped so the volume matches the character), **Harry** (Army-medic
wisdom; soft-removed from `ACTIVE_PERSONAS`, assets retained, settings migration maps persisted
Harry → Kevin). The brand line is **"Built by SmartPlay AI,"** never a single caddie — the canonical
avatar is `CaddieAvatar.tsx`. Per-pillar assignment (`settingsStore.caddieAssignments`) lets a user
run Tank for cage, Serena for round, Kevin for play; each persona carries a three-register
(Caddie / Coach / Psychologist) spec.

### Competitive frame & brand lock
**GolfFix + Golfshot in one shell**: the structured swing-fault coach (primary fault + cause + fix +
drill + evidence) and the satellite-imagery on-course yardage tool, unified by a conversational
caddie neither has — and done without a pose-hardware bar (phone-sensor + AI vision). Brand: app
**SmartPlay Caddie**, builder **Built by SmartPlay AI**, social **@SmartPlayCaddie**, support
**support@smartplaycaddie.com**, site **www.smartplaycaddie.com**, API **api.smartplaycaddie.com**.

## 2. Using the App (User Guide)
_⏳ To compile — from USER_COMPENDIUM (tabs, flows) + SMARTPLAY pillars, brought current._

## 3. Voice — Full Vocabulary
_⏳ To compile — from USER voice vocabulary + SMARTPLAY §6 intent catalog, brought current._

## 4. Architecture
_⏳ To compile — from field-manual/02 + MASTER §3 + SMARTPLAY §10, brought current._

## 5. Feature State (REAL / STUB / DEFERRED)
_⏳ To compile — from field-manual/03 + SMARTPLAY §8, brought current._

## 6. Conventions & Standing Rules
_⏳ To compile — from field-manual/04 + MASTER §5. Mostly portable; verify each against current code._

## 7. File Map
_⏳ To compile — from field-manual/05 + MASTER §4, brought current (new: wear-os-app, glasses, Light)._

## 8. Ship Status & Beta Readiness
_⏳ To compile — from field-manual/06 + MASTER §8, brought current._

## 9. Known Issues & Roadmap
_⏳ To compile — from field-manual/07 + MASTER §7, brought current._

## 10. Glossary & Reference
_⏳ To compile — from SMARTPLAY Appendix A + MASTER §9, brought current._

---

*Consolidation kickoff 2026-07-11. Build section-by-section, bringing each current against the
live code before marking ✅. When complete, export to PDF for Tim's testing + editing.*
