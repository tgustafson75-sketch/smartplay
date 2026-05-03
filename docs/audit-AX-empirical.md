# Phase AX — Empirical Verification Audit

**Status**: Framework complete, scenarios PENDING EMPIRICAL.
**Owner**: Tim runs scenarios on real Galaxy Z Fold device.
**Renamed from prompt's "Phase AV"** — AV was already used this session for
the SmartVision GolfShot rebuild (`app/smartvision.tsx`).

## Operating Principles

This is **NOT a code-level audit**. Code-level checks (tsc clean, lint clean,
logic correct in isolation) have repeatedly produced false confidence. This
audit verifies **empirical behavior on real device**.

A scenario is **PASSED** ONLY when behavior matches expectation on Tim's Galaxy
Z Fold device under realistic conditions. Code that "should work" but doesn't
work in practice = **FAILED**, not passed.

If verification cannot be done empirically right now, mark **PENDING EMPIRICAL**.
Pending Empirical is honest. Falsely marking PASSED has consequences: Tim
resorts to Golfshot mid-round.

The goal is not "most scenarios pass." The goal is "every scenario verified
honestly."

## Pre-audit Setup Checklist

Before running scenarios, verify:

- [ ] Latest dev-client build installed on Galaxy Z Fold (commit `c7a0136` or
      newer, includes Phases through AU.2 + AV + AW)
- [ ] voiceHash bumped if filler library changed since last build
- [ ] Bluetooth earbuds charged + connected (test rotation: AirPods, Galaxy
      Buds, generic)
- [ ] Test environment: outdoor location with real GPS reception preferred,
      indoor with simGPS as fallback
- [ ] Battery >50% (audit takes 2-3 hours)
- [ ] Device connected to computer via USB with `adb logcat` running:
      `adb logcat -s ReactNativeJS:I | grep -E "audit:|V6-DIAG|ttfa|path[1-4]:"`
- [ ] Test Manual PDF accessible for cross-reference
- [ ] Tim has 2-3 uninterrupted hours

If any setup item missing, audit cannot begin.

## Audit Instrumentation Markers

Every critical decision point logs with a `[audit:*]` marker. Greppable via
`adb logcat | grep audit:`. Markers used:

| Marker | Surface / Event |
|---|---|
| `[audit:onboarding]` | Each onboarding screen transition |
| `[audit:nav]` | Tab navigation, drawer open, modal display |
| `[audit:layout]` | Layout zone rendering decisions, aspect detection |
| `[audit:theme]` | Theme token resolution, mode switches |
| `[audit:voice]` | Listening session state, filler firing, response timing |
| `[audit:earbud]` | Media key callbacks, listening engage |
| `[audit:gps]` | Location updates, accuracy reports |
| `[audit:round-active]` | Round state changes, hole transitions, surface refresh |
| `[audit:smartvision]` | Hole render, geometry load, gesture events |
| `[audit:smartfinder]` | Distance calculations, error states |
| `[audit:scorecard]` | Load, save, share events |
| `[audit:cage]` | Setup, session, swing detection, analysis pipeline |
| `[audit:upload]` | Upload pipeline stages, classifier output |
| `[audit:lie-analysis]` | Capture, vision call, response render |
| `[audit:wind]` | Weather fetch, arrow rendering |
| `[audit:mark]` | Manual mark events, propagation to subscribers |
| `[audit:context]` | Persistent context injection into Sonnet/Haiku calls |
| `[audit:conversation]` | Conversation state retention, multi-turn handling |

Existing diagnostics also greppable: `[V6-DIAG]`, `[ttfa]`, `[path1:onboard]`,
`[path2:round]`, `[path3:cage]`, `[path4:voice]`.

## Verification Scenarios

Each scenario format:
- **ID** | **Path/Surface** | **Pre-conditions** | **Steps** | **Expected**
- **Logs** (what should appear in adb logcat)
- **Failure indicators** (specific things to watch for)
- **STATUS**: `PASSED` | `FAILED` | `PENDING EMPIRICAL`
- **Notes** (capture failure specifics)

---

## GROUP 1: APP STARTUP + ONBOARDING (AX-1 through AX-12)

### AX-1: Cold start performance
- **Pre**: app fully closed, device awake
- **Steps**: tap app icon, time to first interactive screen
- **Expected**: <4s to onboarding screen 1 OR Caddie home if previously onboarded
- **Logs**: `[audit:nav] startup complete` with timestamp
- **Failure**: >6s, white flash, crash, blank screen
- **STATUS**: PENDING EMPIRICAL

### AX-2: Splash screen Kevin presence (Phase AI)
- **Pre**: cold start
- **Steps**: observe splash before main app loads
- **Expected**: Kevin visible on splash (photoreal portrait or logo with Kevin
  element), SmartPlay branding visible
- **Failure**: no Kevin presence, generic splash, default OS splash
- **STATUS**: PENDING EMPIRICAL

### AX-3 through AX-9: Fresh onboarding flow (Phase AJ)
For each onboarding screen (Welcome, Meet Kevin, Trust Spectrum, Goal Mode,
Handicap, Permissions, Complete):
- **Pre**: fresh install OR onboarding reset state
- **Steps**: progress through screen
- **Expected**:
  - Screen displays long enough to read (>3s minimum, user-paced advance preferred)
  - Kevin visible from Meet Kevin forward (canonical photoreal asset)
  - No text overlap during transitions
  - Logical progression
