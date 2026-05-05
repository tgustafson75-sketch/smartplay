# Phase BU — Component 4: Fix Coverage Assessment

**Audit date:** 2026-05-04

For each of Tim's six observations: did committed-or-uncommitted changes since the studio session address it? If yes, is the fix complete or partial? If partial/no, what's still required?

## Methodology

Reference points:
- **`6dff9f3`** — last committed work; bundled BS audit + scaffolding. Studio session predates this commit. Cage refactor came after.
- **Working tree (uncommitted)** — two layered change sets: (A) BS-followup cage refactor targeting Tim's 8 studio observations, (B) persona widening (orthogonal to Cage Mode).
- **Empirical verification status** — whether Tim has run a Cage Mode session on Galaxy Z Fold since the fix was made. Spoiler: no, for any of these.

## Coverage table

| # | Observation | Status | Coverage | Verified? |
|---|---|---|---|---|
| 1 | UI layout jumbled | **PARTIAL** | Overlay UI compacted + safe-area paddingBottom; older feel/shape session screen UNCHANGED | No |
| 2 | Video recording works | **N/A** | Not a failure; baseline confirmed | Yes (Tim) |
| 3 | Detection false positives | **NO** | Thresholds + algorithm unchanged | n/a |
| 4 | Save/routing broken | **PARTIAL** | Library bridge wired (overlay path); per-clip extraction NOT done; older path still broken; Phase K shape mismatch (master video as clipUri) | No |
| 5 | Review UI limited | **NO** | Same single-clip player + static card | n/a |
| 6 | Correlation broken | **NO** | Detection events and saved media still don't share a key | n/a |

## Per-observation coverage detail

### Obs 1 — UI layout jumbled · PARTIAL coverage

**What was changed (uncommitted):**
- `components/CageSessionOverlay.tsx`: Replaced emoji icons with Ionicons; reduced sizes (swing count 64→28, button text 22→16, button padding 22→14); added compact `recHeader` with timer + count inline; flex:1 `livePreviewBox`; silhouette overlay (Ionicons `body-outline`); fold-aware `actionRow`/`actionRowStacked`; safe-area `paddingBottom: insets.bottom + 12`; `edges={['top','left','right']}` on SafeArea.
- These changes target the "buttons cut off / icons too big / no silhouette" subset.

**What was NOT changed:**
- The older `app/cage/session.tsx` live UI (feel/shape grid + Log Shot button + Kevin coach box) — unchanged. If a navigation path reaches both UIs in the same flow, controls overlap.
- Reconciliation of the two-UI ambiguity (Component 2 finding F1, Component 3 root cause hypothesis A).

**Required to fully resolve:**
- Pick one canonical live-session UI.
- Route every entry from `app/(tabs)/swinglab.tsx` and any other surface through that single UI.
- Delete or hide the redundant code path.
- Empirically verify on Galaxy Z Fold (closed + open).

**Status if Tim runs cage now:** The overlay portion of the UI should be visibly improved (icons, padding, silhouette). The older session-screen layout, if reached, will look exactly as it did during the studio session.

---

### Obs 2 — Video recording · N/A

Confirmed working pre-studio. No regression introduced by uncommitted changes. Camera + master.mp4 write path is the same.

---

### Obs 3 — Detection false positives · NO coverage

**What was changed:** Nothing.

**Constants in working tree:**
```ts
// components/CageSessionOverlay.tsx L30-32
const TRANSIENT_THRESHOLD_DB = 14;
const DEBOUNCE_MS = 1500;
const NOISE_FLOOR_MIN_SAMPLES = 5;
```
These are identical to pre-studio.

**Algorithm:** `handleMeterReading()` (L174–202) — same single-modality audio comparison against a 5-sample noise floor. No spectral filter, no pose check, no per-club tuning.

**Required to fully resolve:**
- Quick win: lengthen noise-floor window (5 → 20+ samples), add a high-pass spectral threshold so only sharp 1–4 kHz transients fire.
- Proper fix: route the live mic stream through `services/acousticEngine.ts` (already used by upload pipeline) to get spectral classification + per-club threshold mapping.
- Multi-modal (defer): pose/IMU confirmation requires camera frame + watch IMU integration not present today.

**Status if Tim runs cage now:** Identical false-positive behavior. Background noise will still trigger detections.

---

### Obs 4 — Save/routing broken · PARTIAL coverage ⚠️

**What was changed (uncommitted):**
- `store/cageStore.ts:ingestUploadedSwing` accepts optional `source: SwingSource` parameter (default `'uploaded_video'`, live cage passes `'live_cage'`). Routes session-id and shot-id suffixes by source.
- `components/CageSessionOverlay.tsx:handleEndSession` now:
  1. Calls `useCageStore.getState().ingestUploadedSwing({clipUri: masterVideoPath, club: 'unknown', upload: {...}, source: 'live_cage'})` — bridges the live session into Zustand `sessionHistory`.
  2. Calls `void runPhaseKOnSession(libraryEntryId).catch(...)` — fires Phase K analysis.
  3. Calls `onComplete(libraryEntryId ?? session.id)`.
