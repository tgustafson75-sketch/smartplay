# Code Simulation — Three Golfers, Three Rounds Each

A trace through the code paths each player would hit, what voice fires, what the caddie says back, and what the user should experience. **Not a runtime test** — we can't fire mic + audio from here — but a deterministic walk through the handlers, store mutations, and `speak()` calls. Flagged any path that looks fishy in the trace.

Updated **2026-05-27** against `main @ 81a391f` (HEAD includes Fixes EB, EC, EG, EH on the voice path).

---

## Sim setup

### Player 1 — "Bogey Bob" (breaks 100)

| Field | Value |
|---|---|
| handicap | 24 (driver-slicer, fat 7-iron) |
| persona | **Kevin** (default) |
| trustLevel | **2 — Companion** (default) |
| voiceEnabled | true |
| voiceOnPhoneSpeaker | true |
| cartMode | true (rides) |
| relationship | roundsTogether: 0 (first-round user across all 3 rounds; advances each round) |
| Behavior | Asks distances heavily, lays up, struggles mid-round, asks "what should I work on" at end |

### Player 2 — "Steady Steve" (breaks 90)

| Field | Value |
|---|---|
| handicap | 14 |
| persona | **Serena** for round, **Tank** for cage |
| trustLevel | **2 — Companion** (round), **4 — Full** (cage practice) |
| voiceEnabled | true |
| cartMode | true |
| relationship | roundsTogether: 5 (established) |
| Behavior | Voice-first for shot tracking, taps Kevin on tough lies, runs Cage Mode mid-week |

### Player 3 — "Aggressive Adam" (single digit, uses everything)

| Field | Value |
|---|---|
| handicap | 6 |
| persona | **Kevin** round / **Tank** cage / **Harry** in Cockpit mode for tournaments |
| trustLevel | **3 — Active** (Round), **5 — Cockpit** (tournament) |
| voiceEnabled | true |
| cartMode | true (round 1-2), false (walks round 3) |
| relationship | roundsTogether: 20 (deep) |
| Behavior | Uses TightLie on every approach, SmartMotion at the range pre-round, SmartCapture to mark his own swing, runs full Cage sessions, voice-direct mark-tee/mark-green on missing courses |

---

## Common path: round start → briefing

For all players, every round starts the same code path:

1. **User taps "Start Round"** in `app/(tabs)/caddie.tsx:1687` → `router.push('/round/briefing')`
2. **Briefing screen mounts** (`app/round/briefing.tsx`).
3. `useEffect` (line 115) fires `run()`:
   - Calls `generateBriefing()` → server returns ~300-500 char text
   - `setBriefText(text)` → text renders on screen
   - **Fix EB gate**: `if (voiceEnabled)` only (was `voiceEnabled && trustLevel !== 1`). So even Quiet users get the briefing voice now — BUT none of our 3 sims are at L1, so this isn't load-bearing.
   - `await configureAudioForSpeech()` → audio session forced into playback mode
   - `await speak(text, voiceGender, language, apiUrl, { userInitiated: true })` — **userInitiated:true** prevents L1 silencing if user later drops to Quiet mid-round.
4. **Inside `speak()`** (services/voiceService.ts:686):
   - `isVoiceAllowed(opts)` — passes for all 3 sims (voiceEnabled=true, route ≠ phone_speaker or voiceOnPhoneSpeaker=true, trust≥2 or userInitiated=true).
   - Speech-id claim. notifySpeaking(true) + notifyCaption(text) → caddie state "talking" + caption renders.
   - configureAudioForSpeech (double-configured, idempotent via setAudioModeSerial queue).
   - **Custom-caddie clip override** (Fix DY + EC):
     - Player 1: useCustomCaddie=false → skipped.
     - Player 2: useCustomCaddie=false → skipped.
     - Player 3: hypothetically may have recorded greetings, but briefing text is ~400 chars (way outside the 16-phrase catalog) → no match → skipped.
   - Fetch `/api/voice` → 60-90 char/sec OpenAI TTS → returns ~50-80KB mp3.
   - **Fix EH gate**: `if (arrayBuffer.byteLength < 1000)` — under-threshold rejects now clear BOTH notifyCaption + notifySpeaking. Passes for normal briefings.
   - **Fix EG retry**: `Sound.createAsync({uri, shouldPlay:true})`. If `isLoaded=false` OR `durationMillis=0`, unload + force-reset audio mode + retry once. If retry also dead, give up cleanly. **All 3 sims expected to load+play first try** — retry is the safety net.
   - `setOnPlaybackStatusUpdate` waits for `didJustFinish` → audio plays end-to-end → notifySpeaking(false) + notifyCaption(null).
