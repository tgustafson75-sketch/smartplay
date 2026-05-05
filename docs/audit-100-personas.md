# Phase 100 — Component 2: Persona Verdicts Updated

**Audit date:** 2026-05-05
**Bundle SHA:** `94e7d29`
**Reference:** `docs/audits/BS/audit-BS-personas.md` (prior verdicts pre-cage-refactor)

## Verdict legend
- **READY** — feature paths the persona depends on are verified working
- **ACCEPTABLE** — works for the persona's primary use case with minor caveats
- **AT RISK** — depends on UNKNOWN-state surfaces that aren't yet verified
- **BROKEN** — depends on a feature path that's empirically broken

## Personas

### Dave — Weekend Warrior
**Profile:** Casual recreational golfer. Plays Free Play mode. Wants on-course caddie advice, score tracking, voice queries. Doesn't use Cage Mode much.

**Critical paths:** PATH 1 ONBOARD, PATH 2 ROUND, PATH 4 VOICE.

**Pre-Phase-100 verdict (BS audit):** READY.

**Phase 100 verdict: AT RISK.**

**Evidence:**
- PATH 2 ROUND: pre-bundle was working per Phase BG/AY/BH. No structural round-flow changes in recent bundle. SHOULD still work.
- PATH 4 VOICE: persona widening + hydration fix landed without Z-Fold verification. The original "Kevin says X when Serena selected" bug had a fix shipped (`5a9e19d` + `94e7d29`). Whether the fix actually holds on cold launch is empirically unknown.
- PATH 1 ONBOARD: untested post-bundle. New users default to Kevin; persona switching only matters for returning Tim-tier users. Dave is a fresh install — should land cleanly.

**What would shift to READY:** PATH 2 ROUND + PATH 4 VOICE pass `docs/verification-BV-PREP.md` on Z Fold.

---

### Marcus — Improver (Practice-focused)
**Profile:** Player working on swing fundamentals. Uses Cage Mode 3-5x/week, uploads instructional videos, expects per-swing breakdown + drill recommendation, tracks progress over weeks.

**Critical paths:** PATH 3 CAGE primarily; PATH 4 VOICE secondarily; tutorial flow (BR).

**Pre-Phase-100 verdict (BU audit Component 8):** **BROKEN** — Cage Mode failed empirically across 5 of 6 dimensions in studio session.

**Phase 100 verdict: AT RISK (uncertain).**

**Evidence:**
- Phase BU established BROKEN. Post-BU, FIVE phases shipped specifically to address Marcus's failures: BV (canonical UI), BX (telemetry), BW (per-clip Phase K), BY-quick (false-positive hardening), BZ-v1 (review UI uplift). All structural changes target Marcus's exact use case.
- All five phases are CODED CORRECTLY (TypeScript clean, lint baseline preserved, internal consistency).
- All five phases are UNVERIFIED on Galaxy Z Fold post-shipping.
- Best-case scenario: Marcus is now READY pending verification.
- Worst-case scenario: an integration gap (e.g., per-clip frame extraction silently fails on Z Fold's specific expo-video-thumbnails build, or per-shot CageShots accumulate without persisting analysis) keeps Marcus BROKEN despite the fixes.

**What would shift to READY:** Galaxy Z Fold MIN VERIFY for PATH 3 CAGE (5 controlled swings → library entry → per-swing analysis card → tap to scrub each swing) per `docs/verification-BV-PREP.md` test groups E1–E4.

**Specific risks for Marcus per surface:**
- Per-clip frame extraction at `clipBoundaries.startSec`+offsets — untested whether expo-video-thumbnails honors offsets within a multi-swing master video correctly on every Android encoding.
- Per-shot Phase K result persistence — `setShotAnalysis` is called inside the iteration; if Zustand updates batch in unexpected ways during a heavy multi-swing analysis pass, some shots may show "—" until next render trigger.
- BY-quick detection thresholds (TRANSIENT_THRESHOLD_DB=18, DECAY_MIN_DB_PER_SAMPLE=5) tuned without empirical validation. Marcus's home practice environment may have different ambient than the studio.

**What would shift to BROKEN:** any one of the above risks materializes on Z Fold.

---

### Sarah — Competitive (Tournament-prep)
**Profile:** Plays Break_80 mode, competitive rounds, expects rigorous shot tracking, ghost match, recap with pattern detection. Uses voice during rounds.

**Critical paths:** PATH 2 ROUND (intensive), PATH 4 VOICE (intensive), recap.

**Pre-Phase-100 verdict (BS audit):** READY.

**Phase 100 verdict: AT RISK.**

**Evidence:**
- PATH 2 ROUND: ghost match, score tracking, scorecard +/- edits all from Phase AY/AZ/BH. No structural changes in recent bundle.
- PATH 4 VOICE: persona widening untested. Sarah is more likely to switch personas (she'll try all 4 at least once) and any inconsistency surfaces.
- Recap: Sonnet system prompt now persona-aware. Untested per persona.
- BH in-round diagnostic Coach (multi-shot pattern reasoning) is one of Sarah's most-valuable features. Last verified in `ef50864`. Persona widening threaded through; untested.

**What would shift to READY:** PATH 2 + PATH 4 verification on Z Fold across at least Kevin + Serena.

---

### James — Returning (Used the app, came back after 2+ weeks)
**Profile:** User who tried the app before, dropped off, returns. Settings persisted from last time. Hits cold launch with non-default state.

**Critical paths:** PATH 1 ONBOARD (cold-launch hydration!), all surfaces if his settings deep-customized.

**Pre-Phase-100 verdict (BS audit):** AT RISK (cold-launch hydration concern flagged).

**Phase 100 verdict: AT RISK.**

**Evidence:**
- The hydration race condition James was at risk for was the EXACT bug Tim hit ("Kevin says 'there you are' when set on Serena"). Phase BU-followup shipped the fix (`98c5822` app/index.tsx blocks routing on both stores, app/greeting.tsx uses TTS for non-Kevin personas).
- Fix is correct on inspection. Not yet Z-Fold-verified.
- If the fix holds: James shifts to READY.
- If a corner case in the hydration order persists (e.g., `useGhostStore`, `useRelationshipStore`, `useCageStore` not also gated), James may still see flicker on a deep-customized cold launch.

**What would shift to READY:** Tim cold-launches with each non-Kevin persona at least once and confirms no Kevin flash. (Test Group B in BV-PREP protocol.)

---

## Aggregate

| Persona | Pre-100 verdict | Phase 100 verdict | Delta |
|---|---|---|---|
| Dave | READY | AT RISK | Worsened (UNKNOWN-state from recent bundle) |
| Marcus | BROKEN | AT RISK | Improved (structural fixes shipped, unverified) |
| Sarah | READY | AT RISK | Worsened (UNKNOWN-state from recent bundle) |
| James | AT RISK | AT RISK | Unchanged (fix shipped, unverified) |

**The pattern:** every persona moved toward AT RISK because the recent bundle of changes touches all paths but none of them have been Z-Fold-verified. The fix-coverage is good on paper; empirical confirmation is missing.

**Single highest-leverage action:** Tim runs `docs/verification-BV-PREP.md` on Galaxy Z Fold. That single empirical session resolves three of the four persona verdicts (Dave, Marcus, James) within ~30 minutes of testing.
