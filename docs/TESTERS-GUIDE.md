# SmartPlay Caddie — Testers Guide

A plain-language tour of what's in the app, how to use it, and what to try. No code. No jargon. Updated **2026-05-27**.

If anything's broken, the fastest way to tell us is in **Reporting Issues** at the bottom — one voice command sends a log right to support.

---

## What this is

An AI golf caddie that talks. Lives in your pocket. Calls clubs, reads your swing, runs your tournament, and (mostly) keeps quiet when you tell it to.

It's three apps in one shell:
- **Round** — on-course caddie + GPS + scoring
- **Practice (SwingLab)** — cage / range swing capture and analysis
- **Play (Dashboard)** — your history, patterns, drills, and recaps

---

## Your caddie team — pick whoever fits your day

You always have all four. Switch in **Settings → Caddie Team** or by voice ("switch to Tank", "let me hear Serena").

| Caddie | Voice | Character |
|---|---|---|
| **Kevin** | Onyx | The friend in the cart who knows your numbers. Default for new users. Warm, observant, never preachy. |
| **Serena** | Nova | Calm, analytical, professional female caddie. Numbers-forward. |
| **Tank** | Ash | Marine drill-sergeant intensity. Clipped, no-BS, gets you out of your head. |
| **Harry** | Fable | Older British storyteller-mentor. Grandfather wisdom voice. Pairs with Cockpit mode (data-forward UI). |

Each persona has its own "personality dial" in Settings → Display & Accessibility. 100 = full intensity, 30 = quietest before you mute entirely.

---

## How to talk to it

**Tap the caddie** (his face or the logo on the caddie tab). You'll feel a haptic. He starts listening. Talk. He answers out loud.

You don't need to say "Kevin" or "Hey Tank." Just talk.

You can also say things he's listening for proactively while a round is active:

### Things you can say at any time
- **"What's my yardage?"** / "How far?" / "How far to the pin?" / "How far to the front?"
- **"What club?"** / "What should I hit?" / "What's the play here?"
- **"What's the wind doing?"** / "How's the weather?"
- **"How's my score?"** / "What hole am I on?"
- **"Open SmartFinder"** / "Open SwingLab" / "Open settings" / "Show me my scorecard"
- **"What's the play"** / "Should I go for it" (defaults to aggressive lie analysis)
- **"Should I lay up"** (defaults to conservative lie analysis)
- **"Open TightLie"** / "Check my lie" / "Take a look at this" / "What do you see"
- **"Start cage session"** / "Start practice" / "Let's practice"
- **"Mark the tee"** / "Mark the green" / "Mark the pin" — captures GPS in place when you're standing on it
- **"Record me down the line"** / "Record me face on" — fires SmartMotion at the right angle
- **"Chip cam"** / "Putt cam" — SmartMotion in the right shot mode
- **"I'm coaching Emma"** / "Coach Mike" — opens Coach Mode pre-set to that student
- **"Open coach mode"** / "Coach mode"
- **"Open library"** / "Show me my swings"
- **"Open SmartPlay"** — full lie-analysis with the conversational opener
- **"Log this — recap is slow"** / "Report a bug — Tank cut me off"  — captures an issue in your Issue Log

### Things you can say to dial down or boost the caddie
- **"Go quiet"** / "Be quiet" / "Shush" — Quiet mode (Level 1)
- **"Come back"** / "Speak up" / "Talk to me" — back to Companion (Level 2)
- (You can also drag the trust slider in Settings)

### Asking him the odd question
He'll answer **golf history / rules / "who won the Masters in '86"** style questions out loud.
- "What's the rule on a lost ball?"
- "What's my handicap?"
- "Who won the Masters in '86?"
- "Tell me about this course."

---

## The five trust levels (how chatty he is)

The slider in Settings → Caddie Team picks how much the caddie volunteers.

| Level | Name | What it means |
|---|---|---|
| 1 | **Quiet** | He only speaks when you tap. Captions everywhere. |
| 2 | **Companion** | Default. Speaks on transitions + when asked. |
| 3 | **Active** | Proactive — chimes in mid-hole when he notices something. |
| 4 | **Full** | All-in. Talks through the whole round. |
| 5 | **Cockpit** | A different layout entirely — data-forward, minimal voice. Harry's home. |

In Quiet mode, when you tap him to talk he **will** answer — the slider muffles auto-talk, not your direct asks.

---

## Cockpit mode (Level 5)

A stripped-down on-course layout. Hole nav, distances, scoring, four big tool pills (Vision, Motion, Play, Settings) and now a 5th **Tools** pill that opens the full tools menu (Drills, Library, Mark Location, etc.) so you don't get stuck.

If you swap to Harry, you're effectively in Cockpit — that's by design. Harry's the analog, no-frills caddie. His "face" is the data screen.

---

## Playing a round

