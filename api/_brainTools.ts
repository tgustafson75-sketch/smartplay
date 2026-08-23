/**
 * ── THE BRAIN TOOL CONTRACT — ONE OWNER ──────────────────────────────────────
 *
 * Every tool the caddie brain can call is declared HERE, once. Both brain
 * endpoints import from this file:
 *
 *   - api/pipecat-turn.ts  — the DEFAULT brain (first turn of a conversation)
 *   - api/kevin.ts         — the FOLLOW-UP brain (useVoiceCaddie.processFollowUp
 *                            → sendToBrain; the legacy main-turn fallthrough was
 *                            deleted 2026-07-23, so this is its only live caller)
 *
 * WHY THIS FILE EXISTS (2026-08-19 reconciliation pass)
 * ----------------------------------------------------
 * These two arrays were hand-maintained "lockstep twins". They drifted, twice
 * that we can prove:
 *
 *   - 2026-07-06 "voice-parity F5" reconciled 7 tools the fallback was missing.
 *   - By 2026-08-19 they had drifted AGAIN: `recommend_club` and `register_bag`
 *     existed only in pipecat-turn. Because kevin.ts owns the FOLLOW-UP turn,
 *     turn 1 and turn 2 of the same conversation ran different tool sets — ask
 *     "what club?" and the advice was logged and pairable with the outcome; ask
 *     it again in the follow-up and `recommend_club` did not exist, so nothing
 *     was recorded. That is the same advice→outcome pairing break found on
 *     2026-08-17 at the caddie-tab dispatcher, resurfacing at a second seam.
 *
 * Beyond the two missing tools, ~255 diff lines of DESCRIPTION drift had
 * accumulated. pipecat-turn's descriptions are the newer ones — they carry the
 * 2026-08-06 "not over-sensitive" tightening ("Talking ABOUT the hole is
 * CONVERSATION — answer it, don't open a screen"). kevin.ts still carried the
 * older loose phrasing, so a follow-up turn was measurably MORE likely to yank
 * the player onto a screen than the first turn was. The tightened text below is
 * canonical for both.
 *
 * THE RULE
 * --------
 * Adding, removing, or re-describing a brain tool is a change to THIS file and
 * nowhere else. A brain endpoint must never declare its own tool array.
 * `__tests__/logic/voice-intent-parity.test.ts` fails if either endpoint grows a
 * local array, if the two brains' tool sets diverge, or if a UI tool has no
 * client dispatch case. The guard forbids the SHAPE, not the two instances that
 * happened to be broken on 2026-08-19.
 */

import type { AiToolDef } from './_aiProvider';

/**
 * Tools the SERVER executes and whose result is fed back to the model.
 * Neither brain forwards these to the client.
 */
export const SERVER_TOOLS = new Set(['lookup_course', 'lookup_hole', 'navigate', 'search_web']);

/**
 * Tools whose payload is forwarded to the RN client for dispatch
 * (services/voice/conversationalToolDispatch.ts). Anything here MUST have a
 * matching case in that dispatcher or the action is silently dropped — the
 * parity guard checks exactly that.
 */
