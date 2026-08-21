# Open items — non-business

Snapshot 2026-08-21, end of the first-turn/voice session. Billing/Stripe/IAP deliberately excluded —
Tim owns that.

---

## 1. BLOCKED ON A DEVICE TEST — highest value, costs one tap

**The single-brain shim is live and unverified on hardware.** `BRAIN_SHIM=1` is set, so one brain
(kevin) answers every turn behind both contracts. Verified 19/19 by probe on all three paths, latency
median ~1.2s, continuity identical. **Never confirmed on a real device.**

Until Tim taps the mic once and it feels right, I will not delete:
- pipecat-turn's native implementation
- `api/_brainTools.ts` + `api/_brain.ts` (640 lines of anti-drift scaffolding)
- `voice-intent-parity.test.ts` and ~15 parity guards
- the migration guard explicitly marked DELETE-ON-SHIM

That deletion is the actual payoff of the consolidation — it is what stops every future fix needing
two homes. Revert if wrong: `BRAIN_SHIM=0` in Vercel + redeploy (~9 min).

## 2. PRE-LAUNCH — caddie emotional art (I cannot produce this)
`docs/TODO-CADDIE-EMOTIONAL-ART.md`. 22 mood slots exist. Serena has **4 distinct images**, one
portrait covering 15 slots; Kevin routes 15 slots to a single image. On the two caddies testers
actually use, the avatar barely moves. Filenames + prompt spec are written so wiring is a one-line
edit per slot. **Assets are OTA-safe.**

## 3. PARKED — needs a native build
`docs/NEEDS-A-NATIVE-BUILD.md`. Headset-CONNECTED detection (~10 lines Kotlin + AVAudioSession; would
retire the "Voice on Phone Speaker" and caption toggles), Meta glasses profile. **Earbud TAP already
works** — that was my error, corrected. Plan as ONE build.

## 4. V2 BY DESIGN — Predictive Tendency Engine
`docs/V2-PREDICTIVE-TENDENCY-ENGINE.md`. Deliberately post-launch: data-starved at ~20 rounds/yr,
needs pre-shot intent capture, and asymmetric failure cost. §7's substrate (one interruption clock)
shipped.

## 5. CONTEXT GAPS — ranked, none change a club call
Practice/cage history ("how has my range work been going"), watch swing data, tee-box goals, points
progress, tournament state. The one that DID change a club call — the SmartFinder lock — is fixed.

## 6. COURSE PRELOAD — visibility, not engine
Selecting a course already downloads it. There is no "ready offline" state, no queue, no confirmation
before leaving the house. `services/connectionClass.ts` gates unattended pulls on measured throughput.
Small surfacing job; arguably QC rather than building.

## 7. UNSWEPT CODE
`holeGeometryDerivation` and the download/orchestrator path — both network-bound, so device-only
verification. Everything else on the critical path has had an invariant sweep.

## 8. ⚠️ SYSTEMIC — guards that pin defects
**Five guards this week were green BECAUSE a bug was present**, and would have gone red on the fix:
the swing gate, the probe-abort, the persona handoff, "the mic tap re-arms", and "earbud 25s
first try". Two of those were written specifically to PROTECT the thing they were keeping broken.

689 `check()` calls exist. The stale-guard sweep on 08-20 checked for *vacuous* guards (absence
assertions over missing files) and found the harness clean — it did NOT look for this class: guards
that assert a behaviour EXISTS where that behaviour is itself the defect. That sweep is worth doing
deliberately, because the pattern is now established rather than anecdotal.

## 9. COGNITIVE-LOAD AUDIT — agreed, not started
Ethos §6: count what a golfer must read and tap to get ONE decision. The rule AI most easily violates.
