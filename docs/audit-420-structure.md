# Phase 420 — App Structure Audit

**Audit date:** 2026-05-20  
**Scope:** SmartPlay Caddie Pro production codebase at `/Users/timothyg/Documents/smartplay`

---

## Directory Tree & Metrics

### Root-level structure

```
smartplay/
├── app/              [77 .ts/.tsx files; 36,596 lines] — Expo Router routes & layouts
├── components/       [81 .ts/.tsx files; 15,061 lines] — Reusable UI components
├── services/         [132 .ts/.tsx files; 21,324 lines] — Business logic & integrations
├── store/            [24 .ts/.tsx files; 4,730 lines] — Zustand state stores
├── api/              [30 .ts/.tsx files; 6,319 lines] — API endpoints & handlers
├── hooks/            [9 .ts/.tsx files; 1,588 lines] — Custom React hooks
├── data/             [7 .ts/.tsx files; 1,752 lines] — Seed data & lookups
├── contexts/         [3 .ts/.tsx files; 140 lines] — React Context providers
├── lib/              [2 .ts/.tsx files; 143 lines] — Utility libraries
├── utils/            [2 .ts/.tsx files; 208 lines] — General utilities
├── scripts/          [3 .ts/.tsx files; 895 lines] — Build/CLI scripts
├── types/            [TypeScript definitions]
├── constants/        [Shared constants]
├── styles/           [Theme & style definitions]
├── theme/            [Theme configuration]
├── assets/           [Images, SVGs, etc]
├── __mocks__/        [Jest mock files]
├── docs/             [Audit & research markdown]
└── [config files]    [package.json, eas.json, tsconfig, etc]
```

### Major directory purposes

#### **app/** — Expo Router file-based routing
- **Purpose:** Defines all screen routes and navigation structure. Each `.tsx` file is a route; `_layout.tsx` files define nested stack/tab navigation.
- **Structure:** 
  - `(tabs)/` — Tab-based bottom navigation (caddie, play, dashboard, scorecard, swinglab)
  - `app/index.tsx` — Root entry point (onboarding router)
  - Nested folders for feature domains: `cage/`, `swinglab/`, `recap/`, `round/`, etc.
  - Root-level screens: diagnostic, settings, smartfinder, smartvision, etc.
- **Key observation:** Heavy concentration in single large files (caddie.tsx 3,870 lines); feature screens are nested by folder, creating 8 distinct subdirectories.

#### **components/** — Reusable UI components
- **Purpose:** Shared React component library. Organized by domain (caddie, cage, swinglab, course, recap, etc.).
- **Top-level "god components":** CaddieAvatar (1,090 L), CageSessionOverlay (1,085 L), CaddieDataStrip (509 L).
- **Subdirectories:** 18 category folders (caddie/, cage/, swinglab/, smartvision/, etc.). Each exports domain-specific components.

#### **services/** — Core business logic
- **Purpose:** Non-UI orchestration: GPS, voice, audio, course data, AI, gesture detection, state sync.
- **132 files** across multiple domains: golf logic (course geometry, handicap), AI (voice recognition, vision), hardware (earbud control, media keys), detection (hole detection, movement, walking).
- **Largest services:** conversationalLoggingOrchestrator.ts, poseAnalysisApi.ts, courseGeometryService.ts, recapGenerator.ts.

#### **store/** — Zustand state management
- **Purpose:** Persistent + ephemeral application state. 24 stores total.
- **Key stores:** playerProfileStore, roundStore, settingsStore, cageStore, pointsStore, relationshipStore, ghostStore, trustLevelStore, etc.
- **Pattern:** Each store wraps AsyncStorage for persistence; many use `persist` middleware.

#### **api/** — API route handlers
- **Purpose:** Expo Router API routes (cloud functions). 30 files.
- **Routes:** 
  - `brain+api.ts` — Kevin AI orchestration
  - `cage-review+api.ts` — Cage session summaries
  - `voice+api.ts`, `voice-intent+api.ts` — Voice processing
  - `transcribe+api.ts` — Audio-to-text
  - `parse-shot+api.ts`, `preround+api.ts` — Data parsing
  - `vision+api.ts` — Image analysis
  - `kevin+api.ts` — Kevin endpoint
  - Other smaller endpoints.

#### **hooks/** — Custom React hooks
- **9 files; 1,588 lines.** Reusable hook library.
- **Key hooks:** useVoiceCaddie, useKevin, useCurrentWeather, useVoiceActivityDetection, useRoundState, etc.

#### **contexts/** — React Context providers
- **3 files; 140 lines.** 
- **Providers:** ThemeContext, SmartVisionContext, KevinPresenceContext.

#### **data/** — Seed data & static content
- **7 files; 1,752 lines.**
- **Content:** courses.ts (golf courses), tutorials.ts, drills.ts, etc.