- **Logs**: `[audit:onboarding] screen X displayed, advanced to Y`
- **Failure**: text overlap, screens advance too fast, Kevin missing, illogical ordering
- **STATUS**: PENDING EMPIRICAL (per screen)

### AX-10: Permission request handling
- **Pre**: fresh install, permissions screen
- **Steps**: grant Camera, Microphone, Location permissions
- **Expected**: each permission requested with clear reason; declining surfaces
  appropriate fallback messaging
- **Failure**: permissions auto-grant without user action, declining causes crash, no explanation
- **STATUS**: PENDING EMPIRICAL

### AX-11: Onboarding completion lands on L2 Caddie home
- **Pre**: completed onboarding flow
- **Steps**: complete final screen
- **Expected**: lands on L2 Caddie home with profile populated, green-arrow
  dropdown collapsed at bottom-right
- **Logs**: `[audit:nav] onboarding complete`, `[audit:layout] L2 home rendered`
- **Failure**: lands on different surface, profile data missing, wrong trust level
- **STATUS**: PENDING EMPIRICAL

### AX-12: Persistent context generated post-onboarding (Phase AQ)
- **Pre**: onboarding complete
- **Steps**: check that profile context Sonnet call fired
- **Expected**: `[audit:context] onboarding profile synthesis completed`,
  `kevinContext` populated in playerProfileStore
- **Failure**: no context call fired, kevinContext empty, future Kevin responses generic
- **STATUS**: PENDING EMPIRICAL

---

## GROUP 2: NAVIGATION + LAYOUT (AX-13 through AX-32)

### AX-13 through AX-17: Bottom tab bar visibility (Phase AE)
For each trust level L1, L2, L3, L4:
- **Pre**: at L[level] Caddie home
- **Steps**: observe bottom of screen
- **Expected**: bottom tab bar with five tabs visible (Caddie / Play / Score /
  SwingLab / Stats)
- **Logs**: `[audit:layout] tab bar visible at L[level]`
- **Failure**: tab bar hidden, suppressed by trust level
- **STATUS**: PENDING EMPIRICAL (per level)

### AX-18 through AX-22: Tab navigation
- **Pre**: any trust level, any starting tab
- **Steps**: tap each tab in sequence (Caddie → Play → Score → SwingLab → Stats → back)
- **Expected**: each tap navigates within 500ms, target tab active indicator highlights
- **Logs**: `[audit:nav]` tab change events
- **Failure**: lag >1s, wrong tab activates, content fails to load, state lost
- **STATUS**: PENDING EMPIRICAL

### AX-23: Round-active state preserved across tab navigation (Phase Y.2)
- **Pre**: active round on Caddie home
- **Steps**: navigate to Stats, then back to Caddie
- **Expected**: round still active, current hole preserved, all surfaces still
  showing round-active state (no flash-then-collapse)
- **Logs**: `[audit:round-active] state preserved across navigation`
- **Failure**: round becomes inactive, state collapses, hole resets to 1
- **STATUS**: PENDING EMPIRICAL

### AX-24 through AX-31: Layout on Galaxy Z Fold both states
For Caddie home, Play, Score, SwingLab, Stats, Course Detail, Round Setup, Cage Setup:
- **Pre**: surface loaded
- **Steps**: verify on Fold closed (~9:21), open fold to Fold open (~8:9)
- **Expected**:
  - All content fits viewport, no buttons cut off (Phase AA)
  - No card overlap (Phase AU.2 for Caddie home)
  - Green-arrow dropdown at bottom-right collapsed, accessible
- **Logs**: `[audit:layout] aspect detected, layout rendered`
- **Failure**: buttons cut off, cards overlap, dropdown missing
- **STATUS**: PENDING EMPIRICAL (per surface)

### AX-32: Green-arrow dropdown functionality (Phase AU + AU.2)
- **Pre**: bottom-right of any Caddie home surface during active round
- **Steps**: tap green chevron pill
- **Expected**: smoothly expands LEFT to reveal **6 icons** in a horizontal
  ScrollView: **Mic / Scorecard / SmartVision / SmartFinder / MARK / TightLie**.
  Mic icon is state-aware (mic / stop / ellipsis / volume-high based on
  voiceState). Tap icon → navigates/triggers action + collapses dropdown.
  Tap chevron when expanded → collapses back to chevron only.
- **Logs**: `[audit:nav]` dropdown expand/collapse events
- **Failure**: doesn't expand, icons missing, taps don't trigger, doesn't collapse
- **AMENDMENT NOTE**: prompt expected 5 icons (mic/flag/list/accessibility/stats).
  Shipped reality is 6 icons (above). Audit verifies the 6 actual icons. Tools
  (•••) is NOT in the dropdown — corner pill is canonical Tools anchor.
- **STATUS**: PENDING EMPIRICAL

---

## GROUP 3: KEVIN POSITION + L4 FOLD-OPEN LAYOUT (AX-33 through AX-44)

### AX-33: Kevin canonical position L2 Caddie home, Fold open (Phase AU)
- **Pre**: L2 Caddie home, Fold open
- **Steps**: observe Kevin's portrait position
- **Expected**: Kevin renders inside the L2 split avatar cell at canonical
  proportion. NOT pushed to extreme left edge.
