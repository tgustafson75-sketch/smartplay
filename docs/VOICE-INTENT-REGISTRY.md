# Voice Intent Registry

**Vision:** Meta Ray-Ban glasses + earbuds as the primary hands-free caddie. Every UI tap MUST have a voice equivalent, and every voice intent MUST get a clear caddie acknowledgment before the action executes. Hands-free is the primary flow; touch is the fallback.

**Living doc.** Append to it when you add new UI affordances or voice intents. Reviewers: if you ship a button without a voice intent, you've left a hole in the primary UX.

---

## 1. Principles

1. **Voice-first.** UI taps are convenience. Voice is the canonical input.
2. **Acknowledge then act.** The caddie always speaks a brief confirmation BEFORE side-effects land. Pattern: `"Got it, <repeat-back-in-natural-language>..."` then perform the action. This is non-negotiable: silent state changes break trust on glasses where the user can't see the screen.
3. **No silent failures.** If an intent can't run (no GPS / no active round / no permission), the caddie says exactly why in one sentence. Never just refuse.
4. **Same handler, two surfaces.** Touch handlers and voice handlers MUST call the same underlying store action. Never duplicate logic. UI is a thin shell.
5. **Future-proof for glasses.** Today input = phone mic. Soon = earbud tap-to-talk. Eventually = Meta Ray-Ban camera frames as additional context. The intent layer is the API the glasses will talk to.

---

## 2. Acknowledgment patterns

Every `IntentResult.voice_response` follows one of these shapes:

| Pattern | When | Example |
|---|---|---|
| **Ack + verb** | Side-effecting action | "Got it — marking your lie as fairway." |
| **Ack + state** | Setting change | "Cart mode on — tightened up shot detection." |
| **Ack + answer** | Status query | "Through 9, you're 42 — +6." |
| **Refuse + reason** | Can't execute | "I can't read the wind right now." |
| **Ack + follow-up** | Ambiguous | "On or off?" |

**Forbidden:** silent success. If a handler returns `success: true` with empty `voice_response`, that's a bug.

---

## 3. Intent type → handler map