#### **lib/** & **utils/**
- **2 files each; 143 & 208 lines.**
- lib/: Helper utilities (persona library, etc.)
- utils/: General calculation helpers.

#### **scripts/** — Build & CLI utilities
- **3 files; 895 lines.** Mostly diagnostic and setup.

#### **Types, Constants, Styles, Theme, Assets**
- TypeScript definitions, app-wide constants, Tailwind/style configs, theme tokens, image/SVG assets.

---

## File Size Analysis: Top 10 Largest `.ts/.tsx` Files

| Rank | File | Lines | Category | Notes |
|------|------|-------|----------|-------|
| 1 | `app/(tabs)/caddie.tsx` | 3,870 | Route/Screen | **LARGEST COMPONENT** — Caddie home tab, monolithic |
| 2 | `app/settings.tsx` | 1,580 | Route/Screen | Settings UI with multi-section layout |
| 3 | `app/hole-view.tsx` | 1,484 | Route/Screen | Hole visualization & metrics |
| 4 | `app/smartvision.tsx` | 1,351 | Route/Screen | CV-powered shot analysis |
| 5 | `app/smartfinder.tsx` | 1,323 | Route/Screen | GPS/greenside positioning tool |
| 6 | `app/(tabs)/play.tsx` | 1,228 | Route/Screen | Round-in-progress UI |
| 7 | `app/swinglab/smartmotion.tsx` | 1,127 | Route/Screen | Swing capture & analysis |
| 8 | `app/swinglab/cage-drill.tsx` | 1,039 | Route/Screen | Single-swing mode for cage |
| 9 | `app/swinglab/swing/[swing_id].tsx` | 991 | Route/Screen | Swing detail view |
| 10 | `app/smartmotion-quick.tsx` | 954 | Route/Screen | Quick swing capture launcher |

### Component god-components (components/)

| Rank | File | Lines | Notes |
|------|------|-------|-------|
| 1 | `components/CaddieAvatar.tsx` | 1,090 | Avatar animation & voice state |
| 2 | `components/CageSessionOverlay.tsx` | 1,085 | Cage session recording overlay |
| 3 | `components/tools/GlobalToolsMenu.tsx` | 526 | Tools menu modal dispatcher |
| 4 | `components/CaddieDataStrip.tsx` | 509 | Cockpit data display strip |
| 5 | `components/caddie/L1HolePreview.tsx` | 479 | Hole card preview in caddie home |

---

## Structural Issues & Flagged Patterns

### 1. MONOLITHIC SCREENS (Refactoring Debt)

**caddie.tsx (3,870 lines):** Combines Caddie tab home, voice orchestration, round start, greeting overlay, profile menu, Tool menu dispatcher, avatar state machine, golf logic (wind, yardage, penalties, handicap), and more in a single file.

- **Impact:** Hard to test, hard to maintain, high cognitive load.
- **Refactoring opportunity:** Extract avatar logic → component, voice orchestration → hook, golf logic → service, UI sections → child screens.
- **Line spread:** app/(tabs)/caddie.tsx:1–3,870

**Other large screens (1,000+ lines):**
- smartvision.tsx, smartfinder.tsx, play.tsx, hole-view.tsx all mix heavy UI + heavy logic.
- Suggests insufficient extraction to hooks/services.

### 2. ORPHANED/UNREACHABLE ROUTES

The following routes exist but have **no router.push() call** from any other file:

- **app/greeting.tsx** — Entry point for onboarding; called only via `index.tsx` (✓ not orphaned, but a gateway route).
- **app/diagnostic-card.tsx** — **ORPHANED**: No navigation entry; appears to be a component file misplaced in app/ root. Should be in components/.
- **app/hole-view.tsx** — **UNCLEAR**: Large screen but no grep for `/hole-view` in router.push calls. Likely reachable from play.tsx or recap but not explicitly linked via named navigation.
- **app/reference.tsx** — Called from caddie.tsx menu (✓ reachable).
- **app/pattern-debug.tsx** — Called from cage-debug.tsx (✓ reachable, but debug-only).

**Potential misplacements:**
- diagnostic-card.tsx is JSX but appears to be a utility component, not a route screen. File should be in components/ or a specific feature folder.

### 3. DEBUG/TEST ROUTES (Should Be Gated)

The following routes are labeled `*-debug.tsx` or `*-test.tsx` and are **owner-only** or should be restricted for production:

- `app/api-debug.tsx` — API response inspector (owner-only)
- `app/battery-debug.tsx` — Battery monitoring (debug feature)
- `app/cage-debug.tsx` — Cage diagnostics (debug feature) — **876 lines, large**
- `app/ghost-debug.tsx` — Ghost player testing (debug)
- `app/gps-test.tsx` — GPS diagnostic bench (owner-only) — **876 lines, large**
- `app/patterns-debug.tsx` — Pattern detection testing (debug)
- `app/smartfinder-debug.tsx` — Smartfinder diagnostics (debug)
- `app/smartmotion-quick.tsx` — Quick swing mode (semi-debug)
- `app/subscription-debug.tsx` — Subscription testing (debug)
- `app/voice-debug.tsx` — Voice recognition testing (debug)

