# SmartPlay Caddie — QA Testing Checklist

**Established 2026-08-19.** The runnable companion to [critical-paths.md](critical-paths.md)
(*what* the gates are) and [device-os-matrix.md](device-os-matrix.md) (*where* we can run them).

This does **not** replace the autonomous QA system in [`QA/`](../QA/) — that is the persistent
regression brain (`QA/history/*.json`, `QA/model/*.md`) and it runs against source. This is the
**human pass**: the things a harness that cannot hold a phone will never catch.

---

## How to use this

Every item carries a verification tier. This is the whole point — the recurring failure in this
project is not missed tests, it is **claims outrunning evidence**.

| Tier | Means | Who/what |
|---|---|---|
| **A** | Compiles, typechecks, lints, unit/sim gates pass | automated |
| **B** | Code-traced source → UI by reading the code | Claude |
| **C** | Run on a real device, with eyes on it | **Tim only** |

**Rules that are not negotiable:**

1. **Never mark a C item done from an A or B result.** The sim greps source and evaluates pure
   functions — it is structurally blind to a stub, a dead wire, and an unreachable branch.
2. **A green gate is not a working feature.** Run a disconnect audit (does the data actually
   reach the pixel?) before writing "done".
3. **Assume the fix is false.** The most productive check in this repo's history has been
   re-running a claimed fix with the assumption it did not work.
4. When an item fails, fix the **instance**, then ask whether it is a **class** — and if it is,
   write the guard against the *shape*, not the instance.

---