| Intent | Handler file | Notes |
|---|---|---|
| `open_tool` | `services/intents/openToolHandler.ts` | Launches tool screens (SmartVision, SmartFinder, SwingLab, TightLie…) |
| `query_status` | `services/intents/queryStatusHandler.ts` | Reads state (score, hole, ghost, weather, pattern, lie, swing) |
| `change_setting` | `services/intents/changeSettingHandler.ts` | All settings + ghost on/off + caddie persona |
| `navigate` | `services/intents/navigateHandler.ts` | Back / home / next / previous hole |
| `help` | `services/intents/helpHandler.ts` | "What can I say" |
| `acknowledge` | `services/intents/acknowledgeHandler.ts` | Filler ("thanks", "got it") |
| `rules_query` | `services/intents/rulesQueryHandler.ts` | USGA rules questions |
| `handicap_query` | `services/intents/handicapQueryHandler.ts` | Index / differential lookup |
| `set_trust_quiet` | `services/intents/setTrustQuietHandler.ts` | Trust level → L1 Quiet |
| `set_trust_companion` | `services/intents/setTrustQuietHandler.ts` | Trust level → L2 Companion |
| `in_round_diagnostic` | `services/intents/inRoundDiagnosticHandler.ts` | Mid-round "what am I doing wrong" read |
| `club_change` | `services/intents/clubHandler.ts` | "Switching to 7-iron" — sets the working club |
| `club_query` | `services/intents/clubHandler.ts` | "What club am I on" (cage session) |
| `club_menu` | `services/intents/clubHandler.ts` | Opens the manual club picker |
| `set_club_distance` | `services/intents/setClubDistanceHandler.ts` | **Added to the enum 2026-08-19.** "my 7 iron goes 165" — registers a standing bag yardage |
| `log_shot` | `services/intents/logShotHandler.ts` | Conversational shot log (past tense) |
| `correct_last_shot` | `services/intents/correctLastShotHandler.ts` | Amends the last shot instead of appending a duplicate |
| `log_score` | `services/intents/logScoreHandler.ts` | "I made a five" |
| `log_putts` | `services/intents/logPuttsHandler.ts` | "Two putts" — putts for the hole |
| `log_issue` | `services/intents/logIssueHandler.ts` | "Remember this — bug X" |
| `media_capture` | `services/intents/mediaHandlers.ts` | Video clip capture |
| `media_playback` | `services/intents/mediaHandlers.ts` | Play back a captured clip |
| `putt_watch` | `services/intents/mediaHandlers.ts` | Putt-watch capture mode |
| `at_my_ball` | `services/intents/atBallHandler.ts` | "I'm at my ball" — position fix |
| `position_declaration` | `services/intents/positionDeclareHandler.ts` | Declaring where on the hole you are (tee / fairway / green) |
| `confirm_position` | `services/intents/confirmPositionHandler.ts` | Confirms a position the caddie proposed |
| `declare_hole` | `services/intents/declareHoleHandler.ts` | Absolute hole declaration ("teeing off on 4") |
| `set_hole_note` | `services/intents/setHoleNoteHandler.ts` | Per-hole note for the course book |
| `state_yardage` | `services/intents/stateYardageHandler.ts` | Player states the yardage themselves |
| `refresh_gps` | `services/intents/refreshGpsHandler.ts` | Forces a fresh GPS fix |
| `open_course` | `services/intents/openCourseHandler.ts` | Opens a named course |
| `quick_round` | `services/intents/quickRoundHandler.ts` | Starts a round with minimal setup |
| `end_round` | `services/intents/endRoundHandler.ts` | Ends the round → scorecard + recap |
| `coach_refine` | `services/intents/coachRefineHandler.ts` | Refines a coaching read after a drill |
| `set_session_focus` | `services/intents/sessionFocusHandler.ts` | "I want to work on X this session" — orients the session |
| `ask_golf_father` | `services/intents/askGolfFatherHandler.ts` | Strategic course-management ask |
| `find_my_data` | `services/intents/findMyDataHandler.ts` | Universal recall ("pull up my last scorecard") |
| `undo` | `services/intents/undoHandler.ts` | Reverses the last logged action |
| `open_external` | `services/intents/openExternalHandler.ts` | Opens an external URL / app |
| `social_greeting` | `services/intents/socialGreetingHandler.ts` | "Morning Kevin" — greeting, not a command |
| `sequence` | `services/intents/sequenceHandler.ts` | Chained commands in one utterance |
| `conversational` | *(none — routing sentinel)* | Hands the turn to the brain (`api/pipecat-turn.ts`). Not an action. |
| `unknown` | *(none — routing sentinel)* | Parser fallback (`services/voiceCommandParser.ts`) when nothing matched. |

**This table is complete as of 2026-08-19 and is now enforced.** It previously listed 18 of 42
intents — the 24 shipped after it was written were never added, so a "living doc" was 57% behind
the code and reviewers checking it against a new intent got a false read.
`__tests__/logic/voice-intent-parity.test.ts` asserts the enum, the handlers, and the brain tools
agree; keep this table in step when you add an intent (checklist §12, step 7).

---

## 4. Cockpit Mode — voice parity

The Cockpit screen has six tappable affordances. All six are voice-equivalent.

| Cockpit affordance | Voice intent | Example utterances | Handler |
|---|---|---|---|
| Brand-header mic tap | (none — this IS the voice trigger) | — | — |
| HOLE +/− stepper | `change_setting` setting=`current_hole` OR `navigate` direction=`next_hole`/`previous_hole` | "next hole", "I'm on hole 7", "back one" | `navigateHandler`, `changeSettingHandler` |
| SHOTS +/− stepper | `log_score` | "I made a five", "score me a 4" | `logScoreHandler` |
| PUTTS +/− stepper | `log_score` qualifier=`putts` *(future)* | "two putts", "I had three putts" | `logScoreHandler` (extend) |
| DistanceCard tap (open SmartFinder) | `open_tool` tool_name=`smartfinder` | "open SmartFinder", "rangefinder" | `openToolHandler` |
| SmartToolsRow → Vision | `open_tool` tool_name=`smartvision` | "open SmartVision", "show me the hole" | `openToolHandler` |
| SmartToolsRow → Motion | `open_tool` tool_name=`smartmotion` | "record my swing", "capture this swing" | `openToolHandler` |
| SmartToolsRow → Play (TightLie) | `open_tool` tool_name=`tightlie` | "check my lie", "analyze my lie", "what's the play" | `openToolHandler` |
| SmartToolsRow → Settings | `open_tool` tool_name=`settings` | "open settings" | `openToolHandler` |
| AskCaddie pill | (already the mic surface) | "what's my play", "what club" → routes to brain | (kevin.ts/brain.ts) |
| ShotResult: Distance Good/Short/Long | `log_shot` outcome_text=`good`/`short`/`long` | "that was short", "I came up long", "good distance" | `logShotHandler` |
| ShotResult: Direction L/Straight/R | `log_shot` direction=`left`/`straight`/`right` | "pulled it left", "straight at it", "pushed right" | `logShotHandler` |
| Mark Shot button | `at_ball` OR `change_setting` setting=`mark_position` | "mark this", "I'm at my ball", "log my position" | `atBallHandler` |

