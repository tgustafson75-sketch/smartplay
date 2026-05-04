# Phase AZ — Persona Simulation Results

**Method**: code-walk simulation by Claude Opus 4.7 against shipped state at
commit `ad0d489`. **NOT a device run.** Predictions are from reading the
shipped logic in roundStore, kevin.ts, recapGenerator, contextSynthesizer,
listeningSession, swingAnalysis, drillRecommendation, lie-analysis, etc.
Each per-dimension score is what the code WOULD deliver based on the
implementation; anything that requires device feel (voice tone, GPS
accuracy, drag latency) is flagged DEVICE-VERIFY.

This is a **predictive** simulation. Tim should still run the empirical
version per `audit-AZ-methodology.md` to confirm/correct.

---

## Per-persona summary table

| Persona | Onb | 1st rnd | Voice | Cage | Round | TLie | Stats | Recap | Ctx | Conv | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Marcus (Improver) | 🟡 | 🟡 | 🟡 | 🟠 | ✅ | ✅ | 🟡 | 🟠 | 🟠 | 🟡 | **AT RISK** |
| Dave (Weekend) | ✅ | ✅ | ✅* | ✅ | ✅ | ✅ | 🟡 | ✅ | 🟡 | ✅ | **READY** |
| Sarah (Competitive) | 🟠 | 🟡 | 🟠 | 🟡 | 🟡 | ✅ | 🟡 | 🟡 | 🟠 | 🟡 | **AT RISK** |
| James (Returning) | ✅ | 🟡 | 🟠 | 🟡 | 🟡 | ✅ | 🟡 | 🟠 | 🟠 | 🟡 | **AT RISK** |

✅ SERVES WELL · 🟡 SERVES OK · 🟠 SERVES POORLY · 🔴 BROKEN
*Dave's voice = ✅ contingent on earbud tap empirically working — DEVICE-VERIFY.

---

## Marcus — The Improver (handicap 14, cage + rounds equally)

### Code-predicted experience

**Onboarding 🟡 SERVES OK**: Welcome → name → mode → home-course → ready →
meet-kevin synthesizes `kevinContext` via Phase AQ. **Critical gap**: NO
handicap input during onboarding — it defaults to 18 in playerProfileStore
and only gets set later via Phase T WHS flow. Marcus would expect to enter
his 14 handicap upfront so Kevin's strategy advice scales to his game.
Also: no "primary issue you're working on" prompt to seed coach memory.

**First round 🟡 SERVES OK**: Synchronous start (`startRound` is sync), pre-round
briefing fires with `cageContext` + `pre_round_notes` injected. Marcus
benefits if he just had a cage session — briefing should reference his recent
work via `recentCageInsights`. **Gap**: GPS warms lazily, no synthetic Mark
on round-start (in `caddie.tsx` startRound flow, `startGpsManager()` is
called but no immediate `forceMarkPosition`). Hole 1 yardage = static
courseHoles distance until the user moves.

**Voice 🟡 SERVES OK**: Caddie register on course, Coach register on cage —
**but the registers are NOT differentiated system prompts**. They're just
service-grouping labels at the import-hub level. Kevin's voice is unified
across all three modes. Marcus expecting a distinct "Coach" voice when on
SwingLab won't perceive a meaningful tonal shift. Direct/Haiku/Sonnet
routing works as designed for query latency.

**Cage / Phase K 🟠 SERVES POORLY**: Phase K analysis with confidence flag
works (Phase V.6 hedging "tentative read..."); insight synthesis pipes into
`cageStore.recentInsights`. **Critical gap**: drill library has only **6
drills** (alignment / tempo / impact / gate / pump / one-handed). Marcus
hitting `swing_path_outside_in` AND `_inside_out` issues both get the SAME
Gate Drill. No graded difficulty. After 2-3 weeks of cage work, drill
library exhaustion is real.

**Round flow ✅ SERVES WELL**: Live yardages from `getGreenYardagesSync`,
plays-like with weather, displayYardage fallback to courseHoles distance
when GPS empty. Honest "real-or-empty" data flow — won't fake yardages.

