# Phase BG — Round-Foundation Empirical Verification

**Renamed from prompt's "Phase BA-FOUNDATION"** — BA was used for voice register
differentiation (commit `70defd6`).

**Scope**: audit + close GPS-subscriber gaps that prior phases (AC/AL/AH/Y.2)
left open. The prompt was written assuming those phases hadn't shipped; they
have. This phase only fixes what was actually missing.

## Critical pre-round gap (BLOCKING for earbud-tap voice path)

**`react-native-track-player` is uninstalled.** `services/mediaKeyBridge.ts`
header explicitly states no-op fallback. The JS wire from
`notifyEarbudTap()` → `listeningSession.toggle()` is intact end-to-end, but
**physical Bluetooth earbud taps cannot reach the JS layer at all** because
the native source module isn't installed.

This is why your last round's earbud tap empirically failed.

### Options
1. **Install `react-native-track-player`** — adds a native dependency,
   requires fresh EAS dev-client build. Highest impact: physical earbud
   taps actually work.
2. **Accept on-screen-tap-only for this round** — open the green-arrow
   dropdown, tap the mic icon. Works today.
3. **Use `expo-av` audio focus** — different mechanism, doesn't capture
   media keys but might detect Bluetooth A2DP route changes.

**Recommendation**: option 1 if you want earbud voice working in the next
round. ~2-3h to install + wire + EAS rebuild + verify. Option 2 if the
on-screen tap is acceptable for this round and you want to defer the
native install decision.

## JS-side gaps closed in this commit

| Surface | Was | Now |
|---|---|---|
| **holeDetection** | Polled every N ms; comment claimed Mark subscription but didn't actually subscribe | Subscribes to position-mark bus on `startHoleDetection()`, fires immediate `tick()` on Mark — closes up to N-second lag for hole transition after Mark |
| **SmartFinderCard** | Polled every 4s only | Polls every 4s + subscribes to mark bus for instant refresh on Mark |
| **SmartVision** (`/smartvision`) | No subscription, no GPS | Subscribes to mark bus → re-renders on Mark (sets up future GPS overlay; current behavior unchanged but bus is wired) |
| **Caddie tab data-strip live yardage** | Recomputed only on Mark or hole change → stale during walking | Recomputes on Mark + every 4s during active round — matches SmartFinderCard cadence |
| **lie-analysis context** | Audit thought it didn't capture GPS — wrong | Already uses `getLastFix` in `services/lieAnalysisContext.ts:55`. No fix needed. |

## Pre-round verification checklist

Run all 5 before stepping on the first tee. **If ANY fails, do not play.
Identify what's still broken first.**

### 1. Earbud tap engages Kevin
**Pre**: Bluetooth earbuds connected, app on Caddie home, no active round
needed for this test.
**Action**: single-tap the play/pause control on your earbuds.
**Expected**: within 1-2 seconds, Kevin engages with a register opener line.
**adb logcat**: should see `[audit:earbud] media key fired` followed by
`[audit:voice] listening engaged`.
**Likely outcome with current build**: ❌ FAIL — `react-native-track-player`
not installed (see "Critical pre-round gap" above).
**Workaround**: open green-arrow dropdown, tap mic icon. Should engage within
500ms (`[audit:voice] listening engaged`).

### 2. Start round → SmartFinder shows real hole-1 yardages
**Pre**: At your home course (or a course with verified geometry — Palms
or Lakes per Phase AW data sync).
**Action**: open Play tab → Start Round at the course.
**Expected**: Caddie home loads with round-active state. Open
green-arrow → tap SmartFinder icon → F/M/B yardages reflect hole 1
(should be plausible — e.g., 200-400y middle for a par-4).
**adb logcat**: `[path2:round] start course=...` then
`[audit:round-active] state=true roundId=... hole=1`.
**Failure mode**: yardages show "—" (course geometry missing — fall back
to bundled values; check `data/courses.ts` has GPS for your course).

### 3. SmartVision shows hole 1
**Pre**: round started.
**Action**: tap green-arrow → SmartVision icon.
**Expected**: navigates to `/smartvision`. Markers (T blue, Y yellow,
P red) visible. Yardages in bottom panel match hole 1.
**Imagery toggle test**: tap top-right sparkles icon to cycle Auto →
Curated → GPS. With Palms (now has OSM-matched coords from Phase AW),
GPS mode should load Mapbox satellite tile.
**Failure mode**: blank screen / no markers — check `app/smartvision.tsx`
startup logic for the current hole.