- **Failure**: Kevin jammed left, collapsed to logo, wrong size
- **STATUS**: PENDING EMPIRICAL

### AX-34: Kevin canonical position L4 Caddie home, Fold open (Phase AU)
- **Pre**: L4 Caddie home, Fold open
- **Steps**: observe Kevin's portrait position
- **Expected**: full Kevin photoreal presence in the locked container
  (`top: insets.top + 56, left: 0, width: W, height: capped W*16/9`). NOT
  competing with cards, canonical layout intact, hat fully visible, NOT
  extending below visible viewport.
- **Failure**: Kevin pushed left, cards overlap him, collapsed to logo, hat clipped
- **STATUS**: PENDING EMPIRICAL

### AX-35: SmartVision card position Fold open (Phase AU.2)
- **Pre**: L4 Caddie home, Fold open, active round
- **Steps**: observe SmartVision card location
- **Expected**: SmartVision card height-capped, doesn't overlap Kevin or
  bottom dropdown row.
- **AMENDMENT NOTE**: prompt expected "TightLie button at bottom-edge". Shipped
  reality: TightLie has NO standalone button — lives only in the dropdown.
  Audit verifies SmartVision zone without the standalone TightLie reference.
- **Failure**: SmartVision overlaps Kevin, overlaps HOLE card, in wrong zone
- **STATUS**: PENDING EMPIRICAL

### AX-36: HOLE yardage card / DataStrip position Fold open (Phase AU)
- **Pre**: L4 Caddie home, Fold open, active round
- **Steps**: observe DataStrip (HOLE/YARDS/PLAYS/TARGET/STROKE row)
- **Expected**: bottom zone, full width, above tab bar, anchored at bottom: 0
- **Failure**: overlaps SmartVision, overlaps Kevin, wrong position
- **STATUS**: PENDING EMPIRICAL

### AX-37 through AX-40: Kevin position consistency across trust levels
For L1, L2, L3, L4:
- **Pre**: same position on Fold open per level
- **Steps**: cycle through trust levels in settings
- **Expected**: Kevin treatment varies appropriately per level, but POSITION
  rules consistent. No level pushes Kevin to wrong location.
- **Failure**: position drift across levels
- **STATUS**: PENDING EMPIRICAL (per level)

### AX-41 through AX-44: Kevin position Fold closed
For L1, L2, L3, L4 on Fold closed:
- **Pre**: Caddie home, Fold closed
- **Steps**: observe layout
- **Expected**:
  - L1: no Kevin face shown (Quiet design)
  - L2: stacked cells (Kevin + SmartVision)
  - L3: Kevin avatar with SmartVision overlay tile bottom-left
  - L4: full Kevin within natural 9:16 frame (canonical)
  - All accessible, dropdown chevron at bottom-right
- **Failure**: cards overlap, Kevin pushed off-screen, layout broken
- **STATUS**: PENDING EMPIRICAL (per level)

---

## GROUP 4: THEME + CONTRAST (AX-45 through AX-54)

### AX-45: Light mode visible distinct (Phase AP)
- **Pre**: any main surface in light mode
- **Expected**: light backgrounds, dark text, sufficient outdoor-readable contrast
- **Failure**: gray-on-gray, text washed out
- **STATUS**: PENDING EMPIRICAL

### AX-46: Dark mode visible distinct (Phase AP)
- **Pre**: same surface, toggle to dark
- **Expected**: immediate app-wide shift, visible difference
- **Logs**: `[audit:theme] mode changed dark`
- **Failure**: subtle change, partial shift, restart needed
- **STATUS**: PENDING EMPIRICAL

### AX-47: High contrast mode (Phase AP)
- **Pre**: dark or light active
- **Steps**: enable high contrast in settings
- **Expected**: visible intensity increase — stronger borders, higher text contrast
- **Failure**: no visible change, control missing
- **STATUS**: PENDING EMPIRICAL

### AX-48 through AX-52: Theme honors across surfaces
For Caddie, Play, Score, SwingLab, Stats:
- **Pre**: dark mode + high contrast active
- **Expected**: every surface honors theme tokens
- **Failure**: any surface stays light, hardcoded colors visible
- **STATUS**: PENDING EMPIRICAL (per surface)

### AX-53: Brand colors preserved across modes (Phase AP)
- **Pre**: toggle modes
- **Expected**: SmartPlay green, yellow accent (Mark icon in dropdown), blue
  accent (wind circle) all render appropriately on both backgrounds
- **AMENDMENT NOTE**: prompt expected "TightLie button, Mark pin" yellow.
  Shipped reality: standalone Mark pin and TightLie button removed; yellow
  accent now only on the Mark icon INSIDE the dropdown. Wind is BLUE not green.
- **Failure**: brand colors washed, invisible, wrong shift
- **STATUS**: PENDING EMPIRICAL

### AX-54: Theme persistence across restart
- **Pre**: dark + high contrast active
- **Steps**: close app, reopen
- **Expected**: settings persist
- **Failure**: resets to defaults
- **STATUS**: PENDING EMPIRICAL

---

## GROUP 5: VOICE FLOW (AX-55 through AX-78)

### AX-55: Earbud tap engages Kevin (Phase AC)
- **Pre**: Bluetooth earbuds connected, Caddie home
- **Steps**: single-tap earbud
- **Expected**: within 1-2s, Kevin engages with caddie register opener
- **Logs**: `[audit:earbud] media key fired`, `[audit:voice] listening engaged`
- **Failure**: no response, on-screen tap workaround needed
- **STATUS**: PENDING EMPIRICAL

