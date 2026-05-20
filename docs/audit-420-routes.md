# Phase 420 — Routes & Navigation Audit

**Audit date:** 2026-05-20  
**Scope:** Expo Router routes in `/app/` (77 route files). Reachability analysis via grep of `router.push()`, `href=`, and `<Link>` calls.

---

## Routing Architecture Overview

### Tab-based navigation

**Root:** `app/(tabs)/_layout.tsx`  
**5 tabs:**

| Tab | File | Route URL | Status |
|-----|------|-----------|--------|
| Caddie | `app/(tabs)/caddie.tsx` | `/(tabs)/caddie` | ✓ Home hub |
| Play | `app/(tabs)/play.tsx` | `/(tabs)/play` | ✓ Round in progress |
| Dashboard | `app/(tabs)/dashboard.tsx` | `/(tabs)/dashboard` | ✓ Stats & history |
| Scorecard | `app/(tabs)/scorecard.tsx` | `/(tabs)/scorecard` | ✓ Scorecard view |
| SwingLab | `app/(tabs)/swinglab.tsx` | `/(tabs)/swinglab` | ✓ Practice launcher |

### Modal/Stack routes

All non-tab screens are modals or stacks, opened via `router.push()` from tab screens or other routes.

---

## Comprehensive Route Enumeration

### 1. Root Entry Point

| Route | File | Reachability | Rendered | Notes |
|-------|------|--------------|----------|-------|
| `/` | `app/index.tsx` | App launch (initial render) | Route gateway | Hydration guard; redirects to `/greeting` or `/(tabs)/caddie` based on setup state |

### 2. Onboarding Routes

| Route | File | Reachability | Rendered | Notes |
|-------|------|--------------|----------|-------|
| `/greeting` | `app/greeting.tsx` | Cold launch (index.tsx line 67) | Caddie persona intro | One-time greeting; voice/animation per persona |
| `/quick-start` | `app/quick-start.tsx` | Manual deep link (or auth flow?) | Onboarding walkthrough | Copies some content from old Pro QuickStart; reachability unclear |
| `/welcome` | `app/welcome.tsx` | Unclear | Welcome splash? | Unclear purpose; may be deprecated |
| `/intro-video` | `app/intro-video.tsx` | Unclear | Video intro | Unclear reachability; likely onboarding or tutorial |
| `/permissions` | `app/permissions.tsx` | Manual deep link or app boot | Permissions request UI | Reachable from _layout.tsx or manual trigger |

### 3. Caddie Tab Routes (Caddie Home & Tools)

**Parent:** `app/(tabs)/caddie.tsx` (3,870 lines)

| Route | File | Called From | Rendered | Notes |
|-------|------|-------------|----------|-------|
| `/(tabs)/caddie` | `app/(tabs)/caddie.tsx` | Tab press | Caddie home + avatar voice control | Hub for round start, profile, tools menu, greeter |
| `/settings` | `app/settings.tsx` | caddie.tsx:1534 (More menu → Settings) | Settings UI (1,580 L) | Reachable from caddie home menu |
| `/reference` | `app/reference.tsx` | caddie.tsx:1520 (More menu → Quick ref) | Rules & handicap reference | Reachable from caddie home menu |
| `/profile/custom-caddie` | `app/profile/custom-caddie.tsx` | caddie.tsx (persona picker) | Persona customization | Reachable from caddie home profile section |
| `/owner-logs` | `app/owner-logs.tsx` | Unknown | Owner diagnostic logs | ⚠️ **ORPHANED**: No grep for `/owner-logs` in router calls |

### 4. Round Start & Pre-Round

| Route | File | Called From | Rendered | Notes |
|-------|------|-------------|----------|-------|
| `/round/briefing` | `app/round/briefing.tsx` | caddie.tsx (start round) | Pre-round brief with hole/score setup | Part of round-start flow |

### 5. Play Tab Routes (Round In Progress)

**Parent:** `app/(tabs)/play.tsx` (1,228 lines)

