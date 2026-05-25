# 01 — Product

## Vision

SmartPlay Caddie is a conversational AI golf companion (Android / iOS, Expo / React Native). It blends a four-character caddie team, GPS-based shot detection, vision-based swing analysis, course imagery, and tools for practice + on-course play.

The differentiator over conventional rangefinder + scoring apps is **personality and presence**: a caddie that talks to you, learns you, and adapts to context — pre-round, mid-round, between shots, on the range, in the cage. Behavior across surfaces is unified by **honesty-as-differentiator**: every number we surface is tagged with its source and confidence, and we'd rather say "I don't know yet" than print a fake-precision answer.

The competitive frame is **GolfFix and Golfshot in one shell**. GolfFix is the structured-fault swing coach (primary fault + cause + fix + drill + evidence); Golfshot is the on-course satellite-imagery yardage tool. We do both, plus a conversational caddie those two don't have, and we do the swing-coach piece without GolfFix's pose-detection hardware bar — Anthropic Sonnet 4.6 vision reads the swing video, and we surface the structured GolfFix-shaped output.

---

## Three pillars

The app is organized around three pillars, each with its own surfaces, primary caddie register, and verification path:

| Pillar | Surfaces | Primary register | Verify path |
|---|---|---|---|
| **ROUND** | Play tab, Caddie tab, Scorecard, Hole View, Cockpit, SmartFinder, SmartVision | Caddie (tactical, in-the-moment) | Path 2 |
| **PRACTICE — SwingLab** | SwingLab tab, Cage Mode, Range Mode, SmartMotion, Quick Record | Coach (instructional, swing-analysis-aware) | Path 3 |
| **PLAY** | Dashboard, Arena drills, Recap, social / sharing | Psychologist (cross-round, observational, regulation) | — |

Path 1 (Onboarding) and Path 4 (Voice / hands-free) cross all three pillars.

---

## The four caddie personas (equal, user-selectable)

From [lib/persona.ts](../../lib/persona.ts):

- **Kevin** — original, balanced, all-around (default for new users)
- **Serena** — analytical, calm, female voice
- **Tank** — Marine vet intensity, clipped cadence, no-BS — scoped to `ask_golf_father` (rule + course-management questions) so the volume matches the character
- **Harry** — Army medic vet wisdom — currently in `ACTIVE_PERSONAS` only when re-enabled in `lib/persona.ts`; assets retained, settings migration v6 maps persisted Harry → Kevin so existing users don't get stuck

### Persona-equality model

The brand line is **"Built by SmartPlay AI"**, never "Built by Kevin" or any single caddie. All four caddies are equal collaborators in the brand identity. UI surfaces that previously elevated Kevin (KevinAvatar, KevinHelpButton, persona-specific welcome copy) have been generalized; the canonical avatar component is now `CaddieAvatar.tsx` and routes through whichever persona the user selected.

Per-pillar assignment lives in [store/settingsStore.ts](../../store/settingsStore.ts) (`caddieAssignments`) so the user can run Tank for cage, Serena for round, and Kevin for play — three-register interpretation (Caddie / Coach / Psychologist) is built into each character spec at [constants/{kevin,serena,tank,harry}Character.ts](../../constants).

---

## Positioning

### Honesty-as-differentiator

Every metric we render carries a source label + a confidence bucket. Examples:
- A pose-derived club-speed reads `~96 mph (pose-estimated, med)` — the `~` prefix, the source tag, and the confidence bucket all surface.
- An acoustic ball-speed off a single-mic impact reads `~148 mph (acoustic, club-typical, med)` — never claimed as truth-grade.
- A measured value from a calibrated source (Galaxy Watch IMU, when wired) drops the `~` and shows `(watch, high)`.
- When confidence is too low to honestly print a number, we render `—` and explain why instead of guessing.

This shows up across the full stack:
- `/api/swing-analysis` returns `primary_fault: 'inconclusive'` or `'no_dominant_fault'` when the vision read genuinely can't conclude, not a default "over-the-top" answer.
- `/api/acoustic-detect` returns `ball_speed_mph: null` (not a faked club-typical number) when the client posts no club.
- `queryStatusHandler` carry-check answers honestly when the player has no driver baseline yet, instead of comparing to a hardcoded 230y.
- The pose skeleton overlay only renders when there's a real keypoint feed; the placeholder is `__DEV__`-gated and never reaches production.

### The GolfFix / Golfshot competitive frame

We deliberately copy the **shape** of what works in each comp, then add the conversational caddie they don't have:

- **GolfFix shape**: structured `primary_fault` + `cause` + `fix` + `drill` + `evidence` (the four fields a coach actually delivers).
- **Golfshot shape**: satellite imagery with F/M/B yardages, hole-by-hole layout view, shot tracking.

Both are conventional product shapes. The differentiation isn't shape — it's:
1. The conversational caddie weaves these into one interface.
2. Honesty bar means we ship fewer fake numbers than either comp.
3. Voice-first hands-free path means the player doesn't have to look at their phone mid-shot.

### Brand lock

- App name: **SmartPlay Caddie**
- Builder line: **Built by SmartPlay AI**
- Social: **@SmartPlayCaddie**
- Support: **support@smartplaycaddie.com**
- No single caddie is "the face." Marketing leads with the four-persona team.