5. **First-tee hint** (only for first-round users — `roundsTogether === 0`):
   - Player 1 (rounds 1-3): roundsTogether=0,1,2 → hint fires on round 1 only (`useVoiceHintsStore` marks `first_tee_shown`). Hint: "Tap me or just talk — what mode are you playing today?"
   - Players 2 & 3: roundsTogether >0 → hint suppressed.
6. `setTimeout(1500, goToCaddie)` → navigates to /(tabs)/caddie.

**Expected outcome for ALL 3 players, round 1 briefing:**
- ✅ Briefing text renders on screen
- ✅ Caddie voice plays end-to-end (~30-45s of speech)
- ✅ Caption visible during voice
- ✅ Lands on Caddie tab after voice + 1.5s
- ✅ Player 1 gets the first-tee hint as a follow-up utterance

**User response expected:** Player taps "got it" or just starts hitting. None panic about silence (which was Tim's prior bug — now triple-defended by EB / EG / EH).

---

## Player 1 — Bogey Bob

### Round 1 — Sunday morning, home course, riding

**Hole 1, par 4, 380y:**
- Steps to tee, GPS settles. Per-hole intro auto-fires from `roundStore.setCurrentHole(1)` (line 1422): `speak(holeText, ..., { userInitiated: true })`. Kevin: "Hole 1, par 4, 380. Driver bunker on the right, fairway pinches left of it."
- Bob tees off — slice. Goes 180y into right rough.
- **Bob taps Kevin** (caddie avatar). `handleMicPress` → `Haptics.impactAsync` + `useVoiceCaddie.handleMicPress` → opens listening session.
  - `openSession()` plays filler ("alright so...") via playLocalFile (userInitiated implicit via session-open path)
  - `captureUtterance(6000ms)` records mic, transcribes via Whisper
  - Bob says: "How far?"
  - Classifier returns `{intent_type: 'query_status', parameters: {query_topic: 'distance_to_green'}}`
  - Handler computes from GPS + course geometry → "From here, you're 195 to the front, 210 middle, 222 back."
  - **`speak(reply, ..., { userInitiated: true })`** → reply plays. Caption shows.
- Bob taps again: "What club?"
  - Classifier → `query_status` with `query_topic: shot_strategy`
  - Handler calls `/api/kevin` with register='caddie' + handicap context (24) → "From this lie at 210 — that's a hybrid for you. Just put it past the bunker on the front, you don't need the green."
  - Speak fires. Lays up cleanly.
- Hits 5-iron 145, then a wedge to 12ft, 2-putts for double bogey.
- `roundStore.logScore(6, hole=1)` → caddie state mutation.

**Mid-round (hole 7) — frustration:**
- Bob's three-putted twice and chunked a wedge. He says: "What's wrong with my swing today?"
  - Classifier → `in_round_diagnostic` (regulation: pattern + reasoning verb).
  - Handler → `/api/kevin` with `register: 'coach'` + `inRoundDiagnostic: true` → multi-sentence coaching reply: "You're hitting it fat — I'd guess your weight's hanging back. Try one practice swing where you finish on your lead leg before the next shot. Just one. Don't make it complicated."
  - Reply plays. Coach register = slower, more deliberate.

**Hole 18 — wrap:**
- Bob taps "end session" / End Round button.
- Recap screen renders. Caddie does a recap voice (`speak`, userInitiated from button press).
- Bob: "What should I work on?"
  - Classifier → `query_status` with `query_topic: next_focus`
  - Handler → kevin coach register → "Hanging back. Same chunk pattern on three approaches today. Drills tab → Posture → Tank's Take on Early Extension. That's the one."
  - **Drill recommendation surfaces Tank's content** (Fix EE wired early_extension → posture, Tank's video lives in tank_caddie slot).