**TightLie ✅ SERVES WELL**: Highly context-specific (bundles
hole/par/distance/weather/last-shot/lie-hint/mode/goal/trust-level into
prompt). Anti-platitude system prompt forbids "trust your swing" filler.
Marcus would respect this.

**Stats / scorecard 🟡 SERVES OK**: ShotResult tracks
feel/direction/shape/club/outcome/penalty/distance/gps/weather. Inline
+/- edits ship. **Gap**: dashboard tab exists but multi-round trend depth
(driver accuracy progression, wedge dispersion over time) wasn't deep-read
in this audit. DEVICE-VERIFY whether Marcus sees the analytical depth he
expects.

**Recap 🟠 SERVES POORLY**: `cage_context` + `pre_round_notes` injected into
recap — round→practice link works. **Gap**: per-hole framing is
**mode-driven** (par for free_play, par-1 for break_80) not persona-aware.
Marcus playing free_play gets generic par-relative framing instead of
"versus your typical 14-handicap day." No anti-fluff guardrail in
recapGenerator; quality depends on `/api/recap` prompt language (not
verified in this audit).

**Persistent context 🟠 SERVES POORLY for first 2-3 weeks**: Phase AQ wires
the storage and injection correctly. **Gap**: `kevinContext` is sparse for
new users (only firstName + mode + maybe homeCourse since no handicap or
miss tendency captured at onboarding). `maybeSynthesizePatterns` requires
≥3 cage or ≥5 round insights AND ≥7 days. Until then Marcus's "Kevin
remembers me" expectation stays unmet.

**Conversation feel 🟡 SERVES OK**: 60s rolling buffer, multi-turn handles
"and the wind?" follow-ups via prompt slot. **Risk**: code agent flagged
that `recordUserTurn`/`recordKevinTurn` may not be wired into
`listeningSession.openSession` — DEVICE-VERIFY by tapping a follow-up and
checking Kevin understands context.

### Verdict: **AT RISK**

Three structural gaps for Marcus: (1) onboarding doesn't capture
handicap/issue, (2) drill library is too thin for serious cage work, (3)
voice register differentiation is more label than reality. Each is a
specific fix, not a foundation problem.

---

## Dave — The Weekend Warrior (handicap 22, casual, caddie tap-and-go)

### Code-predicted experience

**Onboarding ✅ SERVES WELL**: Warm Kevin intro, simple chip-based mode
picker, no handicap nag, lands on Caddie home. Dave gets through fast and
isn't asked to think about anything technical.

**First round ✅ SERVES WELL**: Synchronous `startRound`, briefing skippable
via `skip_briefings` setting, then Caddie home with hole 1. Sub-30-second
target depends on dev-client cold-start speed (DEVICE-VERIFY) but logic
path is fast.

**Voice ✅ SERVES WELL** (contingent on earbud tap working empirically):
Earbud tap → `mediaKeyBridge` → `listeningSession.toggle` → captures 8s,
classifies, fires direct handler for distance/wind/club queries. Direct
handlers are **instant** (<500ms target) — exactly Dave's preference.
System prompt enforces "Maximum 2 sentences unless asked for more" — won't
get verbose on him. **DEVICE-VERIFY** earbud tap reliability (Dave's
make-or-break).

**Cage ✅ SERVES WELL** (by absence): Cage features live in SwingLab tab,
not on Caddie home. Dave never enters that tab → never sees them. The
universal green dropdown contains SmartVision/SmartFinder/Mark/TightLie
but no cage entry. Dave isn't burdened by features he doesn't want.

**Round flow ✅ SERVES WELL**: HOLE/PLAYS/TARGET/STROKE bottom strip
(YARDS removed in Phase AY — exactly Dave-friendly: fewer numbers,
bigger fonts). SmartVision card shows hole sketch. Tap mic icon in dropdown
or tap earbud for voice. Simple loop.

