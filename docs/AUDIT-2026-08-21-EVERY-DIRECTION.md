# Whole-app audit — every direction

Tim, 2026-08-21: *"get to the audit of everything in every direction. I swear to God, don't miss
anything"*, and *"I get embarrassed as hell thinking this is out there in over twenty people's hands,
and people who played it thirty times have stopped because they found all these bugs before we did."*

**Testers finding bugs first is a DETECTION failure.** So each direction below records not just what
it found, but whether a standing check now exists — because a sweep run once finds today's bugs, and
a sweep encoded finds next month's.

---

## 1. Intelligence computed but never reaching the caddie ⭐ HIGHEST YIELD
**Four found in one day. All fixed. Now permanently detected.**

| what | the app knew | the caddie said |
|---|---|---|
| SmartFinder LOCK | the yardage he measured himself | answered from the GPS green-middle |
| ADVICE CALIBRATION | whether its own club calls had been right | nothing consumed it at all |
| HAZARDS | vision found the bunker, geometry measured the carry | "158 yards" |
| GOLFER MODEL | dominant miss, miss type, contact tendency | advised a man it had no model of |

**Why this class is invisible:** BOTH HALVES WORK. Nothing throws, no test fails — the caddie simply
answers with less than it knows. That reads as *"the app isn't very smart"*, not as a bug, which is
exactly how a tester quietly stops using something instead of reporting it.

✅ **Standing check:** `__tests__/regression/intelligence-reaches-the-caddie.test.ts` — each sense must
be assembled into the context AND survive translation to the one brain.

## 2. Guards that are green BECAUSE a bug is present
**Six found this week.** The swing gate · the probe-abort · the persona handoff · "the mic tap
re-arms" · "earbud 25s first try" · the VAD 800/2000 windows. **Two were written specifically to
protect the thing they were keeping broken.**

Swept deliberately: 689 `check()` blocks → 187 assert a literal → **10 pin a TIME/THRESHOLD**, the
shape all six shared. **It found a live 22-second hang** (the earbud intent classify) that testing
the transcribe would never have revealed. Remaining ones triaged: `REQUEST_TIMEOUT_MS = 63s` on the
pose path is deliberate (outlasts the 60s Vercel deadline); the rest are not on hang paths.

⚠️ **No standing check** — "is this assertion pinning a judgment?" resists automation. The method is
in this file; re-run when guards go red on a fix rather than assuming the fix is wrong.

## 3. Entry-point parity
Two mic owners: the Caddie tab (`useVoiceCaddie`) versus the earbud and text-box mic
(`listeningSession` → `captureUtterance`). Every first-turn fix landed on one. The earbud was **worse
than the path being fixed** — 25s before any retry, so an identical hung socket cost ~4s from the tab
and 25s from his earbuds.
✅ **Standing check:** entry points must converge and both owners must hedge.

## 4. Stale documentation asserting a missing capability
`mediaKeyBridge.ts` said "NO-OP… tapping a Bluetooth earbud DOES NOT fire notifyEarbudTap()". True for
**three weeks in May**. I believed it over the running code and told Tim a working feature was
impossible — a feature he had been chasing since the app's second day.
**A stale comment claiming something is missing is the same class as a guard pinning a defect.**
Corrected in place, with the live path drawn.

## 5. Self-inflicted resource contention at boot
`prewarmVoice` (5 endpoints + retries) + `warmBackendConnection` (CDN prime + 6-step ladder) +
`prewarmOfflineVoiceClips` (SERIAL TTS renders) — all at the same host, against OkHttp's
**five-connections-per-host** limit, through the exact window a player opens the app and taps.
Plus `warmBackendConnection()` fired **on the mic tap itself**.
Proof it was us, not the network: a **static CDN file timing out at 3s on full-bars 5G**.
✅ **Standing check:** the tap path must fire NOTHING at the host.

## 6. Cognitive load (ethos §6)
Mid-round the standing strip shows TARGET, PLAYS, STROKE, source badge — **no club**. The ethos's own
example is five lines; we deliver line one and make him ask for the rest. SmartFinder *does* show a
club unprompted, so the app already believes a standing recommendation is right — on one surface.
📋 **Product call, not a defect.** `docs/AUDIT-COGNITIVE-LOAD.md`.

## 7. Store → brain reachability
50 of ~60 stores never reach the brain. Most correctly (toasts, tour targets, onboarding,
diagnostics). Ranked remainder — practice/cage history, watch swing data, tee goals, points,
tournament — **none change a club call**, which is why the SmartFinder lock was done first.

## 8. Derived helpers deliberately NOT wired
`coachingAdaptation.deriveComplexityLevel` — the brain already receives `handicap` and
`physicalLimitation`, its raw inputs. Wiring it would be completeness, not value. Recorded so the
next audit does not "find" it again.

---

## Still open — and who owns each
| item | owner |
|---|---|
| Device-test the shim → unlocks deleting 640 lines of anti-drift scaffolding | **Tim** |
| Caddie emotional art, 22 states, Serena + Kevin | **Tim** (cannot be generated here) |
| Headset-connected detection + glasses → one native build | **Tim** |
| Per-hazard distances on courses with no geometry | degrades honestly today |
| V2 Predictive Tendency Engine | post-launch by design |