| Route | File | Called From | Rendered | Notes |
|-------|------|-------------|----------|-------|
| `/(tabs)/play` | `app/(tabs)/play.tsx` | Tab press (during round) | Round cockpit UI | Shot log, caddie data, scoreboard |
| `/smartfinder` | `app/smartfinder.tsx` | play.tsx (when round active) | GPS-based greenside finder (1,323 L) | Reachable from play tab |
| `/smartvision` | `app/smartvision.tsx` | play.tsx (camera button) | Computer vision shot analysis (1,351 L) | Reachable from play tab |
| `/hole-view` | `app/hole-view.tsx` | play.tsx or recap? (unclear) | Hole metrics & visualization (1,484 L) | ⚠️ **ORPHANED**: No explicit `router.push('/hole-view')` found |
| `/lie-analysis` | `app/lie-analysis.tsx` | Unknown | Lie analysis UI | ⚠️ **ORPHANED**: No grep found; may be dead code |
| `/mark-green` | `app/mark-green.tsx` | play.tsx? (unclear) | Manual greenside mark tool | ⚠️ **ORPHANED**: No explicit router.push found |
| `/smartmotion-quick` | `app/smartmotion-quick.tsx` | play.tsx? (unclear) | Quick swing capture (954 L) | May be reachable from play tab; unclear exact entry |
| `/smartfinder-debug` | `app/smartfinder-debug.tsx` | settings.tsx (owner tools) | SmartFinder diagnostics | Debug-only; reachable from owner settings |
| `/gps-test` | `app/gps-test.tsx` | settings.tsx (owner tools) | GPS diagnostic bench (876 L) | Debug-only; reachable from owner settings; owner-only |
| `/ghost-debug` | `app/ghost-debug.tsx` | Unknown | Ghost player testing | ⚠️ **ORPHANED**: No grep for `/ghost-debug` in router calls |

### 6. Dashboard Tab Routes

**Parent:** `app/(tabs)/dashboard.tsx` (869 lines)

| Route | File | Called From | Rendered | Notes |
|-------|------|-------------|----------|-------|
| `/(tabs)/dashboard` | `app/(tabs)/dashboard.tsx` | Tab press | Dashboard home (stats, trends) | History & analytics hub |
| `/recap/[round_id]` | `app/recap/[round_id].tsx` | dashboard.tsx (round history tap) | Round recap detail | Dynamic route parameter |
| `/recap/hole/[round_id]/[hole]` | `app/recap/hole/[round_id]/[hole].tsx` | recap.tsx (hole tap) | Hole detail in round recap | Nested dynamic route |
| `/course/[course_id]` | `app/course/[course_id].tsx` | dashboard.tsx? (course lookup) | Course detail view | Dynamic route; reachability unclear |

### 7. Scorecard Tab Routes

**Parent:** `app/(tabs)/scorecard.tsx` (772 lines; ~35 KB on disk)

| Route | File | Called From | Rendered | Notes |
|-------|------|-------------|----------|-------|
| `/(tabs)/scorecard` | `app/(tabs)/scorecard.tsx` | Tab press | Scorecard editor & display | Scoreboard UI; 772 lines (size note: ~35 KB on disk) |

### 8. SwingLab Tab Routes (Practice Launcher)

**Parent:** `app/(tabs)/swinglab.tsx` (6.5 KB)

