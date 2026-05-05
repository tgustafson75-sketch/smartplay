# Phase 200 — Component 2: Persona Verdicts (v1.1)

**Audit date:** 2026-05-05
**Bundle SHA:** `c170ec5`

## Verdict legend
- **READY** — feature paths the persona depends on are verified working
- **ACCEPTABLE** — works for primary use case with minor caveats
- **AT RISK** — depends on UNKNOWN-state surfaces not yet verified
- **BROKEN** — depends on a feature path that's empirically broken

## Pre-200 baseline

All four personas were AT RISK at the end of Phase 100 (audit-100-personas.md) pending Tim's BV-PREP empirical pass. Since Phase 100, this session shipped 8 phases that materially affect every persona. Empirical verification still hasn't happened.

## Per-persona verdicts

### Dave — Weekend Warrior

**Profile:** casual recreational. Plays Free Play. Wants on-course caddie advice + score tracking + voice queries. Doesn't use Cage Mode much.

**Default team after Phase 105 migration:** Round = Kevin, Cage = Tank (irrelevant — doesn't use it), Drills = Serena (irrelevant), Play = Kevin.

**Verdict: AT RISK ↗**

What's improved since Phase 100:
- Phase 107: GPS yardages auto-update on walking (was 4s poll, now sub-second). Per-pillar caddie auto-flips so Kevin handles the round consistently.
- Phase 108: SmartVision tee/pin markers projection-based (matches actual rendered position).
- Phase 109: log_shot voice intent ("I hit driver 240 left" → logs to current hole).
- Audit 101 / S4: voice-write race fix (likely the [voice] speak timeout culprit).

What's still UNKNOWN:
- Every above improvement hasn't been verified on Z Fold.
- PATH 4 voice still unconfirmed (no F12 evidence post-S4 fix).

**What would shift to READY:** Tim runs a casual round end-to-end. SmartFinder yardages match Garmin within 2-3 yards. Voice commands fire reliably. Recap renders correctly.

### Marcus — Improver (Practice-focused)

**Profile:** Cage Mode 3-5x/week. Uploads instructional videos. Expects per-swing breakdown + drill recommendation + week-over-week trend.

**Default team:** Round = Kevin, **Cage = Tank** (his pillar), **Drills = Serena**, Play = Kevin.

**Verdict: AT RISK**

What's improved since Phase 100:
- Phase 105: when Marcus opens Cage Mode, Tank auto-engages with "Tank here. Let's work." Persona texture matches Marcus's intensity preference for practice.
- Phase 106: drill_plateau detector — if Marcus practices the same drill 3+ sessions with the same primary issue, Serena can suggest swapping to Tank's speed-drill approach (or vice versa).
- Phase 111: Common Faults cards on SwingLab tab with reputable instructor videos (Hank Haney, Sean Foley, Mike Malaska, Mike Bender). Personalization re-orders catalog by Marcus's most-frequent detected issue.
- Phase 111-followup: cards collapsible (was too much vertical space).

What's still UNKNOWN:
- Cage Mode itself was BROKEN at Phase BU studio session. Five phases of structural fixes shipped (BV/BX/BW/BY-quick/BZ-v1 + Audit 101 cage fixes). Whether they hold on Z Fold is the bet.
- Phase 106 trigger detection uses cageStore.sessionHistory.shots.perShotAnalysis.detected_issue — if Phase K isn't writing this consistently, plateau detection silently no-ops.

**What would shift to READY:** Marcus runs 3 cage sessions over a week. Tank engages each time. Per-swing analysis renders. If issue persists across sessions, drill-plateau suggestion fires offering Serena's alternate.

### Sarah — Competitive (Tournament-prep)

**Profile:** Break_80 mode. Competitive rounds. Rigorous shot tracking + ghost match + recap pattern detection. Uses voice intensively during rounds.

**Default team (per Phase 105 spec):** Round = Kevin OR Serena (her preference). Cage = Tank. Drills = Serena. Play = Kevin.

**Verdict: AT RISK ↗**

What's improved since Phase 100:
- Phase 102: Serena spec rewrite — composed professional caddie, "Trust your number" / "Smooth swing" — explicitly the voice for Sarah.
- Phase 105: she can assign Serena to Round + Drills cleanly via Settings → Caddie Team.
- Phase 107: GPS accuracy bumped (B5 walking → High; B2 outlier rejection; B3 smoothing). Yardages should be Garmin-comparable post-fix.
- Phase 108: SmartVision tee/pin projection-based.
- Phase 109: log_shot lets her dictate every shot ("8-iron 165 in the rough").

What's still UNKNOWN:
- Garmin comparison test (Phase 107 / C6) — Tim's empirical run is the gate.
- Voice intent classifier handling log_shot under stress (mid-round).
- Recap pattern detection: persona-aware system prompts on api/recap and Anthropic prompt caching shipped, but whether the recap *text* feels like Serena's voice is empirically TBD.

**What would shift to READY:** Sarah plays a competitive 18 with Serena assigned to Round + Drills. Yardages within 2-3 yards of Garmin. log_shot fires reliably. Recap reads in Serena's voice.

### James — Returning (returned after 2+ weeks)

**Profile:** Tried before, dropped off, came back. Settings persisted.

**Default team:** Round = Kevin (default). **Tim's spec recommendation: assign Harry for round → measured wisdom for returning golfer.** Cage = Tank. Drills = Serena. Play = Kevin.

**Verdict: AT RISK ↗**

What's improved since Phase 100:
- Phase 104: Harry spec rewrite — partnership voice, "Take a breath" / "Worth thinking about" — measured wisdom designed exactly for James's profile.
- Phase 105: migration from prior single caddiePersonality preserves James's preference. He can swap Round → Harry in one tap.
- Phase 100 / hydration gate: Kevin-flash-on-cold-launch bug (the original Tim-reported bug that triggered Phase BU) shipped a fix; not Z-Fold-verified.

What's still UNKNOWN:
- Cold launch with Harry assigned: does the greeting use Harry's voice / "Harry here" line, or does it flash Kevin first?
- Whether Phase 105's auto-sync subscription order avoids any new race conditions.

**What would shift to READY:** James cold-launches with Harry assigned to Round. No Kevin flash. "Harry here" greeting plays. Round flow respects partnership voice.

## Aggregate

| Persona | Pre-Phase-200 verdict | Phase 200 verdict | Delta |
|---|---|---|---|
| Dave | AT RISK | AT RISK | Improved underlying tech (GPS, voice fixes); empirical unchanged. |
| Marcus | AT RISK | AT RISK | Cage pipeline structural fixes + Common Faults cards + Phase 106 plateau detector all serve Marcus; empirical unchanged. |
| Sarah | AT RISK | AT RISK | Serena spec rewrite + GPS accuracy fixes serve Sarah; empirical unchanged. |
| James | AT RISK | AT RISK | Harry spec rewrite + team architecture migration serve James; empirical unchanged. |

**Pattern:** every persona has BETTER underlying capability than at Phase 100, but verdict didn't move because no empirical pass has happened. This is the same shape Phase 100's verdict landed on, just with more shipped.

**Highest-leverage action:** Tim runs an end-to-end empirical session covering all four pillars per his preferred persona. Within ~2 hours of testing, three or all four personas can shift to READY or surface concrete BROKEN findings to fix.