### AX-56: On-screen mic in dropdown engages Kevin
- **Pre**: Caddie home, expand green-arrow dropdown
- **Steps**: tap mic icon (leftmost)
- **Expected**: same engagement as earbud tap. Mic icon transitions to stop
  while listening, ellipsis while thinking, volume-high while speaking.
- **Logs**: `[audit:voice] listening engaged`
- **Failure**: button doesn't respond, listening fails to start, icon doesn't update
- **AMENDMENT NOTE**: replaces prompt's "tap microphone button" — there's no
  standalone mic button anymore; mic lives in the dropdown.
- **STATUS**: PENDING EMPIRICAL

### AX-57: Earbud tap on different surfaces (role registers)
- **Pre**: earbuds connected
- **Steps**: tap earbud on Caddie home, then SwingLab, then Arena
- **Expected**:
  - Caddie home: caddie register opener
  - SwingLab: coach register opener
  - Arena: psychologist register opener
- **Failure**: same opener everywhere, wrong register for surface
- **STATUS**: PENDING EMPIRICAL

### AX-58: Direct handler query latency (Phase P + AB)
- **Pre**: active round
- **Steps**: ask "How far to the green?"
- **Expected**: response within 500ms total, no audible silence gaps
- **Logs**: `[audit:voice] direct handler invoked, response audio start <500ms`
- **Failure**: >2s latency, silence gaps, routes to Sonnet instead of direct
- **STATUS**: PENDING EMPIRICAL

### AX-59: Haiku query latency
- **Pre**: active round
- **Steps**: ask "How was last time I played this hole?"
- **Expected**: response within 1500ms, filler may fire briefly
- **Failure**: >3s latency, routes to Sonnet unnecessarily
- **STATUS**: PENDING EMPIRICAL

### AX-60: Sonnet query with filler chain (Phase AB)
- **Pre**: active round, complex query
- **Steps**: ask "What should I do here?"
- **Expected**: initial filler within 150ms, extension filler if response >3s,
  total perceived latency <8s, no audible silence gaps
- **Logs**: `[audit:voice]` filler chain events
- **Failure**: silence after initial filler, total latency >12s with no bridge
- **STATUS**: PENDING EMPIRICAL

### AX-61: Context-aware fillers fire (Phase AB)
- **Pre**: trigger lie analysis (TightLie)
- **Steps**: ask Kevin to analyze a lie
- **Expected**: filler is context-specific not generic
- **Failure**: only generic fillers, voiceHash didn't regenerate
- **STATUS**: PENDING EMPIRICAL

### AX-62: Conversation state across turns (Phase AR)
- **Pre**: voice query complete
- **Steps**: ask "How far to the green?", within 30s ask "And the wind?"
- **Expected**: Kevin understands "the wind" refers to current shot context
- **Logs**: `[audit:conversation] context retained, multi-turn handling`
- **Failure**: treats second query as standalone
- **STATUS**: PENDING EMPIRICAL

### AX-63: Conversation state decays after timeout (Phase AR)
- **Pre**: voice query complete, wait 90s
- **Steps**: ask follow-up
- **Expected**: treated as fresh query
- **Failure**: stale context bleeds in
- **STATUS**: PENDING EMPIRICAL

### AX-64: Conversation continuity behavior (Phase AB)
- **Pre**: voice query complete
- **Expected**: chosen pattern (single-turn ends, OR multi-turn with generous timeout)
- **Failure**: insufficient timeout cuts user off
- **STATUS**: PENDING EMPIRICAL

### AX-65: TTS plays through earbuds not phone speaker
- **Pre**: earbuds connected, voice query
- **Expected**: audio through earbuds only
- **Failure**: phone speaker blasts, dual playback
- **STATUS**: PENDING EMPIRICAL

### AX-66: Audio disconnect handling
- **Pre**: earbuds connected, mid-Kevin-response
- **Steps**: disconnect earbuds during TTS
- **Expected**: TTS pauses immediately, disconnect notification
- **Failure**: phone speaker takes over
- **STATUS**: PENDING EMPIRICAL

### AX-67 through AX-72: Voice intents
- **Mark**: "Mark this position" → Mark fires (Phase AL)
- **Distance**: "how far to the green" → SmartFinder yardage
- **Wind**: "what's the wind doing" → weather data response
- **Hole history**: "how was last time" → hole_history handler
- **TightLie**: "open TightLie" / "check my lie" → /lie-analysis opens (Phase AS)
- **Course handicap**: "what's my course handicap" → handicap response (Phase T if shipped)
- **AMENDMENT NOTE**: TightLie standalone button removed; voice intent and
  dropdown icon both still work.
- **STATUS**: PENDING EMPIRICAL (per intent)

### AX-73: Briefing playback completion (timeout fix)
- **Pre**: start a round
- **Expected**: briefing plays through to natural completion
- **Logs**: `[audit:voice] briefing duration, completion status`
- **Failure**: cuts off at 30s mark mid-sentence
- **STATUS**: PENDING EMPIRICAL