| Route | File | Called From | Rendered | Notes |
|-------|------|-------------|----------|-------|
| `/(tabs)/swinglab` | `app/(tabs)/swinglab.tsx` | Tab press | SwingLab launcher (v3-style cards) | 6 cards: SmartMotion, Range, Drills, Arena, Library, Acoustic |
| `/swinglab/smartmotion` | `app/swinglab/smartmotion.tsx` | swinglab.tsx card (SmartMotion) | AI swing analysis (1,127 L) | ✓ Reachable from launcher |
| `/swinglab/range` | `app/swinglab/range.tsx` | swinglab.tsx card (Range Mode) | Multi-shot session UI | ✓ Reachable from launcher |
| `/swinglab/cage-drill` | `app/swinglab/cage-drill.tsx` | smartmotion.tsx, or direct? | Single-swing cage mode (1,039 L) | Reachable from smartmotion |
| `/swinglab/library` | `app/swinglab/library.tsx` | swinglab.tsx card (Library) | Swing library viewer | ✓ Reachable from launcher |
| `/swinglab/quick-record` | `app/swinglab/quick-record.tsx` | Unknown | Quick recording UI | ⚠️ **ORPHANED**: No grep for router.push; may be dead |
| `/swinglab/upload` | `app/swinglab/upload.tsx` | library.tsx (add swing) | Swing upload from camera roll | Reachable from library |
| `/swinglab/tutorial-upload` | `app/swinglab/tutorial-upload.tsx` | tutorial.tsx? (unclear) | Tutorial swing upload | Unclear reachability |
| `/swinglab/tutorials` | `app/swinglab/tutorials.tsx` | tutorial card? (unclear) | Tutorial library (master list) | Unclear exact entry point |
| `/swinglab/tutorial/[id]` | `app/swinglab/tutorial/[id].tsx` | tutorials.tsx (tutorial tap) | Tutorial detail with practice toggle | Dynamic route |
| `/swinglab/swing/[swing_id]` | `app/swinglab/swing/[swing_id].tsx` | library.tsx (swing tap) | Swing detail & metrics (991 L) | Dynamic route; reachable from library |
| `/swinglab/camera-setup` | `app/swinglab/camera-setup.tsx` | smartmotion.tsx (setup step) | Camera & permission setup | Reachable from smartmotion flow |
| `/swinglab/space-scan` | `app/swinglab/space-scan.tsx` | camera-setup.tsx (next step) | Practice space CV scan | Reachable from camera setup flow |
| `/arena/practice` | MISSING — no `app/arena/` | swinglab.tsx card (Arena) | **🔴 BROKEN LINK** | Route does not exist; user sees 404 |
| `/acoustic-test` | `app/acoustic-test.tsx` | swinglab.tsx card (Acoustic) | Acoustic detection validation (52 KB) | ✓ Reachable from launcher |
| `/drills` | `app/drills/index.tsx` | swinglab.tsx card (Drills) | Drill catalog (primary issue/faults) | ✓ Reachable from launcher |
| `/drills/[issue]` | `app/drills/[issue].tsx` | drills/index.tsx (drill tap) | Drill detail & videos | Dynamic route |

### 9. Cage Mode Routes (Multi-swing Session)

**Parent:** `app/cage/_layout.tsx` (stack)

| Route | File | Called From | Rendered | Notes |
|-------|------|-------------|----------|-------|
| `/cage` | `app/cage/index.tsx` | Manual nav or app boot? | Cage mode home (session list) | Entry to cage feature |
| `/cage/session` | `app/cage/session.tsx` | cage/index.tsx (session start) | Active cage recording UI | Multi-swing capture |
| `/cage/summary` | `app/cage/summary.tsx` | cage/session.tsx (end session) | Session summary & metrics | Post-recording |
| `/cage/history` | `app/cage/history.tsx` | cage/index.tsx (history tab) | Past cage sessions list | Historical access |

### 10. Cage-Review Routes (Post-Session Analytics)

**Parent:** `app/cage-review/_layout.tsx` (stack)

| Route | File | Called From | Rendered | Notes |
|-------|------|-------------|----------|-------|
| `/cage-review/start` | `app/cage-review/start.tsx` | Unknown (orphaned or manual?) | Cage review entry point | ⚠️ Reachability unclear |
| `/cage-review/summary` | `app/cage-review/summary.tsx` | cage-review/start.tsx? | Review analytics display | Part of cage-review flow |
| `/cage-review/[review_session_id]` | `app/cage-review/[review_session_id].tsx` | cage-review/summary.tsx? | Detail view of a review session | Dynamic route |

### 11. Author/Reference Routes

| Route | File | Called From | Rendered | Notes |
|-------|------|-------------|----------|-------|
| `/author/reference-assets` | `app/author/reference-assets.tsx` | Unknown | Author/dev reference assets | ⚠️ **ORPHANED**: No grep found; dev-only? |