### 4. Mark refreshes all GPS-dependent surfaces
**Pre**: round active, hole 1.
**Action**: tap green-arrow → tap MARK (yellow location icon).
**Expected**:
- Haptic feedback
- Caddie response toast: `Marked (accuracy ~Nm).`
- adb logcat: `[audit:mark] fired hole=1 accuracy=N subscribers=N`
- adb logcat: `[audit:gps] holeDetection tick triggered by mark event`
  (Phase BG fix — confirms holeDetection actually heard the Mark)
- Open SmartFinder card → yardages immediately reflect new position
  (no 4-second wait — Phase BG fix)
- Open SmartVision → screen re-renders (no visible change yet since SV
  doesn't draw a "you-are-here" dot, but the bus subscription confirms
  the wire is intact for future overlay work)
**Failure mode**: only some surfaces refresh → grep adb logcat for
`[audit:mark] subscribers=N` and verify N >= 4 (caddie tab, _layout
seeding, SmartFinderCard, holeDetection).

### 5. SmartFinder measure handles errors gracefully
**Pre**: round active.
**Action**: open SmartFinder full screen, tap on the map to drop a target.
If GPS is degraded, force-quit and re-test in conditions with poor signal.
**Expected**: even if GPS fails, you see graceful messaging
("GPS not ready" or "course data not loaded"), no app crash, no uncaught
promise rejection in adb logcat.
**Failure mode**: app hangs or red-error screen → SmartFinder.tsx try/catch
gap; report exact error.

## Walk-test verification (during round)

After 10-20 yards of walking from the tee box:

- **SmartFinder yardages should DECREASE** (closer to green) within 4s of
  movement. If frozen at tee values, the polling loop isn't refreshing
  `lastFix`.
- **Caddie tab data strip "PLAYS" yardage should also decrease** — this is
  the Phase BG fix. Before the fix, it stayed stale until you Mark or
  change holes.
- **Hole transition test**: walk to next tee box. Within ~10s of sustained
  position there, the round should auto-advance to hole N+1
  (`[audit:round-active] hole-transition prev=1 next=2`). If it doesn't,
  tap MARK — that should trigger immediate hole detection re-evaluation
  (Phase BG fix).

## EAS build coordination

**Current main branch HEAD**: see `git log -1 --oneline` after this commit
ships.

**What needs an EAS rebuild**:
- ❌ Native dependency changes — none in this commit (Phase BG is JS-only).
- ✅ JS-only changes — included in any reload of an existing dev-client
  build via Metro hot reload.

**Build command**:
```
eas build --profile development --platform android
```

**After build completes**:
1. Install on Galaxy Z Fold (open the email link or scan QR).
2. Verify build version contains commit hash matching `git log -1 --oneline`.
3. Run the 5-step pre-round checklist above.
4. Walk-test verification on first 2-3 holes.
5. If all 5 + walk-test pass, proceed with full round.
6. If anything fails, capture adb logcat with `[audit:*]` markers and
   report.

**For earbud voice path** (separately from this commit): if you decide
to install `react-native-track-player`, that requires:
1. `npx expo install react-native-track-player`
2. `npx expo prebuild --clean` (if not using EAS managed)
3. Fresh EAS build — JS-side wire to native module needs the native
   module present at build time.

## Verdict

This commit closes the JS-side subscription gaps that were preventing
GPS-dependent surfaces from refreshing reliably. **Earbud voice path
remains BLOCKED** pending native module install — separate decision.

After this ships:
- ✅ Manual MARK reliably refreshes SmartFinder + holeDetection + caddie tab
- ✅ SmartFinder + caddie tab data strip live-update during walking
- ✅ Hole transitions fire on Mark (not just on poll cycle)
- ❌ Physical earbud tap — requires `react-native-track-player` install
- ✅ On-screen mic in dropdown — works today, reliable fallback

**For your next round**: use the on-screen mic in the green dropdown for
voice. All other GPS surfaces should work empirically.
