# Phase AZ — Deep Persona Simulation Audit (Methodology)

**Status**: Framework ready. Simulation execution PENDING (Tim runs).
**Renamed from prompt's "Phase AW"** — AW already used this session for
Palms/Lakes data cleanup (commit `c7a0136`).

## Why simulation, not feature checking

Phase AX verifies functions work empirically (does the feature do what it
says?). Phase AZ verifies the **product holds together for the actual
golfers who will use it**. Scenario-based testing catches "does feature X
work?" Persona simulation catches "does the product serve this golfer's
actual needs across all features?"

A feature can technically work but be wrong for the user. Example:
pre-round briefing technically plays through, but its content is generic
when it should be personalized for the persona. AX would PASS this. AZ
would FAIL it because it doesn't serve the persona.

This is **harder testing because it requires empathy and product judgment**,
not just empirical checking. Tim runs simulations imagining each persona's
actual context, needs, frustrations, motivations.

## Operating principle

> **"Would this user genuinely benefit from this experience as it currently
> delivers?"** is the question, not "does the feature function."

## The four personas

1. **Marcus** ([marcus-improver.md](personas/marcus-improver.md)) —
   mid-handicap, serious about improvement, cage + rounds equally
2. **Dave** ([dave-weekend-warrior.md](personas/dave-weekend-warrior.md)) —
   high handicap, casual, mostly in-round caddie use
3. **Sarah** ([sarah-competitive.md](personas/sarah-competitive.md)) —
   low handicap, scoring-focused, demands precision
4. **James** ([james-returning.md](personas/james-returning.md)) —
   variable, coming back to game, needs welcoming flow

## Simulation methodology

For each persona, Tim runs through:

### Day 1: Onboarding + first round (~45-60 min)
- Fresh install simulation (or onboarding reset)
- Walk through each onboarding screen as that persona would
  - Does it feel right? Pacing OK?
  - Does Kevin's introduction land for this persona?
  - Does Trust Spectrum explanation match what this user wants?
- Simulate first round as persona
  - Do features serve this user?
  - Are the right things accessible?
  - Is Kevin's voice register appropriate?

### Day 2-3: Cage practice (or not, per persona)
- Marcus + James (cage users): simulate cage session, evaluate Phase K
  analysis quality from persona's needs perspective
- Dave + Sarah (not cage primary): note absence of cage doesn't hurt them
  (or does it cause friction by being prominently visible?)
- Drill library exploration

### Day 4-7: Multiple rounds + cage
- Persistent context starts mattering
- Pattern detection emerges
- Recap quality across sessions
- Multi-round trends

### Week 2-4: Power use
- All features explored
- Edge cases hit
- Stats accumulate
- Trust deepens or erodes

For each phase, capture:
- Does the product serve this persona at this stage?
- What would frustrate this persona right now?
- What would delight this persona right now?
- What's missing that this persona expected?

## Per-feature evaluation rubric

Each persona gets evaluation across 10 dimensions:

| Dimension | What it measures |
|---|---|
| **Onboarding** | Welcomes this persona appropriately? |
| **First round** | Gets them productive immediately? |
| **Voice flow** | Matches their preferred mode and pacing? |
| **Cage / practice** | If relevant, serves their needs? Or stays out of the way? |
| **Round flow** | In-round experience matches their expectations? |
| **TightLie** | Lie analysis useful for their game level? |
| **Stats / scorecard** | Data they care about, presented appropriately? |
| **Recap** | Post-round content matches their needs? |
| **Persistent context** | Kevin gets smarter about them over time? |
| **Conversation feel** | Voice flow feels natural for their style? |

### Score each dimension

- **SERVES WELL** — clearly delivers value for this persona
- **SERVES OK** — works but could be better for this persona
- **SERVES POORLY** — technically functions but doesn't really serve them
- **BROKEN** — foundation issue affects this persona's experience

## Per-persona overall verdict

After all dimensions scored:

- **READY** — product genuinely serves this persona at v1.0 quality
- **ACCEPTABLE** — works but rough edges that won't lose them
- **AT RISK** — significant gaps that will frustrate this persona
- **BROKEN FOR THIS PERSONA** — foundation issues prevent productive use

## Beta-launch criteria

For external beta launch, target = all four personas READY or ACCEPTABLE.
- Any **AT RISK** → needs scoping before launch
- Any **BROKEN** → that persona can't be in beta until fixed

## Cross-persona pattern analysis

After per-persona scores, identify:

- **Universal failures** — broken across all personas (highest priority fix)
- **Persona-specific failures** — broken for one persona but fine for others
  (decide if v1.0 must serve that persona or defer)
- **Persona conflicts** — features that serve one persona but harm another
  (architectural decisions needed)
- **Universal wins** — working well across all personas (keep, don't mess with)

## Time investment per persona

| Activity | Time |
|---|---|
| Onboarding simulation | 15-20 min |
| Day 1 round simulation (real or simGPS) | 30-45 min |
| Cage simulation (if applicable) | 20-30 min |
| Multi-round / power-use mental simulation | 30-45 min |
| Per-persona evaluation writeup | 20-30 min |
| **Total per persona** | **~2 hours** |
| **Total all four** | **~8 hours** |

Splitting across 2-3 days is reasonable. Deeper than scenario testing but
more revealing.

## Output documents

After simulation:
- Each `docs/personas/<persona>.md` updated with per-feature scores + verdict
- `docs/audit-AZ-results.md` — consolidated cross-persona findings
- Phase queue updated with refinement priorities (in this file's "Refinement
  Priorities" section once Tim has run the simulation)

## Refinement priorities (PENDING SIMULATION)

To be filled in after Tim completes the simulation runs. Format:

```
PRIORITY 1 — [issue affecting all/most personas]
  Affected personas: [list]
  Severity: BROKEN / AT RISK / SERVES POORLY
  Root cause hypothesis: [what's actually wrong]
  Fix scope: [new phase ID or queued phase reference]
```
