# SmartPlay Caddie — full handoff

**Head:** `fd137e72` · main == origin/main · working tree clean
**Gates:** tsc 0 · jest 1484 / 124 suites · sim 784 · user-sim 100 players clean · eslint 0 errors
**Shipped:** production + preview OTA current · Vercel deployed · both brain routes probed live

Read §0 and §1 first. §2 is the only architectural task left. §3 is everything else, root-caused.

---

# §0 — READ THIS BEFORE TOUCHING ANYTHING

## The product
This is a **present caddie**, not a bag of tools. Presence = *continuity of knowing*. Every defect
below is the same shape: **the app knew something and the caddie didn't.** Judge any change by
whether it closes that gap.

## The one bug class, stated once
> **Something is built, correct, tested — and nothing reaches it.**

Every single fix in this session was an instance. Not "bugs everywhere" — *one* bug, many faces:
- a capability with no caller
- a field sent and never destructured
- a field destructured and never rendered
- N call sites where only some were updated
- a flag that exists and no UI sets
- a guard asserting the very defect it should forbid

**Before writing a fix, ask: who calls this, on every route, and does the far end read it?**

## Four traps that have burned this codebase repeatedly

**1. Guards that pin the defect.** Eight times this session a test/sim guard went red on a *correct*
change because it asserted the literal source text of the bug. Titles like *"a failed TTS fetch now
speaks on the device instead of leaving the caddie silent."* **When a guard goes red, read it before
"fixing" the code — it may be protecting the bug.** Assert the PROPERTY, never the call's spelling.

**2. Tombstone comments.** Three times a guard matched *my own comment describing the old bug*.
**Strip comments AND string literals before asserting old copy is gone.**

**3. Silent try/catch.** `services/caddieRequestBody.ts` wraps every store read. A wrong module path
or field name returns null **forever** while the payload looks perfectly healthy, and `tsc` cannot
see through `require()`. Writing that file produced **3 wrong module paths and 6 wrong field names**,
all silent. **Verify every require target against source. Assert real values resolve, not just keys.**

**4. Spread order.** New fields placed *before* `...prev` are silently overwritten by the previous
value. Caught mid-fix in `caddieMemoryStore` — nothing would ever have been learned.

## Verification commands
```bash
cd /Users/timothyg/smartplay
npx tsc --noEmit
npx jest
npx tsx scripts/simulations/run-sim.ts        # 784 grep/shape guards
npx tsx scripts/simulations/user-sim.ts       # 100 simulated players, invariants
npm run probe-tools                           # turn-1 brain, 25 live tool cases
npm run probe-tools -- --kevin                # follow-up brain
```
Ship: commit → `git push` → `npx eas update --branch production` → `--branch preview` (sequential,
never parallel). `api/*` needs the **Vercel deploy (6–11 min)** — an early probe looks exactly like
"the fix didn't work."

## Detectors built (use these, don't hunt by hand)
- `scratchpad/halffix.py` — **sound.** Finds the same named option passed with *different* values
  across call sites. This found the `shouldAbort` split.
- `scratchpad/dw2.py` — **not yet trustworthy.** Reports 172 "unreached exports"; most are false
  positives (JSX components, same-file internal calls). Refine before believing it. It wrongly
  flagged `detectCurrentHole`, which is correctly wired.

---

# §1 — WHAT IS DONE (and how it was verified)

All committed, pushed, OTA'd to both channels. Server work probed live after deploy.