---

## 5. SmartFinder — voice parity

| SmartFinder action | Voice intent | Example utterances |
|---|---|---|
| Open screen | `open_tool` tool_name=`smartfinder` | "rangefinder", "open SmartFinder" |
| Distance to front/middle/back | `query_status` topic=`green_front`/`green_middle`/`green_back` | "front of the green", "back yardage", "middle" |
| Plays-like | `query_status` topic=`plays_like` target_yards=N | "plays like 150", "what does 145 play like" |
| Wind read | `query_status` topic=`wind` | "what's the wind", "wind read", "is it into me" |
| Distance to hazard | `query_status` topic=`carry_check` hazard_phrase=string | "can I carry the bunker", "yardage to the water" |
| Mark position (force refresh) | `at_ball` | "mark this", "I'm at my ball" |
| Lock target / pin | `change_setting` setting=`smartfinder_lock` *(future)* | "lock the pin", "lock this target" |

---

## 6. Scoring — voice parity

| Scoring action | Voice intent | Example utterances |
|---|---|---|
| Log hole score | `log_score` strokes=N | "I made a five", "score me a 4", "I had 6" |
| Edit prior hole | `log_score` strokes=N hole_number=N | "score me a 5 on hole 7", "change hole 4 to 6" |
| Log putts | `log_score` qualifier=`putts` *(future extension)* | "I had two putts", "three putts" |
| Log penalty | `log_shot` outcome=`manual_penalty` | "I took a penalty", "drop, one shot" |
| Query running score | `query_status` topic=`score` | "what's my score", "where am I" |
| Query running par | `query_status` topic=`score` | "am I over par" |
| Query hole history | `query_status` topic=`hole_history` | "how did I do here last time" |
| Query ghost match | `query_status` topic=`ghost_match` | "how am I doing vs last time", "where am I vs the ghost" |

---

## 7. Round Setup / Mode — voice parity

| UI tap | Voice intent | Example |
|---|---|---|
| Start round | `change_setting` setting=`start_round` *(future)* | "let's tee it up", "start the round" |
| End round | `query_status` topic=`end_session` (extend for round) | "end this round", "I'm done" |
| Pick caddie | `change_setting` setting=`caddie_persona` | "switch to Tank", "give me Serena" |
| Pick mode | `change_setting` setting=`round_mode` | "break 90 mode", "free play" |
| Pick ghost (manual) | `change_setting` setting=`ghost` + picker *(future)* | "race my best round here" |
| Auto-ghost toggle | `change_setting` setting=`ghost` value=true/false | "ghost on", "ghost off", "stop comparing" |
| Trust level | `set_trust_quiet` / `set_trust_companion` | "Kevin quiet", "speak up" |
| Cart toggle | `change_setting` setting=`cart_mode` | "I'm in a cart", "walking mode" |

---

## 8. Media capture — voice parity

| UI action | Voice intent | Example |
|---|---|---|
| Record swing (mid-round) | `media_capture` capture_type=`swing` | "record my swing" |
| Record shot result | `media_capture` capture_type=`shot` | "record this shot" |
| PuttWatch ack (glasses-recorded) | `putt_watch` shot_type=`putt`/`chip` | "watch this putt", "watch this chip" |
| Replay last clip | `media_playback` playback_action=`last` | "play that back", "show me my last shot" |
| Open swing library | `media_playback` playback_action=`open` | "show me my swings" |
| Find specific swing | `query_status` topic=`look_at_swing` swing_phrase=string | "pull up last Tuesday's swing" |

---

## 9. Settings — voice parity

