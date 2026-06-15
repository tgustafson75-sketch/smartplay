# SmartPlay Caddie — Test Manual
_Last updated: 2026-06-14. Covers every tool, mode, and option. Built from a full read-only pass of the live code — only documents what actually works; dormant/gated items are flagged._

---

## How to read this manual

**Status legend:**
- **LIVE** — fully wired; works on the current OTA build.
- **NATIVE-POSE** — code complete but inert until a fresh **native build** that includes the MediaPipe pose plugin. *Not OTA-shippable.* Gates: skeleton overlay, phase scrub, tempo numbers, biomechanics body row, shoulder/hip-turn rails, club-speed, Framing Coach. Without it they honestly show "—" (never fake data).
- **PARTIAL** — screen/flow is LIVE but a number depends on a gated/network signal.
- **NETWORK** — needs connectivity (cloud brain, AI content, TTS, recap, search, scene read).
- **DORMANT** — code exists, no entry point reaches it yet.
- **GATED** — paywall (round start, SmartVision, SmartFinder, Scene Read) or owner-only (Mark Location, debug screens).

**Before testing — prerequisites:**
- **Permissions:** Location (GPS yardages, AR ranging, course sort), Camera (SmartFinder, Smart Motion, captures, scene read), Microphone (voice asks, dictation, video capture, acoustic segmentation).
- **Native-pose note:** confirm whether your build includes the MediaPipe plugin. If it's the ~2-week-old build, all NATIVE-POSE items read "—" — that's expected, not a bug.
- **Acoustic note:** tempo + ball-trace are anchored to a cage acoustic strike (non-zero loudness). Range/upload/video-located swings show no tempo by design even on a native build.

---

## 1. PLAY TAB (course selection + start a round)

| Tool | How to reach | Key functions | Caveats |
|---|---|---|---|
| **Course discovery** | Bottom tab → Play | Local courses list (Palms, Lakes, Rancho California, Crystal Springs, Mariners Point, San Jose Muni, Sunnyvale, Echo Hills, Westlake) w/ thumbnails + rating/slope; GPS-distance sort; golfcourseapi search (Courses / Range toggle, 3+ chars); GPS-refresh button; active-round banner | Search = NETWORK. Distance sort needs location (fires on tap, never auto). Some local courses use a placeholder layout. |
| **Round setup factors** | Select a course → factors render below | STRATEGY (Break 100/90/80/Free), MENTAL, FORMAT (9-hole, Competition, Tournament), **GETTING AROUND (Walking/Cart)**, TEE BOX, NOTES (typed or 🎤), **Start Round** | Round start is **GATED** (paywall). Tee box is informational in v1.1. Notes dictation = NETWORK + mic. |
| **View → SmartVision** | Selected course → **View** | Sets preview course, opens the SmartVision hole map | **GATED**. This is where **layup/aim lines + the "T" aim** live (NOT SmartFinder). |
| **Log → Course Detail** | (i) icon or **Log** button | The course "book" (see §2) | — |

**Steps:** Open Play → (optionally tap locate to sort by distance) → tap a course → set factors → **Start Round** (hands to Caddie tab, launches directly).

---

## 2. COURSE DETAIL — the course "book" (`/course/[id]`)