| # | Fix | Verified by |
|---|---|---|
| 1 | Preferred Tee reaches every yardage reader (**4th surface** was still on `tees[0]`) | live Sharp Park build |
| 2 | Gender-correct course ratings (men's vs women's share yardages) | live, 8 tees |
| 3 | Course search finds a course when you add the town | live, 4 query forms |
| 4 | Course coordinates → geometry builds before you arrive | live, `37.6249,-122.4886` |
| 5 | Caddie knows **where** the trouble is, every shot | offline test + bearing-0 bug found |
| 6 | **One client payload** (was 45 vs 34 fields, 20 shared) | value-resolution test |
| 7 | Live distance + stroke number (was quoting the scorecard) | live probe |
| 8 | Robot voice **ripped out** at the single choke point | shape guard, all files |
| 9 | Listen window 12s → 8s | log-matched (`durationMs: 12151`) |
| 10 | Tap during mic-opening queued, not discarded | shape guard |
| 11 | Swing export carries the video, or says it didn't | 2 silent causes fixed |
| 12 | Club-arc failure now reports instead of drawing nothing | breadcrumb |
| 13 | SmartFinder phantom 10 yards (**3 stacked causes**) | invariants re-aimed |
| 14 | Round stats (putts/GIR/fairways) reach the caddie | both ends guarded |
| 15 | Walking vs cart, tee box, nine-hole, risk posture reach the caddie | both ends guarded |
| 16 | Playback no longer kills analysis | shape guard, all files |
| 17 | Cart vs walking **sensed**, not asked | live GPS path confirmed |
| 18 | Every shot after the drive was being lost (20s → 10s stillness) | arithmetic + test |
| 19 | Play past 9 → round expands instead of silently not counting | 5 cases |
| 20 | `__DEV__` latent crash class guarded app-wide | shape guard |
| 21 | **Learn loop closed** — learns putts/3-putts/GIR/fairways per hole | learn + surface tested |
| 22 | Both brain routes carry the same facts | parity guard |
| 23 | The caddie can see the **lie** (sent for months, never read) | parity guard |

### Findings worth remembering
- **SmartFinder tilt ranging cannot measure golf distances.** Usable band is ≈ **−2° to −9°**
  (50 → 11 yards). Everything steeper collapsed under the floor and was clamped **up** to exactly
  `MIN_YARDS = 10` — that was the phantom. GPS and the height-scan are the real methods past ~50y.
- **`!shotBearingDeg`** was a falsy check on a number: a hole playing **due north (bearing 0)**
  collapsed every hazard to `center`. The caddie *could not* say "bunker right" on those holes.
- **20s stillness** before a shot is trivially true on a tee and usually false at your ball. That
  single constant is why the drive registered and the approach never did.

---

# §2 — THE ONE ARCHITECTURAL TASK LEFT

## Collapse two roads to one brain

**Current, verified live** (`x-brain-shim: kevin` on every response):

```
mic (useVoiceCaddie)   ──> /api/kevin          ──┐
text (useKevin)        ──> /api/kevin          ──┤
                                                 ├──> kevin.ts   ← the ONLY brain
usePipecatVoice        ──> /api/pipecat-turn   ──┤   via api/_brainShim.ts
conversationalBrain    ──> /api/pipecat-turn   ──┘
```

There is **one brain**. `pipecat-turn` no longer thinks — it translates and forwards. But there are
**two roads**, **two client context builders**, and a translator between them.