**Finding:** All are protected behind `isOwnerEmail()` checks in settings or code comments, but the routes themselves are discoverable in app/ (not gated at router level). **Recommendation:** Create a dedicated `app/owner-only/` folder or add route-level gating via `_layout.tsx` middleware.

### 4. DUPLICATE ROUTE/FEATURE CHECK: SwingLab vs. Practice

**Standing decision:** SwingLab and Practice are **ONE feature**, not two. Check for route duplication.

**Finding:** No duplicate routes detected.
- **SwingLab tab** (`app/(tabs)/swinglab.tsx`, 6.5 KB) is a flat launcher (v3-style cards).
- **Cards route to:**
  - `/swinglab/smartmotion` ✓
  - `/swinglab/range` ✓
  - `/drills` ✓
  - `/arena/practice` — **ROUTE DOES NOT EXIST** (see next section)
  - `/swinglab/library` ✓
  - `/acoustic-test` ✓

**All SwingLab feature screens live under `/swinglab/*` or dedicated `/drills`, `/acoustic-test`. No practice-specific route found.**

### 5. MISSING ROUTES: `/arena/practice` (BROKEN LINK)

**Finding:** `app/(tabs)/swinglab.tsx` line 78 routes to `/arena/practice`, but **no `app/arena/` directory exists**.

- **Impact:** Tapping "Arena" card results in route-not-found error.
- **File:** app/(tabs)/swinglab.tsx:78
- **Severity:** BLOCKING — user-facing broken link

**Probable intent:** Arena is a future feature (range practice, tempo trainer, putting clock per the sub-copy). The route should be commented out, replaced with a coming-soon screen, or the feature should be implemented.

### 6. DEBUG ROUTE: `/acoustic-test` (Production Route, But Debug-adjacent)

- **File:** app/acoustic-test.tsx (52 KB)
- **Finding:** This is a full user-facing feature (validate acoustic detection pipeline at range), not a debug route, but it's named like one.
- **Status:** ✓ Correctly reachable from SwingLab tab → Acoustic Test Bench card.

### 7. STRAY FILES IN APP ROOT

The following files are in app/ root but appear to be component files, not routes:

- **app/diagnostic-card.tsx** — Should be in components/ (likely a reusable diagnostic UI component).
- **app/greeting.tsx** — ✓ Correct placement (onboarding gateway).
- **app/mark-green.tsx** — Green marking tool; reachable from play? Unclear. May be orphaned or misplaced.
- **app/landmark-curate.tsx** — Landmark curation UI; unclear reachability.
- **app/lie-analysis.tsx** — Lie analysis screen; unclear if routable.

### 8. CAGE-REVIEW ROUTES: Parallel to Cage?

Two cage-related folders exist:

- **app/cage/** — Cage Mode (multi-swing session recording)
  - index.tsx (session list)
  - session.tsx (active session)
  - summary.tsx (post-session review)
  - history.tsx (past sessions)
  - _layout.tsx (stack)

- **app/cage-review/** — Cage Review (post-session analytics)
  - start.tsx (enter review)
  - summary.tsx (analytics display)
  - [review_session_id].tsx (detail view)
  - _layout.tsx (stack)

**Finding:** These are distinct workflows, not duplicates. Cage = recording, Cage-Review = analysis. ✓ Correct separation.

---

## Summary of Structural Observations

| Category | Count | Status |
|----------|-------|--------|
| **Total routes** | 77 | ✓ Reasonable scope |
| **Monolithic screens (>1000 L)** | 10 | ⚠️ Refactoring debt |
| **Debug routes** | 9 | ⚠️ Needs gating |
| **Orphaned routes** | 2 | ⚠️ Diagnostic-card.tsx, others unclear |
| **Broken routes** | 1 | 🔴 /arena/practice missing |
| **Duplicate features** | 0 | ✓ Clean |
| **Components (root level)** | 81 | ✓ Well-organized |
| **Services** | 132 | ✓ Extensive business logic |
| **Stores** | 24 | ✓ Comprehensive state |

---

## Recommendations (Phase 420 Findings Only)

1. **Implement arena/practice route or remove card** — Currently broken user-facing link.
2. **Move diagnostic-card.tsx to components/** — Misplaced component file.
3. **Create app/owner-only/ folder or add _layout.tsx gating** — Consolidate all debug routes to reduce namespace pollution.
4. **Extract caddie.tsx logic** — Split 3,870 lines into avatar (component), voice (hook), and UI sections for testability.
5. **Document orphaned routes (mark-green, lie-analysis, landmark-curate)** — Clarify reachability or remove.

---

**Audit owner:** Phase 420  
**Next audit:** Recommended after arena/practice implementation and debug route consolidation.
