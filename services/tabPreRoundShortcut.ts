/**
 * THE TAB-AVATAR PRE-ROUND SHORTCUT — the tool opens and the quick-round start the on-screen mic acts
 * on before the router and the brain.
 *
 * Moved out of hooks/useVoiceCaddie (2026-10-28, Brain review r5) so the rule is tested against the
 * real phrase lists, like services/tabVoiceBypass; the hook still runs the handlers.
 *
 * 2026-10-28 (Brain review r5) — the only guard was isNotACommand, which misses a plain statement, and
 * the match is a substring. Off-round, "That was a quick round today" started a round at the home
 * course and "Tomorrow I want to start a round at Hemet with my dad" one at Hemet with a guest "dad",
 * neither confirmed. "I did cage mode for an hour this morning" and "My wife wants me to try coach mode
 * with our daughter" opened Cage / Coach Mode — both exempt from openToolHandler's open-verb gate — so
 * the camera started recording and the caddie never heard the story. The shortcuts that ACT now need
 * the whole utterance to be the order (services/utteranceIsCommand.opensWithOrder); anything else goes
 * on to the router and the caddie, as it does on every other route.
 */
import { isNotACommand, opensWithOrder } from './utteranceIsCommand';

export interface PreRoundShortcut {
  intent_type: 'open_tool' | 'quick_round';
  parameters: Record<string, unknown>;
}

function normalizeForMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[’'".,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitGuestNames(text: string): string[] {
  return text
    .split(/,|\band\b/i)
    .map(name => name.trim())
    .filter(name => name.length > 0)
    .map(name => name.replace(/^(?:my|our|the)\s+/i, ''));
}

function stripLeadIn(text: string): string {
  return text.replace(/^(?:please\s+)?(?:can you\s+|could you\s+|would you\s+|hey\s+\w+\s+|me\s+)?/i, '').trim();
}

function includesAny(text: string, phrases: string[]): boolean {
  return phrases.some(phrase => text.includes(phrase));
}

/**
 * The tools openToolHandler opens WITHOUT an open verb (its EXEMPT_ACTION_TOOLS) and that start
 * something on arrival — Coach and Cage Mode begin recording. SmartMotion with an angle auto-starts
 * too (checked where its params are set). Every other tool here still meets the handler's verb gate,
 * which declines a sentence that merely names it.
 */
const ACTS_ON_ARRIVAL = new Set(['coach_mode', 'cage_mode']);

const QUICK_ROUND_PHRASES = ['quick round', 'start a round', 'start round', 'let s play a round', 'let us play a round', 'let s play 9', 'let s play 18', 'play a quick round', 'start another round', 'start a quick round'];

