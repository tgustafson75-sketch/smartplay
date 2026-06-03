# DEEP DIAGNOSIS — GPS + Voice Path Regression Archaeology

**Date:** 2026-06-03
**Scope:** Read-only archaeology. NO fixes shipped in this pass.
**Pattern flagged by Tim:** Six weeks of "fixes" have been adding defensive code (banners, fallbacks, retries, suppressions) instead of finding root cause. Golfshot works on the same phone, same 5G, same GPS chip — so the problem is OUR code, not the environment.

---

## Executive Summary

**GPS regression — one line:** Phase 107 (commit `1944f35`, 2026-05-05) introduced `OUTLIER_ACCURACY_M = 15` which causes `processFix` to **silently discard any GPS fix worse than 15m accuracy**. Real-world golf courses (tree cover, cart paths near buildings, post-Doze warmup) routinely produce 20-40m fixes. Golfshot uses those fixes; we throw them away. Every "GPS weak" / "warmup" / "stale" / "health" / "poor signal" patch shipped since has been REPORTING the consequences of our own rejection gate, not fixing it.

**Voice regression — one line:** D-ID Kevin intro video (commit `446b537`, 2026-05-25) introduced a parallel audio path that raced post-splash voice. The video was correctly REVERTED in Fix GG (commit `b6e6c9b`, 2026-06-01) — but the splash-lock complexity built up around it (Fix GK / GM / GO) stayed in place, solving a race that no longer exists.

**The bandaid pattern:** Out of ~80 commits to GPS + voice paths in the last 6 weeks, the majority are downstream patches for symptoms caused by 2-3 root-cause introductions. Each patch added a banner, a fallback, a retry, a degradation path — none questioned the original assumption.

---

## PHASE 1 — GPS Path Archaeology

### Last commit GPS worked correctly (Tim's "about a month ago"): ~2026-05-05

- **`1944f35` (2026-05-05) — Phase 107 - GPS framework audit + SmartFinder rangefinder accuracy (Garmin-comparable)**

This commit's BENCHMARK was "Garmin-comparable" — meaning Tim's first-hand test on the Galaxy Z Fold matched a Garmin within 2-3 yards. That measurement was likely done **in clear-sky conditions** where Phase 107's new accuracy gate of 15m was always satisfied. The audit document at `docs/audit-107-gps-framework.md` is the authoritative record.

### The root cause: `OUTLIER_ACCURACY_M = 15`