**TightLie ✅ SERVES WELL**: One tap from dropdown opens camera; vision
call returns 1-2 sentence recommended_club + alternative_play. Anti-fluff
prompt. Dave gets his "what do I do here" answer fast.

**Stats / scorecard 🟡 SERVES OK**: Dave doesn't care about stats; tab
existence isn't friction. Scorecard gets +/- edits which helps when he
mis-taps a score. Recap is brief. He'd never visit the dashboard.

**Recap ✅ SERVES WELL**: Per-hole + overall_summary, 2-3 sentence Kevin
line. Mode-driven framing (he's break_100) gives him appropriate "you
played within your level" tone instead of pro analysis.

**Persistent context 🟡 SERVES OK**: Doesn't matter much for Dave —
he doesn't notice or care if Kevin "remembers him." Wins by being
unobtrusive.

**Conversation feel ✅ SERVES WELL**: Single-turn per tap matches Dave's
tap-and-go style. He's not chaining follow-ups.

### Verdict: **READY** *(contingent on earbud tap empirical reliability)*

Dave is the persona shipped state serves best. The only DEVICE-VERIFY risk
is earbud tap working consistently across his Bluetooth pairings — that's
the single make-or-break for him.

---

## Sarah — The Competitive Player (handicap 6, tournament, demands precision)

### Code-predicted experience

**Onboarding 🟠 SERVES POORLY**: Mode picker is `break_100/90/80/free_play`.
Sarah at 6-handicap shoots in the 70s consistently — none of these modes
fit her. She'd pick `free_play` reluctantly. **No "tournament" or
"shooting under par" mode** exists. Trust spectrum chips help her pick L2
(Companion — minimal Kevin during shots) but the goal modes don't speak
to her game.

**First round 🟡 SERVES OK**: GPS-driven yardages flow when course
geometry has middle/front/back coords. **Risk**: many courses including
several SoCal munis lack GPS in golfcourseapi (Phase AW finding — 0/31
tested had GPS coverage). For Sarah, ONE bad yardage = lost trust forever.
Palms now has matched OSM coords (Phase AW), so her home course IF it's
Palms works; any other course = Russian roulette.

**Voice 🟠 SERVES POORLY**: System prompt skews toward decisive
recommendations and **lacks an explicit "say I don't know when you don't"
instruction for tactical questions**. Sarah catches Kevin claiming
certainty he can't have ONCE → won't trust him again. Honesty admission
exists for features-in-development but not for live tactical calls.

**Cage 🟡 SERVES OK**: Phase K with confidence flag is honest. She'd respect
"tentative read..." hedge. Drill library too thin (6 drills) but she
practices her own way — less affected than Marcus.

**Round flow 🟡 SERVES OK**: Live yardages, plays-like, real wind data
(weather returns null on failure rather than fabricating — Sarah's win).
**Risk**: SmartFinder yardages from courseHoles middleLat/Lng coords. If
upstream data is +/- 5 yards off her laser, she loses faith. Palms now
has OSM-matched coords with hole-8 estimated — DEVICE-VERIFY accuracy
vs her laser before she'll commit.

**TightLie ✅ SERVES WELL**: Strategic "punt out vs go for it" honesty,
goal-aware buffer logic, conservative_call alternative. Sarah would value
the layback recommendations.

**Stats 🟡 SERVES OK**: Per-shot tracking is comprehensive. Handicap
calculator does WHS Score Differential + AGS with NDB cap + Index
estimate (best 8 of 20). **Gap**: handicap_index null until she sets it
manually; no GHIN posting (1.x). She'd cross-check against GHIN externally.

**Recap 🟡 SERVES OK**: Mode-driven framing problem hits Sarah from the
other side — she's playing free_play (no mode fits her), so recap can't
calibrate. No anti-fluff guardrail in recapGenerator means tone depends
on /api/recap prompt quality (not verified). She'd skim, not value.

**Persistent context 🟠 SERVES POORLY**: Same kevinContext sparseness
issue as Marcus until 7+ days and 5+ round insights. Sarah expects
references to her real patterns (e.g., "you've missed left on 3 of last
5 par-3s") — those need pattern synthesis to have run.

**Conversation feel 🟡 SERVES OK**: Multi-turn 60s buffer good for "what's
the wind?" follow-ups. Same wired-or-not risk as Marcus.

### Verdict: **AT RISK**

Sarah is the highest-stakes persona. ONE GPS error or fabricated tactical
call and she's gone. The "Kevin says I-don't-know when he doesn't"
guardrail is a critical gap. Mode picker not fitting her is structural —
either add a "Tournament" mode or default low-handicap players to a
distinct framing.

---

## James — The Returning Golfer (handicap 18, was 12, needs welcoming)

### Code-predicted experience

**Onboarding ✅ SERVES WELL**: Warm Kevin intro lands well for James.
2.5s min-display gates prevent fast-skip overwhelm. Trust spectrum
explanation is shown twice (welcome + meet-kevin) so he can pick
Companion at his pace. Mode picker has descriptive cards — break_100
fits him cleanly as he rebuilds.

**First round 🟡 SERVES OK**: Synchronous start, briefing fires with his
mode. **Gap**: briefing tone is generic — not specifically welcoming for
returning golfers. Kevin's first-round line via `proactive_kevin` should
acknowledge "rebuilding" framing but doesn't have explicit hooks for
"returning golfer" persona.

**Voice 🟠 SERVES POORLY**: This is James's biggest gap. The three role
registers (Caddie/Coach/**Psychologist**) are NOT differentiated system
prompts — they're labels over a single unified Kevin voice. James
expecting Psychologist register to feel **distinctly more supportive**
when he's frustrated won't perceive a tonal shift. The system prompt
has no "if user is frustrated, downshift to encouragement" branching.

**Cage 🟡 SERVES OK** (when he uses it): Phase V.6 confidence hedging
("tentative read") is exactly right for James's rusty swing. Honest
about not knowing. **Gap**: drill library skews technical (Gate, Pump,
One-Handed) — James might find these intimidating without context.

**Round flow 🟡 SERVES OK**: HOLE/PLAYS/TARGET/STROKE strip is uncluttered
which suits his "rebuilding" mindset. Wind circle, SmartVision, dropdown
all available but not pushed. Won't overwhelm.

**TightLie ✅ SERVES WELL**: `conservative_call` field in lie-analysis
output explicitly recommends layback for risk-averse situations. Anti-
platitude rule means no "trust your swing" empty cheer. James gets
genuine "play it safe here" honesty.

**Stats 🟡 SERVES OK**: Tracks his current baseline. **Gap**: no opt-out
for "don't show me comparisons to past handicap" — but also no aggressive
"you used to be 12" framing exists in code. Neutral.

**Recap 🟠 SERVES POORLY**: Recap fires with `cage_context` + `pre_round_notes`.
Mode-driven framing (he's break_100) gives him a fair lens. **Gap**: no
explicit "find the bright spot, acknowledge effort" instruction — relies
on /api/recap prompt quality. James needs honest encouragement, not
relentless miss-pattern listing. Risk that recap reads as critical when
he wanted supportive.

**Persistent context 🟠 SERVES POORLY**: Same sparseness issue. Worse
for James because his "Kevin gets to know me" bar is highest — he
*needs* Kevin to feel like a real caddie helping him rebuild. Until
patterns synthesize (7+ days), Kevin is generic.

**Conversation feel 🟡 SERVES OK**: 60s buffer, single-turn per tap.
**Gap**: no "Kevin checks in proactively after a frustrating shot" hook
that James would value (proactive triggers exist but checked for
shot_outcomes, not emotional state).

### Verdict: **AT RISK**

James needs Psychologist register to feel different from Caddie. It
doesn't, structurally. Plus no proactive emotional-check-in after
frustration. The encouragement scaffolding is implicit (depends on prompt
language), not enforced. Risk that James experiences Kevin as
"transactional, not supportive."

---

## Cross-persona pattern analysis

### Universal failures (broken across multiple personas)

**UF-1: Voice role registers aren't differentiated system prompts**
Affects: Marcus 🟡, Sarah 🟠, James 🟠
Severity: SERVES POORLY for personas expecting distinct voice modes
Root cause: `services/roles/{caddie,coach,psychologist}.ts` are import
hubs, not separate Kevin voices. `api/kevin.ts` system prompt is unified.
Fix scope: Phase BA — actually differentiate Caddie/Coach/Psychologist
prompts. ~4-6h.

**UF-2: Persistent context sparse for first 7+ days**
Affects: Marcus 🟠, Sarah 🟠, James 🟠
Severity: SERVES POORLY in early week, OK after pattern synthesis
Root cause: `kevinContext` only carries onboarding fields (no handicap,
no miss tendency captured); pattern synthesis gated by ≥3 cage / ≥5
round insights AND ≥7 days.
Fix scope: Phase BB — onboarding adds handicap + dominant-miss capture;
seed `kevinContext` with these so day-1 Kevin has substance. ~2-3h.

**UF-3: No explicit "say I don't know" guardrail in tactical voice**
Affects: Sarah 🟠 (critical), Marcus 🟡 (notices), James 🟡 (would value)
Severity: ONE bad tactical call from Kevin = Sarah lost
Root cause: `api/kevin.ts` system prompt admits dev-status honesty but
doesn't enforce uncertainty admission for live recommendations.
Fix scope: Phase BC — system prompt addition: explicit instruction
"when GPS is missing or course geometry is incomplete, say so. When
weather data is null, say 'I don't have wind right now.' When uncertain,
say 'best guess' explicitly." ~30 min.

### Persona-specific failures

**PS-1 (Marcus only): Drill library too thin for serious cage user**
Severity: SERVES POORLY after 2-3 weeks of cage work
Fix scope: Phase BD — expand drill library from 6 → 18+, with graded
difficulty and per-issue specificity. ~1-2 days.

**PS-2 (Sarah only): No mode for low-handicap / tournament play**
Severity: AT RISK — mode picker doesn't fit her game
Fix scope: Phase BE — add `break_75` / `tournament` mode OR change
free_play to dynamically calibrate par-relative framing from handicap.
~3-4h.

**PS-3 (James only): No emotional-state-aware proactive Kevin**
Severity: SERVES POORLY for frustration-recovery use case
Fix scope: Phase BF — add proactive trigger on consecutive bad shots
(double bogey + worse) firing Psychologist-register check-in. ~2-3h.

### Persona conflicts (feature serves one but harms another)

None identified. The product's modular trust-spectrum + opt-in
features (dropdown, Tools menu, SwingLab tab) keep each persona's
preferred surface clean.

### Universal wins (working well across all personas)

- **Honest data flow**: real-or-empty (no fabricated GPS/weather/yardages)
- **TightLie**: anti-platitude prompt + goal-aware buffer logic + conservative_call
- **DataStrip simplification**: HOLE/PLAYS/TARGET/STROKE uncluttered
- **Mode-driven recap framing**: scales to player level (helps Dave + James)
- **Phase V.6 confidence hedging**: "tentative read" in cage analysis
- **Trust spectrum**: opt-in Kevin presence; Quiet/Companion/Active/Full all reachable
- **Onboarding pacing**: 2.5s min-display gates prevent overwhelm
- **Inline scorecard +/- edits** (Phase AY): mid-round corrections without leaving the surface

---

## Beta-launch verdict

**Target**: all four personas READY or ACCEPTABLE.
**Current code-predicted state**:
- ✅ Dave — READY (DEVICE-VERIFY earbud tap reliability)
- 🟠 Marcus — AT RISK
- 🟠 Sarah — AT RISK
- 🟠 James — AT RISK

**3 of 4 personas AT RISK based on code analysis.** External beta is
**NOT recommended** until at least UF-1 (voice register differentiation),
UF-2 (onboarding handicap/miss capture), and UF-3 (uncertainty guardrail)
ship. Those three fixes elevate Marcus → ACCEPTABLE, Sarah →
ACCEPTABLE, James → ACCEPTABLE without touching anything else.

**Internal beta with Tim only**: GO — the AT RISK gaps don't break
core function, they erode trust over time. Tim playing solo wouldn't hit
them in a single round.

---

## Refinement priority queue

**Priority 1 — UF-1: Differentiated voice role prompts**
- Affects: Marcus, Sarah, James (3 of 4 personas)
- Severity: SERVES POORLY
- Root cause: roles are labels not prompts
- Fix scope: Phase BA — split kevin.ts system prompt into 3 by-role
  variants OR add role-specific tone-modifier blocks. ~4-6h.

**Priority 2 — UF-3: Uncertainty admission guardrail**
- Affects: Sarah (BLOCKING), Marcus (notices), James (values)
- Severity: AT RISK / BROKEN for Sarah
- Root cause: kevin.ts prompt lacks "say I don't know" enforcement
- Fix scope: Phase BC — add 3-line instruction block. ~30 min.

**Priority 3 — UF-2: Onboarding captures handicap + miss tendency**
- Affects: Marcus, Sarah, James (all need richer day-1 context)
- Severity: AT RISK in week-1 experience
- Root cause: onboarding skips these fields; Phase T fills handicap later
- Fix scope: Phase BB — 1 new onboarding screen "About your game"
  with handicap input + dominant-miss chips. Inject into kevinContext
  synthesis. ~2-3h.

**Priority 4 — PS-2: Tournament/low-handicap mode**
- Affects: Sarah only
- Severity: AT RISK
- Fix scope: Phase BE — add `break_75` mode or auto-calibrate by handicap. ~3-4h.

**Priority 5 — PS-3: Emotional-state proactive trigger**
- Affects: James only (but improves all returning/new-golfer personas)
- Severity: SERVES POORLY
- Fix scope: Phase BF — proactive trigger on consecutive bad shots. ~2-3h.

**Priority 6 — PS-1: Drill library expansion**
- Affects: Marcus only (longer-term gap, weeks 3+)
- Severity: SERVES POORLY at week 3+
- Fix scope: Phase BD — 6 → 18+ drills with progression. ~1-2 days.

**Total scope to move all personas to ACCEPTABLE**: ~12-16 hours of code
work split across Phases BA / BB / BC. Phase BE-BF-BD are nice-to-haves
that move the bar from ACCEPTABLE → READY.

---

## DEVICE-VERIFY items (code analysis can't answer)

Tim should verify on real device:

1. **Dave's earbud tap reliability** across AirPods / Galaxy Buds / generic
2. **Sarah's GPS yardage accuracy** vs her laser rangefinder on her home course
3. **Conversation buffer wiring** — does `listeningSession` actually call
   `recordUserTurn`/`recordKevinTurn`? (audit code agent flagged uncertainty)
4. **Recap tone** for free_play mode — is it honest or fluffy? Depends on
   `/api/recap` prompt language not deeply verified in this audit.
5. **Briefing references** — does pre-round briefing actually mention
   recent cage work when cageContext has insights? (Phase AQ wiring assumed
   good but not visually confirmed)
6. **Persistent context surfacing** — after 7+ days of usage, does Kevin
   actually reference patterns?

---

## Limits of this report

- This is a **code-walk simulation**, not a device run. Voice tone, GPS
  feel, drag latency, briefing audio playback, and many other "feel"
  dimensions cannot be assessed from source.
- Some sub-systems weren't deep-read (e.g., `/api/recap` prompt content,
  `/api/briefing` prompt content). Findings on those have lower confidence.
- The recapGenerator mode-driven framing finding assumes the /api/recap
  prompt honors mode framing — it might or might not.
- Predictions assume Tim has fresh Palms data (Phase AW shipped) and
  active session continuity — first-install behavior would be sparser.

For full empirical verification, run the per-persona simulations per
`audit-AZ-methodology.md` on a real device.