/** `homeCourse` is the player's primary home course name (the course a bare "quick round" starts at). */
export function tabPreRoundShortcut(transcript: string, homeCourse: string): PreRoundShortcut | null {
  const cleaned = normalizeForMatch(transcript);
  if (!cleaned) return null;
  /**
   * 2026-10-16 (voice seam review) — this runs on EVERY caddie-tab turn, before the bypasses, the
   * router and the brain, and matched substrings with no question guard: "What should I hit here?"
   * opened TightLie, openToolHandler then declined (no explicit verb → route_to_brain), and the turn
   * went idle in SILENCE — on the most common in-round question. A question or a story is never a
   * shortcut; it goes to the caddie (services/utteranceIsCommand, the same guard as the precheck).
   */
  if (isNotACommand(transcript)) return null;

  const familyHomeCourse = homeCourse.trim();

  const toolText = stripLeadIn(cleaned.replace(/^(?:open|show|pull up|go to|launch|bring up|take me to)\s+(?:me\s+)?/i, ''));
  const toolMatchers: { tool_name: string; aliases: string[] }[] = [
    { tool_name: 'smartvision', aliases: ['smart vision', 'smartvision', 'vision', 'analyze the hole', 'read the hole'] },
    { tool_name: 'smartfinder', aliases: ['smart finder', 'smartfinder', 'finder', 'rangefinder', 'course map', 'hole map', 'show me the course', 'show the course'] },
    // 2026-06-29 (Tim — "natural caddie, not a prompting system") — REMOVED the vague
    // 'practice'/'drills' (and below 'cage'/'start practice', and 'course'/'the course'
    // above): a conversational "I want to practice" must reach the BRAIN for the
    // dialogue-first confirm ("what do you want to work on?"), not deterministically
    // open Smart Motion. Explicit "open swing lab" still matches.
    { tool_name: 'swinglab', aliases: ['swing lab', 'swinglab', 'swing library'] },
    { tool_name: 'scorecard', aliases: ['scorecard', 'score card', 'scores', 'show the scorecard'] },
    { tool_name: 'dashboard', aliases: ['dashboard', 'stats', 'overview', 'home stats'] },
    { tool_name: 'settings', aliases: ['settings', 'preferences', 'voice settings', 'audio settings'] },
    // 2026-10-16 — bare 'coach' removed: "My coach told me to stay down" opened Coach Mode for "told".
    { tool_name: 'coach_mode', aliases: ['coach mode', 'coachmode', 'watch my student', 'record their swing'] },
    { tool_name: 'cage_mode', aliases: ['cage mode', 'cagemode', 'start cage session'] },
    { tool_name: 'library', aliases: ['player library', 'swing library', 'library', 'show my swings', 'my swings', 'show best shots', 'show my best shots', 'best shots'] },
    { tool_name: 'smartmotion', aliases: ['smart motion', 'smartmotion', 'record my swing', 'capture my swing', 'down the line', 'face on'] },
    { tool_name: 'issue_log', aliases: ['issue log', 'bug log', 'log an issue', 'send issue log', 'email issue log'] },
    // 2026-10-16 — 'what should i hit' removed: it is a strategy question for the caddie (api/voice-intent
    // says so), never a TightLie open.
    { tool_name: 'tightlie', aliases: ['tightlie', 'tight lie', 'open tightlie', 'check my lie'] },
  ];

  for (const matcher of toolMatchers) {
    if (includesAny(toolText, matcher.aliases)) {
      // A sentence that only mentions Coach / Cage Mode is not an order to start recording (r5).
      if (ACTS_ON_ARRIVAL.has(matcher.tool_name) && !opensWithOrder(transcript, matcher.aliases)) return null;
      const params: Record<string, unknown> = { tool_name: matcher.tool_name };
      if (matcher.tool_name === 'smartmotion' && includesAny(toolText, ['down the line', 'face on'])) {
        // An angle starts the camera recording on arrival — the same rule as Coach / Cage Mode, or
        // "I want to record my swing down the line tomorrow" passes the handler's "record" verb gate.
        if (!opensWithOrder(transcript, matcher.aliases)) return null;
        params.auto_start = true;
        params.angle = toolText.includes('down the line') ? 'down_the_line' : 'face_on';
      }
      if (matcher.tool_name === 'issue_log' && includesAny(toolText, ['send', 'email', 'share', 'export'])) {
        params.send_log = true;
      }
      if (matcher.tool_name === 'coach_mode') {
        // "coach mode for Lily" → Lily, not "mode" (re-review 10-16).
        const playerMatch = transcript.match(/\b(?:coach(?:\s+mode)?(?:\s+for)?|watch my student|watching|i'?m coaching|let's coach)\s+(?!mode\b|for\b)([A-Z][a-zA-Z'-]*)/i);
        if (playerMatch?.[1]) params.player_name = playerMatch[1];
      }
      return { intent_type: 'open_tool', parameters: params };
    }
  }

  // 2026-10-16 — bare "let's play" / "another round" removed: "let's play it safe" and "I don't want another
  // round like that" started a quick round at the home course.
  // normalizeForMatch turns apostrophes into spaces, so "let's" is matched as "let s" (re-review 10-16:
  // the apostrophe forms could never match).
  // 2026-10-28 (r5) — and the round starts only on an order: "That was a quick round" is a sentence.
  if (includesAny(cleaned, QUICK_ROUND_PHRASES) && opensWithOrder(transcript, ['quick round'])) {
    const holeCount = /\b9[- ]?hole\b|\blet s play 9\b|\bplay 9\b/.test(cleaned) ? 9 : 18;
    const courseMatch = transcript.match(/\b(?:at|on|for)\s+(.+?)(?:\s+with\s+|\s+today\b|\s+now\b|\s*$)/i);
    const courseHint = courseMatch?.[1]?.trim() || familyHomeCourse;
    const guestMatch = transcript.match(/\bwith\s+(.+?)(?:\s+at\b|\s+on\b|\s+for\b|\s+today\b|\s+now\b|$)/i);
    const guestNames = guestMatch?.[1] ? splitGuestNames(guestMatch[1]) : [];
    const params: Record<string, unknown> = { hole_count: holeCount };
    if (courseHint) params.course_hint = courseHint;
    if (guestNames.length > 0) params.guest_names = guestNames.slice(0, 4);
    return { intent_type: 'quick_round', parameters: params };
  }

  return null;
}