**Round-end state mutations:**
- `roundStore.endRound()` writes the round to history.
- `relationshipStore.roundsTogether` ticks 0 → 1.
- `useVoiceHintsStore.first_tee_shown=true` (persisted).

### Round 2 — Saturday, different course (Sunnyvale)
- roundsTogether=1; first-tee hint NOT shown (already marked).
- Briefing voice fires same path. Sunnyvale has correct course geometry so no Mark Green needed.
- Bob plays normally. Uses voice for distance ~6x; logs 3 scores by voice ("I got a 5 on hole 4").
- **Voice score-tell**: `log_score` intent → `logScoreHandler.execute()` → `round.logScore(5, hole=4)` → caddie confirms "Got it — 5 (bogey)." Voice fires via speak.
- Round ends with 95.

### Round 3 — Tournament mode, weather turning
- Bob picks Tournament mode at Start Round. Closest-to-pin + skins enabled.
- During briefing voice, Bob taps to skip → `doSkip()` → `stopSpeaking()` → briefing voice halts cleanly (Fix EG's queue handles the speech-id bump).
- Wind picks up on hole 11. Bob asks "what's the wind doing?" → `query_status:wind` handler → reply.
- Bob shoots 102 in worse conditions. Caddie psychologist register on End Round recap: "Wind cost you 3-4 shots today; underlying ball-striking was the same as last week. Hold the takeaway from yesterday's swing on dry days."

**Net for Bogey Bob across 3 rounds:**
- Briefing voice: 3-for-3 (or 2-for-3 if he skipped one)
- Distance / club voice asks: ~25 fires, all play (caddie-register replies, ~5-8 sec each)
- Score log voice: ~5 fires
- Drill recommendation: Tank's Take card surfaced 1x on round 1, available on Drills tab thereafter
- First-tee hint: fired exactly once (round 1)
- Issue log entries: 0 unless something broke

---

## Player 2 — Steady Steve

### Round 1 — Wednesday twilight, Cage practice in the morning first

**Morning — Cage Mode (before the round):**
- Voice: "Tank, start cage session."
  - Classifier → `open_tool` with `tool_name: cage_mode`
  - `openToolHandler` → `'cage_mode'` route → `router.push('/swinglab/cage-mode')` + voice response: "Cage mode starting. I'll capture every swing."
  - Persona switched to Tank for cage (via `caddieAssignments`).
- Tank: "Alright, range time. Let's see what we've got. Hit when you're ready."
- Steve hits 30 balls — 5 drivers, 10 7-irons, 10 PWs, 5 wedges.
- Acoustic detector auto-captures each. Background analyzer runs (per-shot Phase K).
- After 5 minutes idle: cage session summary auto-fires.
  - `voicedSessionSummary` speaks: "Thirty swings, mostly clean. Your drivers are leaking right — fade pattern. Irons are flushed. Primary issue: clubface open at impact on the longer clubs. Drill is grip-check + setup ball position. See the Library for the worst miss."
- Steve drives to course.

**Round 1 — Serena persona for round:**
- Briefing fires (Steve hasn't toggled simple_briefing off, but he's past round 5 so simple briefing isn't auto-active for him).
- Serena: calm, professional, numbers-forward. "Welcome to Maplewood. The greens are firm today after Tuesday's mow, expect more roll on approaches. Watch the pin position on 4 — back right, easy to over-fly."
- Steve plays. Uses voice mid-round ~10x.
- Hole 5, ball in heavy rough.
  - Voice: "Open TightLie" / "Check my lie".
  - Classifier → `open_tool: lie_analysis`.
  - Handler → router to /lie-analysis with conversational opener (smartplay=1 path).
  - Camera opens. Caddie: "What do you see?"
  - Steve: "Heavy rough, 130 out, downhill."
  - `captureUtterance` records context. Photo taken. Sent to `/api/lie-analysis`.
  - Reply (via speak): "Heavy lie + downhill — flier risk. Club one less than the yardage suggests. Pin-high is the win here, not the flag."
  - Steve hits an 8-iron (planned 9), lands 25 ft past, two-putts.

**Coach moment — hole 12:**
- Steve's wife Lily is playing the back nine with him. He says: "Coach Lily" / "Watching Lily."
- Classifier → `open_tool: coach_mode` with `player_name: Lily`.
- Handler → sets `familyStore.active_member_id` to Lily (creates her if first time) → routes to /swinglab/coach-mode.
- Caddie: "Coach Mode — coaching Lily."
- Steve films Lily's swing, gets coach analysis back.

**End round:**
- Recap. Serena: "Strong round — 86. Three pars on the back. The lay-up on 5 was the right call. Tomorrow's range work: keep at it on drivers, that fade is gettable."

### Round 2 — Tournament with the crew
- 4-player group. Steve toggles Tournament mode + closest-to-pin + skins.
- Briefing covers tournament setup.
- Per-hole + scoring runs for all 4 (`familyStore` roster).
- Voice score-tell ~12x ("I got a 4, Mike got a 5, Jenny got a 6, Frank got a 7").
- Closest-to-pin auto-detected on par 3s via GPS proximity at shot-end.
- End-of-round tournament summary: leaderboard, skins, closest-to-pin winner.

### Round 3 — Solo, raining, irritated
- Trust slider drops to **1 (Quiet)** mid-round. Steve says "Serena go quiet."
- Classifier → `set_trust_quiet` → `useTrustLevelStore.setLevel(1)`.
- Serena: "Quiet mode on. Tap if you need me." Then silent for the rest of the round.
- Steve still taps her 3x for distances. **Per Fix EB**, mic-tap responses pass userInitiated:true → speak fires through the L1 gate. ✅ Voice plays.
- Steve does NOT see "text shows but no audio" on his taps (Fix EH cleared the lingering-caption bug).

**Net for Steady Steve:**
- Briefing voice: 3-for-3
- Cage session summary voice: fires after each cage session (1x round 1)
- TightLie voice path: ~3 fires across rounds (hole 5 R1, twice in R2)
- Score-tell voice: ~12 fires R2, ~5 each other round
- Voice quiet/companion toggles: works as designed
- Coach Mode: triggered with player_name extraction

---

## Player 3 — Aggressive Adam

### Round 1 — Cage Mode warmup → Tournament Cockpit round → SmartMotion after

**Pre-round Cage:**
- Voice: "Tank, start cage session"
- Adam hits 50 balls in 25 minutes, mixes clubs.
- Tank's acoustic detector + per-shot analysis runs in parallel (USE_PARALLEL_PER_SHOT, Fix DQ).
- Tank summary: "Fifty swings, big mover. Driver path is steep — that's where the pulls come from. Wedges are nailing it. Primary issue: over-the-top on the driver. Drill is headcover-gate."
- Adam taps the Library → his pulled-driver swing → tap **SmartCapture**.
- Toggles DRAW. Selects **straight** tool → drags from shoulder to ball on the address frame → edge-to-edge line renders with **"−12°"** label (his attack angle).
- Adds an **ROI** circle around his right hip → dashed circle + "Ø 18%" diameter readout.
- Shares the annotated screenshot to his coach via the system share sheet.

**Tournament Round 1 — Cockpit mode (Harry):**
- Adam switches to Harry, locks into Cockpit (L5).
- Cockpit layout renders — minimal data, four tool pills + new **Tools** pill (Fix DV).
- Briefing voice: Harry's British storyteller cadence ("Right then. Maplewood. Track plays long today; the bermuda's healthy. Eighteen ahead — let's begin.").
- Adam plays. Per-hole intros fire as he taps Next Hole. Each speak fires with userInitiated:true (Fix EE wired this throughout).
- On hole 3, GPS coordinates are off (Maplewood's hole 3 green coords are wrong by ~20y).
- Voice: "Mark the green" / "I'm at the pin."
  - Classifier → `open_tool: mark_green`.
  - **Voice-direct mark path** (Fix E/O): handler checks GPS accuracy <20m + age <15s. If passes, captures GPS in place + writes course override + speaks "Pin marked on 3." NO navigation.
  - If GPS fails the quality gate, navigates to /mark-green for manual.
- Adam continues; every subsequent yardage on hole 3 uses the override.
- Score: 71 (-1).

**Post-round — SmartMotion review:**
- Adam at the range, voice: "Record me down the line"
  - Classifier → `open_tool: smartmotion` with `angle: down_the_line, auto_start: true`.
  - Handler → routes to `/swinglab/quick-record?angle=down_the_line&autoStart=1` with the parameter forwarded.
  - Caddie: "SmartMotion, down the line." Camera fires immediately on mount.
- 5-second swing video captured + uploaded to /api/swing-analysis (USE_GEMINI=false, USE_PARALLEL_PER_SHOT=true).
- Analysis returns: primary fault detected as **"early_extension"**.
- Per Fix EE, this routes to the **posture** card in PRIMARY_ISSUE_CATALOG → user sees Posture as primary issue → Drills tab shows Tank's Take pinned first.
- Adam taps Tank's drill → sees Tank's video + Tank's Tips infographic (Fix EF).
- Taps the infographic → tap-to-zoom modal opens with the full PGA-vs-Golf-Father comparison card.

### Round 2 — Walking round, family with him (Coach Mode)
- Adam toggles cartMode=false in Settings.
- Walking detection takes over (different GPS thresholds).
- Cart-default memory rules: walking is the secondary calibration path; some proactive cues are quieter on walking rounds.
- Adam plays with his son Mike. Switches to Coach Mode between his own shots to film Mike.
- Voice: "Coaching Mike" → Coach Mode pre-set to Mike. Films Mike's swing on hole 4. Returns to his own play after.
- End: caddie does Adam's recap AND a separate Coach Mode summary for Mike.

### Round 3 — Stress test, frustrated, asks everything
- Adam shoots 82 in tough wind. Mid-round he stress-tests:
  - "What's the play from the rough" → `query_status: shot_strategy, lie_hint: rough` → kevin reply.
  - "What did Meta say" → `query_status: what_did_meta_say` → reads glasses ingest log if any.
  - "How am I doing against the ghost" → `query_status: ghost_match` → reads ghostStore.
  - "Plays like 152" → `query_status: plays_like, target_yards: 152` → wind+elevation adjusted.
  - "Can I carry the bunker" → `query_status: carry_check, hazard_phrase: bunker` → reads dispersion data.
  - "Compare to my last swing" → `query_status: swing_compare, against: self_previous` → opens compare flow.
- Every one fires the appropriate handler, all reply via speak() with userInitiated:true (mic-tap origin).
- Mid-frustration: "Log this — caddie cut me off when I was talking" → `log_issue` → entry persists with context.
- After round: "Kevin send issue log" → Fix DW: `open_tool: issue_log, send_log: true` → routes to /owner-logs?send=1 → auto-fires mailto export to support@smartplaycaddie.com.

**Net for Aggressive Adam:**
- Voice fires: ~40 across the 3 rounds (max-tool usage)
- Cage summary: 1x per cage session (pre-round R1)
- SmartCapture: used 2x (R1 driver fault, R3 review)
- SmartMotion: 3x (range R1, pre-round R2, mid-cage)
- TightLie: 6x (every difficult approach)
- Coach Mode: 1x per round 2 hole when Mike was hitting
- Mark Green / Tee: 1x R1
- Cockpit mode + Harry: smoke-tested
- Issue log voice: 1x in R3 → email composed and sent

---

## Voice fire path — summary across all 9 rounds

Total voice fires across the simulation (rough estimate):

| Path | Player 1 | Player 2 | Player 3 | Total |
|---|---|---|---|---|
| Briefing speak (Fix EB) | 3 | 3 | 3 | 9 |
| First-tee hint | 1 | 0 | 0 | 1 |
| Per-hole intro (54 holes / 3 players) | 54 | 54 | 54 | 162 |
| Mic-tap → speak | 25 | 30 | 40 | 95 |
| Cage session voice summary | 0 | 1 | 1 | 2 |
| SmartMotion analysis voice | 0 | 0 | 3 | 3 |
| TightLie reply voice | 0 | 3 | 6 | 9 |
| Score-tell confirm | 5 | 22 | 0 (cockpit, less voice scoring) | 27 |
| End-round recap voice | 3 | 3 | 3 | 9 |
| **Estimated voice fires** | **~91** | **~116** | **~110** | **~317** |

Every one of those goes through `speak()` which now has:
- ✅ Fix EB: userInitiated:true on briefing + mic-tap origin
- ✅ Fix EC: stale-clip file probe before override
- ✅ Fix EG: auto-retry on dead playback
- ✅ Fix EH: small-payload reject clears caption
- ✅ Fix DS: trace logs on every step

**Expected silent-fail rate: 0** under normal conditions (server OK, audio session OK, file system OK). If any of the underlying conditions break, Fix EG retries once; if still bad, gives up cleanly (caption + state clear). No more stuck "talking" badge.

---

## What could still go wrong (flagged from the trace)

These aren't bugs I'm fixing right now — they're risk areas worth real-device testing:

1. **Concurrent voice fires during round-start race.** Briefing speak() + per-hole intro at hole 1 fire near-simultaneously after navigation. The speak queue serializes them, but the timing window between briefing.speak resolving and the caddie tab mounting could leave the per-hole speak suppressed if hasHydrated isn't ready. Worth a real cart-round verification.

2. **Cage session voice summary timing.** If the user moves the phone or leaves the cage screen before the 5-min idle trigger, the summary may not fire. Per [[cart-is-default]] this is "expected sometimes" — but worth confirming via Issue Log.

3. **Mark Green / Tee voice-direct path.** Falls through to navigation when GPS quality fails. Player 3's hole-3 Mark Green ASSUMES GPS quality is good in the moment — could fall through silently on a cold-cellular start.

4. **SmartMotion auto-start.** Quick-record screen mounts and fires recording on a setTimeout. If the camera permission prompt blocks first, the auto-start could miss. The screen's logic handles this but it's the kind of timing issue that bites only on devices where camera init is slow.

5. **Tank's Tips infographic load.** 2.5MB bundled PNG. Older Androids on cold-load could see a flash before image renders. Acceptable.

---

## What the USER should feel (round-by-round)

| Player | Round | Subjective experience |
|---|---|---|
| Bogey Bob | 1 | "Hey, this thing actually talks to me. Useful for the yardages. Bit chatty." |
| Bogey Bob | 2 | "I'm in a groove. The voice quieted on stuff I already knew. Drills tab gave me Tank — first one." |
| Bogey Bob | 3 | "Wind was rough. Caddie didn't get in my way. Recap was honest — wind cost me, not my swing." |
| Steady Steve | 1 | "Range Tank kept me focused. Serena is the right voice for the round. TightLie nailed the lay-up call." |
| Steady Steve | 2 | "Tournament mode just worked. Voice score for 4 players was the killer feature." |
| Steady Steve | 3 | "Quiet mode actually quiet. Tapped 3x, got real answers, no silence." |
| Aggressive Adam | 1 | "Used every tool. Cockpit + Harry is the calm tournament UI I wanted. Mark Green saved a hole." |
| Aggressive Adam | 2 | "Walking + Coach Mode for Mike + my own play — three roles, no conflict." |
| Aggressive Adam | 3 | "Stress-tested every voice intent. Asked stupid stuff, got real answers. Issue log via voice was the cherry." |

---

## What we'd be WATCHING for on real devices

If a tester ran these scenarios on hardware, the things I'd most want to know:

1. **Did Player 1's briefing actually play voice all 3 rounds?** Fix EB + EG + EH all target this; a real-device "still silent" would mean a fifth latent cause we haven't found.
2. **Did Player 2's L1 → tap-to-talk path actually fire voice?** Confirms Fix EB's userInitiated override.
3. **Did Player 3's SmartMotion early-extension detection actually route to Tank's drill card on top?** Confirms Fix EE's matchesDetectedIssues wiring.
4. **Did SmartCapture's straight + ROI tools land cleanly with measurement readouts?** Confirms Fix DX UX.
5. **Did the post-round Issue Log voice ("send issue log") actually fire the email export?** Confirms Fix DW + the email-on-mount effect.
6. **Did cage session summary voice fire for both Steve + Adam?** Tests the proactive-talk path that doesn't go through mic-tap.

Anything that doesn't match the above → say "Kevin send issue log" → the trace logs will pinpoint the exact step.