export const UI_TOOLS = new Set([
  'open_smartvision', 'open_smartfinder', 'open_swinglab',
  'record_swing', 'log_shot', 'plan_shot', 'log_score', 'log_emotional_state',
  'mark_tee', 'mark_green', 'log_issue', 'set_reminder',
  'configure_drill', 'close_swinglab', 'set_angle', 'set_golfer', 'switch_caddie',
  // 2026-08-09 (Tim — exact club attribution) — recommend_club carries the caddie's spoken club to the
  // client so silent adherence trains the bag with the EXACT club advised (not just a distance proxy).
  'recommend_club',
  // 2026-08-08 (verification wave) — register_bag was declared + prompted but MISSING here, so it fell
  // through to the bare 'Done.' with NO toolActions.push: the model verbally confirmed the bag while the
  // client dispatch case never fired and nothing was written. The passthrough spread carries the
  // clubs/distances arrays intact to the client registrar.
  'register_bag',
  // 2026-08-20 (Tim — "tap or ask to zoom the pin flag and get a tight read"). Declared here, in
  // UI_TOOLS, in ToolAction and in the dispatcher in the SAME change — the parity guard checks all
  // three, and the two tools ever dropped were dropped because one of those was missed.
  'zoom_target',
  /**
   * 2026-08-21 — TWO WIRES COMPLETED, and Tim remembered the first one existed.
   *
   * set_session_focus has been fully built on the CLASSIFIER path since early on — the voice-intent
   * enum knows it, sessionFocusHandler writes the store, and the CNS block reads it into every
   * prompt. It just never became a BRAIN TOOL. So "I want to work on my tempo today" set a focus if
   * you said it hands-free, and did nothing at all if you said it to the caddie in conversation —
   * which is how most people talk to it. Half a feature, quietly, for months.
   *
   * set_playing_condition is the one they have failed to get across live on a course: "I'm hitting
   * everything left today" is NOT a request for a diagnosis, it is the truth about today, and the
   * caddie should move the aim rather than explain the golf swing on the seventh tee.
   */
  'set_session_focus',
  'set_playing_condition',
  /**
   * 2026-08-21 — THE JUNE "NARRATIVE BRAIN", and the rest of the state the brain could not write.
   *
   * Tim remembered a focus/narrative wire "from very early on, like June" that had been built down.
   * They were right, and it is bigger than one wire: comparing the classifier's 43 intents against the
   * brain's tools shows the CLASSIFIER can record things the BRAIN cannot. Hands-free, "I'm 150 out
   * with my 7-iron on twelve, downhill lie" lands four pieces of state. Said in CONVERSATION — the
   * way most people talk to it — the caddie answers and records none of it.
   *
   * f4e0b31e (2026-07-01) built set_hole_note precisely so a bare lie/condition note would be
   * REMEMBERED and factored into advice. It has worked on one path ever since.
   *
   * These four are the ones that change what the caddie knows about the shot in front of them.
   */
  'set_hole_note',
  'state_yardage',
  'club_change',
  'declare_hole',
]);

