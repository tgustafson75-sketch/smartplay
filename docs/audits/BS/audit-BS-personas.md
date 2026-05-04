# Phase BS — Persona Verdicts

**Date:** 2026-05-04
**Caveat:** All verdicts assume today's code is committed + pushed + on-device-verified. Pre-empirical, every persona's actual experience is the pre-session state — see `audit-BS-empirical-status.md`.

---

## Verdict scale

- **READY** — persona's primary needs are met by working features
- **ACCEPTABLE** — primary needs met but with known gaps the persona will work around
- **AT RISK** — at least one primary need has a known empirical failure or a missing feature
- **BROKEN** — primary need cannot be served at all

---

## Dave — Weekend Warrior

**Primary needs:** Simple, fast, reliable. Open app → start round → see yardage → finish → score.

| Dimension | State | Today's delta |
|---|---|---|
| Earbud tap to engage Kevin | AT RISK (Phase AC honest-disable; on-screen tap is the working fallback) | none |
| GPS yardages | AT RISK (Y.2 rehydration race fix shipped pre-session; never empirically verified) | none |
| SmartFinder | AT RISK (AH error handling shipped pre-session; verification pending) | none |
| Mark button propagation | AT RISK (AL pub/sub shipped pre-session; verification pending) | none |
| Hole transitions | AT RISK (sustained-position threshold fires pre-session; never on-device-verified through 18 holes) | none |

**Verdict: AT RISK.** Same as session start. Dave depends on the foundation batch (AC + AL + AH + Y.2) verifying empirically; nothing today moved that needle. **The earbud tap is the most concerning — when on-screen-tap fallback isn't obvious to a Dave-shaped user, he gives up and reaches for Golfshot.**

---

## Marcus — Improver

**Primary needs:** Practice that connects to round play. Tutorials, cage sessions, structured feedback, drill recommendations. Sees Kevin's caddie advice as the integration layer.

