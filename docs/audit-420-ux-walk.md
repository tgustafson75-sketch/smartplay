# Phase 420 — Intuitive-UX Walk

**Date:** 2026-05-20  
**Method:** Cold-launch walk through the app as a fresh tester, tracing the actual code paths in [app/index.tsx](../app/index.tsx), [app/welcome.tsx](../app/welcome.tsx), [app/(tabs)/_layout.tsx](../app/(tabs)/_layout.tsx), [app/(tabs)/caddie.tsx](../app/(tabs)/caddie.tsx), and the SwingLab routes already audited in [audit-420-routes.md](audit-420-routes.md). No assumptions — every observation cites a file path.

## Cold-launch flow

### 1. App entry → routing decision
[app/index.tsx:21-49](../app/index.tsx#L21-L49) — blocks on AsyncStorage hydration of BOTH `usePlayerProfileStore` AND `useSettingsStore`. **Good** — the comment block correctly notes that not gating on hydration causes a flash-of-default-Kevin and a double-redirect IOException.

Routing branches:
- `first_opened_at == null` AND `name == ''` → `/welcome`
- `kevinGreetingEnabled` AND first launch this process → `/greeting`
- Else → `/(tabs)/caddie`

**Honest call:** the hydration gate is solid; the routing decision is the cleanest part of the launch path.

### 2. Welcome screen ([app/welcome.tsx](../app/welcome.tsx))
- 241 lines, single screen, three fields: name / caddie pick / handicap. All skippable. **Good** — Tim's "get rid of the multi-step onboarding nonsense" directive is honoured.
- Caddie pick shows 4 cards (Kevin/Tank/Serena/Harry) with one-line blurbs. **Good UX.**
- "Get Started" → `/(tabs)/caddie`. **Clean.**
- Quibble: the screen header says "PHASE 410" in the source comment block but no visible app-level "Phase X" markers leak to the user. **OK.**

### 3. Greeting screen (optional, [app/greeting.tsx](../app/greeting.tsx))
Intro spoken greeting from the chosen caddie. Skippable via toggle.

### 4. Tab landing → Caddie tab
[app/(tabs)/_layout.tsx](../app/(tabs)/_layout.tsx) defines 5 tabs:

| Position | Tab        | Icon                                        | Purpose                          |
|----------|------------|---------------------------------------------|----------------------------------|
| 1        | Caddie     | Brand-badge silhouette                      | Home, voice caddie, start round  |
| 2        | Play       | golf-outline / golf                         | Course discovery (NOT 1.1 PLAY)  |
| 3        | Scorecard  | list-outline / list (live dot when active)  | Hole-by-hole score entry         |
| 4        | SwingLab   | bullseye-arrow (MCI)                        | Practice launcher                |
| 5        | Dashboard  | stats-chart-outline / stats-chart           | Round / shot analytics           |

**Bottom-tab pattern is solid** — Phase AE comment in the file documents the restoration of the tab bar across all routes. Icons are distinct (the "Play and SwingLab both used 'golf'" issue is fixed).

**Naming concern — UX confusion:** the **Play** tab is course discovery, not the 1.1 "PLAY" pillar. A fresh user reading "Play" expects to hit a button and play a round. The actual round-start CTA lives on the **Caddie** tab. The Caddie+Play split is non-obvious from the labels alone.

## Header / chrome consistency

[components/brand/BrandHeaderRow.tsx:43-99](../components/brand/BrandHeaderRow.tsx#L43-L99) is the canonical header. Every tab except Caddie should render it via `<BrandHeaderRow />`, which includes the ••• Tools pill (top-right) that opens the same GlobalToolsMenu.

Caddie tab passes `hideToolsPill` because it has its own anchored ••• in the top-right corner of the home screen (see [app/(tabs)/caddie.tsx:1966](../app/(tabs)/caddie.tsx#L1966)).

**Consistency check:**
- Caddie: ✅ own ••• in upper-right corner
- Play: ✅ uses BrandHeaderRow (verified in [app/(tabs)/play.tsx](../app/(tabs)/play.tsx))
- Scorecard: ✅ uses BrandHeaderRow
- SwingLab: ✅ uses BrandHeaderRow (line 104)
- Dashboard: ✅ uses BrandHeaderRow

**Verdict:** the canonical ••• pattern is intact across all five tabs.

## Pre-round Tools FAB (Caddie tab)
After this turn's edit, the pre-round Caddie tab now shows a small green chevron-back FAB on the right side at the bottom ([app/(tabs)/caddie.tsx:2463-2533](../app/(tabs)/caddie.tsx#L2463-L2533)). Tapping expands a row of tool icons (SmartMotion / Range / Drills / Library / All Tools) to the left.

**UX quibble:** this is THIRD distinct entry point for tools on the Caddie tab:
1. ••• in top-right corner (canonical)
2. Persistent dropdown chip (where present)
3. Pre-round expanding FAB (this turn)

The FAB only shows pre-round, which mitigates conflict — but a new user sees both ••• and the FAB and doesn't know which is "the" tool menu. **Add label or remove one.**

## First-round path

Cold tester taps Caddie tab → sees the avatar + brand bubble. To start a round, they need to:
1. Tap the green pre-round CTA (Start Round) — visible per [app/(tabs)/caddie.tsx:2513+](../app/(tabs)/caddie.tsx#L2513)
2. Course Picker opens
3. Pick a course → round starts → caddie speaks

**Cracks:**
- **`/arena/practice` is broken.** The SwingLab launcher card ([app/(tabs)/swinglab.tsx:78](../app/(tabs)/swinglab.tsx#L78)) routes to `/arena/practice` but `app/arena/` does not exist. This is a **user-visible 404** that any tester tapping the Arena card on the SwingLab tab will hit. **LAUNCH BLOCKER.**
- The Range Mode card ([app/(tabs)/swinglab.tsx:65](../app/(tabs)/swinglab.tsx#L65)) routes to `/swinglab/range`. Confirm this file exists — based on the routes audit, it may also be missing.

## First-practice path

SwingLab tab → 6 cards:
1. SmartMotion → `/swinglab/smartmotion` (works, just refactored in Phase 416/418)
2. Range Mode → `/swinglab/range` (**likely missing — verify**)
3. Drills → `/drills` (works)
4. Arena → `/arena/practice` (**BROKEN**)
5. Swing Library → `/swinglab/library`
6. Acoustic Test Bench → `/acoustic-test` (debug surface, should be gated for non-owners)

**Tap SmartMotion:** lands on the redesigned two-card view. Empty state (no clipUri) shows NoClipHero with "Ready when you are. Tap Record." — clean. Tap Record → `/swinglab/quick-record` → camera opens directly. After recording, returns to SmartMotion with the clip and analysis. Phase 418 validation gate now correctly suppresses fake skeleton/metrics on no-swing footage and shows framing tips + retake CTA. **Wired correctly post-Phase-418.**

## Dead-ends / surprises

1. **`/arena/practice` 404** — top priority, see above.
2. **`/acoustic-test`, `/gps-test`, `/api-debug`, `/battery-debug`, `/cage-debug`, `/ghost-debug`, `/patterns-debug`, `/plan-debug`, `/smartfinder-debug`, `/subscription-debug`** — 10 debug surfaces accessible to any user (no `isOwnerEmail()` consistent gate at the route level). Per [audit-420-routes.md](audit-420-routes.md), most are gated only on a check inside the Tools menu. Owner-only routes should sit behind a single gate in [app/_layout.tsx](../app/_layout.tsx) for the launch build.
3. **Two SmartMotion screens.** [app/smartmotion-quick.tsx](../app/smartmotion-quick.tsx) (954 lines) still exists alongside [app/swinglab/smartmotion.tsx](../app/swinglab/smartmotion.tsx). Per [audit-420-duplication.md](audit-420-duplication.md), three entry points still route to the older one (voice-intent, GlobalToolsMenu, Library). If a tester opens via "open SmartMotion" voice command they get a different UI than if they tap the SwingLab card. **User-visible drift.**
4. **Tools FAB vs ••• pill on Caddie tab.** New users won't know they're the same menu.
5. **End-Round crash** — flagged in the prior session summary ("Maximum update depth exceeded") and **never resolved.** Hitting End Round may crash mid-test. Unverified on the most recent bundle.

## Labels / hints / empty-states needing work

| Where                               | What's missing                                                         |
|-------------------------------------|-----------------------------------------------------------------------|
| `/arena/practice` (broken)          | Doesn't exist — see blocker above.                                    |
| `/swinglab/range`                   | Reportedly missing per routes audit — verify; if missing, add or hide. |
| Caddie tab ••• vs FAB               | One needs a label distinguishing them, or one should be removed.       |
| Debug routes                        | Need a single gating layer, not scattered `isOwnerEmail()` checks.    |
| Swing Library when empty            | Verify empty-state copy is honest ("no swings yet, record one").       |
| SmartMotion Tag Club                | `onTagClub={/* TODO: club tag sheet */}` — dead button. Either wire or hide. |
| Compare button                      | "Compare" in BottomBar of smartmotion — what does it compare? UX unclear. |
| Insight Card "View Full Data"        | No `onPress` — pure placeholder. Remove or wire.                       |

## Verdict — UX walk

**Top blockers for a tester walking the app cold:**
1. **`/arena/practice` 404** on SwingLab → Arena card (any tester finds this in <60s).
2. **Two SmartMotion UIs** depending on entry point — feels broken even when both "work."
3. **End-Round crash** unverified post-most-recent-bundle.
4. **Debug routes ungated** for owner-only.
5. **Tag Club / Compare / View Full Data** are placeholder buttons that LOOK functional.

The header chrome (BrandHeaderRow + ••• pill) is the cleanest part of the UX — consistent across all five tabs. The tab bar (5 tabs, distinct icons, restored everywhere) is also solid. The breakdown is at the card → screen junction, where stale routes and placeholder buttons set a tester up to think something's broken even when the underlying tool works.
