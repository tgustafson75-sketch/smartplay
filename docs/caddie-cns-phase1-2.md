# Caddie Central Nervous System — Phase 1 & 2 (design)

**Goal:** give the Anthropic brain a persistent, growing memory + a single fast
retrieval path, so over repeated rounds the caddie relies less on live signal
(GPS/acoustics) and more on what it has learned. Must be **additive** — upgrade,
speed up, reduce errors/nulls — and **never break** existing behavior.

Nervous-system mapping: Anthropic = CNS · this memory = long-term/procedural
memory · GPS/acoustics/camera = afferent signals · OpenAI = ears/mouth ·
Gemini = vision reflex backup.

---

## Phase 1 — Caddie Memory store  (`store/caddieMemoryStore.ts`, NEW)

One persistent, device-local, versioned Zustand store. Keyed by `player_id`
(from `derivePlayerId()`) and `course_id`. Additive: nothing else changes; it
just starts filling.

### Data model (every field null-safe; defaults, never `undefined`)
```
CaddieMemory { version, players: Record<playerId, PlayerMemory> }

PlayerMemory {
  player_id
  bag:        Record<clubId, ClubModel>      // learned distances
  tendencies: TendencySummary                // distilled dominant miss/patterns
  preferences:{ respondsTo, tone }           // what coaching lands
  courses:    Record<courseId, CourseMemory>
  reflections:Reflection[]                   // rolling, capped ~10
  updated_at
}

ClubModel  { club, samples, avgCarryYds|null, p80DispersionYds|null, lastUpdated }
            // numbers stay null until >= MIN_SAMPLES (e.g. 5) real shots — HONESTY
CourseMemory { course_id, name|null, rounds_played, holes: Record<hole,HoleMemory>, notes[] }
HoleMemory { hole, par|null, typicalTeeClub|null, typicalApproach|null,
             bestLine|null, greenBehavior|null,
             outcomes:{ played, scoringAvg|null, trouble[] }, lastPlayed }
Reflection { round_id, course_id, date, summary, keyTakeaways[] }
```

### Writers (events → memory; each wrapped, non-fatal, dynamic-require to avoid cycles)
- `onShotLogged(shot)` — update `bag[club]` carry + dispersion when a *real*
  distance exists (windowed/rolling; cap samples).
- `onSwingAnalyzed(analysis)` — roll `tendencies` (dominant fault).
- `onRoundEnded(round)` — update `courses[id].holes` outcomes + `typical*`,
  bump `rounds_played`; optional **Anthropic reflection pass** → `Reflection`.
- `onCoachNote / onFeel` — update `preferences`.

### Safety
- `persist` with `version` + `migrate` (seed empty on miss; never throws on hydrate).
- **Bounded growth:** cap reflections (10), notes/course, rolling sample windows.
- No reads wired yet in Phase 1 → zero behavior change. Memory just accumulates.

---

## Phase 2 — Retrieval layer  (`services/caddieMemoryRetrieval.ts`, NEW)

ONE pure, **sync, never-throwing** function that returns the relevant slice —
replacing the scattered, throw-prone context assembly in `useKevin` /
`useVoiceCaddie` (the exact source of "Hit a snag", 413s, and nulls).

```
getCaddieContext({ playerId, courseId?, hole?, club?, situation? }): CaddieContext

CaddieContext {
  promptBlock: string          // tight newline string the brain pastes verbatim
  bag: ClubModel[]             // only clubs with real data
  course: { name, hole, par, line, greenBehavior, typicalClub } | null
  tendencies: string | null
  preferences: string | null
  recentReflection: string | null
}
```
- Pulls only the relevant slice (this course, hole ±1, this club, top tendencies)
  → **small payload** (fixes 413), **fast** (sync, no network), **no nulls**
  (typed defaults; `promptBlock` omits empty sections).
- Wrapped so it can NEVER throw — returns an empty-but-valid context on any issue.

### Integration (staged, behind a flag — cannot regress)
1. Land store (Phase 1) + writers. No reads. Ship → memory starts filling.
2. Land `getCaddieContext` + feature flag `CNS_RETRIEVAL` (default OFF). Ship.
3. Brain calls `getCaddieContext().promptBlock` as a unified context block when
   the flag is ON; the existing ad-hoc builders remain the **fallback** (so an
   empty/new memory still has live context). Validate in dev → default ON.
4. (Phase 3+) learning/reflection loop + signal-independence (answer from
   course memory when GPS/network is weak) — later.

### Why it meets the constraints
- **Doesn't break:** additive files + flag; existing paths untouched until flipped;
  empty memory degrades to current behavior.
- **Speeds up / fewer nulls:** one null-safe sync slice replaces 8 throw-prone
  builders + a big payload → smaller, faster brain calls.
- **Grows over time:** writers accumulate each shot/round; the per-course model
  fills in, enabling signal-independence on repeat courses.

### Telemetry
- Owner-logs snapshot of what's learned per player/course, so growth is visible.
