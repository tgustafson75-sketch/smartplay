# Legacy Club Detection — Deep Capture (Phase BM Component 4)

**Author:** Claude Code (audit pass + Phase BI revision)
**Date:** 2026-05-04 (initial), 2026-05-04 (Phase BI revision — added Tim's confirmed UX pattern)
**Purpose:** Capture legacy v2 implementation of auto club recognition during cage sessions, so Phase BL has validated scope when 1.x prioritizes the rebuild.

---

## TL;DR — Honest finding

**No auto club recognition implementation exists in any reachable legacy codebase. Validated UX pattern from Tim's memory: player shows the bottom of the club (with the number stamped on the sole) to the camera; vision identifies it.**

The premise of this capture (`Legacy v2 had auto club recognition that worked during cage sessions`) does not match what's on disk. After exhausting the available legacy sources, every cage flow I found — both legacy `origin/master` and current `main` — uses **manual tap-grid club selection** before the session starts. The user picks a club from a 14-button grid (Driver / 3W / 5W / 4I–9I / PW / GW / SW / LW / Putter), `startSession(club)` is called with that value, and every shot in the session inherits the manually-chosen club.

The acoustic engines that exist are **scaffolded stubs**, not detection pipelines. There is no vision-based club ID, no audio-based club ID, no pose-based club ID, no sensor-based club ID — anywhere in the legacy or current code.

**Tim's memory-validated UX pattern (added 2026-05-04 in Phase BI):** the user **shows the bottom of the club to the camera with the number visible** (the "8" stamped on the sole of an 8-iron, the "PW" on a pitching wedge, etc.), and vision identifies the club from that image. This is the design pattern Phase BL should implement. It maps cleanly to the existing `api/vision.ts` infrastructure: a new `mode === 'club'` branch sending the cropped club-sole image to GPT-4o-vision (or Sonnet vision), expected response `{club: 'PW' | '8I' | …, confidence: 0..1}`. Legacy implementation code is not recoverable, but the interaction model is.

**Implication for Phase BL:** the rebuild is **greenfield code, validated UX**. Treat Phase BL as a from-scratch implementation against a known interaction model, not a migration of existing logic. The data model + UI affordances for `club: string` per shot DO carry forward — those are reusable. The vision call is new but maps to a familiar pattern (`api/vision.ts:mode === 'hole'` already exists; add `mode === 'club'`). The trigger logic, confidence threshold, and manual-fallback UX still need fresh design.

This finding could be wrong if the legacy codebase exists outside the locations searched (Tim's old laptop, an iCloud/Drive zip, a TestFlight archive). The interaction model captured above stands regardless.

---

## Methodology — what I searched

### Codebases searched
| Location | git remote | Status |
|---|---|---|
| `/Users/timothyg/Documents/smartplay` (current) | `tgustafson75-sketch/smartplaycaddie` | active, 420 tracked files |
| `origin/master` (in same repo) | — | legacy v2, 98 tracked files, "Day N" commit cadence |
| `origin/fix/v2-wiring` | — | recent v2-wiring fix branch (matches current main lineage) |
| `origin/copilot/copy-smartplay-caddie-code` | — | single "Initial commit" |
| `/Users/timothyg/smartplay-vnext` | local-only | `Initial commit`, 38 files, fresh starter |
| `/Users/timothyg/Desktop/smartplay-vnext` | local-only | `Initial commit`, monolithic `App.tsx` (60KB), v3 scaffold |
| `/Users/timothyg/Desktop/smartplay-temp` | local-only | empty `App.tsx`, scratch directory |

### Search patterns
Across all of the above:
```
grep -iE 'club.?detect|club.?recogn|club.?ident|club.?classif|auto.?club|detect.?club|identify.?club'
```
Plus broader searches: `vision`, `cage`, `acoustic`, `audio`, `tempo`, `metric`, `recogn`, `classif`, `detect`, `impact`.

**Total grep matches for any club-detection-shaped term: zero.**

### Commits searched
- `git log --all --oneline | grep -iE 'club.*detect|club.*recogn|auto.*club|club.*ident|club.*classif'` → zero hits.
- All `Day N` commits in `origin/master` (Day 7 through Day 14 visible in log) — none describe club detection.

---

## What legacy v2 actually had (origin/master)

### Manual club selector
**File:** `app/cage/index.tsx` (legacy)
**Pattern:** explicit hard-coded `CLUBS` array → tap-grid → state → `startSession(selectedClub)`.

```ts
const CLUBS = [
  { label: 'Driver', value: 'DR' },
  { label: '3 Wood', value: '3W' },
  { label: '5 Wood', value: '5W' },
  { label: '4 Iron', value: '4I' },
  { label: '5 Iron', value: '5I' },
  { label: '6 Iron', value: '6I' },
  { label: '7 Iron', value: '7I' },
  { label: '8 Iron', value: '8I' },
  { label: '9 Iron', value: '9I' },
  { label: 'PW', value: 'PW' },
  { label: 'GW', value: 'GW' },
  { label: 'SW', value: 'SW' },
  { label: 'LW', value: 'LW' },
  { label: 'Putter', value: 'PT' },
];

const [selectedClub, setSelectedClub] = useState('7I');

const handleStart = () => {
  startSession(selectedClub);
  router.push('/cage/session');
};
```

### Per-club confidence tracking (a STAT, not detection)
**Store:** `store/relationshipStore.ts` (legacy and current)
- Field: `confidenceByClub: Record<string, number>`
- Action: `updateClubConfidence(club: string, score: number)`
- Source: end-of-session `analyzeSession(shots, club)` returns `flushRate / 100` → written into the store.

This is a **post-hoc statistic** computed from manually-entered feel/shape data per shot. It is not detection — Kevin was never identifying which club you'd just used. He was tracking how well you struck the club you told him you were using.

The display: "Kevin rates your 7I at 73% confidence" — that's flush-rate-renamed-as-confidence, not a model output.

### Pattern engine on feel/shape (also not detection)
**File:** `services/patternEngine.ts` (legacy)
- Inputs: array of `CageShot` objects with manually-entered `feel` (`flush | fat | thin | heel | toe`) and `shape` (`draw | straight | fade | hook | slice | push | pull`).
- Output: `dominantMiss`, `flushRate`, `rootCause` heuristics ("Low point control", "Early extension", etc.).
- Note: legacy fed in the same `club` that was set at session start. Pattern engine never tried to *infer* the club — it consumed the user's selection.

### Acoustic engine — scaffolded stub
**File:** `services/acousticEngine.ts` (legacy AND current — same shape, single comment difference)

Legacy:
```ts
// Acoustic engine — built in Day 14
export const acousticEngine = {
  analyze: async (_audioUri: string): Promise<null> => null,
  isAvailable: (): boolean => false,
};
```

Current:
```ts
// Acoustic engine — built in Day 14
export const acousticEngine = {
  analyze: async (_audioUri: string): Promise<null> => null,
  isAvailable: (): boolean => false,
};
```

Identical 6-line stub. Both return `null` and report `isAvailable: false`. **There is no acoustic detection logic anywhere — only the function signature.**

### Phase J — acoustic ball speed (also stubbed, current only)
**File:** `services/acousticBallSpeed.ts` (current only)

Honest comment from the file itself:
> STATUS: stubbed (option b per the spec). Real-time audio impact detection with peak-pair time-of-arrival math is genuinely real engineering — single-peak detection alone needs careful onset detection, noise filtering, and cage-acoustic calibration. Phase J ships a club-typical estimator instead so the data shape is in place for Phase K consumers; the real detector lands in a refinement bundle when reliable detection tech is in hand.
>
> Output is clearly tagged `confidence: 0.3, source: 'club_typical_stub'` so downstream consumers (and any future analytics) can distinguish estimated values from real measurements when the detector ships.

What it actually does:
- `estimateBallSpeed(club: string)` → looks up a hard-coded MPH-by-club table and returns it tagged `source: 'club_typical_stub'`, `confidence: 0.3`.
- `measureBallSpeedAcoustic(...)` → returns `null`.

This is the closest thing to "auto detection" in the codebase. Note it goes the **opposite direction** — it expects the club as input and returns an estimated ball speed. It does not look at audio and infer the club.

### Vision API — hole-overhead, not club identification
**File:** `api/vision.ts` (legacy and current)

Takes a satellite image of the hole + course context, sends to `gpt-4o`, returns a 2-sentence Kevin "read the hole" response (hazard ID + aim point). Has nothing to do with club detection.

```ts
mode === 'hole'  → "identify the main hazard and recommend an aim point"
```

No "club" mode exists.

---

## What's still in v1.0 today (current main)

**Same manual flow.** Current `app/cage/index.tsx` has the same `CLUBS` constant (with one minor tweak — `Phase I` short-club-label mapper for the Coach intro template, line 22-29). Same `startSession(selectedClub)`. Same default `'7I'`. Same `confidenceByClub` stat. Same `acousticEngine.ts` stub.

The "v1.0 migration didn't carry forward" framing in the phase prompt is technically **inverted**: v1.0 carries forward exactly what legacy had — the manual selector. There was no auto-detection feature to drop.

---

## Implications for Phase BL (1.x rebuild)

If Tim's intent for BL is to ship auto club recognition during cage sessions, the rebuild is **greenfield**:

1. **No portable detection code exists.** Every "engine" file is either a stub or operates on user-provided club input.
2. **The data model is reusable.** `CageShot.club: string`, `CageSession.club: string`, `confidenceByClub: Record<string, number>` all stay. The detection just needs to write to the same fields.
3. **The selector affordance is reusable.** Manual fallback UI (the existing tap-grid) becomes the fallback path. Auto-detection writes the value the user would have tapped.
4. **No "trigger logic" exists.** Legacy starts a session with one fixed club; there's no concept of "detect when the club changes mid-session" because legacy didn't support multi-club sessions. Phase BL would need to introduce that concept too, OR keep one-club-per-session and just remove the manual selection step.
5. **No reliability data.** Since the feature didn't exist, there's no telemetry, user feedback, or historical success rate to inform thresholds.

### What Phase BL needs to specify (validated UX, de novo code)
Going through the original capture template the phase prompt asked for:

**VISION APPROACH:** *Validated by Tim's memory.* User shows the bottom of the club (number visible on sole) to the camera. Recommended path: GPT-4o vision (consistent with existing `api/vision.ts:mode === 'hole'` pattern). Add `mode === 'club'` branch:
- Input: cropped image of club sole + brief context prompt
- Output: `{club: '8I' | 'PW' | …, confidence: 0..1, raw_label: string}`
- Confidence threshold for auto-register: needs empirical tuning, suggest start at 0.7
- Below threshold: show transcribed label + "is this right?" with manual override
- Cost: ~$0.005 per detection (gpt-4o-mini-vision pricing) — cheap enough for one-per-club-change

Alternative paths considered:
- Pose/keypoint detection on swing video — harder, likely confuses club length with body geometry, rejected.
- Custom classifier trained on club-bottom photos — most accurate but requires training data nobody has, rejected for v1.x.
- Audio-based — both legacy and current acoustic engines are stubs; not viable without DSP work.

**TRIGGER LOGIC:** *Not specified in legacy memory.* Options to choose:
- (A) One-shot at session start — replaces the current 14-button tap grid with a "show me your club" camera step. Cleanest. Maintains "one club per session" assumption.
- (B) Continuous: detect after swing-cessation timer (e.g., 8s of no swing) → "did you switch?" — requires multi-club session model.
- (C) User-initiated: explicit "switching clubs" button or voice intent ("Kevin, switching to 6-iron") — falls back to vision if user agrees, or just accepts the spoken value.
- Recommendation: ship (A) for v1.x first, layer (C) voice-trigger as polish, defer (B) to multi-club session model phase.

**UX INTEGRATION:** *Not specified in legacy memory.* Recommendation:
- TTS announcement on detection: "8-iron, got it." or "Switching to PW."
- Visual confirmation: club label appears prominently, manual override tap target visible
- Silent failure path: low-confidence detection → tap-grid auto-opens with the best-guess pre-selected
- Voice trigger: "Kevin, mark this as wedge" / "switching to 6-iron" routes to manual override regardless of vision

**RELIABILITY DATA:** *Not in legacy.* Will need to be generated during Phase BL beta.

**LEGACY CODE PORTABILITY:** Reusable assets:
- `CLUBS` constant (the list of clubs the app understands).
- `CageShot` / `CageSession` data shapes — write `club` from detection instead of selector state.
- `relationshipStore.updateClubConfidence(club, score)` — keep using as-is.
- `patternEngine.analyzeSession(shots, club)` — consumes club, doesn't care where it came from.

What needs writing fresh:
- The detector itself.
- The trigger logic.
- The confidence threshold + manual-fallback UX.
- Telemetry to measure success rate over time.

---

## Open questions for Tim

Before BL hardens scope, please confirm one of these:

1. **The premise was wrong.** Auto club recognition was never actually built; it was a planned/discussed feature that didn't make it into legacy. Phase BL is greenfield from the start. → Capture above stands as the validated input.

2. **There's a legacy codebase I didn't find.** Maybe on a different machine, an older laptop, a cloud backup, an early prototype branch since deleted, or in a non-git directory. → Tell me where to look and I'll re-run the capture.

3. **Conflated with a related feature.** What's actually in legacy:
   - **Per-club confidence stats** (renamed "Kevin rates your 7I at 73%") — this exists and works post-session.
   - **Acoustic ball-speed scaffolding** (Phase J stub) — this exists as a stub but inverts the direction (club → speed, not audio → club).
   - **Manual selection with Kevin commentary** — this exists.
   If one of those was what you remembered as "auto recognition," BL scope changes accordingly (less ambitious, more about polishing the existing flow).

4. **It was a paper/planning concept** — maybe there's a design doc, a Loom video, or a Notion page where the auto-detection was specced but never coded. → Point me to the doc and the capture can incorporate the spec.

The honest baseline for now: **legacy = manual + post-hoc stats. BL = greenfield detection.**

---

## Sources

- `git ls-tree -r origin/master --name-only` (98 files)
- `git show origin/master:app/cage/index.tsx`
- `git show origin/master:app/cage/session.tsx`
- `git show origin/master:store/cageStore.ts`
- `git show origin/master:store/relationshipStore.ts`
- `git show origin/master:services/acousticEngine.ts`
- `git show origin/master:services/patternEngine.ts`
- `git show origin/master:api/vision.ts`
- Current `services/acousticEngine.ts`
- Current `services/acousticBallSpeed.ts`
- Current `app/cage/index.tsx`, `app/cage/session.tsx`, `services/cageApi.ts`