1. **Start Round** on the Play tab. Pick a course, mode (Free Play / Tournament / Practice), and tees.
2. **Briefing** — caddie reads your round intro (course intel, who you are, what to watch for). Tap-skip if you don't want it.
3. **Cart vs walking** — the app assumes cart by default (~95% of golfers ride). Walking detection works but cart is the primary calibration.
4. **Per-hole** — caddie reads a per-hole intro on hole change. Yardages auto-update. Tap his face anytime.
5. **Logging shots** — say "I hit a 7-iron 145 yards" or use the tap UI on Scorecard.
6. **End of round** — tap End Round → recap with notes, photos, social-share card.

### Voice score-telling
- "I got a 4 on hole 7" / "Mark me down for a five" — logs the score
- "What hole am I on" / "What's my score" — query

---

## SmartTools at a glance

| Tool | Where | What it does |
|---|---|---|
| **SmartVision** | Tools menu / voice | Live camera analysis (terrain, distance to hazards) |
| **SmartFinder** | Tools menu / voice | Rangefinder / yardage tool with draggable target |
| **SmartMotion** | SwingLab / voice | Quick swing record — film yourself, get the one thing to fix |
| **TightLie** (lie analysis) | Caddie tab / voice | Snap a photo of your lie, get a play recommendation |
| **SmartPlay** | Voice "Open SmartPlay" | Conversational opener — caddie asks "what do you see?" before the photo |
| **Cage Mode** | SwingLab / voice | Range session — auto-captures every swing, gives a session summary |
| **SwingLab** | Tab bar | Practice hub. Drills, library, cage, coach mode |
| **Coach Mode** | SwingLab / voice | Watching someone else swing? Pre-set the student, capture their swing |
| **Mark Tee / Mark Green** | Voice | Captures your current GPS as the tee/pin for the hole you're on |

---

## Practice / Drills

**Drills tab** — common-fault diagnoses with 2-3 drills each, plus a pro-instruction video link per fault.

### What's at the top of the Drills grid

**Tank's Take — Practice with Standards** (Tank's first video covers Early Extension — pinned first because that's the most common fault diagnosis).

Tap in → you'll see:
- The standard drill text
- **Tank's Tips** infographic — full-page comparison card (PGA vs The Golf Father). Tap to zoom — it's text-heavy on purpose.
- **Watch** card — Tank's YouTube video

**Chang Chip — Randy Chang short-game** is pinned second. Randy is the head pro at Journey at Pechanga, known for his under-3-minute YouTube instruction format.

The rest of the catalog follows — Swing Path, Grip, Posture, Ball Position, Weight Transfer, etc.

### What links to what
When the AI analyzes your swing and flags **early extension**, the **Posture** card lights up as your primary issue. Tank's "Take on Early Extension" is in that lane.

---

## Cage Mode (the range / cage WOW feature)

Voice: **"Start cage session"** or tap Cage Mode in SwingLab.

What happens:
- Acoustic detector listens for ball-strike impacts
- Every swing auto-captures (no tap-to-record)
- After the session, you get a session summary: contact quality, dominant miss, primary issue, drill recommendations
- Each swing is saved to your Library

Tip: tell the caddie what club you're hitting — "switching to driver" — so it segments the session right.

---

## SmartMotion (quick swing capture on course)

Voice: **"Record my swing"** / **"Record me down the line"** / **"Record me face on"**

Quick-record screen opens, films, analyzes via vision AI, gives you the **one thing to fix** plus a drill suggestion.

Also accepts:
- "Chip cam" / "Putt cam" — pre-tags the shot type
- "Watching Chris" / "Coach my student Mike" — pre-tags the swinger (Coach Mode)

---

## Library (your past swings)

Every Cage Mode swing + every uploaded video lands here.

- Filter by date, club, swinger
- Tap a row → swing detail screen
- Long-press a row → delete
- Trash icon also visible on each row

You can **Compare** any swing to a reference (yourself last week, a pro reference, an archetype).

---

## Personal Caddie (your selfie + AI portrait + YOUR voice)

Settings → Your Caddie.

### Step 1 — Selfie
Front camera. Good light. Crop to a square.

### Step 2 — Describe Your Caddie
Pre-filled prompt ("Stylize this person as a confident golf caddie…"). Edit if you want a specific look.

### Step 3 — Generate Caddie
Sends to the image AI. Returns a stylized portrait.

### Step 4 — Record YOUR voice (optional)
Record short fixed phrases in your own voice. The caddie uses YOUR recording for any phrase you've recorded, and falls back to the AI voice for everything else.

**16-phrase catalog** across four categories:
- Greetings (4): "Welcome back. Let's play some golf." / "Squeezing in a late round?" / "Good morning. Ready to play?" / "Good evening. Good to see you."
- Reactions (5): "Good shot." / "Nice contact." / "Solid putt." / "Good drive." / "Tough break."
- Encouragement (5): "Stay with it." / "Let's reset." / "You got this." / "Nice and easy." / "Take your time."
- Closing (2): "Let's go." / "Nice round."

Per row: mic to record, play to preview, trash to delete. Re-record anytime.