[services/gpsManager.ts:56](services/gpsManager.ts#L56) (introduced in commit `1944f35`, line `+const OUTLIER_ACCURACY_M = 15;`):

```typescript
// Phase 107 / B2 — outlier rejection thresholds.
// accuracy_m worse than this = reading discarded entirely.
const OUTLIER_ACCURACY_M = 15;
```

And in `processFix` at [services/gpsManager.ts:158-162](services/gpsManager.ts#L158-L162):

```typescript
// (1) Discard if reported accuracy is worse than threshold.
if (raw.accuracy_m != null && raw.accuracy_m > OUTLIER_ACCURACY_M) {
  outliersDiscarded++;
  console.log(`[gps:outlier-rejected] accuracy_m=${raw.accuracy_m.toFixed(1)} (>${OUTLIER_ACCURACY_M})`);
  return false;
}
```

**What this means in practice:** Every GPS fix with reported accuracy worse than 15 meters is **silently discarded — not weighted, not flagged, dropped entirely**. `lastFix` does not update. Downstream consumers (SmartFinder yardages, hole detection, off-course detector, shot location) see a frozen position.

**Why 15m fails in real-world golf:**

| Condition | Typical reported accuracy |
|---|---|
| Open fairway, clear sky | 3–8m |
| Light tree cover | 10–15m |
| Heavy tree cover (par-3s, doglegs) | **15–30m** ← rejected |
| Cart path near pro shop / clubhouse | **20–40m** ← rejected |
| First fixes after Doze / app resume | **30–100m** ← rejected |
| Urban courses, building shadows | **20–50m** ← rejected |

**What Golfshot does:** Accepts the fix, displays the accuracy variance as a visual cue (less precise = less confident), but never throws the fix away. Yardages might be ±5y instead of ±2y, but they update.

**What we do:** Throw the fix away, then bandaid the consequences for six weeks.

### The bandaid chain (every commit since Phase 107 that "fixed" GPS)

| Commit | Date | What it added | Real fix or bandaid? |
|---|---|---|---|
| `a8a40fc` Phase 405 wave 2 | 2026-05-16 | `subscribePoorSignal` → toast "GPS weak (~Xm) — step into open sky or tap Mark" | **BANDAID** — REPORTS that our 15m gate is rejecting fixes. Doesn't fix anything. |
| `7c15aac` Fix L | 2026-05-22 | `MIN_DISTANCE_FROM_GREEN_YD` 30→60, `TRANSITION_MARGIN_YD` 30, `CART_MODE_BONUS_YD` 20 | **BANDAID** — tightened hole-transition gates because frozen `lastFix` from rejected reads was producing false transitions. Real fix: accept the fixes. |
| `ff3dbea` Fix H | 2026-05-25 | `isWarmingUp` flag + `WARMUP_FRESH_FIXES_REQUIRED = 3` good fixes to clear | **BANDAID** — REPORTS that post-resume fixes are being rejected. yardageResolver downgrades confidence to 'med'. |
| `1d0b7b9` Fix CL | 2026-05-26 | `WARMUP_HARD_TIMEOUT_MS = 30s` | **BANDAID ON BANDAID** — warmup never cleared because the 15m gate kept rejecting "good" fixes. Forced a timeout. |
| `82dfe47` Fix EY | 2026-05-27 | Pass `fix.timestamp` to classifyAccuracy, reject 'stale' for hole transitions | **BANDAID** — fixes go stale because they're being rejected. Patched the symptom downstream. |
| `bdfbe2d` Fix FW | 2026-05-30 | Bumped `subscribeFixChange` throttle 3yd → 5yd | **TANGENTIAL** — battery patch, not relevant to root cause. |
| `b3e4d8f` Fix GF | 2026-06-01 | offCourseDetector cache fallback, `outcome` telemetry field, `ownerSentinel` breadcrumbs | **PARTIAL** — cache fallback is real (Westlake/Sunnyvale have empty courseHoles); telemetry is REPORTING. |
| `3b275f6` Fix GL | 2026-06-01 | `isValidGolfCoord` at OS boundary + **GpsHealthBanner** | **MIXED** — coord guard catches genuine garbage (NaN, near-zero placeholders); **banner REPORTS GPS unhealthy mid-round, doesn't fix it**. |
| `ccfa2fc` Fix GM | 2026-06-02 | `ownerSentinel` breadcrumbs on 3 more rejection paths | **BANDAID** — adds visibility for telemetry. Doesn't change what's rejected. |

### Real-fix commits worth keeping

These addressed actual bugs, not symptoms of the accuracy gate:

- **`80e4dee` Day 1 (2026-05-20)** — Collapsed 3 GPS-fix caches into single `gpsManager` source. **REAL** — eliminated divergent-state class of bug.
- **`8b4d021` Fix GA (2026-05-31)** — 246yd haversine coord-unit bug + safeLoc WGS84 guard. **REAL** — closed actual math defect (meters leaked into degree slots).
- **`c650c10` Fix FZ (2026-05-31)** — Killed the `getCourse('palms')?.holes ?? []` fallback at round start (any non-Palms course got Palms coords). **REAL** — root-cause fix for "always off course" on non-Palms rounds.
- **`3b275f6` Fix GL — coord-guard portion** (separate from the banner) — Catches genuinely invalid coords like NaN, infinity, exact `{0,0}` placeholders. **REAL** — defensive but legitimate at OS boundary.

### The smoking gun for "GPS isn't picking up despite 5G working"

The chain of events on Tim's device:
1. Tim opens app on course
2. `watchPositionAsync` starts delivering fixes from the OS
3. Tree-canopy course: first fix `accuracy=22m` → REJECTED (>15m)
4. Second fix `accuracy=18m` → REJECTED
5. Third fix `accuracy=14m` → ACCEPTED (lastFix set)
6. Player walks 100 yards under trees: `accuracy=25m, 28m, 19m, 22m` → ALL REJECTED
7. `lastFix` shows the stale position from step 5
8. SmartFinder shows yardage from step 5's position (now wrong by 100y)
9. After 45s of >15m fixes, `subscribePoorSignal` fires the toast "GPS weak — step into open sky"
10. Tim sees the toast, looks at his 5G full bars, concludes "GPS broken"

Meanwhile Golfshot is happily showing yardages that update with every step.

**The "GPS isn't picking up" symptom is OUR CODE deciding the GPS is too noisy and silently dropping the data.** The hardware is delivering fine.

---

## PHASE 2 — Voice Path Archaeology

### Last commit voice intro / close / splash worked cleanly: ~2026-05-13 to 2026-05-17

Before the splash intro complexity exploded. The voice path at this point was:
- Splash: bundled Kevin mp3 via `playLocalFile`
- Post-splash: caddie tab opener at 600ms, single `speak` call
- No splash lock, no audio session memo, no D-ID video, no warm-up

### The root-cause introductions

**1. Splash intro accumulation (May 25–26):**

- **`446b537` (2026-05-25)** — D-ID Kevin intro video. Introduced a **second audio path** (video carries its own audio) that ran in parallel to existing `playLocalFile`/`speak`. Created races with the post-splash opener.
- **`ab4d5a5` (2026-05-25)** — `naturalEndRef` gate prevents `stopSpeaking()` tail-clip. Patched a tail-clip symptom from the new video path.
- **`a8ab92e` (2026-05-25)** — Greeting video fills screen, hides D-ID watermarks. UX patch, not voice.
- **`074ab80`, `3ab8b91`, `56b68c1`, `0d101e9`** (2026-05-25) — Four consecutive UI patches on the greeting frame. All consequences of the video introduction.

**2. The opener silence root cause (May 26):**

- **`3632e85` Fix DO (2026-05-26)** — **THIS IS A REAL FIX**, and the commit message is brutally honest: `"opener silence ROOT CAUSE: remove configureAudioForSpeech short-circuit"`. The bug: `audioLifecycle.goCold` was changing the OS audio session, but `voiceService.currentAudioMode` was a separate flag that stayed at `'speech'`. The next `speak()` short-circuited reconfig because the flag said the mode was already right — but the actual OS session was in goCold's default state. So `Sound.createAsync` played silently. **Two flags that should have been one piece of state.**

### The bandaid chain on voice (post-D-ID, pre-revert)

| Commit | Date | What it added | Real fix or bandaid? |
|---|---|---|---|
| `2dea565` Fix BX | 2026-05-26 | Second Kevin voice not firing on Caddie tab opener | **BANDAID** — patched a race symptom from the new splash complexity. |
| `da3e9b6` Fix BY | 2026-05-26 | Dropped trustLevel !== 1 outer gate so opener fires at L1 | **REAL** — undid a previous over-restriction. |
| `e3584a9` Fix BB | 2026-05-26 | 3s gap before Caddie second intro (was 600ms) | **UX patch**, not a defect fix. |
| `1d19c22` Fix AV | 2026-05-26 | GPS-aware second intro ("I see you're at <course>") | **FEATURE**. |
| `07260af` Fix EH | 2026-05-27 | Small-payload reject path was leaving caption stuck | **REAL** — closed a stuck-state defect. |
| `abaf514` Fix EG | 2026-05-27 | speak() auto-retry on dead playback + heartbeat probe | **DEFENSIVE** — adds retry mechanism for symptom (Sound.createAsync sometimes returns dead). Reasonable but doesn't address why. |
| `e32e07d` Fix EC | 2026-05-27 | File-existence probe before custom-caddie clip | **REAL** — closed a silent-failure path. |
| `07513da` Fix FS | 2026-05-28 | settingsStore hasHydrated gate post-splash audio paths | **REAL** — closed a hydration race. |
| `6295cab` Fix FX | 2026-05-30 | Voice/network circuit-breaker (3-fail → 60s cooldown) | **BANDAID** — when network is degraded, this just SKIPS the call entirely. "Less than ideal wifi signal" should produce slower TTS, not silence. |
| `ffa5d93` Fix FY | 2026-05-30 | Local Mode (user-toggled conservation) | **FEATURE**. |

### Tim already did the right undo (June 1)

- **`b6e6c9b` Fix GG (2026-06-01) — "REVERT Kevin D-ID intro video to bundled-mp3 path"**

This is the cleanest commit in six weeks. The audit description: "Tim's repro across many sessions: video renders visually but audio fires late on the NEXT screen with the captions appearing there instead of on the splash."

The right call. **The D-ID introduction (May 25) was the breaking change for splash. Tim reverted it on June 1.**

### Post-revert: the splash-lock complexity that should not still exist

After Fix GG removed the D-ID video, these patches REMAINED in place:

| Commit | Date | What it added | Still relevant after GG revert? |
|---|---|---|---|
| `e41246a` Fix GJ | 2026-06-01 | Split greeting effect, `audioKickoffStartedRef`, unmount-only stopSpeaking, goCold via serialSetAudioMode | **YES** — closed real dep-flip cleanup defect that exists with mp3 path too. |
| `e98fe15` Fix GK | 2026-06-01 | **Splash lock** — `acquireSplashLock` / `releaseSplashLock` / gates on `speak`/`playLocalFile`/`stopSpeaking`/`audioLifecycle.goCold`/`listeningSession.toggle`/caddie opener | **PARTIALLY** — designed to prevent the D-ID video's audio from being preempted. Now D-ID is gone, but the lock still gates 14 different paths and creates 14 new silent-failure modes (per Voice Pass 2 audit 2026-06-02). |
| `ccfa2fc` Fix GM | 2026-06-02 | Bumped splash lock 10s → 15s, opener wait 10s → 15s | **BANDAID** for GK's timeout race. With D-ID gone, the mp3 is 4-6s; the 15s lock is grossly oversized and the race window it creates (lock auto-expires while greeting is still playing) is contrived. |
| `be9b8cb` Fix GO | 2026-06-02 | Opener `openingPromptSpokenThisProcess` flag now flipped AFTER speak resolves (not before); `waitForSplashLockRelease` forces expiry check | **REAL** — closes the flag-flip defect that the splash-lock complexity exposed. But the lock itself is the actual cause of the silent-failure paths. |

**Net result on voice path:** The splash-lock (GK) was built to solve the D-ID video race. The video is gone. The lock remains and is the source of the silent post-splash failures Tim reported on 2026-06-02 ("text shows but no voice").

---

## PHASE 3 — Architectural Sanity Check vs Golfshot

Tim's evidence: **Golfshot works on the same Galaxy Z Fold, same 5G, same GPS chip.** Therefore the difference is in our code, not the device.

### What Golfshot doesn't do

- Reject GPS fixes for accuracy > 15m
- Refuse to update yardages until a "warmup" gate passes
- Display "GPS weak — step into open sky" banners during normal play
- Force a 3-fix smoothing window before showing position
- Pop "GPS unhealthy" mid-round banners
- Track 14 silent-failure paths in its TTS pipeline

### What Golfshot probably does

- Subscribe to OS location with the lowest-power accuracy that delivers ≤30m
- Use every fix the OS provides
- Display accuracy as a hint (small text or dot color), never as a hard gate
- Show last-known position when GPS drops, with a quiet "(updated 12s ago)" indicator rather than blanking
- For TTS, accept that audio sometimes fails and just retry on next user action — no silent gates

### What we do (the architectural inversion)

We treat normal GPS variance as **a fatal error condition** that triggers cascading defensive responses:
- Reject → smooth → warm-up → poor-signal callout → hole-detection freeze → off-course threshold → health banner

Each layer was added to handle a symptom of the layer above. None of them questioned whether the original layer (15m gate) was correct for the actual environment.

### Permission request shape

- `Location.requestForegroundPermissionsAsync` — fine
- `Location.requestBackgroundPermissionsAsync` — Tim has hit POST_NOTIFICATIONS denial on Android 13+ (Fix N), which then SILENTLY skips the foreground service (`backgroundLocationTask.ts:195-214`). Phone-in-pocket Doze coverage degrades silently. The fix logs to `ownerSentinel` but the user sees no indication.

### Smoothing buffer math

`SMOOTHING_WINDOW = 3` averaging lat/lng. With 1Hz polling that's 3 seconds of lag added to every yardage update. Golfshot doesn't appear to smooth — it just shows what the OS gives it, possibly with very light EMA.

---

## What to UNDO vs SURGICAL Fix

### GPS — REVERT recommended

The accuracy gate is the foundation everything else stacks on. Remove it (or raise to 50m+) and **most of the bandaid chain becomes dead weight**.

| To remove / revert | Reasoning |
|---|---|
| `OUTLIER_ACCURACY_M = 15` gate | Root cause. Remove it entirely, or raise to 50m+ to catch only true sensor garbage. |
| `subscribePoorSignal` toast | Reports a symptom of the gate. With the gate gone, the "weak" condition becomes a normal accuracy indicator, not an alert. |
| `isWarmingUp` flag + downgrade | Reports that early post-resume fixes are being rejected by the gate. Gate gone → warmup unnecessary. |
| `WARMUP_HARD_TIMEOUT_MS` | Bandaid for the bandaid. Goes away with warmup. |
| `GpsHealthBanner` mid-round popup | Reports our own state of degraded confidence, not a real device problem. Useful in genuine permission/subscription death, but unrelated to the accuracy gate. |
| Hole-detection threshold inflation (Fix L) | Was tightened because frozen `lastFix` from rejected reads produced false transitions. With fixes flowing again, the original 30y gate may be enough. Re-test before changing. |

### GPS — KEEP

- `SMOOTHING_WINDOW = 3` — small EMA-like effect, real value
- Position-jump rejection (`OUTLIER_JUMP_M = 50`) — catches true GPS teleports
- Fix GA WGS84 guards on coords
- Fix GL coord guards at OS boundary (catches NaN, exact `{0,0}` placeholders — the truly-invalid cases, not the noisy-but-valid cases)
- Fix FZ Palms substitution removal
- Day 1 single-source `lastFix` consolidation

### Voice — SURGICAL UNDO

The D-ID video is correctly reverted. The complexity built around it should follow.

| To remove / revert | Reasoning |
|---|---|
| Splash lock (Fix GK gates in speak/playLocalFile/speakFromBase64/stopSpeaking/audioLifecycle.goCold/listeningSession.toggle) | Built for D-ID video race. Video is gone. Lock now gates 14 paths and creates its own silent-failure modes. The mp3 path doesn't need preemption protection — it's a single bundled file with predictable duration. |
| Splash lock 15s timing (Fix GM) + waitForSplashLockRelease in caddie opener (Fix GK) | Becomes irrelevant when the lock itself is removed. |
| Caddie opener `waitForSplashLockRelease(15_000)` call | No lock to wait for. |
| Fix GO opener flag ordering | KEEP — closes a real defect (flag-flip before speak resolved). Independent of the lock. |
| Fix DO removal of configureAudioForSpeech memo short-circuit | KEEP — real root-cause fix for the two-flag desync. |
| Fix FX network circuit-breaker | REVIEW — "skip the call after 3 fails" is itself a Tim-flagged anti-pattern ("if you have less than ideal wifi signal, use immediately loses functionality"). Better: slower TTS, longer timeout, no skip. |

### Voice — KEEP

- Fix GG D-ID revert
- Fix DO short-circuit removal
- Fix EC file-existence probe
- Fix EH small-payload reject fix
- Fix FS hydration gate
- Fix GJ structural cleanup race fix (independent of splash lock)
- Fix GO opener flag ordering

---

## The Pattern Itself (so the team recognizes it next time)

A defensive-band-aid commit has these shapes:

1. **"Report the problem"** — adds a banner, toast, sentinel, breadcrumb, or downgrade flag that SURFACES the symptom but does not change what produced it.
2. **"Skip the call"** — adds a circuit-breaker, timeout, or fallback that SUPPRESSES a downstream call when an upstream condition triggers, without questioning whether the upstream condition is real.
3. **"Tighten the gate"** — raises a threshold to filter out the noise that an upstream gate is producing.
4. **"Patch the patch"** — adds a hard timeout / forced clear / safety net that fires when the previous patch's "good state" never arrives.

The Phase 107 → Fix L → Fix H → Fix CL → Fix EY → Fix GL banner chain is a textbook example. Each commit individually made the symptom less visible. The system as a whole got more broken.

A root-cause commit has these shapes:

1. **"Two flags should have been one"** (Fix DO).
2. **"Existing fallback was for the wrong condition"** (Fix FZ, Fix GG).
3. **"Calculation used wrong units"** (Fix GA).
4. **"State was set before the operation it gates resolved"** (Fix GO).
5. **"Cache scopes diverged"** (Day 1 single source).

The differentiator: a root-cause commit USUALLY REMOVES CODE. A bandaid USUALLY ADDS CODE.

Net code delta in last 6 weeks on `services/gpsManager.ts` alone: hundreds of lines added, almost none removed. That ratio is the diagnosis.

---

## Honest Summary for Tim

You were right. The pattern is real. The GPS gate at 15m is the single biggest contributor to "GPS isn't picking up," and almost every "fix" since has been a bandaid on its consequences. The voice path's recovery story is closer to clean — Fix GG correctly undid the D-ID introduction — but the splash-lock complexity built around D-ID stayed in place and is now the source of post-splash silence.

The recommendation is REVERT-first: remove the accuracy gate, remove the warmup state, remove the splash lock. Then re-test and only add back the pieces that prove necessary against real on-course behavior. The downstream patches (Fix L's hole-detection inflation, the GpsHealthBanner, the network breaker) can come out together because they exist to absorb the consequences of the upstream gates.

No code shipped in this diagnosis. Awaiting your call before any revert.
