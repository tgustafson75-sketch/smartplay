/**
 * VoiceIntelligence.js — Golf Caddie Voice Intelligence System
 *
 * Controls WHEN, WHY, and HOW the AI caddie speaks across the entire app.
 * Acts like a real caddie: speaks with purpose, stays quiet when nothing useful
 * to say, never repeats itself, and never interrupts the golfer mid-action.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 4 VOICE STATES
 * ──────────────
 *  INTRO          — App launch / round start. Speaks once. Then silent.
 *  ACTIVE_PLAY    — Pre-shot: GPS update, club suggestion. Max 1 sentence.
 *  REACTIVE       — Post-shot feedback tied to shot result. Max 1 sentence.
 *  SILENT         — No action. Nothing useful to say. Never speaks.
 *
 * PRIORITY ORDER (highest wins when two messages compete)
 * ────────────────────────────────────────────────────────
 *  4 = CRITICAL    (safety / critical info)
 *  3 = SHOT        (immediate post-shot feedback)
 *  2 = STRATEGY    (pre-shot recommendation)
 *  1 = AMBIENT     (proactive coaching / atmosphere)
 *
 * GLOBAL SPEECH RULES
 * ────────────────────
 *  • Never repeat the same message twice in a row
 *  • 8-second minimum between any two auto-speak calls
 *  • When mic is LISTENING — ALL auto-speech is suppressed
 *  • Max 10 words when possible
 *  • Variation built in so nothing sounds robotic
 *
 * Usage:
 *   import { VoiceIntelligence } from '../services/VoiceIntelligence';
 *
 *   // Check before speaking:
 *   const msg = VoiceIntelligence.getPreShotMessage({ distance: 145, club: '7 Iron' });
 *   if (VoiceIntelligence.shouldSpeak(msg, 'STRATEGY')) {
 *     await speak(msg);
 *     VoiceIntelligence.record(msg);
 *   }
 *
 *   // Or use the all-in-one helper:
 *   await VoiceIntelligence.autoSpeak('STRATEGY', msg, speakFn);
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal state (module-level singleton)
// ─────────────────────────────────────────────────────────────────────────────

let _lastMessage       = '';
let _lastSpokenAt      = 0;
let _introSpoken       = false;
let _roundStartSpoken  = false;
let _isListening       = false;   // set true when mic is active — blocks auto-speech
let _currentState      = 'SILENT'; // INTRO | ACTIVE_PLAY | REACTIVE | SILENT
let _pendingPriority   = 0;        // highest priority of currently-pending speech

// Minimum ms between auto-speech calls (not mic-triggered)
const MIN_GAP_MS = 8000;

// Priority constants
export const PRIORITY = {
  AMBIENT:  1,
  STRATEGY: 2,
  SHOT:     3,
  CRITICAL: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// Phrase pools (variation engine — cycles to avoid repetition)
// ─────────────────────────────────────────────────────────────────────────────

const _cursors = {};
const _cycle = (key, pool) => {
  const i = (_cursors[key] ?? 0) % pool.length;
  _cursors[key] = i + 1;
  return pool[i];
};

const INTRO_LINES = [
  "Alright, let's play smart today. I'll guide you shot by shot.",
  "Ready when you are. I'll keep it simple out here.",
  "Let's go. One shot at a time — I've got you.",
];

const ROUND_START_LINES = [
  "Round's live. First hole loaded. Let's be smart.",
  "Here we go. Play your game, I'll do the rest.",
  "Tee it up. I've got your yardages and strategy ready.",
];

// Pre-shot: distance-based
const PRE_SHOT_LINES = {
  inside100: [
    'Inside 100 — focus on landing zone, not power.',
    'Short game time. Pick your spot and commit.',
    'Under 100 yards. Let the loft do the work.',
  ],
  range100to150: [
    '{dist} yards. Play to the middle of the green.',
    '{dist} to the pin. Smooth swing, trust the club.',
    'About {dist} yards. Commit to your target.',
  ],
  range150to200: [
    '{dist} yards — solid iron distance. Smooth tempo.',
    "{dist} to the pin. Take one extra if the wind's up.",
    '{dist} yards. Let the club do the work.',
  ],
  over200: [
    '{dist} yards. Full swing. Pick a clear target.',
    'Long one — {dist} yards. Fairway first.',
    '{dist} out. Smooth and full. No steering.',
  ],
};

// Post-shot reactive feedback
const SHOT_FEEDBACK = {
  left: [
    'Pulled it. Stay through it next time.',
    'Left miss. Keep the hands forward at impact.',
    'Went left. Focus on releasing to the target.',
  ],
  right: [
    'Push right. Commit to the line.',
    'Went right. Stay connected through the ball.',
    'Right miss. Check your aim on the next one.',
  ],
  straight: [
    'Good swing. Keep that.',
    'Straight ball flight. Stay with it.',
    "Solid. That's your swing right there.",
  ],
};

// Pattern-based coaching (after 3+ in a row same miss)
const PATTERN_FEEDBACK = {
  right: [
    'Three rights in a row — aim left of your line.',
    "You're pushing right lately. Aim slightly left.",
    'Consistent right miss. Adjust your aim left center.',
  ],
  left: [
    'Keep pulling left — aim right of center.',
    "Left pattern building. Let the face release.",
    'Three lefts now. Trust the release, aim right.',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Core guard: shouldSpeak()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if this message is safe to speak right now.
 *
 * Blocks when:
 *  - message is empty
 *  - mic is active (user is speaking)
 *  - identical to last spoken message
 *  - within 8 seconds of last auto-speech
 *  - lower priority than a recently-queued message
 *
 * @param {string} message
 * @param {number} priority  — use PRIORITY constants
 * @returns {boolean}
 */