### 12. Debug-Only Routes (Protected by isOwnerEmail)

| Route | File | Called From | Rendered | Status | Gating |
|-------|------|-------------|----------|--------|--------|
| `/api-debug` | `app/api-debug.tsx` | settings.tsx (owner tools) | API response inspector | ✓ Reachable | Owner-only in code |
| `/battery-debug` | `app/battery-debug.tsx` | Unknown | Battery diagnostics | ⚠️ Unclear | Owner-only? |
| `/cage-debug` | `app/cage-debug.tsx` | Unknown (or owner tools?) | Cage recording diagnostics (876 L) | ⚠️ Unclear | Owner-only? |
| `/patterns-debug` | `app/patterns-debug.tsx` | cage-debug.tsx line (owner tools) | Pattern detection testing | ✓ Reachable | Owner-only via cage-debug |
| `/plan-debug` | `app/plan-debug.tsx` | Unknown | Plan/course debugging | ⚠️ Unclear | Owner-only? |
| `/smartmotion-quick` | `app/smartmotion-quick.tsx` | Unknown | Quick swing (954 L) | ⚠️ Unclear if debug | May be user-facing |
| `/subscription-debug` | `app/subscription-debug.tsx` | Unknown | Subscription testing | ⚠️ Unclear | Owner-only? |
| `/voice-debug` | `app/voice-debug.tsx` | Unknown | Voice recognition testing | ⚠️ Unclear | Owner-only? |
| `/paywall` | `app/paywall.tsx` | consumeDeferredPaywall() | Paywall UI | ✓ Reachable | Subscription gate |
| `/kevin-learning` | `app/kevin-learning.tsx` | Unknown | Kevin learning UI | ⚠️ Orphaned? | |
| `/landmark-curate` | `app/landmark-curate.tsx` | Unknown | Landmark curation | ⚠️ Orphaned? | Dev-only? |

### 13. Fallback Route

| Route | File | Rendered | Notes |
|-------|------|----------|-------|
| `*` | `app/+not-found.tsx` | Route-not-found fallback | Catches undefined routes |

---

## Reachability Analysis & Orphan Detection

### ✓ WELL-ROUTED (Confirmed entry points)

- `/(tabs)/*` — All 5 tabs (explicit tab navigation)
- `/greeting` — app/index.tsx (onboarding)
- `/settings` — caddie.tsx menu (More button)
- `/reference` — caddie.tsx menu (More button)
- `/swinglab/*` — swinglab.tsx launcher cards
- `/drills*` — swinglab.tsx launcher card
- `/recap/*` — dashboard.tsx (round history)
- `/cage/*` — Unclear entry point, but internal navigation is clear
- `/smartfinder`, `/smartvision` — play.tsx (round-active tools)
- `/acoustic-test` — swinglab.tsx launcher card
- `/gps-test`, `/smartfinder-debug` — settings.tsx owner tools
- `/patterns-debug` — cage-debug.tsx
- `/api-debug` — settings.tsx owner tools

### 🔴 BROKEN ROUTES

- **`/arena/practice`** — Linked from swinglab.tsx line 78, but NO `app/arena/` directory exists.
  - **File:** `app/(tabs)/swinglab.tsx:78`
  - **Impact:** Tapping Arena card results in 404 navigation error
  - **Fix:** Implement arena feature or replace card with coming-soon placeholder

### ⚠️ ORPHANED (No Found Entry Point)