### AX-74: Persistent context injection (Phase AQ)
- **Pre**: user has profile + recent cage session + recent round
- **Steps**: ask Kevin a strategic question
- **Expected**: response references stored context (handicap, recent practice)
- **Logs**: `[audit:context] injection in system prompt`
- **Failure**: response is generic
- **STATUS**: PENDING EMPIRICAL

### AX-75: Filler audio quality
- **Expected**: matches Kevin's TTS voice, no audio artifacts
- **STATUS**: PENDING EMPIRICAL

### AX-76: Filler-to-response transition smoothness
- **Expected**: clean transition, no audible cut, no word repetition
- **STATUS**: PENDING EMPIRICAL

### AX-77: Voice query during cage session (silence guard)
- **Pre**: active cage session recording
- **Steps**: tap earbud or mic
- **Expected**: Kevin does NOT engage during recording
- **STATUS**: PENDING EMPIRICAL

### AX-78: Voice query when no round active
- **Pre**: no active round, on Caddie home
- **Steps**: ask "how far to the green"
- **Expected**: honest "no active round, start one" response
- **Failure**: fabricated response, silent failure
- **STATUS**: PENDING EMPIRICAL

---

## GROUP 6: GPS + ROUND-ACTIVE (AX-79 through AX-100)

### AX-79: Course discovery in Play tab (Phase AG)
- **Pre**: Play tab open
- **Expected**: real courses populated based on GPS, distances accurate
- **Logs**: `[audit:gps]`, course list populated
- **Failure**: empty list, wrong courses, fake data
- **STATUS**: PENDING EMPIRICAL

### AX-80: Course Detail loads (Phase AG)
- **Steps**: tap (i) on a course
- **Expected**: real course data, hero image, stats, About, Caddie Tips, Hole Photos, Hole Guide
- **Failure**: missing data, generic placeholders
- **STATUS**: PENDING EMPIRICAL

### AX-81: Round start triggers active state (Phase Y.2)
- **Pre**: Course Detail
- **Steps**: tap "Start Round Here", complete Round Setup, tap Start Round
- **Expected**:
  - roundStore.activeRound populated
  - Caddie home loads with round-active state visible (NOT flash-then-collapse)
  - Pre-round briefing fires
  - Hole 1 yardages populate
  - SmartVision shows hole 1
- **Logs**: `[audit:round-active] state set and propagated to all surfaces`
- **Failure**: flash-then-collapse, surfaces show idle state
- **STATUS**: PENDING EMPIRICAL

### AX-82: Wind arrow renders correctly (Phase AU.2)
- **Pre**: Caddie home (any state — wind circle renders unconditionally)
- **Expected**: blue circular badge upper-right with wind arrow visible.
  Pre-round shows static N-pointing arrow; in-round shows live WindArrow with
  speed.
- **Logs**: `[audit:wind] weather fetched, arrow rendered`
- **Failure**: badge missing, wrong color (should be blue not green), arrow missing
- **STATUS**: PENDING EMPIRICAL

### AX-83: SmartFinder yardages reflect current hole (Phase Y.2)
- **Pre**: active round on Palms (now has GPS coords from Phase AW)
- **Steps**: in dropdown, tap SmartFinder icon
- **Expected**: real F/M/B yardages from GPS to green polygon, F<M<B plausible
- **Failure**: yardages "—" placeholder, don't match current hole
- **STATUS**: PENDING EMPIRICAL

### AX-84: SmartFinder measure handles errors (Phase AH)
- **Steps**: trigger measure when GPS or course data fails
- **Expected**: graceful messaging, retry option, no uncaught error
- **STATUS**: PENDING EMPIRICAL

### AX-85: SmartVision opens (Phase AV)
- **Pre**: active round
- **Steps**: tap SmartVision icon in dropdown
- **Expected**: navigates to /smartvision. With Palms now having GPS, satellite
  tile loads from Mapbox. T (blue) and P (red) markers render at tee/green;
  Y (yellow) at midpoint. F/M/B yardage panel shows live values from yellow
  position.
- **Logs**: `[audit:smartvision]` hole render
- **Failure**: blank screen, no markers, yardage panel shows "—"
- **AMENDMENT NOTE**: replaces prompt's "vector hole rendering" — Phase AV
  built a satellite-tile path; vector hole sketch lives in L1HolePreview
  for the Caddie-home SmartVision card, not the full /smartvision route.
- **STATUS**: PENDING EMPIRICAL

### AX-86: SmartVision draggable yellow marker (Phase AV)
- **Pre**: SmartVision open
- **Steps**: drag the yellow marker
- **Expected**: marker follows touch; F/M/B yardage panel updates live
- **Failure**: marker doesn't move, yardages don't update, drag laggy
- **STATUS**: PENDING EMPIRICAL

### AX-87: SmartVision imagery mode toggle (Phase AV)
- **Pre**: SmartVision open
- **Steps**: tap top-right toggle (sparkles → image → globe → sparkles)
- **Expected**:
  - sparkles (auto): GPS tile when geometry available, curated otherwise
  - image (curated): bundled hole screenshot always, no markers
  - globe (gps): GPS tile only; "GPS imagery requires hole geometry" if missing
- **Failure**: toggle doesn't cycle, doesn't switch backdrop
- **STATUS**: PENDING EMPIRICAL

### AX-88: Manual Mark refresh propagation (Phase AL)
- **Pre**: active round, expand dropdown
- **Steps**: tap MARK icon in dropdown
- **Expected**:
  - Fresh GPS read fires
  - SmartFinder yardages refresh on next open
  - Hole transition re-evaluation runs
  - Haptic feedback + visual confirmation
