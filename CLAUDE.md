# SmartPlay Caddie — Project Conventions

## Critical Path Verification Gates (Phase AO)

The four end-to-end paths defined in [docs/critical-paths.md](docs/critical-paths.md)
gate every future phase. Before a phase that touches one of these paths is
declared shipped:

1. **The phase response must explicitly state** which critical path(s) the
   phase touches.
2. **The phase response must state expected behavior** per touched path.
3. **Tim verifies** the path works end-to-end on the dev-client before
   declaring the phase confirmed shipped.
4. **If the verification fails**, the phase is *not shipped* — it's pending
   targeted fix. Fix is scoped to the failure (not bundled with other work).
   Re-verify after fix. Only then proceed with other phase work.

The four paths:
- **PATH 1 ONBOARD** — cold install → onboarding → Caddie home with profile
- **PATH 2 ROUND** — open app → find course → start round → log shots → end → recap
- **PATH 3 CAGE** — SwingLab → Cage Mode setup → record → analysis → drill
- **PATH 4 VOICE** — earbud/badge tap → Kevin engages → response → continuation/close

Each path has path-specific log markers (`[path1:onboard]`, `[path2:round]`,
`[path3:cage]`, `[path4:voice]`) instrumented at flow boundaries, plus
existing `[V6-DIAG]` and `[ttfa]` lines for finer detail. Tim greps logcat
on the path marker during the MIN VERIFY scenario for that path.

External beta-readiness requires all four paths verified working end-to-end
on a real device within the last 7 days, on a real round (not just simulated).
Until that's true: internal personal beta only.

## Phase report format

When shipping a phase, include in the response:
- Commit SHA
- Per-component what shipped
- Honest scope notes for anything *not* shipped
- **Critical paths touched** (Path 1 / 2 / 3 / 4 / none)
- **Expected behavior** per touched path (what Tim should see in MIN VERIFY)

## Commit conventions

- Phase commits use the format `Phase XX - <one-line summary>` then a
  paragraph body explaining intent and any honest scope notes.
- Co-author trailer required.
- Never `--no-verify`, never amend a published commit.

## Dev environment notes

- Platform: Windows + PowerShell. Use POSIX paths in tools when possible.
- Bash tool available for git/npm; prefer dedicated tools (Read/Edit/Grep/Glob) elsewhere.
- TypeScript strict mode. `npx tsc --noEmit` and `npx expo lint` must pass before commit.
- Build path: `eas build --profile development --platform android`.

## Feature naming

- **TightLie** (Phase AS) — user-facing brand for the lie analysis camera
  flow ("Phase H" internally). Voice triggers: "open TightLie", "check my
  lie", "what's the play", "analyze my lie", "tight lie". Internal names
  (route `/lie-analysis`, API `/api/lie-analysis`, intent
  `tool_name: 'lie_analysis'`) are unchanged for back-compat. The
  `tool_name: 'tightlie'` alias also routes to the same flow.
- **GolfFather** (1.x+ deferred concept, not built) — broader strategic
  course-management AI: multi-shot planning, hole strategy from tee,
  what-now post-shot guidance. TightLie answers "what's this shot";
  GolfFather would answer "what's my game plan." Don't build it. The
  name is reserved for the evolution path.

## Locked elements (Phase AU)

Some UI elements are **canonically locked** — their layout was approved at a
specific commit and any divergence is a regression, not an improvement. Phases
that touch surfaces containing locked elements MUST verify the locked element
is unchanged before reporting the phase complete.

### Kevin photoreal portrait — LOCKED
- **Canonical reference**: commit `19165fb` (2026-04-26 12:43 PDT — "Fix
  Caddie screen: avatar framing, greeting bubble position, safe area").
- **Container** (`app/(tabs)/caddie.tsx`, L4 trustLevel block):
  `{ position: 'absolute', top: 0, left: 0, width: W, height: avatarFrameHeight }`
  where `avatarFrameHeight = Math.round(W * 16 / 9)`. Single rule for every
  aspect (Fold closed, Fold open, standard phones). NO aspect-ratio branches,
  NO `top: -70` nudges, NO `insets.top + N` anchors.
- **Render** (`components/CaddieAvatar.tsx`): plain cover-mode crossfade,
  transforms = breath + nod + drift only. NO static scale, translate, or
  per-portrait recompose pipeline. Composition is controlled entirely by the
  parent container's frame size — not by transforms inside CaddieAvatar.
- **If Kevin appears off-center on a new device**: audit the parent container
  in `caddie.tsx` (frame size, position). DO NOT add transforms in
  CaddieAvatar to compensate. Move the OTHER element, not Kevin.
- **Drift cause history**: Phase AT iteratively added a recompose pipeline
  (`PORTRAIT_OFFSET_F`, `baseShiftFraction`, `kevinShiftFraction`,
  `kevinShiftYFraction`, `kevinScaleMul`, `PORTRAIT_EXTRA_SHIFT`) that
  drifted Kevin user-left on Fold open and clipped his hat. Removed in
  Phase AU.
- **Phase completion checklist for any Caddie-home work**:
  - [ ] Kevin's container in `caddie.tsx` matches canonical (single rule, no
        aspect branches)
  - [ ] CaddieAvatar transforms unchanged (breath/nod/drift only)
  - [ ] Kevin renders identically on Fold closed, Fold open, standard phones
  - [ ] Kevin position consistent across L1/L2/L3/L4 trust levels and
        round-active vs idle

## Honest scope discipline

- Don't add features beyond what the phase requires.
- Don't write tests, error handling, or fallbacks for scenarios that can't happen.
- Don't add comments unless the *why* is non-obvious.
- Trust internal code; only validate at system boundaries.
- When something can't be shipped honestly in the available time, *say so explicitly*
  in the phase response and scope a follow-up — don't fake completion.