- `app/(tabs)/swinglab.tsx`: cage `onComplete` callback routes to `/swinglab/swing/${sessionId}` instead of `/cage-debug`.

**What was NOT changed:**
- **Per-detection clip extraction.** The bridge passes the WHOLE master video as `clipUri`. Phase K extracts 5 frames at fractions `[0.08, 0.40, 0.60, 0.75, 0.88]` of the master video — for a multi-swing session, frames mostly land between swings. Phase K returns `none`/low-confidence/`no_data`.
- **Older `app/cage/session.tsx` end-path.** Its `handleEndSession()` (L350–363) calls only `endSession({...})` (Zustand internal — does not bridge to library). Sessions reaching this path are recorded to filesystem but invisible in the swing library.
- **Detection-event → CageShot correlation.** Audio detections in `cageStorage._pendingEvents` are still parallel to CageShots (which only get created via manual Log Shot in the older session screen, with `clipUri: null`).

**Required to fully resolve:**
1. Pick one canonical end-path (preferably the BS-followup one in the overlay) and remove the other.
2. After session ends, before calling `ingestUploadedSwing`, extract per-detection mp4 clips:
   - Read `cageStorage` clip metadata (offsets + start/end times).
   - For each clip: extract `cage_sessions/<id>/clip_<n>.mp4` from the master video (5 seconds: offset−2 to offset+3).
   - Library / module candidates: `expo-video-thumbnails` (has frame extraction; needs evaluation for video segment), `react-native-ffmpeg` (heavyweight, native dependency), or a custom Sharing/Asset workaround.
3. Create one CageShot per extracted clip with the per-clip `clipUri`. Push into the session's `shots[]` BEFORE Phase K runs.
4. Phase K should now produce per-swing analysis; multi-swing classifier (`classifySession`) selects primary issue across the set.

**Status if Tim runs cage now:**
- If reaching the new overlay path: session DOES appear in library (Issue G partial), but Phase K will return `no_data` because frame samples land between swings.
- If reaching the older session.tsx path: session does NOT appear in library at all.

The user will see a library entry with "No data" or "I had trouble watching this one." instead of a useful primary issue + drill. Tim's "session captured but disconnected from downstream value" observation will largely persist.

---

### Obs 5 — Review UI limited · NO coverage

**What was changed:** Routing target changed (cage onComplete now routes to `/swinglab/swing/${sessionId}` instead of `/cage-debug`), but the destination screen is unchanged.

**Capability state:** Same as pre-studio — single video player + static analysis card. Per Component 2 finding F7:
- No multi-swing timestamp scrubber.
- No favorite/mark within session.
- No comparison view.
- No re-analyze button.
- No editable tags post-session.
- No share/export.

**Required to fully resolve:** Multiple sub-fixes in `app/swinglab/swing/[swing_id].tsx` and adjacent. See Component 5 for prioritization.

---

### Obs 6 — Correlation broken · NO coverage

**What was changed:** Nothing structural.

**Why:** The bridge added in Obs 4's partial fix routes the master video to a single CageShot. It does not create per-detection correlation. Detection events and the CageShot are joined only by session id, not by detection index → media segment id.

**Required to fully resolve:** Subsumed in Obs 4's full fix. Per-detection clip extraction = per-detection CageShot = inherent correlation.

**Status if Tim runs cage now:** Same data integrity gap. Detection counter says 8, library entry shows 1 CageShot pointing at the master video.

---

## Coverage stratified by severity

| Severity | Total | Fully covered | Partially covered | Not covered |
|---|---|---|---|---|
| BLOCKING | 3 (Obs 1, 4, 6) | **0** | 2 (Obs 1, 4) | 1 (Obs 6) |
| SIGNIFICANT | 2 (Obs 3, 5) | **0** | 0 | 2 (Obs 3, 5) |
| n/a | 1 (Obs 2) | n/a | n/a | n/a |

Three BLOCKING failures. **Zero of them are fully covered.** Two are partially covered with the partial fix unverified empirically. One has had no work attempted.

## Verification status across all uncommitted changes

- **TypeScript / lint**: Pass clean.
- **Galaxy Z Fold device testing**: Not done since cage refactor was made.
- **Logcat trace markers**: No `[path3:cage]` markers added — verification by log grep is impossible.
- **Critical path PATH 3 CAGE**: Per CLAUDE.md "Critical Path Verification Gates," this path requires empirical verification before phase shipping. Has NOT been re-verified since studio session.

## Honest summary

The BS-followup refactor that targets Tim's studio observations is **about 30% of the way to fully resolving the BLOCKING issues**:
- ~50% of UI layout fix shipped (overlay updated, older path stale).
- ~30% of save/routing fix shipped (library bridge wired, but Phase K shape wrong + dual end-path remains).
- 0% of correlation fix shipped.
- 0% of false-positive fix.
- 0% of review UI fix.

The phrase "Tim sent some fixes via Claude Code since the studio session" is true but misleading: the fixes target the right observations, none of them are complete, and none of them have run on real hardware. The honest framing is: **"a partial coded attempt at the right surface, currently unverified, with the deepest structural causes (per-clip extraction, dual code paths, correlation primitive) untouched."**