- **Logs**: `[audit:mark] event fired`, `[audit:gps] fresh read`
- **AMENDMENT NOTE**: standalone Mark pin removed; MARK lives only in dropdown.
- **STATUS**: PENDING EMPIRICAL

### AX-89: Mark via voice (Phase AL)
- **Steps**: say "Kevin, mark my position"
- **Expected**: same Mark action as dropdown tap
- **STATUS**: PENDING EMPIRICAL

### AX-90: Mark gated to active round
- **Pre**: no active round
- **Steps**: try to MARK (dropdown is hidden when no round, so MARK shouldn't be reachable)
- **Expected**: dropdown not visible pre-round; MARK voice intent surfaces
  "start a round first"
- **STATUS**: PENDING EMPIRICAL

### AX-91: Hole transition fires on sustained position (Phase Q.5b)
- **Pre**: active round, near hole boundary
- **Steps**: walk (or simGPS) to next tee box, wait sustained-position threshold
- **Expected**: hole transition fires, currentHole updates, all surfaces refresh
- **Logs**: `[audit:gps] sustained position detected`, `[audit:round-active] hole transition`
- **Failure**: stays on previous hole, requires manual override
- **STATUS**: PENDING EMPIRICAL

### AX-92: Hole transition immediate on Mark (Phase AL)
- **Pre**: active round, on wrong hole
- **Steps**: walk to correct hole, MARK
- **Expected**: hole detection runs immediately, transitions
- **STATUS**: PENDING EMPIRICAL

### AX-93: Manual hole-jump picker fallback
- **Pre**: active round, hole detection failed
- **Steps**: tap SmartFinder header to access picker
- **Expected**: picker opens, manual select works, all surfaces refresh
- **STATUS**: PENDING EMPIRICAL

### AX-94: Shot tracking affordance available
- **Pre**: active round, on Caddie home
- **Expected**: shot tracking entry visible/tappable
- **STATUS**: PENDING EMPIRICAL

### AX-95: Shot logging via voice
- **Steps**: say "hit driver 240 left"
- **Expected**: shot logged, Kevin acknowledges
- **STATUS**: PENDING EMPIRICAL

### AX-96: Shot logging via tap
- **Steps**: tap shot button, fill fields
- **Expected**: shot logged with current GPS
- **STATUS**: PENDING EMPIRICAL

### AX-97: Round persists across app close/reopen
- **Pre**: active round, hole 5
- **Steps**: close app fully, reopen
- **Expected**: returns to active round on hole 5, no state loss
- **STATUS**: PENDING EMPIRICAL

### AX-98: Final hole closure (Phase Q.5b)
- **Pre**: on hole 18 (or 9)
- **Steps**: end round
- **Expected**: final hole shots properly closed, end_location set, recap fires
- **STATUS**: PENDING EMPIRICAL

### AX-99: Round end triggers recap (Phase U)
- **Steps**: tap End Round
- **Expected**: recap with per-hole summaries, score differential, post-round
  Kevin summary, references to pre-round notes if set
- **Logs**: `[audit:context] recap generation includes user context`
- **Failure**: generic recap, missing context references
- **STATUS**: PENDING EMPIRICAL

### AX-100: Pattern shift surfaced if applicable (Phase U)
- **Pre**: 3+ rounds with consistent patterns
- **Expected**: pattern detection surfaces real patterns OR honest "no pattern yet"
- **Failure**: fabricated patterns, missing patterns when data supports
- **STATUS**: PENDING EMPIRICAL

---

## GROUP 7: CAGE + UPLOAD (AX-101 through AX-118)

### AX-101: Cage Mode setup with overlay (Phase AM)
- **Pre**: SwingLab → Practice Tools → Cage
- **Expected**: camera viewfinder with bullseye/alignment overlay, color feedback
- **STATUS**: PENDING EMPIRICAL

### AX-102: Cage Mode distance calibration
- **Steps**: complete calibration flow
- **Expected**: produces values close to known club distances
- **STATUS**: PENDING EMPIRICAL

### AX-103: Cage session recording
- **Steps**: hit 8-10 swings
- **Expected**: swing detection within 1-2 of actual count, Kevin silent during recording
- **Logs**: `[audit:cage] session start, swing detection events`
- **STATUS**: PENDING EMPIRICAL

### AX-104: Phase K analysis on cage session (Phase AF)
- **Steps**: end cage session with multiple swings
- **Expected**: PrimaryIssueCard with detected issue OR honest "tentative read",
  NOT generic "couldn't analyze" failure
- **Logs**: `[audit:cage]` analysis pipeline stages
- **STATUS**: PENDING EMPIRICAL

### AX-105: Drill recommendation matches issue (Phase AF)
- **Expected**: drill logically connects to detected issue
- **STATUS**: PENDING EMPIRICAL

### AX-106: Drill detail surface (Phase R)
- **Steps**: tap "Open Drill"
- **Expected**: drill steps visible, Kevin's Coach voice callout
- **STATUS**: PENDING EMPIRICAL

### AX-107: Cage session generates persistent context (Phase AQ)
- **Expected**: Sonnet-generated insight summary stored in cageStore
- **Logs**: `[audit:context] cage insight generated`
- **STATUS**: PENDING EMPIRICAL

### AX-108: Upload swing video flow (Phase R)
- **Expected**: video saves to library, metadata persists
- **STATUS**: PENDING EMPIRICAL

### AX-109: Phase K analysis on uploaded video (Phase V.6)
- **Expected**: useful analysis (not "couldn't analyze" failure)
- **Logs**: `[audit:upload]` pipeline stages
- **STATUS**: PENDING EMPIRICAL

### AX-110: Tentative read confidence flag (Phase V.6)
- **Expected**: PrimaryIssueCard renders "Tentative read..." prefix when confidence='low'
- **STATUS**: PENDING EMPIRICAL

### AX-111: Re-analyze button on previously failed (Phase V.7)
- **Steps**: open failed video, tap "Re-analyze with latest"
- **Expected**: replaces failed analysis with V.6-fixed result
- **STATUS**: PENDING EMPIRICAL

### AX-112: Voice query during swing detail (Phase R)
- **Expected**: Kevin references the analysis content
- **STATUS**: PENDING EMPIRICAL

### AX-113: Coach Audio toggle (Phase R)
- **Expected**: toggle switches between original video audio and Kevin TTS analysis
- **STATUS**: PENDING EMPIRICAL

### AX-114: SwingLab home access from voice
- **Steps**: say "open SwingLab"
- **Expected**: navigates to SwingLab home
- **STATUS**: PENDING EMPIRICAL

### AX-115: Drill library filter by tag
- **Expected**: filter works
- **STATUS**: PENDING EMPIRICAL

### AX-116: Practice → Round connection (Phase AQ)
- **Pre**: recent cage session, then start a round
- **Expected**: pre-round briefing references recent practice
- **Logs**: `[audit:context] cage insights injected into briefing`
- **STATUS**: PENDING EMPIRICAL

### AX-117: Round → Practice connection (Phase U + AQ)
- **Pre**: round with notable patterns, then end round
- **Expected**: recap suggests practice work or references recent practice
- **STATUS**: PENDING EMPIRICAL

### AX-118: Practice space scan readiness (Phase AM)
- **Expected**: overlay defines strike zone boundaries
- **STATUS**: PENDING EMPIRICAL

---

## GROUP 8: PLAY / ARENA (AX-119 through AX-125)

### AX-119: Arena landing (Phase L)
- **Expected**: current tier and points visible, challenge options accessible
- **STATUS**: PENDING EMPIRICAL

### AX-120 through AX-122: Each challenge runs end-to-end
- Closest to Pin / Skills Challenge / Sim Round
- **Expected**: challenge runs, scoring works, summary shown
- **STATUS**: PENDING EMPIRICAL (per challenge)

### AX-123: Tier progression celebration (Phase L)
- **Pre**: points near tier threshold
- **Expected**: upgrade celebration modal, tier name updates
- **STATUS**: PENDING EMPIRICAL

### AX-124: Psychologist voice register in Arena (Phase L)
- **Steps**: tap earbud in Arena, ask question
- **Expected**: Kevin uses Psychologist register opener
- **STATUS**: PENDING EMPIRICAL

### AX-125: Arena tracks across sessions
- **Steps**: complete challenge, close app, reopen, return to Arena
- **Expected**: points/tier preserved
- **STATUS**: PENDING EMPIRICAL

---

## GROUP 9: SCORECARD + RECAP (AX-126 through AX-135)

### AX-126: Scorecard surface loads (Phase Z)
- **Expected**: all-holes view loads, no broken navigation
- **Logs**: `[audit:scorecard] load complete`
- **STATUS**: PENDING EMPIRICAL

### AX-127: All-holes view with scores (Phase Z)
- **Expected**: hole numbers, par, yardage, score, totals (front 9 / back 9 / total)
- **STATUS**: PENDING EMPIRICAL

### AX-128: Club usage summary (Phase Z)
- **Expected**: each club used, count, average distance from shot data
- **STATUS**: PENDING EMPIRICAL

### AX-129: Post-round summary inline (Phase Z + U)
- **Expected**: 2-3 sentence Kevin summary, pattern observations
- **STATUS**: PENDING EMPIRICAL

### AX-130: Save round (Phase Z)
- **Expected**: round persisted, idempotent
- **STATUS**: PENDING EMPIRICAL

### AX-131: Share round (Phase Z)
- **Expected**: system share sheet opens with formatted scorecard text
- **STATUS**: PENDING EMPIRICAL

### AX-132: Back navigation from scorecard
- **Expected**: returns to Caddie home or Stats cleanly
- **STATUS**: PENDING EMPIRICAL

### AX-133: Photo collage in recap (Phase R)
- **Expected**: photo collage visible
- **STATUS**: PENDING EMPIRICAL

### AX-134: Recap voice playback
- **Expected**: Kevin speaks summary via TTS
- **STATUS**: PENDING EMPIRICAL

### AX-135: Multi-round trend visible
- **Pre**: 3+ rounds in history
- **Expected**: trend data visible (handicap, scoring trend)
- **STATUS**: PENDING EMPIRICAL

---

## GROUP 10: CROSS-PILLAR INTEGRATION (AX-136 through AX-142)

### AX-136: Three voice modes shift correctly (role discipline)
- **Expected**: Caddie / Coach / Psychologist registers each distinct
- **STATUS**: PENDING EMPIRICAL

### AX-137: TightLie branding consistent (Phase AS)
- **Expected**: TightLie label everywhere lie analysis is referenced
- **STATUS**: PENDING EMPIRICAL

### AX-138: Yellow accent consistent
- **Expected**: yellow accent on Mark icon (inside dropdown), Course Detail
  Book Tee Time, SmartFinder reticle
- **AMENDMENT NOTE**: prompt expected standalone Mark pin and TightLie button
  yellow. Both removed. Yellow now only on Mark icon inside the dropdown.
  Wind circle is BLUE (Phase AU.2 change).
- **STATUS**: PENDING EMPIRICAL

### AX-139: Trust spectrum visual treatments (Phase R)
- **Expected**: Kevin's presence/treatment varies appropriately per L1/L2/L3/L4
- **STATUS**: PENDING EMPIRICAL

### AX-140: Tools (•••) pill semantic position (locked element)
- **Expected**: always top-right, never moves
- **AMENDMENT NOTE**: prompt called this "TightLie pill" — actual semantic
  top-right anchor is the Tools (•••) ellipsis pill. TightLie has no
  standalone pill.
- **STATUS**: PENDING EMPIRICAL

### AX-141: Banner across surfaces
- **Expected**: SMARTPLAY CADDIE banner consistent across all surfaces
- **STATUS**: PENDING EMPIRICAL

### AX-142: Profile / handicap / settings persist
- **Steps**: configure all settings, close app, reopen
- **Expected**: all preferences preserved
- **STATUS**: PENDING EMPIRICAL

---

## Failure Documentation Template

For each FAILED scenario, capture:

```
Scenario ID: AX-NN
Expected: <copy from above>
Actual: <what happened>
Logs: <relevant adb logcat excerpt>
Screenshot: <if applicable>
Hypothesized cause: <best guess>
Recommended fix phase: <new phase ID>
Severity: BLOCKING | SIGNIFICANT | MINOR
```

## Pass Criteria for Next Round Attempt

Aggregate verdict:

- All BLOCKING scenarios PASSED + 90%+ SIGNIFICANT scenarios PASSED →
  **next round attempt approved**
- Any BLOCKING scenarios FAILED → **fix before round attempt, period**
- Many SIGNIFICANT scenarios FAILED → fix priorities scoped, partial round
  attempt acceptable
- Only MINOR scenarios FAILED → round attempt approved, polish queued

Honest verdict, not optimistic verdict.

## Performance Baseline Capture

During audit, capture timing data and write to `docs/audit-AX-baseline.md`:

| Metric | Target | Actual | Notes |
|---|---|---|---|
| App cold start to interactive | <4s | | |
| Tab navigation latency (avg) | <500ms | | |
| Voice query TTFA (direct) | <500ms | | |
| Voice query TTFA (Haiku) | <1500ms | | |
| Voice query TTFA (Sonnet) | <8s w/ filler bridge | | |
| SmartVision open from dropdown | <2s | | |
| SmartVision tile load (Mapbox) | <3s | | |
| Cage analysis pipeline | <30s | | |
| Upload analysis pipeline | <60s | | |
| Recap generation | <15s | | |
| Mark propagation to subscribers | <500ms | | |

## Items Specifically Requiring Empirical Verification

Tim cannot see these from code/logs alone — requires real-device runs:

- Wind arrow rendering and accuracy (AX-82)
- GPS hardware producing usable data (AX-79, AX-83)
- Hole transitions firing correctly (AX-91)
- Persistent context actually injected into Sonnet calls (AX-12, AX-74, AX-107, AX-116)
- Filler library regeneration (AX-61, AX-75)
- Round-active state propagation across surfaces (AX-23, AX-81)
- Empirical earbud media key callbacks (AX-55, AX-57)
- SmartVision GPS path with newly-added Palms coords (AX-85, AX-86, AX-87)
- Re-analyze pipeline producing different result than original (AX-111)
- Bundled vs API-corrected Palms par/distance match real scorecard (AX-83 implied)

These get explicit `[audit:*]` instrumentation so behavior is greppable.

## Amendments Index (vs original prompt)

Documented to flag where the audit deliberately diverges from the prompt to
match shipped reality (per Tim's "do not change formatting or improvements made
today" lock):

1. **AX-32**: dropdown contents are 6 icons (mic/scorecard/smartvision/smartfinder/mark/tightlie), not the prompt's 5 (mic/flag/list/accessibility/stats). Tools (•••) excluded — corner pill is canonical.
2. **AX-35**: SmartVision zone verified without "TightLie button at bottom-edge" — TightLie standalone removed.
3. **AX-56**: replaces "tap microphone button" — mic is in the dropdown, no standalone button.
4. **AX-67–72**: TightLie voice intent + dropdown entry verified; standalone button gone.
5. **AX-85**: SmartVision verifies the Phase AV satellite-tile path, not vector hole rendering (which lives in L1HolePreview for Caddie home, separate component).
6. **AX-88**: MARK in dropdown only; standalone Mark pin removed.
7. **AX-138**: yellow accent rule narrowed — Mark icon only (inside dropdown), no TightLie button. Wind circle is blue (Phase AU.2).
8. **AX-140**: top-right semantic anchor is Tools (•••), not TightLie.

All amendments preserve the audit's empirical-verification intent; only the
expected behavior is updated to match what shipped.
