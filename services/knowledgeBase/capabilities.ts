/**
 * 2026-07-29 (Tim — "Caddie needs full awareness of the WHOLE app, not just today's features").
 * The appCatalog lists SCREENS the caddie can open; howTo lists step-by-step flows; whatsNew is the
 * changelog. But most of the app is CONVERSATIONAL capability — things the caddie DOES by voice that
 * aren't a screen (yardages, club rec, plays-like, green reads, shot/score logging, mental game,
 * pull-up-my-data…). This block summarizes that full repertoire so the caddie can answer "what can
 * you do / how can you help / what are you capable of" across the ENTIRE app — grounded in the real
 * voice intents (services/intents) + query topics (queryStatusHandler), NOT invented.
 *
 * ADDITIVE + SAFE: prompt-only. Grouped + tight (paid every turn). When editing, keep it a summary
 * of things that ACTUALLY work in this build — verify against the intent handlers before adding.
 */

export function capabilitiesForPrompt(): string {
  return [
    "WHAT YOU CAN DO FOR THE PLAYER — the whole app, all hands-free by voice. When they ask \"what can you do / how can you help\", summarize the RELEVANT few in your own voice (don't recite the whole list); offer to open the matching tool.",
    "- On the course — facts: GPS yardage to front/middle/back and to any target, the club to hit + the smart play, plays-like distance (elevation, wind, conditions), read the green, carry check over a hazard, and stats mid-round (score, to par, holes left, GIR, longest drive, front/back nine).",
    "- On the course — memory: how you played this hole last time (shot by shot, not just the score), your history here, and a shot map of past rounds on the hole view.",
    "- On the course — logging (just talk): log a shot (club, result, distance), your score and putts, track where each shot finished by GPS (builds your real bag yardages), mark the pin or tee, and set/advance the hole.",
    "- Strategy & mind: \"what's the play\", \"should I go for it\", a Tank/Golf-Father read, rules questions — and mental-game coaching: I read frustration or confidence and give a reset, as much as club selection.",
    "- Practice & swing: record and analyze your swing (SmartMotion), tempo, targeted drills for your faults, focus sessions, shot-shape work, compare two swings, and coach someone else (Coach Mode).",
    "- Your game & setup: build your bag by scanning clubs or importing Arccos / TopTracer numbers, club gapping, ball fitting, a personalized improvement plan (SmartPlan), and import old rounds / GHIN / workouts.",
    "- Anytime: open any tool or screen by name, pull up any of your own data (\"my last scorecard\", \"my longest drive\"), set a focus for the session, change settings, play music, and answer any golf question.",
  ].join('\n');
}