export const BRAIN_TOOLS: AiToolDef[] = [
  {
    name: 'open_smartvision',
    description: 'Open the SmartVision hole-map overlay. Trigger ONLY on an explicit ask to OPEN/SHOW it ("open SmartVision", "show me the hole map", "pull up the hole"). Talking ABOUT the hole, hazards, or strategy is CONVERSATION — answer it, don\'t open a screen.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_smartfinder',
    description: 'Open SmartFinder — the rangefinder / distance-lock tool for measuring distance to a specific target on the current hole. Trigger ONLY on explicit rangefinder requests: "rangefinder", "lock the distance", "pin distance", "give me a precise distance". Do NOT use for course search, course selection, or "what course are we playing" — use lookup_course for those.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'zoom_target',
    description: 'Magnify the SmartFinder rangefinder view for a tighter read on a distant target ("zoom in on the pin", "zoom in on the flag", "get me a tighter read", "zoom out", "reset the zoom"). Opens SmartFinder first if it is not already up. This changes the CAMERA magnification only — it does not change the measured yardage, which comes from GPS geometry. For "how far is the pin" answer with the distance instead; only use this when they ask to zoom or for a closer/tighter look.',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['in', 'out', 'reset'], description: 'Direction of magnification. Defaults to "in".' },
      },
      required: [],
    },
  },
  {
    name: 'open_swinglab',
    description: 'Open the GENERIC SwingLab hub. Call this ONLY when the player wants the hub itself with NO specific destination. If they name a specific feature or drill (Smart Tempo, the tempo drill, Open Range, Setup Check, Drills, the Library, etc.) DO NOT use this — use the `navigate` tool so they land ON that feature, not the hub. For a VAGUE "I want to practice", ASK what they want, then navigate once they pick.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'navigate',
    description: 'Take the player DIRECTLY to a specific app feature / screen / drill by name. Use this WHENEVER they ask to open, go to, pull up, or "take me to" a named destination — e.g. "the tempo drill", "Smart Tempo", "Drills", "Open Range", "Setup Check", "the library", "my scorecard", a fault drill ("the over-the-top drill", "chicken wing drill"). Pass `feature` as the feature NAME (or a listed alias) from the APP FEATURES list in your context. ALWAYS prefer this over open_swinglab when they name a destination.',
    parameters: {
      type: 'object',
      properties: {
        feature: { type: 'string', description: 'The destination feature NAME (or alias) from the APP FEATURES list, e.g. "Smart Tempo", "Drills", "Over the Top Drill".' },
      },
      required: ['feature'],
    },
  },
  {
    name: 'log_score',
    description: 'Log the score for a hole. Pass hole only when the player names a specific hole number.',
    parameters: {
      type: 'object',
      properties: {
        hole:  { type: 'number', description: 'Hole number 1-18. Omit for current hole.' },
        score: { type: 'number', description: 'Strokes taken' },
      },
      required: ['score'],
    },
  },
  {
    name: 'log_shot',
    description: 'Log a shot the player just HIT / describes as already done. Capture EVERY detail they mentioned — never drop one. Pass only the fields they actually said.',
    parameters: {
      type: 'object',
      properties: {
        club:          { type: 'string', description: 'Club used (e.g. "5 wood", "7 iron", "driver")' },
        hole:          { type: 'number', description: 'Hole number IF they named one (e.g. "on hole 3" -> 3). Omit to use the current hole.' },
        shot_number:   { type: 'number', description: 'Which shot on the hole IF they said it (e.g. "my second shot" -> 2).' },
        distance_yards:{ type: 'number', description: 'How far the shot went / the yardage they gave for it, in yards.' },
        direction:     { type: 'string', enum: ['left','straight','right','pull','push','hook','slice','fade','draw'] },
        contactQuality:{ type: 'string', enum: ['fat','thin','pure','toe','heel','topped'] },
        outcome:       { type: 'string', description: 'Where it ended up' },
        feel:          { type: 'string', description: 'How the swing felt' },
      },
    },
  },
  {
    name: 'plan_shot',
    description: 'The player states their PLAN for a shot they are ABOUT to hit — the club, the yardage, and/or which shot on the hole. Examples: "I am going to use a 5 wood for my second shot on hole 3 with 210 yards to go", "hitting 7 iron here", "I have 150 to the pin, going with a smooth 8". This SETS the club + yardage context and confirms it back — it does NOT log a completed shot (use log_shot for a shot already hit). Capture EVERY detail they gave.',
    parameters: {
      type: 'object',
      properties: {
        club:           { type: 'string', description: 'Club they plan to hit (e.g. "5 wood", "7 iron").' },
        distance_yards: { type: 'number', description: 'Yardage they stated (e.g. "210 yards to go" -> 210).' },
        shot_number:    { type: 'number', description: 'Which shot on the hole (e.g. "my second shot" -> 2).' },
        hole:           { type: 'number', description: 'Hole number IF they named one.' },
        target:         { type: 'string', description: 'What they are aiming at IF mentioned (e.g. "the green", "lay up short of the water").' },
      },
    },
  },
  {
    name: 'recommend_club',
    description: 'Call this WHENEVER you tell the player which club to hit / what the play is on a shot — "I\'d go with the 8 here", "smooth 7", "this is a driver hole", "lay up with a 5 iron". Pass the exact club you recommended so the app tracks whether they take your advice and learns their distances from it. Call it IN ADDITION to speaking your recommendation — it does not replace your spoken answer. Do NOT call it for general club talk ("your 7-iron goes 165") — only when advising THIS shot. Do NOT call it when the PLAYER told YOU the club they are hitting ("I\'m hitting my 7", "going with the 52") — that is their decision, not your advice, and recording it as advice teaches the app you made a call you never made. Use club_change / plan_shot for that, even if you agree with them out loud.',
    parameters: {
      type: 'object',
      properties: {
        club:  { type: 'string', description: 'The club you recommended for this shot (e.g. "8 iron", "driver", "pitching wedge").' },
        shape: { type: 'string', description: 'Shot shape you advised IF any (e.g. "draw", "fade", "punch"). Omit if none.' },
      },
      required: ['club'],
    },
  },
  {
    name: 'set_session_focus',
    description: 'The player declares what they want to WORK ON this session — a theme that should colour the rest of it ("let\'s work on tempo today", "I want to fix my slice at the range", "today is all about the short game"). Capture the goal in their own words. Use clear:true when they say to drop it. NOT for a one-off question ("how do I fix my slice?" is just conversation) and NOT for what the ball is doing today — that is set_playing_condition.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: "What they want to work on, in their own words." },
        note: { type: 'string', description: 'Any extra detail they gave. Omit if none.' },
        clear: { type: 'boolean', description: 'True when they are dropping the focus.' },
      },
      required: [],
    },
  },
  {
    name: 'set_playing_condition',
    description: 'The player tells you WHAT THE BALL IS DOING TODAY, or how their body feels — "I\'m hitting everything left today", "everything is coming up short", "my back is tight", "I\'ve got no turn today". This is NOT a request to diagnose it. Record it and then AIM AROUND IT for the rest of the session; it outranks their learned tendency because it is what is happening right now. Set compensate to the side you should favour to allow for it ("hitting it left" → compensate right). Do NOT call it for WEATHER or the COURSE — "the wind is picking up", "these greens are quick", "it started raining" are conditions of the day, not of the player. Talk about those; do not record them here. Recording them would make you aim around a tendency the player does not have for the rest of the round. Call this ALONGSIDE your spoken answer — it never replaces the club call.',
    parameters: {
      type: 'object',
      properties: {
        stated: { type: 'string', description: "What they said, in their own words." },
        kind: { type: 'string', enum: ['ball_flight', 'physical', 'feel'], description: 'ball_flight for where it is going, physical for the body, feel for tempo/rhythm.' },
        compensate: { type: 'string', enum: ['left', 'right', 'shorter', 'longer'], description: 'Which way to favour to allow for it. Omit when it does not imply a direction.' },
        clear: { type: 'boolean', description: 'True when they say it has settled down or stopped.' },
      },
      required: ['stated'],
    },
  },
  {
    name: 'set_hole_note',
    description: 'The player describes their LIE, POSITION or the situation in front of them — "I\'m off to the right, pin high, downhill lie", "ball\'s below my feet", "I\'m in the rough sitting down", "hole 7 is a dogleg left". REMEMBER it against the hole so you can factor it into this shot and the rest of the hole. Omit hole when they did not say one — it applies to the hole they are on. This is NOT opening the lie camera tool; you are just remembering what they told you.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: "What they said about the lie/position, in their words." },
        hole: { type: 'integer', description: 'Only when they named a hole. Otherwise omit.' },
      },
      required: ['note'],
    },
  },
  {
    name: 'state_yardage',
    description: 'The player tells you the distance they have — "I\'m 150 out", "about 172 to the pin", "we\'ve got 90 in". Record it as the working number for this shot: it is measured or paced by them and BEATS the GPS estimate. Call it as well as answering. If the SAME sentence also asks what to hit or what the play is ("I\'m 150 out, what should I hit"), that is a shot question too — give the club out loud AND call recommend_club. Logging their number is not an answer to their question, and a silent turn reads as being ignored.',
    parameters: {
      type: 'object',
      properties: { yards: { type: 'integer', description: 'The distance they stated, in yards.' } },
      required: ['yards'],
    },
  },
  {
    name: 'club_change',
    description: 'The player says which club they are using or switching to — "I\'m hitting my 7", "going with the 52 wedge", "switched to hybrid". Record it so the shot is attributed to the right club. Call it as well as answering.',
    parameters: {
      type: 'object',
      properties: { club: { type: 'string', description: 'The club they named, in their words ("7 iron", "52 wedge", "hybrid").' } },
      required: ['club'],
    },
  },
  {
    name: 'declare_hole',
    description: 'Set the hole the player is on. Two ways they say it. ABSOLUTE — they name it: "we\'re on 12", "moving to the 4th", "starting hole 1". RELATIVE — they move on without naming it: "next hole", "let\'s move on", "on to the next one", "we\'re walking to the next tee", "done here", "that\'s that one finished". A relative move is still a hole change and you MUST call this for it: work out the number from the hole they are on now and pass the one they are moving TO — from hole 7, "next hole" is 8, never 7. Getting this wrong or skipping it is expensive and silent: every yardage, hazard and green read you give for the rest of the walk belongs to the hole they just left. Say the new number back so they know it took ("On to 8"). Only when they DECLARE or MOVE, never when they ask ABOUT a hole.',
    parameters: {
      type: 'object',
      properties: { hole: { type: 'integer', description: 'Hole number, 1-18.' } },
      required: ['hole'],
    },
  },
  {
    name: 'set_reminder',
    description: 'Set a reminder the player asks for by voice — "remind me to work on my putting", "remind me to hit the range before Saturday", "remind me tomorrow to do the tempo drill", "note that I want to work on my speed this week". Capture WHAT to be reminded of, and if they said WHEN, the natural when-phrase. Saved to their SmartPlan reminders.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to be reminded of / the activity (wake phrase + "remind me to" stripped).' },
        when: { type: 'string', description: 'Natural-language WHEN if they said it ("Thursday", "tomorrow morning", "before Saturday", "this week"). Omit if not mentioned.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'log_emotional_state',
    description: "Note the player's emotional state when they voice a feeling.",
    parameters: {
      type: 'object',
      properties: {
        state:   { type: 'string' },
        valence: { type: 'string', enum: ['positive','neutral','negative'] },
      },
      required: ['state', 'valence'],
    },
  },
  {
    name: 'log_issue',
    description: 'Capture an app issue / bug / feedback into the in-app ISSUE LOG when the player asks you to record it ("log this", "log an issue", "report a bug", "note this", "make a note", "this is broken", "I have feedback" + the description). Pass `note` = the issue text with the wake phrase stripped. NOT a conversational "noted" — it writes a real, reviewable issue-log entry.',
    parameters: {
      type: 'object',
      properties: { note: { type: 'string', description: 'The issue / bug / feedback description, wake phrase stripped.' } },
      required: ['note'],
    },
  },
  {
    name: 'record_swing',
    description: 'Open SwingLab / Smart Motion in RECORD mode to film the next swing, camera ready and rolling. Trigger for "record my swing", "record", "SmartMotion and record", "start recording", "watch my swing", "watch this swing", "watch this one", "film this swing", "watch me hit this", "watch me swing" — any time the player wants you to watch/record the FULL swing they are about to hit. (A putt/chip/bunker shot is different — that is putt watch, not this.) On the course this opens the course recording interface directly. IMPORTANT: this is ALWAYS an explicit command — call it IMMEDIATELY, never ask "do you want me to record?" first, and never just talk about it.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mark_tee',
    description: 'Mark the tee box position for the current hole in SmartVision. Trigger when user says "mark tee", "mark the tee box", "mark my position at the tee", "save the tee", or similar. User must be standing at the tee when they say this.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mark_green',
    description: 'Mark the green / pin position for the current hole in SmartVision. Trigger when user says "mark the green", "mark the pin", "mark the hole", "save pin position", "mark position at the green", or similar. User must be standing at or near the green when they say this.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'lookup_course',
    description: 'Search the EXTERNAL course database for a golf course, driving range, or practice facility by name or location. Use for ANY question about finding a place to play or practice: "what course is nearby?", "find a course near me", "closest golf course", "courses in [city]", "find a driving range near me". BUT FIRST check the "BUNDLED COURSES" list in your context — if the named course is there, you ALREADY have it: discuss/open it by name and do NOT call this tool. This tool does NOT include the app\'s bundled/local courses, so its "not found" is meaningless for a bundled course — never tell the player a bundled course "isn\'t in the database."',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Course / range name or "name in city" (append "driving range" when they asked for a range).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'configure_drill',
    description: 'Configure the SmartMotion drill session ONLY once the player is setting one up / SmartMotion is open and they state the club + number of swings ("7 iron, 3 swings", "driver, 5 balls"). This is NOT for narrative like "I need to work on my irons" or "irons today" — that is conversation about intent, not a command to configure a drill; answer it, do not configure or open anything. Wait for an explicit setup.',
    parameters: {
      type: 'object',
      properties: {
        club:       { type: 'string', description: 'Club ID (e.g. "7I", "DR", "PW", "PT"). Omit if not mentioned.' },
        shot_count: { type: 'number', enum: [1, 3, 5], description: 'Number of swings. Default 3 if not specified.' },
      },
    },
  },
  {
    name: 'close_swinglab',
    description: 'Close SmartMotion / SwingLab and return to the caddie screen. Use when the player says "close", "done", "go back", or "that\'s enough".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'set_angle',
    description: 'Set the SmartMotion camera angle when the player says how they want to film their swing: "down the line" / "DTL", "face on" / "face-on", or "putting" / "putt". Use ONLY when SmartMotion is open (the player is at the capture screen).',
    parameters: {
      type: 'object',
      properties: { angle: { type: 'string', enum: ['down_the_line', 'face_on', 'putt'], description: 'The camera angle to set.' } },
      required: ['angle'],
    },
  },
  {
    name: 'set_golfer',
    description: 'Set WHO is swinging for the SmartMotion captures, so the swing is attributed to the right person in the library. Use when the player says they are filming someone else, or themselves again: "this is Luis", "record my son", "I\'m filming Lily", "back to me", "this one\'s mine". name = the golfer\'s first name, or "me" for the user.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'First name of the golfer being recorded, or "me" for the user themselves.' } },
      required: ['name'],
    },
  },
  {
    name: 'switch_caddie',
    description: 'Switch the active caddie persona when the player asks for a different caddie BY NAME ("switch to Harry", "put Tank on the bag", "I want Serena", "give me Kevin back"). personality must be one of: kevin, serena, harry, tank.',
    parameters: {
      type: 'object',
      properties: { personality: { type: 'string', enum: ['kevin', 'serena', 'harry', 'tank'], description: 'The caddie to switch to.' } },
      required: ['personality'],
    },
  },
  {
    // 2026-08-08 (Tim — "in onboarding and in general I should be able to TELL the caddie what's in my
    // bag and my yardages and it gets registered correctly").
    name: 'register_bag',
    description: 'Register the clubs the player CARRIES and/or their stated per-club yardages, whenever they tell you — onboarding/get-to-know, mid-round, or casual chat. Examples: "I carry driver, 3-wood, 4-hybrid, 5-iron through pitching wedge, 56 and 60, and a putter" → clubs (EXPAND ranges like "5 through PW" into every individual club: "5 iron","6 iron","7 iron","8 iron","9 iron","pitching wedge"; bare numbers with degree context like "56 and 60" are wedges: "56 degree","60 degree"). "My 7-iron goes 165, driver about 250" → distances [{club:"7 iron", yards:165},{club:"driver", yards:250}]. A stated number is a CARRY unless they explicitly say total/rollout. Capture EVERY club and number they said — never drop one.',
    parameters: {
      type: 'object',
      properties: {
        clubs: { type: 'array', items: { type: 'string' }, description: 'Individual club phrases the player carries, ranges fully expanded. Omit if they only stated yardages.' },
        distances: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              club:  { type: 'string', description: 'The club phrase (e.g. "7 iron", "driver").' },
              yards: { type: 'number', description: 'The stated distance in yards.' },
              kind:  { type: 'string', enum: ['carry', 'total'], description: 'carry unless they explicitly said total/with roll.' },
            },
            required: ['club', 'yards'],
          },
          description: 'Stated per-club yardages. Omit if they only listed clubs.',
        },
      },
    },
  },
  {
    name: 'search_web',
    description: 'Search the live web for a FACTUAL, real-world answer you do not already have in your context — course details (record, signature hole, dress code, rates, tee-time policy, conditions), local knowledge about a course or area, golf rules, equipment facts, or anything current. Use it whenever the honest answer is "I would need to look that up" instead of guessing. Do NOT use it for the player\'s own data (their scores/bag/swing — that is in your context), for opening app features, or for casual chat. After it returns, speak the result naturally as your own knowledge.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The factual question to look up, phrased for a search (e.g. "course record at Pebble Beach", "dress code Torrey Pines").' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_hole',
    description: 'Get hole details (par, yardage) for a known course.',
    parameters: {
      type: 'object',
      properties: {
        course_id:   { type: 'string' },
        hole_number: { type: 'number', minimum: 1, maximum: 18 },
        tee_name:    { type: 'string' },
      },
      required: ['course_id', 'hole_number'],
    },
  },
];