## 0. Pre-flight (Tier A — must be green before anything else)

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx expo lint` — **zero errors** (warnings are tolerated; there are ~194)
- [ ] `npm run test:logic` — every prior regression guard still passes
- [ ] `npm test` — full suite including component tests
- [ ] `npm run sim` — the 773-scenario harness
- [ ] `npm run user-sim` — 100+ simulated golfers executing real modules
- [ ] Read [`QA/history/qa-knowledge.json`](../QA/history/qa-knowledge.json) — fragile
      subsystems and hard-won rules, **first, every pass**
- [ ] Read [`QA/history/known-issues.json`](../QA/history/known-issues.json) — `open` items are
      where this pass starts; `refuted` items must not be re-reported

### OTA safety gate (only if shipping an update to frozen TestFlight testers)

- [ ] `runtimeVersion` is still the literal `"1.0.0"`
- [ ] No new `package.json` dependency
- [ ] No new `app.json` plugin or native module
- [ ] If `api/*` changed → **Vercel deploy is a separate step**, and OTA does not cover it
- [ ] Push **both** channels (preview APK *and* production/TestFlight), sequentially — never
      two `eas update` runs in parallel

---

## 1. The six critical paths (Tier C)

Full pass criteria, markers and MIN VERIFY steps live in
[critical-paths.md](critical-paths.md). Grep logcat on the marker while running each.

- [ ] **Path 1 — ONBOARD** · `grep path1:onboard` · ~5 min
      Wipe data → welcome → consent gate blocks → fill → lands on Caddie with the *chosen*
      persona (not "Kevin") → relaunch skips welcome
- [ ] **Path 2 — ROUND** · `grep path2:round` · ~15 min
      Find course → start → ROUND ACTIVE stays green → yardage or honest blank → Mark → log
      shots → hole transition → End Round → scorecard
- [ ] **Path 3 — CAGE** · `grep path3:cage` *(no closing bracket)* · ~10 min
      Setup overlay → Check Position → record → analysis or honest "couldn't analyze" → drill →
      re-analyze an old swing
- [ ] **Path 4 — VOICE** · `grep path4:voice` · ~5 min
      Tap → engages → tactical answer → conversational answer → **follow-up turn** → L1 Quiet
      suppresses opener but still answers
- [ ] **Path 5 — GPS** · `grep path5:gps` · ~20 min · **outdoors, real course**
      Permission → `first_fix` → **stand still 2 full minutes with no stale degrade** → walk →
      auto-advance → pocket for a hole → no `hard-cleared` anywhere
- [ ] **Path 6 — SCORECARD** · `grep path6:scorecard` · ~10 min
      Score from all four surfaces → correction replaces not accumulates → "scratch that"
      restores score *and* hole → no invented putts → persisted counts match holes played

> **Beta gate:** all six verified on a real device within the last 7 days, on a **real round**
> (not simulated). Until then: internal only.

---

## 2. Voice caddie (Tier C — the north star surface)

The standard is *"feels like a real caddie."* A robotic moment is a defect, not a rough edge.

**Engagement**
- [ ] Earbud tap engages within ~200 ms
- [ ] On-screen badge tap engages
- [ ] Cue never speaks before the mic is claimed — the "I'm here." → busy → "Didn't catch that."
      sequence is the tell for the mic-ownership race
- [ ] Second tap means the **same thing** on the avatar and the caddie mic (submit, not discard)
- [ ] App never opens the mic by itself on first turn
- [ ] Zero taps from cold open to a caddie that is helping

**Understanding**
- [ ] Spoken lofts parse: "fifty two", "eighteen degree driving iron"
- [ ] Club vocabularies match across surfaces — hitting the advised club records as *adherence*,
      not as ignoring advice
- [ ] `set_club_distance` phrasings all register (2026-08-19 fix): "my 7 iron goes 165",
      **"set my 7 iron to 165"**, "my pitching wedge is 130", "put my driver at 250"
- [ ] Whole-bag registration ("I carry driver, 3-wood, 5 through PW") rides `register_bag`
- [ ] Score lands on the hole the player *means*, not `currentHole`
- [ ] Corrections amend the last shot rather than appending a duplicate

**Brain parity — new 2026-08-19, and the reason this section exists**
- [ ] Ask for a club on turn 1 → recommendation recorded
- [ ] **Ask again on a FOLLOW-UP turn → still recorded.** Turn 1 goes to `pipecat-turn`, the
      follow-up goes to `kevin`; these ran different tool sets until 2026-08-19
- [ ] The caddie is **not** more eager to open a screen on turn 2 than turn 1 — talking *about*
      the hole should stay conversation
- [ ] Register a bag on a follow-up turn → the device confirms what it actually recorded

**Speech**
- [ ] One voice at a time — cloud/mp3 and device-TTS never overlap
- [ ] No device-TTS robot voice on a normal path (that is the degrade voice)
- [ ] No canned error phrasing; failures sound like a person
- [ ] TTS pacing comes from instructions — **never a `speed` param** (500s on gpt-4o-mini-tts;
      the tell is warmup succeeding while real calls fail)

**Degradation**
- [ ] Dead cellular zone → the caddie says something, out loud, rather than going silent
- [ ] Brain down → graceful line, never a 502 (a 502 trips the client circuit breaker as if the
      network died)
- [ ] Uses `api.smartplaycaddie.com`, never a `*.vercel.app` host (networks filter it)

---

## 3. GPS & on-course (Tier C — outdoors only)

- [ ] Yardage appears within a reasonable time of arriving at a hole
- [ ] Standing still on a tee for 2 minutes does **not** starve the watch (`distanceInterval: 0`)
- [ ] Yardage updates as you walk
- [ ] Hole auto-advance fires on arrival, not at the turn or in a cart
- [ ] Green/tee geometry matches the hole you are on — **greens are paired to the NEXT hole's
      tee** in raw data; pair by scorecard yardage
- [ ] Course centroid is derived from hole geometry, never from a type field
- [ ] A single bad sample cannot poison a club ladder (plausibility band at ingest *and* read)
- [ ] Pocket the phone for a hole → nothing lost
- [ ] Aim lines and layup targets look right on the hole map
- [ ] Course with no geometry → honest "No live yardage on this course" + anchor capture, never
      a bare "—"

---

## 4. Scorecard & round data (Tier C)

- [ ] Score entry from all four surfaces: scorecard tap, cockpit stepper, voice, brain tool
- [ ] Re-scoring **replaces**; quick-score placeholders (`qs-<hole>-<n>`) are cleared
- [ ] Bare score tap invents **no** putts
- [ ] Totals and vs-par match the grid; vs-par shows `null`/blank, never `0`, with no known par
- [ ] Undo restores score **and** hole
- [ ] End Round → scorecard tab, persisted counts match what was played
- [ ] Recap agrees with the scorecard
- [ ] Club summary reflects real logged clubs
- [ ] Scorecard photo ingest merges across multiple photos rather than overwriting
- [ ] Round survives an app kill mid-round

---

## 5. SwingLab / SmartMotion / Cage (Tier C)

- [ ] Camera angle is **detected**, not asked — the label matches what was filmed
- [ ] Analysis deck sits **below** the clip; the clip is never covered
- [ ] Four-card 2×2 review; an unmeasured card shows a dash rather than vanishing
- [ ] A saved swing in the library reads as richly as the live review (one renderer)
- [ ] Match score is `null`, never `0`, below the two-dimension floor — and names what went
      unread
- [ ] A real strike is **never** discarded as a practice swing (range, cage, re-analyze, upload —
      **all four** surfaces)
- [ ] Clubhead trace is clubhead-or-nothing — **never** re-add a wrist fallback
- [ ] Contact shows green only on a confirmed strike
- [ ] Metrics are only ever AI/pose-derivable; anything else says "Coming Soon"
- [ ] An old saved swing does not crash the classifier (persisted data is the attack vector)
- [ ] Watch rep and phone rep for one physical swing log as **one** rep
- [ ] Wrist reps claim times only — no invented dwell, no putting-decel claim

---

## 6. Permissions & degradation (Tier C)

For each of camera, microphone, location, background location, media, notifications:

- [ ] Prompt appears with the right copy
- [ ] **Deny** → the app explains what is unavailable and why, in one sentence
- [ ] Deny → no blank screen, no silent no-op, no crash
- [ ] Grant later in Settings → the feature recovers without a restart
- [ ] Location denied → a **user-visible toast**, not console-only

---

## 7. Offline / poor network (Tier C)

- [ ] Airplane mode → local intents still work (offline precheck path)
- [ ] Airplane mode → the caddie says it is offline rather than hanging
- [ ] Weak/flapping signal → dual-host failover, no dead custom domain
- [ ] Cold boot → first response arrives (cold-aware timeout, gated on connection warm)
- [ ] Round data persists offline and syncs later
- [ ] No spinner without an end state

---

## 8. Cross-device & lifecycle (Tier C)

- [ ] Backgrounding mid-round → round intact on return
- [ ] Phone call interrupts voice → audio session recovers
- [ ] Low battery / battery saver → GPS and voice degrade honestly
- [ ] Device swap → green reads and settings are not lost
- [ ] Fold open/closed (**Tier B only — no device**): layout adapts, Kevin stays centred
- [ ] Watch paired (**Tier B only — no device**): connected indicator, reps flow, club tagging

---

## 9. Layout & theme (Tier C — all FROZEN, regressions only)

Everything here is signed off. The only valid finding is *"this changed and should not have."*

- [ ] Whole-app layout/theme unchanged (frozen 2026-07-29, "BEAUTIFUL")
- [ ] SmartVision layout unchanged (frozen 2026-07-26, "looks perfect")
- [ ] Kevin's portrait matches canonical framing at **every** trust level (L1–L4), round-active
      and idle, on every form factor
- [ ] Dark + high-contrast is the default
- [ ] No footer or status-bar clipping
- [ ] No NaN reaching an SVG — the white-screen class (`!(x > 0)` / `Number.isFinite`)

---

## 10. Subscription state (Tier C — **must be a no-op today**)

`SUBSCRIPTIONS_ENABLED = false`. Testers must see **zero** billing surface and **no clock
running**.

- [ ] No paywall appears anywhere
- [ ] No trial countdown, banner, or "N days left" copy
- [ ] No trial clock starts — `trialDaysLeft()` returns `null`
- [ ] Every feature is unlocked
- [ ] Round start, SmartVision, Cage, SmartFinder, advanced voice, Send-to-Tank all reachable
- [ ] `__tests__/logic/edition-matrix.test.ts` passes (pins all of the above)

---

## 11. Release gates

- [ ] All six critical paths Tier-C verified within 7 days, on a real round
- [ ] Pre-flight §0 green
- [ ] No `open` P0/P1 in `QA/history/known-issues.json`
- [ ] Device matrix coverage stated honestly in the release note — including what was **not**
      device-tested
- [ ] OTA safety gate green (if applicable)
- [ ] Both channels pushed
- [ ] Vercel deployed if `api/*` changed
- [ ] App Store: IAP in place before any paid launch (Stripe in-app = guideline 3.1.1 rejection)

---

## Appendix — pass log

| Date | Tier | Scope | Device | Result | Notes |
|---|---|---|---|---|---|
| 2026-08-19 | A/B | Voice parity, critical-path markers | — | ✅ | tsc clean · jest 1065/1065 · sim 773/773 · lint 0 errors |
| | | | | | |