**Why this is not cosmetic:** what reaches the brain depends on which road you took. That is exactly
how seven facts reached one road and not the other (fixed in #22). Presence is continuity of
*knowing*; two roads means two versions of what the caddie knows.

### The work
1. Pick the surviving endpoint: **`/api/kevin`**.
2. Repoint the two pipecat client callers:
   - `hooks/usePipecatVoice.ts:293`
   - `services/conversationalBrain.ts:41`
3. **Response contract differs** — this is the real blocker:
   - pipecat returns `response_text`, `tool_actions`, `updated_history`
   - kevin returns `text`, `audioBase64`, `toolAction` / `toolActions`
   Adapt at the two call sites, or have kevin emit both shapes during migration.
4. Replace `services/pipecatContext.ts` with `services/caddieRequestBody.ts` (already the union
   builder used by mic + text).
5. Delete once green: `api/pipecat-turn.ts` native path, `api/_brainShim.ts`,
   `services/pipecatContext.ts`, the parity scaffolding, ~15 parity guards.

### Do not skip
- `npm run probe-tools` **and** `-- --kevin` must both stay **25/25** before and after.
- The both-routes parity guard (`__tests__/regression/both-routes-carry-the-same-facts.test.ts`)
  must be updated, not deleted, as roads collapse.
- Migrate **all four** call sites or none. A partial migration is the exact failure being fixed.

---

# §3 — OPEN WORK, ROOT-CAUSED

Ordered by value. Each states what is known so the next session does not re-investigate.

## 3.1 The two-colour swing arc  *(a build, not a fix)*
**Tim's reference:** backswing **yellow**, downswing **orange/red**, persisting across the swing,
impact marker at the ball. Screenshots in `~/Downloads/moreandexampleofpath.zip`.

**What we have:** `components/swinglab/SwingBodyOverlay.tsx` renders a segmented arc coloured by
**speed** (slow/smooth/fast tempo gradient). Pipeline is **fully connected** — verified:
`detectClubPath` → `clubArcPoints` → `clubArc={...}` on **both** screens → overlay, threshold
`MIN_CLUB_POINTS = 3`.

**The real blocker is NOT the renderer.** The arc usually has **fewer than 3 points**, so nothing
draws. That now reports (`clubpath_arc_too_sparse` with point count, abort state, window length).

**Order of work:** (a) get a real `clubpath_arc_too_sparse` from a round, (b) fix the point count,
(c) *then* add phase colouring — every point carries `tMs` and impact time is known, so backswing =
before top, downswing = top→impact. **Colouring first gives a prettier version of nothing.**

## 3.2 SmartMotion "cannot read / cannot analyze"
- ✅ **Fixed:** playback aborting analysis (#16). That was the "first try fails, retry works" case.
- ⬜ **Open:** time from record-stop to analysis is long. Tim confirms the status screen itself is
  correct — the wait is the complaint.
- ⬜ **Open:** `pose_zero_frames` with `nativePose: true`, `reason: no_pose_in_frame`, on a 50s clip
  where he was fully in frame. Frames extracted fine; detector found no body. Needs a real clip.
- ⬜ **Open:** `swing_locate_fallback — Aborted` ×3. The dead-host guard aborts locate when
  `/api/health?lite=1` fails twice (3s then 6s). **The endpoint is healthy (295ms measured)** — so
  either genuine signal loss, or the guard is too aggressive on 4G. **Tim: it must work on 4G.**
  Consider raising the probe budgets rather than the abort.

**DO NOT** re-propose "analysis starts before recording finishes." Tim rejected it explicitly; the
recorder resolving is not the issue.

## 3.3 The ~5s gap between text and voice
**Root-caused, deliberately not half-fixed.** Documented at `api/kevin.ts` in the TTS block.

The server blocks the **entire** response on TTS: it awaits full speech synthesis *and* the whole
arrayBuffer before returning. So the client cannot render text until the audio is built, then still
has to decode, write and load it before playback.

**The fix:** stop shipping text and audio in one blocking response — return text immediately and
stream/fetch audio alongside. That is a contract change across both brains and the client, so it
pairs naturally with §2.

## 3.4 Putt-read vision
The caddie now **knows** it is a putt (`currentLocationType: 'green'` → prompt says read the putt,
don't recommend a club). Verified live. It still **cannot see** the putt.

Tim recorded one via SmartMotion saying *"record this putt"*, which should route to putting mode.
`services/smartTempo.ts` already has `TempoMode = 'full_swing' | 'putt'`. Check the voice → putt-mode
route and whether green-read imagery reaches the brain.

## 3.5 Score-driven hole advance
Tim logged a score standing at the next tee and it didn't move. **Four gates** can hold it and they
have four different fixes. The else branch was silent; it now emits `hole_advance_skipped` naming
which one, with scored/current/last hole. **Wait for one real breadcrumb — do not guess.**

## 3.6 Caddie emotional art — PRE-LAUNCH
`docs/TODO-CADDIE-EMOTIONAL-ART.md`. 22 mood slots. Serena has **4 distinct images** (one portrait
covers 15 slots); Kevin routes 15 slots to a single image. On the two caddies testers actually use,
the avatar barely moves. **OTA-safe (assets only). I cannot generate the art.**

## 3.7 Billing / IAP — the one hard stop on a paid launch
Guideline 3.1.1: in-app digital subscriptions **require IAP**; Stripe in-app = rejection. RevenueCat
is the standard wrapper. Stripe is right for web/direct only. **No billing SDK exists today**;
`SUBSCRIPTIONS_ENABLED=false`, paywall is a no-op, everything unlocked. **Tim's decision.**

## 3.8 Needs one native build (not OTA)
`docs/NEEDS-A-NATIVE-BUILD.md`: headset-**connected** detection (~10 lines Kotlin + AVAudioSession;
`AudioManager` already imported unused), Meta glasses profile. **Plan as ONE build — three builds is
three review cycles.**

## 3.9 Smaller, verified-open
- **SmartFinder level indicator.** Tim asked for a pill showing the phone is level. The phantom-10
  cause is fixed; the affordance is not built. Given the −2°..−9° band, this is genuinely useful.
- **Auto-detect 9 vs 18 at the START.** Playing *past* 9 now expands (#19). Detecting the intent up
  front is still open — same class as the cart setting.
- **`shouldAbort: () => false`** ×2 in `smartmotion.tsx` — **verified deliberate** (private copy makes
  it safe, one-shot, fire-and-forget). Recorded so nobody "fixes" it.
- **Workouts → swing quality rail** — built owner-only (`Training → Strike` on the dashboard progress
  graph). Decide if it goes public once Tim's own data shows the signal is real.
- **Unswept:** `holeGeometryDerivation`, download/orchestrator (network-bound, device-only).

---

# §4 — STANDING RULES (from Tim, non-negotiable)

- **No half-fixes.** Enforce at *every* producer and surface. A fix isn't done until the far end
  reads it and renders it.
- **Root cause only.** No band-aids. If the same thing breaks twice, fix the *class* and add a guard
  that forbids the **shape**, not the instance.
- **Run the second pass yourself.** Every time a second pass was run this week it found something
  bigger.
- **Never say "clean/done/works" from gates alone.** Gates prove compilation and shape, not wiring.
- **Do the work — don't delegate to Tim.** Ask only about genuine decisions. He should not be the one
  discovering defects.
- **Feels like a real caddie** is the north star. Robotic moments, canned lines and generic advice are
  **defects**, not cosmetics.
- **Hands-free zero-setup is the product.** Any setting the phone could sense is a defect (cart mode
  was; 9-vs-18 still is).
- **WHAT'S NEW is part of shipping.** Every user-meaningful change gets an entry in the player's
  words, plus `howTo` whenever the *method* changed.
- **Layout/theme freeze** — no position/theme changes without Tim's per-change OK.
- **Never `eas update` on a tree you don't own** (OTA bundles the working tree). Never run preview and
  production updates in parallel.

---

# §5 — CONTEXT FILES
- `~/Desktop/smartplay-2026-08-22-OVERNIGHT-STATE.md` — narrative of this session, defect by defect
- `docs/OPEN-ITEMS.md` — non-business open items
- `docs/NEEDS-A-NATIVE-BUILD.md` · `docs/TODO-CADDIE-EMOTIONAL-ART.md`
- Field evidence: `~/Downloads/todaysshots.zip`, `more.zip`, `moreandexampleofpath.zip`

**Hard truth for the next session:** Tim bet that half the work would be half done — and he was right.
Seven fields I shipped reached one brain and not the other. **Assume your own work is half-done until
you have proved both ends.** Check the producer, the consumer, *and* every parallel route.