| Setting | Setting name | Values | Aliases |
|---|---|---|---|
| Theme | `theme` | light / dark / system | "dark mode", "lights" |
| Voice | `voice_enabled` | true / false | "mute Kevin", "speak up" |
| Discrete | `discrete_mode` | true / false | "discrete mode on" |
| Auto-listen | `auto_listen` | true / false | "always listen", "hands-free mode" |
| Cart | `cart_mode` | true / false | "I'm in a cart", "walking" |
| Language | `language` | en / es / zh | "Spanish", "Chinese" |
| Response length | `response_mode` | short / neutral / detailed | "be concise", "give me detail" |
| Round mode | `round_mode` | break_100 / break_90 / break_80 / free_play | "break 80 mode" |
| Caddie persona | `caddie_persona` | kevin / tank / serena / harry | "switch to Tank" |
| **Ghost mode** | **`ghost`** | **true / false** | **"ghost on", "ghost off", "compare to last round", "drop the ghost"** |

---

## 10. Future glasses-specific intents

These are NOT live yet. They're stubs for when Meta Ray-Ban glasses become a first-class input.

| Future intent | Trigger | Action |
|---|---|---|
| `vision_context` | Glasses periodically push a frame URI (or short clip) along with a voice utterance | Server-side: pass frame to multimodal Sonnet for lie / target / hazard analysis |
| `gesture_input` | Earbud double-tap / glasses temple tap | Equivalent of mic-press; opens a voice slot |
| `pov_replay` | "save the last 30 seconds" | Push glasses' rolling buffer to phone storage |
| `over_the_shoulder` | "what am I looking at" | Frame + GPS + heading → identifies hazard or feature |

See `services/glassesVisionInput.ts` (stub) for the API.

---

## 11. Acknowledgment style guide (per persona)

| Persona | Ack tone | Examples |
|---|---|---|
| **Kevin** | Calm, friendly, brief | "Got it.", "On it.", "Marking that." |
| **Serena** | Measured, professional | "Confirmed.", "Logging that for you.", "Got it." |
| **Tank** | Direct, intense | "Roger.", "Locked in.", "Done." |
| **Harry** | Encouraging, light | "Yep.", "On it.", "Watching you." |

The persona system prompt already encodes this. The `intentAck()` helper accepts an optional persona override so glasses-routed intents can match the active caddie even when the system prompt isn't reachable from the handler.

---

## 12. Adding a new voice intent — checklist

> **Corrected 2026-08-19.** Step 1 used to read *"Add to the `intent_type` union in
> `app/api/voice-intent+api.ts`."* That file was deleted on 2026-08-13 with the other ten Expo
> Router dev twins (commit `59281f61`), so for six days this document's first instruction sent
> every author to a path that does not exist. There is no twin. `api/voice-intent.ts` is the only
> classifier.

**Order matters.** Steps 1 and 2 are the ones that get skipped, and skipping them is invisible:
the handler works when the precheck regex happens to match and the caddie makes friendly
conversation the rest of the time. This has now happened four times (`undo`, `find_my_data`,
`open_course`, `correct_last_shot`, `set_club_distance`). `__tests__/logic/voice-intent-parity.test.ts`
fails if you skip either one.

1. Add the intent to `INTENT_TYPE_ENUM` in **`api/voice-intent.ts`**. If it is not in the enum the
   cloud classifier physically cannot emit it, no matter what your prompt says.
2. Add a numbered section to the classifier prompt in that same file: parameters, at least three
   example utterances, and — most important — the **boundaries** against the intents it is easiest
   to confuse with. Most misclassification is a boundary problem, not a coverage problem.
3. Create the handler in `services/intents/<name>Handler.ts`.
4. Register it in `services/intents/index.ts`.
5. Every code path MUST set `voice_response` to a non-empty acknowledgment (see §2 — silent success
   is a bug).
6. If the intent has a UI equivalent, link the same store action from the UI button so both surfaces
   share one truth.
7. Add a row to §3 of THIS document.
8. Optional but recommended: a precheck regex in `services/localIntentPrecheck.ts` for the common
   phrasing, so the offline/instant path catches it. This is an **optimization on top of** steps 1–2,
   never a substitute for them. A precheck regex without an enum entry is the exact defect above.

**`api/voice-intent.ts` classifies. It does not act.** Brain *tools* are a separate vocabulary
declared once in `api/_brainTools.ts` — see `docs/voice-intent-parity.md` for how the four
vocabularies relate and which guard covers each.