export const shouldSpeak = (message, priority = PRIORITY.AMBIENT) => {
  if (!message?.trim())                          return false; // nothing to say
  if (_isListening)                              return false; // mic active
  if (message === _lastMessage)                  return false; // exact repeat
  if (Date.now() - _lastSpokenAt < MIN_GAP_MS &&
      priority < PRIORITY.CRITICAL)              return false; // too soon
  if (priority < _pendingPriority)               return false; // outranked
  return true;
};

/**
 * Record that a message was spoken — updates dedup / cooldown state.
 * Call this AFTER the speak() promise resolves.
 *
 * @param {string} message
 * @param {number} priority
 */
export const record = (message, priority = PRIORITY.AMBIENT) => {
  _lastMessage  = message;
  _lastSpokenAt = Date.now();
  _pendingPriority = 0;
};

/**
 * All-in-one: check, speak, record.
 * Calls speakFn(message) only if shouldSpeak() returns true.
 *
 * @param {number} priority
 * @param {string} message
 * @param {(text: string) => Promise<void>} speakFn  — your voiceService.speak
 * @returns {Promise<boolean>}  true if speech was triggered
 */
export const autoSpeak = async (priority, message, speakFn) => {
  if (!shouldSpeak(message, priority)) return false;
  _pendingPriority = priority;
  try {
    await speakFn(message);
    record(message, priority);
    return true;
  } catch (e) {
    console.error('[VoiceIntelligence] autoSpeak error:', e?.message ?? e);
    _pendingPriority = 0;
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// State management
// ─────────────────────────────────────────────────────────────────────────────

/** Call when mic starts listening — suppresses all auto-speech */
export const setListening = (listening) => {
  _isListening = listening;
};

/** Returns the current voice intelligence state */
export const getState = () => _currentState;

/** Manually override state (used by screens to signal context changes) */
export const setState = (state) => {
  _currentState = state;
};

// ─────────────────────────────────────────────────────────────────────────────
// Message generators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * INTRO STATE — Returns one-time welcome message.
 * Returns null after the first call (prevents repeat).
 *
 * @param {'app'|'round'} trigger
 */
export const getIntroMessage = (trigger = 'app') => {
  if (trigger === 'round') {
    if (_roundStartSpoken) return null;
    _roundStartSpoken = true;
    return _cycle('round_start', ROUND_START_LINES);
  }
  if (_introSpoken) return null;
  _introSpoken = true;
  return _cycle('intro', INTRO_LINES);
};

/** Reset intro flags (call on logout / new session) */
export const resetIntro = () => {
  _introSpoken = false;
  _roundStartSpoken = false;
};

/**
 * ACTIVE PLAY — Pre-shot distance/club message.
 *
 * @param {{ distance: number, club?: string }} ctx
 * @returns {string|null}
 */
export const getPreShotMessage = ({ distance, club }) => {
  if (!distance) return null;
  const dist = Math.round(distance);

  let pool;
  if (dist < 100)       pool = PRE_SHOT_LINES.inside100;
  else if (dist < 150)  pool = PRE_SHOT_LINES.range100to150;
  else if (dist < 200)  pool = PRE_SHOT_LINES.range150to200;
  else                  pool = PRE_SHOT_LINES.over200;

  const key = dist < 100 ? 'ps_short' : dist < 150 ? 'ps_mid' : dist < 200 ? 'ps_long' : 'ps_driver';
  const raw = _cycle(key, pool);
  return raw.replace('{dist}', String(dist));
};

/**
 * REACTIVE FEEDBACK — Post-shot message.
 *
 * @param {'left'|'right'|'straight'} result
 * @param {string[]} recentResults  — last N shot results for pattern detection
 * @returns {string|null}
 */
export const getShotFeedback = (result, recentResults = []) => {
  if (!result) return null;

  // Pattern check first (higher priority)
  if (recentResults.length >= 3) {
    const last3 = recentResults.slice(-3);
    if (last3.every(r => r === 'right') && result === 'right') {
      return _cycle('pattern_right', PATTERN_FEEDBACK.right);
    }
    if (last3.every(r => r === 'left') && result === 'left') {
      return _cycle('pattern_left', PATTERN_FEEDBACK.left);
    }
  }

  const pool = SHOT_FEEDBACK[result] ?? SHOT_FEEDBACK.straight;
  const key = `shot_${result}`;
  return _cycle(key, pool);
};

/**
 * shouldSpeakYardage — returns true when a GPS yardage update is significant
 * enough to trigger auto-speech.  Uses a 5-yard walking threshold.
 *
 * @param {number}      newYards
 * @param {number|null} lastSpokenYards  — null = first reading, always speaks
 * @param {number}      [threshold=5]
 * @returns {boolean}
 */
export const shouldSpeakYardage = (newYards, lastSpokenYards, threshold = 5) => {
  if (newYards < 5 || newYards > 700) return false;
  if (lastSpokenYards === null || lastSpokenYards === undefined) return true;
  return Math.abs(newYards - lastSpokenYards) > threshold;
};

/**
 * SILENT MODE guard — returns true if we should stay quiet.
 * Centralises all silence logic.
 *
 * @param {string|null} message
 * @param {number} priority
 */
export const isSilent = (message, priority = PRIORITY.AMBIENT) =>
  !shouldSpeak(message, priority);

// ─────────────────────────────────────────────────────────────────────────────
// Default export — namespace object (for convenience import)
// ─────────────────────────────────────────────────────────────────────────────

export const VoiceIntelligence = {
  PRIORITY,
  shouldSpeak,
  record,
  autoSpeak,
  setListening,
  getState,
  setState,
  getIntroMessage,
  resetIntro,
  getPreShotMessage,
  getShotFeedback,
  isSilent,
  shouldSpeakYardage,
};