| Dimension | State | Today's delta |
|---|---|---|
| Cage session capture | ACCEPTABLE (Phase K shipped pre-session) | none directly; BL adds club tracking |
| Phase K analysis on cage swings | AT RISK (live-cage flow hasn't been empirically verified end-to-end) | none |
| Phase K analysis on **uploaded** videos | **NOT APPLICABLE NOW** (BR Component 14 redirected upload entry to tutorial flow) | **major shift today** |
| Tutorial library | NEW READY (BR foundation shipped, empirical pending) | **shipped today** |
| Tutorial → Kevin caddie context | NEW READY (BR injection shipped) | **shipped today** |
| Round → tutorial recap reinforcement | NEW READY (BR Component 9 shipped) | **shipped today** |
| Per-club cage stats | NEW READY (BL clubSegments shipped) | **shipped today** |
| Auto club detection | NEW READY (BL three-tier triggers shipped, empirical pending) | **shipped today** |
| Drill library | ACCEPTABLE (Phase R shipped pre-session) | none |

**Verdict: AT RISK pre-empirical → READY post-empirical (assuming verification holds).** This is the persona who benefits most from today's session. BL + BR together turn Marcus from "I have to remember which clubs I practiced and rebuild that mental context during rounds" into "Kevin reflects what I'm working on automatically." The risk: empirical verification might surface that Sonnet's tutorial extraction isn't useful enough, or that Kevin's responses don't actually weight the practice context naturally — both unverifiable from code review alone.

**Most likely failure mode for Marcus:** he activates a tutorial, plays a round, and Kevin's responses feel basically the same as before. The practice_context block was injected but didn't change Kevin's behavior in a perceptible way. Mitigation post-empirical: tighten the system prompt's practice-context guidance, possibly add explicit "reference the practice cue when this club fires" instructions.

---

## Sarah — Competitive (low-handicap)

**Primary needs:** Precision. Defensible Kevin calls. No fabrications. Stats + course data accurate. Honest uncertainty admission.

| Dimension | State | Today's delta |
|---|---|---|
| GPS precision (yardages, hazards) | AT RISK (no GPS code changed today; Y.2 race fix unverified) | none |
| Course data (golfcourseapi) | ACCEPTABLE (working pre-session, kept as v1.0 in scope-final) | none |
| Honesty: tentative-read prefix on low-confidence cage analysis | NEW READY (U1 + Phase V.6) | **shipped today (U1)** |
| Honesty: non-instruction guard for tutorials | NEW READY (BR Component 11) | **shipped today** |
| Voice register differentiation (BC) | NOT SHIPPED | none |
| Uncertainty admission in Kevin's prompts | ACCEPTABLE (existing system prompts hedge appropriately) | none |
| Per-stage failure messaging (no_frames vs no_network vs error) | NEW READY (U1) | **shipped today (U1)** |

**Verdict: AT RISK → ACCEPTABLE pre-empirical.** Sarah's honesty bar gets reinforced by U1's per-stage messaging and BR's non-instruction guard — both reduce the surface of "couldn't analyze, no useful info" with hedged-but-useful output. Voice register differentiation (Phase BC) still missing; she'll get the same Kevin tone whether she's struggling vs cruising. That's a Phase BC concern, not today's.

**Most likely failure mode for Sarah:** GPS yardages drift through a round, she catches the drift, loses trust in Kevin's calls. Mitigation: the Mark button (AL) is the recovery path; making sure Sarah knows it exists is an onboarding / discoverability issue, not a code issue.

---

## James — Returning (lapsed golfer)

**Primary needs:** Welcoming onboarding. Encouraging tone. Patient with re-learning. Psychologist register matters when he's frustrated.

| Dimension | State | Today's delta |
|---|---|---|
| Onboarding flow | ACCEPTABLE (multi-step shipped pre-session) | none |
| Welcome tone | ACCEPTABLE (Phase BB context capture shipped per critical-paths Path 1) | none |
| Voice register (Psychologist for emotional / frustrated states) | NOT SHIPPED (Phase BC) | none |
| Trust spectrum L1-L4 | ACCEPTABLE (Phase R shipped pre-session) | none |
| Recap encouraging tone | ACCEPTABLE (existing Sonnet recap prompt) | BR Component 9 added practice-reinforcement block — could read encouraging or clinical depending on extraction quality |

**Verdict: ACCEPTABLE.** Same as session start. James benefits least from today's session since today's work was upload-pipeline-fix + cage practice tools + tutorial library — features Marcus and Sarah will adopt before James does. James's primary gap (Phase BC voice register differentiation) is unaddressed today.

**Most likely failure mode for James:** he has 3 bad holes in a row; Kevin keeps the same Caddie register tone instead of softening to Psychologist; James decides Kevin "doesn't get it" and disengages. Mitigation: BC is the targeted fix.

---

## Movement summary (session start → session end)

| Persona | Pre-session | End of session (post-empirical) | Net |
|---|---|---|---|
| Dave | AT RISK | AT RISK (no change) | unchanged |
| Marcus | AT RISK | **READY** if BL + BR verify | **+1 step** |
| Sarah | AT RISK | **ACCEPTABLE** if U1 verifies | **+1 step** |
| James | ACCEPTABLE | ACCEPTABLE (no change) | unchanged |

**Net: today's session moved 2 of 4 personas one step better — but only conditional on empirical verification.** Dave and James are unchanged; today's work was Marcus-and-Sarah-aligned (cage practice + tutorial integration + analysis honesty). Dave's foundation needs separate empirical verification work. James needs BC.

---

## Pre-empirical reality

If Tim does not run Z Fold testing within ~7 days (per critical-paths.md), the verdicts revert: every persona stays at the AT RISK / ACCEPTABLE level documented at session start regardless of code shipped today, because beta-readiness gating treats unverified work as "doesn't exist for users." That's the bar the project chose; today's session output respects it.