- **Reach:** Play → (i) on a course, or **Log** on the selected card.
- **Functions:** Title + 9/18 badge · **Caddie Tips** (AI) · **Hole Photos** grid (your captured photo → curated bundle → satellite) · **Hole Guide** table (#/Par/Yds/Note + AI per-hole notes) · sticky **[Book Tee Time]** + **[Start Round Here]**.
- **Book Tee Time:** opens the course's real website when known (Google Places lookup), else a tee-time search.
- **Caveats:** AI tips/notes = NETWORK (15s timeout → "—"). Curated photos exist for the 5 named courses; others use satellite (now coord-guarded — no more wrong "parking lot" tiles). Places booking needs the **Places API enabled** on the Google key (else falls back to search). Per-hole info anchors into the offline course book on first load.

---

## 3. CADDIE TAB (voice + brain + tools)

| Tool | How to reach | Key functions | Caveats |
|---|---|---|---|
| **Voice caddie (tap-to-talk)** | Tap avatar (L2/L3) or in-round mic | listen→record→transcribe→brain→speak; haptic on tap | Mic permission. Transcribe + brain = NETWORK; failure → local fallback. |
| **Active Listening (VAD)** | Tools → "Active Listening: ON" | Hands-free hot mic; pulsing green pill; round-only | OFF by default. **Routes ALL detected speech to the brain** (TV/ambient can false-trigger). |
| **The brain** | Ask anything | Local short-circuits first (help/sing/song/plain-speak) → cloud `/api/kevin` → local fallback | General Qs are cloud-first (NETWORK); offline = templated local replies only (§10). |
| **Plain-speak / layman** | Say "explain simply / I'm new / ELI5" | Reshapes the next answer simpler | Per-utterance, not a toggle. |
| **Personas** | Tools → "Caddie:" cycler | Kevin / Serena / Tank / Custom | **Harry is dormant** (not in cycler). Custom needs a generated portrait/voice. |
| **Presence / Trust** | Tools → "Presence" | Quiet (Cockpit) / Companion (default) / Active | L4/L5 removed; old levels migrate to Companion. |
| **Tools menu (••• pill)** | 3-dot circle, top-right | Presence/Voice, GPS/Round, Practice (SwingLab/SmartVision/SmartFinder/Coach Mode), Help, App | The single tools entry (old FAB hidden). SmartVision/SmartFinder rows **GATED**. |
| **Hole preview + GPS dot** | L2/L3 layout; tap → SmartVision | Hole hero image + player dot + yards-to-green, refreshed ~4s | Needs valid fix + tee/green coords; hides dot when >1500y or distances disagree. |
| **Quick instruction cards** | Auto once per screen | Silent pop-up + on-demand 🔊 | Silent by default (out of the voice path). |
| **Pre-round stretch** | **Ask** the caddie ("pre-round stretch") | Health-aware stretch + 3 exercises; save/recall as routine | No button — ask-only (discoverability gap). |

---

## 4. SMARTFINDER (`/smartfinder`) — **GATED**
Top toggle: **Standard · Target · Map · Putt** (persists).

| Mode | Key functions | How to use | Caveats |
|---|---|---|---|
| **Standard** | Camera AR; tilt-down + tap locks distance from GPS+heading+pitch; confidence color; 30s auto-clear; F/M/B strip; pinch-zoom | Aim, **tilt phone down** at the ground toward target, tap to lock | Flat hold → "can't measure" (by design). AR estimate, not a laser. |
| **Target** | Drag yellow reticle → live yds; **answer-first card** (club + plays-like + why); detailed breakdown (carry±dispersion, hazard, aggressive/conservative); padlock | Drag reticle to landing spot, read club | Carry/dispersion are tour-average "(est.)" until you log real carries. Elevation often 0. **No layup lines here.** |
| **Map** | Top-down hole (if geometry) tap-to-yardage, else F/M/B grid + "Mark this green"; hazards; Refresh GPS | — | Tap-to-yardage only when tee+green resolve. Refresh is round-only. |
| **Putt** | Live UPHILL/DOWNHILL %; tap ball→hole = distance (FEET EST) + slope %; YOUR READ break + pace | Tap ball, tap hole | **Uncalibrated** (`PIXELS_PER_FOOT` heuristic) — rough read, labeled EST. |
| **Scene Read (eye button)** | Snaps frame → multimodal brain qualitative read; spoken + card | Standard/Target only | **NETWORK + GATED**; offline → "unavailable." |
| **Photo / Video capture** | Photo → hole "single"; video (60s) → "pano"; tags heading + GPS; ingests to the course book | Snap/record while at the hole | Needs a course context to tag. Video needs mic. Your photo then shows on the course-book hole grid. |

---

## 5. ROUND PLAY

| Tool | How to reach | Key functions | Caveats |
|---|---|---|---|
| **Scorecard** | Scorecard tab (round-active) | Score/vs-par/holes; putts, **Fairway% / GIR%**; per-hole rows + ± steppers; club-usage tables (round / per-course bag + reco / lifetime); Kevin's Take + Listen; Share | A bare score tap does NOT auto-fill putts (GIR/avg-putts skip those holes). GIR/fairway are proxies. Per-course bag "forming" until 2+ in-app rounds. |
| **Shot tracking** | On the hole map (ShotTracked sheet) | Mark ball rest → logs shot; distance (GPS prev→current, or tee→ball); club chip (inferred, tap to correct) → builds bag yardage | Confirmed club trains the bag once. "Driver did what?" goes via **voice** (§10), not a button. |
| **Mark Tee / Green** | Tools → Mark Location | TEE/GREEN toggle + hole; capture fresh fix → feeds SmartFinder; clear; all-marks list | **OWNER-GATED** (allow-list incl. your email) or dev build. Needs active round + fix. |
| **Round Rest mode** | Auto after ~60s untouched in a round | Near-black overlay (OLED battery save); "GPS LIVE · RESTING"; tap to wake | Auto only; GPS/voice keep running. |
| **Recap** | Auto on End Round / Recent Rounds | Hero + collage + handicap impact + Kevin's summary (▶/walk-through) + key moments + hole-by-hole → per-hole shot map + Share/PDF | Renders instantly (archived/synthesized); only a just-ended round polls for the richer AI recap. Play-aloud = NETWORK. |

---

## 6. SMART MOTION (`/swinglab/smartmotion`) — core record → analyze
Reach: SwingLab tab → **Smart Motion** card. Pager: page 1 capture/review · page 2 ANALYSIS · page 3 SHOT MAP (DTL only). **No countdown — the open window IS the recording.**

### 6.1 Setup toggles
| Toggle | Where | Options | Notes |
|---|---|---|---|
| **Environment** | tools card → environment row | **Cage** (acoustic multi-swing) / **Range** (video + acoustic correlate, 120s) / **Course** (video, acoustics off, 60s) | A live round **locks to "Course (round)"**. Loud cage now degrades instead of losing swings. |
| **Angle** | bottom-left golfer badge (tap to cycle) | **DTL** (aim line, effort/carry, ball-trace, shot map) / **Face-On** (target+ball guides) / **Putt** (putt read) | Putt is explicit per-recording (not from club). Lefty mirroring follows the recorded family member. |
| **Camera** | tools card → Selfie row | Front / Rear | Mirror OFF (selfie clip is analysis-safe). |
| **Calibrate (10-strike)** | tools card → Calibrate, or tap the acoustic card | Pick env, record 10 strikes → noise floor + threshold | NATIVE/mic; drives cage detection accuracy. |
| **Chip mode** | tools card → Chip mode | Lowers strike threshold (~18 dB) for quiet chips | LIVE. |

### 6.2 Record → review
- **Record:** tap the green Record badge (mic permission). Pill shows seconds + remaining. Stop manually or auto-stop at window end ("That's your minute — analyzing now"). Hands-free: "caddie record/stop."
- **Segmentation:** each acoustic strike → a swing window; **multi-swing → a reel of separate results, each with its own read + its own ball trace** (fixed 2026-06-14). Hit ~3 swings ≥2s apart.
- **Review (page 1):** video playback (opens on the swing, windowed loop), segments reel (tap a swing), play/pause, slow-mo (1×/½×/¼×), ball trace (DTL, acoustic-anchored), SmartTrace badge, verdict badge, strike cross-check, Re-analyze.

| Review feature | Status |
|---|---|
| Playback, seek-to-swing, windowed loop, reel, slow-mo, ball trace, verdict, re-analyze | **LIVE** |
| Skeleton/Motion overlay, phase scrub (Address/Top/Impact/Finish), shoulder/hip turn, weight-shift | **NATIVE-POSE** |
| Tempo (bar + badge) | **PARTIAL** — acoustic-gated AND needs pose |
| Speed cards (club mph) | **PARTIAL** — club speed needs pose |
| Body Analysis row (Sway/Tilt/Posture/Weight) | **PARTIAL** — Weight needs pose |

- **Page 2 (ANALYSIS):** Top focus + confidence, observation, why, the fix, recommended drill, layman toggle, **Open drills**, Coach Notes + 🎤, How'd it feel? + "run it by your caddie." **FACE ANGLE + SMASH = "COMING SOON"** (dormant, needs 240fps).
- **Page 3 (SHOT MAP, DTL only):** Cage = bullseye (lateral start dot, "est · preview" + confirmable canvas/camera distances). Range/course = vertical course (effort→carry + trace). All "est"-flagged, no fake dots.
- **Save:** Confirm → flushes notes/feel, awards drill points, → Swing Library. **Discard** deletes.

### 6.3 Cage Mode pre-flow
`/cage` → "Cage Mode" → Start Session (+ "Space Scan" → one-photo space assessment, NETWORK vision).

---

## 7. DRILLS & PRACTICE ENGINE

| Tool | How to reach | Key functions | Caveats |
|---|---|---|---|
| **Drills catalog** | SwingLab → Drills | Per-issue drill cards (miss pattern, count) | LIVE. |
| **Drill detail → Practice in Smart Motion** | Tap a drill card | Primary issue, faults, drills, Tank tips, WATCH (YouTube); **"Practice in Smart Motion · N swings"** launches drill-aware capture (right angle per drill, capped 1-5) | Per-drill honest *metric* is NATIVE-POSE. Drills without a practice descriptor hide the button. |
| **Open Range** | SwingLab → Open Range | Live BALLS / FLIGHT SEEN / ON LINE / TEMPO + BY CLUB; blocked-practice nudge ("X of N one club") | BALLS is real; flight/on-line/tempo are PARTIAL (pose/trace). |
| **Focus Session** | SwingLab → Focus Session | Pick a focus (irons/short game/driver/etc.), default 12 reps; auto-advances; switch-clubs prompt | Reads PARTIAL. |
| **SmartPlan** | SwingLab → SmartPlan | Goal + days/week + minutes + where → weighted plan; each day launches a Focus Session | Plan not persisted; never promises an outcome. |
| **Practice points** | Earned on any practice save | 5 base + 1/swing (cap 5) per drill/focus/open-range; feeds the visible tier | Empty sessions grant nothing. |

---

## 8. SWINGLAB — library / upload / detail

| Tool | How to reach | Key functions | Caveats |
|---|---|---|---|
| **Swing Library** | SwingLab → Swing Library | Cage + uploads; filters (source/date/club/swinger); compare → % match; delete | Tap-to-play/zoom lives on the detail screen. |
| **Upload Swing** | Library → upload button | Pick gallery video → CLUB / NOTES / WHO'S SWINGING / PERSPECTIVE / **CAMERA ANGLE (DTL / Face-on)** / CAPTURE DEVICE / TAG → Add | **The "second video source":** AirDrop an iPad/GoPro face-on clip, upload it, **pick Face-on** so it's read correctly (not as DTL). >60s → trim; ≤60s → auto-analyze. |
| **Swing Detail** | Row tap / post-upload | Tap=play/pause, pinch=zoom, double-tap=reset, slow-mo, tap-to-seek, issue-card timestamps scrub; Re-analyze (probes file exists) | Playback LIVE; biomech/tempo NATIVE-POSE even when status "ok". |

---

## 9. PUTTING ANALYSIS
- **Vision read (LIVE, fallback-first):** SmartMotion PUTT mode / uploaded putt / voice intent → server vision returns slope/setup/stroke/read/score. **A populated card is NOT proof a putt was measured** — check confidence / "partial" (it always returns a low-confidence card if frames/voice/network missing).
- **Tripod "watch-the-roll" core:** **DORMANT** (pure roll math exists + unit-tested, no live caller/UI yet).

---

## 10. OFFLINE ON-COURSE VOICE ASKS (work with dead cellular)
Fires when the brain call fails; answer comes from local round state (EN/ES/ZH). Spoken via `/api/voice` when reachable; fully offline = silent reply but the answer still shows as caption/UI.

Supported: **yardage** (front/middle/back), **club call** (from your real logged bag), **plays-like** (wind-adjusted), **wind**, **can I reach it**, **last shot / "what did my driver do"**, **hole info / hazards** (from the offline course book), **hole / par / score / holes left / tee / course / club in hand / handicap**, **save/recall pre-round routine**.
Caveats: most need a valid recent GPS fix (none → "no GPS lock yet"); club/reach need a tracked bag; honest weak-fix hedges throughout.

---

## 11. DASHBOARD (Home tab) — cards top to bottom
Most cards are conditional (a fresh install shows far fewer).

1. **Brand header** + ••• tools pill (always).
2. **Profile card** → tap identity = `/profile`, gear = `/settings`.
3. **Coach Mode / shared group** — only when Coach Mode ON + roster.
4. **Selfie + AI portrait** → custom caddie.
5. **Current Round** — score card if active, else CTA → Play.
6. **Weather** — round-active only.
7. **Shot Stats** — shots logged / fairway% / tee avg (tee shots only; "—" otherwise).
8. **Practice Points** — when total > 0.
9. **Practice History** — sessions by date → tap → detail (per-club striation + tempo trend).
10. **Practice → Performance** — when ≥1 session + ≥1 round; honest association (practice/wk vs score-vs-par).
11. **Recent Shots** timeline.
12. **Recent Rounds** → tap → recap.
13. **Pattern Shift** alert (when it fires).
14. **Kevin's Read** — tap to regenerate (NETWORK).
15. **Highlights** (best round / longest drive / longest putt* / saved) — *longest putt manual entry.
16. **Milestones**.

---

## 12. PROFILE / FAMILY / COACH MODE

| Area | Reach | Functions | Caveats |
|---|---|---|---|
| **Profile** | Dashboard profile card | Handicap index, bag, longest drive/putt; Import rounds (bulk/single); Recalculate (best 8 of 20) | Recalc assumes 72.0/113 per course; GHIN informational. |
| **Custom Caddie** | "Try a new look" / Tools → Your Caddie | Selfie → AI portrait + name + record your voice + default voice | AI gen = NETWORK; activate via persona cycler. |
| **Family Coaching** | Settings → Help → Family Coaching | Add/edit/archive members; per-member library | Device-local; voice flow needs recording pipeline. |
| **Team Captain** | Settings → Help → Team Captain | Coaches (call/text/email), teammates (trend), team broadcast (native Messages) | Contacts never leave device. |
| **Coach Mode** | Caddie tab / Tools toggle (NOT settings) | Record/review family swings; dashboard group card | OFF by default. |

---

## 13. SETTINGS (`/settings`) — every option
Reach: dashboard gear, Tools → Settings. Search bar filters + expands. Sections: Profile · Caddie · Round Experience · Voice & Conversation · Language & Display · Devices & Health · Developer (dev only) · Data & Privacy · Help · Owner Tools (owner only) · Reset.

**Key options (default):** Active Caddie persona (Kevin) · per-pillar caddie assignments · Response Style (Normal) · Greet on launch (ON) · Caddie presence/trust (Companion) · Skip briefing (off) · Proactive caddie (on) · **Riding in a cart (ON)** · **Local Mode** (off — battery/weak-signal, ask-only) · **Active Listening** (off) · Cecily Mode (off) · Continuous Conversation (off) · Voice on Phone Speaker (on) · Captions (on) · **Language** (English — *spoken only, UI stays English*) · Theme (System) · Cast (off) · High Contrast (off) · Screenshot mode (off, not persisted) · Large Text (off) · **Simple briefing** (on) · per-persona intensity · **Distance Unit (Yards)**.

**Devices & Health:** Samsung Watch (**DORMANT**), Health Connect (Android), Earbud tap (**dormant — no native listener**), Ray-Ban temple tap (**BLOCKED**).

**Owner Tools (owner email only):** Reset Tutorials, Glasses Mode, Feel Capture, debug screens (harness, voice misses, telemetry, GPS bench, learning, Mark Location).

**Reset:** **Reset App Data** = the only data-clear (no real auth/Sign Out); needs force-close + reopen.

**Controlled elsewhere (not in Settings):** Coach Mode, Chip sensitivity, Environment mode (Smart Motion), Rest mode (automatic).

---

## 14. POINTS / TIERS
- **Practice Points** (`practice-points`): 5 + 1/swing (cap 5) per drill/focus/open-range; shown on the dashboard.
- **Tier** (Beginner → Club Player → Course Regular → Smart Golfer → SmartPlay Elite): fed by rounds + cage + caddie + (now) all practice. **Computed but not currently shown on a primary screen.**

---

## 15. MISC TOOLS
- **Jukebox** — say "play [song]" → kid-safe YouTube player + caddie sings. **Needs `YOUTUBE_API_KEY` (server)** + a native build for the embedded player (else in-app browser).
- **Tee / Score Goals** — Caddie tools → `/tee-goals`: "break X from the Y tees" challenges, honest progress vs round history.
- **Practice Session Detail** — dashboard Practice History → tap: by-club striation + tempo trend.
- **Owner/Debug screens** — owner-only; harness, telemetry, GPS bench, etc.

---

## Cross-cutting "expected, not a bug" list
- **NATIVE-POSE features read "—" on the current OTA build** (skeleton, phase scrub, tempo, biomech, framing). Unlocks with the native TestFlight build.
- **Elevation/plays-like uphill-downhill** often 0 (feed dormant).
- **Harry persona** not in the cycler.
- **Target direction "—"** on the in-round data strip (no aim engine yet).
- **Pre-round stretch** is ask-only (no button).
- **Language** translates voice, not UI text.
- **Places booking / Jukebox** need their respective API keys enabled server-side.
- **Mark Location + debug screens** are owner-gated.
