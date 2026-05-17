# SmartPlay Caddie — Full App Compendium

## Overview
SmartPlay Caddie is an AI-powered golf companion (Android/iOS). It combines a conversational caddie, GPS shot detection, vision-based swing analysis, course imagery, and tools for practice + on-course play.

## Five Tabs
1. **Play** — course picker, pre-round setup, start round
2. **Caddie** — cockpit, mic, conversational caddie, round management
3. **SwingLab** — practice tools, swing video, analysis
4. **Scorecard** — current-round scorecard
5. **Dashboard** — stats, recent rounds, handicap

## The Caddie Team (Personas)
- **Kevin** — original, balanced, all-around
- **Tank** — direct, no-BS, sound-sensitive (default intensity 70/100)
- **Serena** — analytical, calm, female voice
- Switch via Settings → Caddie Team, OR by voice: *"Switch to Tank"*, *"Switch to Serena"*, *"Switch back to Kevin"*

## Trust Spectrum (5 levels)
Controls how present the caddie is.
- **L1 Quiet** — banner-only, no voice
- **L2 Cockpit** — short voice replies only on tap
- **L3 Companion** — default; voice replies on tap or VAD
- **L4 Active** — proactive between-hole comments
- **L5 Full** — full character breadth
- Settings → Round Experience → Kevin's presence

## Complete Voice Vocabulary

### Open Tools
- "Open SmartVision" / "Show me SmartVision"
- "Open SmartFinder" / "Rangefinder"
- "Open SwingLab"
- "Pull up my scorecard"
- "Show my dashboard"
- "Open settings"

### Status / Queries
- "What's my score?"
- "What hole am I on?"
- "How am I doing against the ghost?"
- "How far to the pin?"

### Settings
- "Switch to dark mode" / "Light mode"
- "Mute Tank" / "Voice off"
- "Switch to Spanish" / "English" / "Chinese"
- "Turn on active listening" / "Hands-free mode" / "Stop listening to me"
- "Cart mode on" / "I'm in a cart" / "Walking mode" / "Cart mode off"
- "Switch to break 80 mode" / "Break 90" / "Break 100" / "Free play"
- "Be more concise" / "More detailed"

### Navigation
- "Go back" / "Back"
- "Home" / "Main menu"
- "Next hole" / "Previous hole"
- "Close this" / "Dismiss"

### Round Logging
- "I'm at my ball"
- "Log shot: 7-iron, 165 yards, clean"

### Hero Shot Capture (spectator mode)
- "Watch this" / "Check this out" / "Look at this" / "Hero shot"
- Records ~5s with smart auto-stop on acoustic strike; review pane shows looping playback + Share button.

### PuttWatch v1 (Meta Ray-Ban glasses)
- "Watch this putt" / "PuttWatch" / "Analyze this putt"
- "Watch this chip" / "Watch this bunker shot"
- Caddie acknowledges only — you record with the glasses. Upload after for analysis with the Putt or Chip tag.

### Media Playback
- "Show me last shot" / "Play that back" / "Replay"
- "Open video" / "Pull up videos"

### Quiet / Companion Modes
- "Tank, go quiet" / "Quiet please" / "Shush"
- "Tank, come back" / "Speak up" / "Back to normal"

### Feedback Log (owner-only)
- "Tank, log this — [description]"
- "Report a bug — [description]"
- "Note this — [observation]"
- Lands in Settings → Owner Tools → Issue Log

### Help
- "What can I say?" / "Help"
- "What are my options?"

## Play Tab — Pre-Round Flow
- Course picker (recent / GPS-nearest / search / curated local courses)
- Curated local courses with bundled hole imagery:
  - Menifee Lakes — Palms
  - Menifee Lakes — Lakes
  - Rancho California
  - Crystal Springs
  - Mariners Point (9-hole par-3)
  - San Jose Municipal
  - Sunnyvale
- Pre-round setup card: round mode (Break 100/90/80/Free Play), 9 vs 18, competition flag, mental state, notes (mic icon for dictation)
- Selecting a course sets `previewCourseId` → SmartVision pre-round preview resolves to it
- **Start Round** consumes the selection, launches Caddie tab, persists state across tabs

## Caddie Tab — The Cockpit
- Avatar with emotion (listening, thinking, speaking, humble/thumbs-up)
- Mic button (push-to-talk)
- Active Listening pill (VAD-based hands-free toggle)
- Live caption bubble for caddie replies
- Cockpit data: hole #, score vs par, current yardage, last shot context, ghost-match status
- Tools menu: SmartVision, SmartFinder, SwingLab, **Log Shot**, **End Round**
- Background services running during a round:
  - GPS shot detection (cart-aware when Cart Mode is on)
  - Conversational logging orchestrator (auto-prompts "what was that shot?")