- **`/owner-logs`** (app/owner-logs.tsx) — No `router.push('/owner-logs')` found anywhere
- **`/hole-view`** (app/hole-view.tsx, 1,484 L) — Large screen with no explicit nav entry; may be unreachable
- **`/lie-analysis`** (app/lie-analysis.tsx) — No entry found
- **`/mark-green`** (app/mark-green.tsx) — No entry found
- **`/smartmotion-quick`** (app/smartmotion-quick.tsx, 954 L) — Unclear if reachable or debug
- **`/swinglab/quick-record`** (app/swinglab/quick-record.tsx) — No entry found
- **`/ghost-debug`** (app/ghost-debug.tsx) — No entry found
- **`/cage-review/start`** (app/cage-review/start.tsx) — Reachability unclear
- **`/author/reference-assets`** (app/author/reference-assets.tsx) — Dev/author only; no nav entry
- **`/kevin-learning`** (app/kevin-learning.tsx) — No entry found
- **`/landmark-curate`** (app/landmark-curate.tsx) — No entry found
- **`/welcome`** (app/welcome.tsx) — Unclear purpose; may be deprecated onboarding
- **`/intro-video`** (app/intro-video.tsx) — Unclear; may be deprecated
- **`/course/[course_id]`** (app/course/[course_id].tsx) — Dynamic route; reachability unclear
- **`/quick-start`** (app/quick-start.tsx) — Reachability unclear; may be deep link only

### 🔶 UNCLEAR GATING (Debug Routes Not Consolidated)

**Finding:** 9+ debug routes exist at app root level with no folder organization. Each relies on internal `isOwnerEmail()` checks, but routes are discoverable in app/:

- `/api-debug`, `/battery-debug`, `/cage-debug`, `/ghost-debug`, `/gps-test`, `/patterns-debug`, `/smartfinder-debug`, `/smartmotion-quick`, `/subscription-debug`, `/voice-debug`

**Recommendation:** Create `app/_layout.tsx` middleware to gate all `/debug/*` or `/owner-only/*` routes at the router level, OR move all to `app/owner-only/` folder.

---

## SwingLab vs. Practice Feature Check

**Standing decision:** SwingLab and Practice are ONE feature, not duplicates.

**Finding:** ✓ **CLEAN** — No duplicate routes detected.
- SwingLab tab (`/(tabs)/swinglab`) is a launcher only.
- All feature screens are nested: `/swinglab/*`, `/drills`, `/acoustic-test`.
- No separate `/practice/*` folder or duplicate SmartMotion/Cage screens.
- No practice-specific route that conflicts with swinglab.

---

## Summary Table

| Category | Count | Status |
|----------|-------|--------|
| **Total routes** | 77 | ✓ Scope appropriate |
| **Tab routes** | 5 | ✓ Clean tabs |
| **Modal/stack routes** | 72 | ✓ Feature screens |
| **Well-routed** | ~55 | ✓ Discoverable |
| **Orphaned routes** | 14 | ⚠️ Dead links or unclear entry |
| **Broken routes** | 1 | 🔴 /arena/practice missing |
| **Debug routes (ungated)** | 9+ | 🔶 Needs consolidation |
| **Duplicate features** | 0 | ✓ SwingLab/Practice clean |

---

## Critical Findings (Phase 420)

1. **BROKEN LINK: `/arena/practice` (BLOCKER)**
   - User-facing 404 when tapping Arena card
   - File: `app/(tabs)/swinglab.tsx:78`
   - Fix: Implement arena feature or replace with coming-soon placeholder

2. **14 ORPHANED ROUTES**
   - Largest orphans: `/hole-view` (1,484 L), `/smartmotion-quick` (954 L), `/owner-logs`, `/lie-analysis`, `/mark-green`
   - Decision: Remove or confirm reachability with Tim

3. **DEBUG ROUTES NOT CONSOLIDATED**
   - 9+ `*-debug.tsx` routes at app root with no folder gating
   - Recommendation: Move to `app/owner-only/` or add _layout.tsx middleware

4. **CADDIE TAB MONOLITHIC (3,870 lines)**
   - `app/(tabs)/caddie.tsx` is 3,870 lines — the real refactor target
   - Scorecard tab is 772 lines; the 35K figure earlier in this doc was a byte-count error
   - Refactoring opportunity: extract avatar block, pre-round CTA, mid-round chrome, more menu into child components

---

**Audit owner:** Phase 420  
**Dependency:** arena/practice route must be resolved before launch  
**Next steps:** Confirm reachability of orphaned routes; implement or delete