Toggle **"Use my custom caddie"** to turn it on. Caddie now uses your portrait as the face and your voice for the catalog phrases.

---

## SmartCapture — annotate a swing video frame

Open any swing in Library → tap **SmartCapture** in the top-left of the video. Toggle DRAW mode.

Six tools:

| Tool | What |
|---|---|
| **Brush** (freehand) | Draw anything |
| **Circle** | Two taps: center, then radius. Open outline. |
| **Line** | Two taps: start, then end. Plain segment. |
| **Straight** ⭐ NEW | Drag-to-size alignment line that **extends edge-to-edge** with an angle readout (`+45°` etc). For swing-plane, spine, shaft lines. |
| **ROI** ⭐ NEW | Drag-to-size region-of-interest circle. Dashed border + soft fill + center crosshair. Shows diameter as % of frame height. For calling out hip, hand, impact zones. |
| **Text** | Tap to drop a labeled point |

4 colors (white / green / red / amber). Undo, Clear, hide/show toggle.

**Tank's tip** (he says this when you draw): the straight line and ROI tools are meant to feel like CT-scanner measuring tools. Drag, watch the angle / diameter readout, release.

---

## Issue log / reporting bugs

**During testing**, the easiest way to flag something is voice.

Say one of these any time:
- **"Log this — recap is slow"**
- **"Log an issue: SmartFinder white-screened at 10x"**
- **"Report a bug — Tank cut me off mid-sentence"**
- **"I have feedback — the active listening pill covers the brand row"**
- **"Note this — Sunnyvale hole 7 yardage looks wrong"**

The note + context (route, persona, round state, GPS, recent settings) lands in your **Issue Log** (Settings → Owner Tools → Issue Log; or the new voice-direct route).

### Sending the log to us
**Say** "Kevin send issue log" / "Email issue log" / "Share issue log"
→ Opens your email app with the full log pre-addressed to **support@smartplaycaddie.com** with a sensible subject + body. Just hit Send.

Or open Issue Log manually → tap the share icon at top-right.

You can also email a SINGLE entry from its row (mail icon) without sending the whole list.

---

## Screenshot mode

Settings → Display & Accessibility → **Screenshot mode (hide top bar)**.

Hides the phone's top status bar (time / battery / wifi) app-wide so promo / App Store / social shots come out clean.

- **iOS**: full effect — only the slim home indicator remains
- **Android**: top bar hides, but the bottom nav bar (back / home / recent) still shows in this build. Crop the bottom strip or shoot on iOS for fully clean shots. Full Android coverage ships with the next native build.

Resets to OFF automatically every time you re-launch the app — you can't accidentally get stuck in screenshot mode.

---

## Smaller things worth knowing

- **Tap-to-zoom** anywhere — drill illustrations, Tank's Tips infographic, swing fault frames. Look for the green "Tap to zoom" badge.
- **Long-press deletes** — library rows, issue log entries, etc. Trash icons also visible.
- **Compare** button on any analyzed swing (Library or swing detail) — pulls up references (your past swings, archetypes, pros).
- **Cast Mode** in Settings — for mirroring to a TV/display while you talk.
- **Caption caddie speech** in Settings → Display & Accessibility — shows the caddie's text on screen while he talks. Auto-on when you're on Bluetooth.
- **Simple briefing** — auto-on for your first 5 rounds. One card at a time, slower pacing. Toggle in Settings.
- **Tank soft-intro** — Tank drops the Marine cadence for his first three turns with you, then unlocks. Auto-clears after one round.
- **Distance unit** — yards vs meters in Settings.
- **Family / Coach roster** — add students/family in Coach Mode for swing tracking across people.

---

## What's WOW worthy (please test, please share what breaks)

1. **Cage Mode** — start a session, hit 10 balls, see the summary land. The acoustic auto-capture is the magic moment.
2. **SmartMotion** — record your swing on the range, get the one fix back in seconds.
3. **TightLie / SmartPlay** — snap your lie on the course, hear the play.
4. **Tap-to-talk caddie** in cockpit mode — full hands-free round.
5. **Tank's drill + Tips infographic** — Tank's Take on Early Extension is the lead drill now.
6. **Personal Caddie with your own voice** — record your greetings, hear yourself respond.

---

## What's NOT in this build yet (intentionally)

- Full skeletal pose overlay on swing videos (manual SmartCapture lines are the workaround for now)
- Library cloud backup (everything is device-local — DO NOT uninstall the app or you lose your library)
- Auto voice-matching when you create a personal caddie (you pick the AI voice manually)
- Android bottom nav-bar hide in Screenshot mode (top bar hides; bottom bar still shows until the next native build)
- Tee-time booking / deals — concierge model planned post-launch

---

## Golden rule for testers

**Never uninstall the app to fix something.** Use **"Send issue log"** instead. Uninstall wipes your library and recorded videos permanently — there's no cloud backup yet. If something feels stuck, force-quit (swipe away the app card) and reopen first.

That's it. Thanks for testing. Yell loudly when something breaks.