## SmartVision (top-down hole preview + measuring)
- **T** (tee), **Y** (yellow target/layup), **P** (pin) markers
- Drag Y → set layup target; carry yardage displays
- Drag P → fine-tune pin; drag T pre-round only
- F / M / B = front, middle, back of green yardages
- Imagery modes: auto (curated → GPS satellite), GPS only, curated only
- Pre-round cascade: active round → about-to-start → preview pick → home course → Palms hole 1 (rock-bottom fallback so the screen never renders empty)
- Save (bookmark icon) persists your plan into the round

## SmartFinder (rangefinder)
- Live GPS-derived distance to target
- Updates as you walk

## SwingLab — Six Tiles
1. **Drills** — Primary Issue catalog, common faults, pro instructor videos
2. **Range Mode** — Multi-shot range/studio/cage session (routes to /cage/session, multi-shot mode)
3. **SmartMotion** — Single-swing capture + analysis. Manual START/STOP or voice-trigger ("ready"/"go"/"swing"/"hit it"); 1/3/5/10 loop count
4. **Arena** — Bag distances, tempo trainer, putting clock
5. **Swing Library** — All captured + uploaded swings. Tap any swing for video + body overlay + swing-trace replay + biomechanics card
6. **Acoustic Test Bench** — Validates strike-detection pipeline before a range session

## Body Overlay + Swing Trace (post-swing analysis)
- Plays on any uploaded swing in Swing Library
- Skeleton interpolates between 5 sampled positions (P1 address → P2 takeaway → P4 top → P6 impact → P10 finish)
- Yellow swing-trace arc = lead-wrist path across the swing
- Toggle **Body** / **Swing Trace** independently under the video
- Auto-backfills pose data for older swings on first open

## Round End — Save vs Discard
- **Save & end** → pushes score differential, updates `handicap_index` when ≥9 holes played, fires recap, archives the round
- **Discard** → full state reset, double-confirm, no record kept
- Triggered from Play tab End Round button OR Caddie tab Tools menu

## Log Shot Sheet (manual marking)
- Tools menu → Log shot
- **↺ Use fresh GPS fix** — forces high-accuracy `getCurrentPositionAsync`, pins the location, overrides cached lastFix (critical for cart play)
- Hole picker — override auto-detected current hole
- Club chip row, distance (optional), outcome (clean/water/OB/lost/hazard/unplayable), direction (left/straight/right)
- Telemetered: manual_fresh_fix + hole_overridden flags

## Cart Mode (cart-aware GPS detection)
- Settings → Round Experience → "Riding in a cart" → ON
- Voice: "Cart mode on" / "I'm in a cart" / "Cart mode off" / "Walking mode"
- Effect: stationary window 20s → 8s, radius 8m → 12m, speed suppression switches from rolling-avg to current-sample-only
- Walking remains the default

## Hero Shot Capture + Share
- Voice: "Watch this" / "Check this out" / "Hero shot"
- 5-second capture with smart auto-stop on acoustic strike
- Post-record review pane: looping playback + Share (OS share sheet) + Done
- Saved to Swing Library AND back-referenced to the current hole's most-recent shot (`is_highlight: true`)

## PuttWatch v1 (Meta Glasses workflow)
- Voice: "Watch this putt" / "Watch this chip" / "PuttWatch"
- Caddie acknowledges + reminds you to record with the glasses
- You: "Hey Meta, record a video"
- After the round: Meta View syncs clip to phone gallery
- SwingLab → Upload → pick clip → tag **Putt** or **Chip** → analysis runs with body overlay

## Voice Settings
- **Voice Enabled** (master toggle)
- **Discrete Mode** (haptic only, no audio)
- **Active Listening** (VAD hands-free)
- **Voice on Phone Speaker** — default ON; allows TTS without earbuds/glasses paired
- **Voice Filler** — bridge phrases ("let me see…", "hmm…") while thinking
- **Per-persona intensity** (0–100, tunes voice rate + verbosity)
- **Tank Soft Intro** (gentler first interaction)

## Display Settings
- Theme — Light / Dark / System
- Large Text
- High Contrast
- Cast Mode (project-friendly contrast)
- TTS Captions (text accompanies voice)

## Round Modes
- **Break 100** — target score 100
- **Break 90** — target score 90
- **Break 80** — target score 80
- **Free Play** — no target, no pressure

## Owner-only Tools
- Settings → Owner Tools → Issue Log
- Stores up to 100 voice-captured bug reports with full context (route, persona, hole, course, app version)
- Share-out export via OS share sheet (formatted as a text dump)
- Long-press an entry to delete, "Clear all" for full wipe

## Strike Detection (acoustic, behind the scenes)
- `services/acousticImpactDetector` is the single source for impact detection
- Single-shot mode: SmartMotion, single-swing cage capture, on-round "record this shot"
- Multi-shot mode: Range Mode, Cage Mode (range sessions)
- Global `onStrike(listener)` bus lets any surface subscribe passively
