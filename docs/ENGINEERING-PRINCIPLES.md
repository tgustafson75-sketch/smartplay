# SmartPlay Caddie — Engineering Principles

**Status:** STANDING — non-negotiable rules for every fix going forward.
**Created:** 2026-06-03
**Trigger:** [DIAGNOSIS-GPS-VOICE-2026-06-03.md](../DIAGNOSIS-GPS-VOICE-2026-06-03.md). Six weeks, ~80 commits to GPS + voice paths, the majority bandaids on top of 2-3 root-cause introductions. Tim's instinct that fixes were treating symptoms was correct. These rules exist so this pattern is never repeated.

---

## Rule 1 — Find when it last worked, before any fix

For any fix to EXISTING behavior, the diagnosis MUST answer: **"What's the most recent commit where this worked correctly, and what changed since?"** If that question is not answered, no fix ships. Regression archaeology precedes patching, always.

---

## Rule 2 — Removing code is preferred over adding code

Root-cause fixes usually **REMOVE** a wrong layer. Bandaids usually **ADD** a defensive layer. If a proposed fix adds more lines than it removes, the diagnosis must explicitly justify why. Default suspicion is on additions. Diffs that are 90% additions on a recurring bug are the bandaid pattern.

---

## Rule 3 — No new user-facing error/status surfaces without root cause first

No new banner, toast, status badge, "weak signal" indicator, "warming up" state, "having trouble" message, or fallback caption ships UNLESS the underlying condition has been root-caused first. **Reporting a problem to the user is not fixing it.** The report itself trains the user that the app is fragile and erodes trust.

---

## Rule 4 — No new fallback / circuit-breaker / timeout / threshold without naming what it's masking

Every defensive addition (try/catch that swallows, threshold gate, timeout, retry mechanism, fallback path, "skip the call when X" logic) must answer in its commit message: **"What specific upstream condition causes this, and have we attempted to fix THAT first?"** If the answer is "we're defending against an unknown," it's a bandaid and it doesn't ship.

---

## Rule 5 — Two attempts, then archaeology

If a fix to a recurring issue takes more than TWO attempts, stop and do regression archaeology (find the breaking commit, identify root cause, consider revert). The third attempt is the signal to step back, not the fifth, not the twenty-fifth.

---

## Rule 6 — Trust the user's lived reality over the code's claim

When the user reports a real-world failure (e.g., "GPS isn't working but Golfshot works on the same phone"), that observation **OUTRANKS** code-level reasoning about why the app "should" be reporting the condition it's reporting. Real-world divergence from observable ground truth is a code bug, full stop. **Do not explain to the user why their phone is wrong.**

---

## Rule 7 — Competitor reality check

For features where competitors exist on the same device (GPS, yardages, swing analysis, voice, course detection), if SmartPlay Caddie fails where a comparable product succeeds, the diagnosis MUST explicitly explain what we're doing differently architecturally that produces the gap. "GPS is noisy here" is not an explanation a competitor on the same hardware gets to make. **Architectural divergence demands architectural justification.**

---

## Rule 8 — Diagnose-before-fix on anything round-critical or recurring

GPS, hole detection, voice path, scoring, round state, native boot — these surfaces ship only after a read-only diagnosis identifies the cause. **No speculative or defensive changes on these paths.** (This was already practice; codifying it.)

---

## Rule 9 — Honest degradation is not infinite latitude

"Honest failure" / "honest degradation" / graceful fallback are legitimate patterns and remain valid — BUT they apply when a real, known, named failure mode exists and the user cannot be helped further. They do NOT justify masking unknown failures with banners or fallbacks. **If we don't know why something is failing, "honest fallback" is the wrong tool — diagnosis is.**

---

## Rule 10 — Bandaid recognition

### A commit is a likely BANDAID if it:
- Adds a banner, toast, sentinel, or breadcrumb that REPORTS a symptom without changing what produced it
- Adds a circuit-breaker, timeout, or fallback that SUPPRESSES a downstream call when an upstream condition fires, without asking whether the upstream is real
- Tightens a threshold to filter noise that an existing gate produced
- Adds a hard timeout / forced clear / safety net that fires when a previous patch's "good state" never arrives
- Adds 50+ lines and removes <10

### A commit is a likely ROOT-CAUSE FIX if it:
- Removes more code than it adds
- Names "two flags should have been one"
- Names "existing fallback was for the wrong condition"
- Names "calculation used wrong units"
- Names "state was set before the operation it gated resolved"
- Reverts a recent change cleanly

---

## Operational hooks (assistant prompt practice)

Every future fix prompt (whether Tim writes it or the assistant proposes it) MUST include where relevant:

- A **"Diagnose first"** section if the bug touches recurring or round-critical surfaces
- A **"What this REMOVES"** line if the fix involves any existing defensive code
- An explicit **"this is not a bandaid because:"** justification on any addition to GPS, voice, hole detection, or native boot paths
- The **competitor-parity question** where applicable

---

## Why this exists (the cost we already paid)

Per [DIAGNOSIS-GPS-VOICE-2026-06-03.md](../DIAGNOSIS-GPS-VOICE-2026-06-03.md):

- **GPS path (May 5 → June 2):** Phase 107 introduced a 15m accuracy gate that rejected normal real-world golf-course fixes (tree cover, cart paths produce 20-40m routinely). Every "GPS weak" / "warmup" / "stale" / "health banner" patch shipped since was REPORTING the consequences of our own rejection gate, not fixing it. Net delta on `services/gpsManager.ts` in 6 weeks: hundreds of lines added, almost none removed. **That ratio was the diagnosis.**

- **Voice path (May 25 → June 2):** D-ID Kevin intro video introduction created cascading audio races. The video was correctly REVERTED in Fix GG. But the splash-lock complexity built around it stayed in place, solving a race that no longer exists, and introducing 14 new silent-failure paths along the way.

These rules are the price of admission to working on those surfaces. Apply them. Hold the line. **No exceptions.**
