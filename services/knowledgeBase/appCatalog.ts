/**
 * APP-FEATURE CATALOG — the single source of truth for every tool / card /
 * drill the caddie can name and open.
 *
 * Why this exists: the caddie's brain had no map of the app. It didn't know
 * "Smart Tempo" existed and couldn't route "open the tempo drill card." This
 * catalog fixes that on two fronts:
 *   1. BRAIN AWARENESS — catalogForPrompt() injects a compact feature list into
 *      the system prompt (api/kevin.ts + api/pipecat-turn.ts) so the caddie can
 *      reference features by name and tell the open-tools which to open.
 *   2. DETERMINISTIC ROUTING — lookupFeature() + the aliases here back the voice
 *      router (services/intents/openToolHandler.ts) so "open smart tempo" lands
 *      on the real screen without a cloud round-trip.
 *
 * EVERY route below is verified against the app/ tree. Routes are the real
 * expo-router paths the SwingLab hub / tab bar already push. Don't invent
 * features — if it's not a real screen, it's not here.
 *
 * SHARED client + server (app router imports it; api/ imports it for the
 * prompt). Pure data + pure helpers — no React, no Node, no fetch.
 */

import type { AppFeature } from './schema';

export const APP_FEATURES: AppFeature[] = [
  // ── ANALYZE (the wow: capture + AI) ──────────────────────────────────────
  {
    id: 'smartmotion',
    name: 'SmartMotion',
    aliases: ['smartmotion', 'smart motion', 'record my swing', 'capture my swing', 'analyze my swing', 'cage mode'],
    route: '/swinglab/smartmotion',
    category: 'analyze',
    blurb: 'AI swing capture + analysis (cage/range/course), acoustic detection, body mechanics',
    whenToUse: 'they want to record and get a real swing analysis',
  },

  // ── PRACTICE ─────────────────────────────────────────────────────────────
  {
    id: 'smart-tempo',
    name: 'Smart Tempo',
    aliases: ['smart tempo', 'tempo', 'tempo drill', 'tempo trainer', 'tempo card', 'work on my tempo'],
    route: '/swinglab/smart-tempo',
    category: 'practice',
    blurb: 'Measures your real backswing:downswing ratio vs the 3:1 ideal',
    whenToUse: 'they ask about tempo, rhythm, or the 3:1 ratio',
  },
  {
    id: 'drills',
    name: 'Drills',
    aliases: ['drills', 'drill', 'practice drills', 'swing drills'],
    route: '/drills',
    category: 'practice',
    blurb: 'Targeted drills for your primary faults, run through SmartMotion',
    whenToUse: 'they want a structured drill for a specific fault',
  },
  {
    id: 'open-range',
    name: 'Open Range',
    aliases: ['open range', 'range mode', 'hit balls', 'range session'],
    route: '/practice/open-range',
    category: 'practice',
    blurb: 'Hit freely — SmartMotion tracks every ball and tallies the read',
    whenToUse: 'they want to mash balls and still get a count/read',
  },
  {
    id: 'focus-session',
    name: 'Focus Session',
    aliases: ['focus session', 'focused practice', 'interleaved practice'],
    route: '/practice/session',
    category: 'practice',
    blurb: 'Interleaved practice that makes range work actually stick',
    whenToUse: 'they want a guided, varied practice block',
  },
  {
    id: 'shot-shapes',
    name: 'Shot Shapes',
    aliases: ['shot shapes', 'shot shape', 'shape practice', 'work on my shapes'],
    route: '/practice/shot-shapes',
    category: 'practice',
    blurb: 'Track your actual shot patterns and see shape trends',
    whenToUse: 'they want to practice or review draw/fade/shape patterns',
  },
  {
    id: 'library',
    name: 'Swing Library',
    aliases: ['swing library', 'library', 'my swings', 'show me my swings', 'past swings'],
    route: '/swinglab/library',
    category: 'practice',
    blurb: 'View, compare, and re-analyze your captured swings',
    whenToUse: 'they want to look back at saved swings',
  },

  // ── PLAY / COACH ─────────────────────────────────────────────────────────
  {
    id: 'coach-mode',
    name: 'Coach Mode',
    aliases: ['coach mode', 'coaching', 'coach someone', 'analyze another player'],
    route: '/swinglab/coach-mode',
    category: 'play',
    blurb: 'Analyze other players and build your coaching roster',
    whenToUse: 'they want to film/analyze someone other than themselves',
  },

  // ── PREPARE ──────────────────────────────────────────────────────────────
  {
    id: 'fit-profile',
    name: 'Fit Profile',
    aliases: ['fit profile', 'my bag', 'club fitting', 'bag setup'],
    route: '/practice/fit-profile',
    category: 'prepare',
    blurb: 'Real game data builds your ideal bag setup and gapping',
    whenToUse: 'they ask about their bag, gapping, or club fitting',
  },
  {
    id: 'setup-check',
    name: 'Setup Check',
    aliases: ['setup check', 'check my setup', 'address check', 'alignment check'],
    route: '/swinglab/setup-check',
    category: 'prepare',
    blurb: 'Address, alignment, and grip fundamentals from one photo',
    whenToUse: 'they want to verify setup fundamentals before playing',
  },
  {
    id: 'smartplan',
    name: 'SmartPlan',
    aliases: ['smartplan', 'smart plan', 'practice plan', 'improvement plan', 'my plan'],
    route: '/practice/smartplan',
    category: 'prepare',
    blurb: 'Your personalized AI improvement plan',
    whenToUse: 'they ask what to work on or want a structured plan',
  },
  {
    id: 'preround',
    name: 'Pre-Round Warm Up',
    aliases: ['pre round warm up', 'pre-round warm up', 'warm up', 'warmup', 'preround'],
    route: '/practice/preround',
    category: 'prepare',
    blurb: 'End your warm-up on a good swing every time before a round',
    whenToUse: 'they are warming up before teeing off',
  },
  {
    id: 'range-import',
    name: 'Import Range Session',
    aliases: ['import range session', 'range import', 'import toptracer', 'scan my range numbers'],
    route: '/swinglab/range-import',
    category: 'prepare',
    blurb: 'Scan a TopTracer screenshot — carry distances feed the caddie',
    whenToUse: 'they have launch-monitor / TopTracer numbers to bring in',
  },

  // ── CADDIE TOOLS ─────────────────────────────────────────────────────────
  {
    id: 'smartfinder',
    name: 'SmartFinder',
    aliases: ['smartfinder', 'smart finder', 'rangefinder', 'find the yardage', 'lock the distance', 'whats the smart play'],
    route: '/smartfinder',
    category: 'caddie',
    blurb: 'Precise distance-locking rangefinder + one composed shot read',
    whenToUse: 'they want an exact yardage or the smart play on a shot',
  },
  {
    id: 'smartvision',
    name: 'SmartVision',
    aliases: ['smartvision', 'smart vision', 'show me the hole', 'hole layout', 'hole map', 'see the layout'],
    route: '/smartvision',
    category: 'caddie',
    blurb: 'Visual hole layout — green, fairway, hazards, yardages',
    whenToUse: 'they want to see the hole / map / layout',
  },

  // ── DATA / NAV ───────────────────────────────────────────────────────────
  {
    id: 'scorecard',
    name: 'Scorecard',
    aliases: ['scorecard', 'my scorecard', 'the card', 'score card'],
    route: '/(tabs)/scorecard',
    category: 'data',
    blurb: 'Your live and past round scorecards',
    whenToUse: 'they want to see or check their scorecard',
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    aliases: ['dashboard', 'my stats', 'home', 'my numbers'],
    route: '/(tabs)/dashboard',
    category: 'data',
    blurb: 'Your stats, trends, and practice history',
    whenToUse: 'they want their stats / trends overview',
  },
  {
    id: 'play',
    name: 'Play',
    aliases: ['play', 'start a round', 'start round', 'play a round', 'tee it up'],
    route: '/(tabs)/play',
    category: 'play',
    blurb: 'Start a round and pick a course',
    whenToUse: 'they want to begin playing / start a round',
  },
];

// ── FAULT DRILLS (voice-addressable) ─────────────────────────────────────────
// "Open the X drill" lands on the DRILL CARD (app/drills/[issue].tsx) — each card
// holds MULTIPLE exercises + a video + a "Practice in Smart Motion" button (Tim,
// 2026-06-26: "some drill cards have multiple drills"). So we route to the card,
// NOT straight into a capture — the user sees the exercises and starts practice
// from there. Only id/title/aliases live here (the card reads its own practice
// config from data/drillCatalog), so there's no duplicated drill data to drift.
// "Tempo" is intentionally omitted: the richer Smart Tempo screen (above) owns it.
const DRILLS: ReadonlyArray<{ id: string; title: string; aliases: string[] }> = [
  { id: 'over_the_top',          title: 'Over the Top',          aliases: ['over the top', 'coming over the top', 'casting', 'over the top fix'] },
  { id: 'swing_path_outside_in', title: 'Outside-In Path',       aliases: ['outside in', 'outside-in', 'outside in path', 'slice path'] },
  { id: 'swing_path_inside_out', title: 'Inside-Out Path',       aliases: ['inside out', 'inside-out', 'inside out path', 'hook path'] },
  { id: 'club_face_open',        title: 'Open Clubface',         aliases: ['open clubface', 'open face', 'face open'] },
  { id: 'club_face_closed',      title: 'Closed Clubface',       aliases: ['closed clubface', 'closed face', 'face closed'] },
  { id: 'early_extension',       title: 'Early Extension',       aliases: ['early extension', 'standing up', 'losing posture'] },
  { id: 'attack_angle_steep',    title: 'Steep Attack',          aliases: ['steep attack', 'too steep', 'steep angle of attack'] },
  { id: 'attack_angle_shallow',  title: 'Shallow Attack',        aliases: ['shallow attack', 'too shallow', 'shallow angle of attack'] },
  { id: 'chicken_wing',          title: 'Chicken Wing',          aliases: ['chicken wing', 'lead arm', 'bent lead arm'] },
  { id: 'reverse_pivot',         title: 'Reverse Pivot',         aliases: ['reverse pivot', 'weight shift', 'hanging back'] },
  { id: 'chipping_inconsistent', title: 'Inconsistent Chipping', aliases: ['chipping', 'chip', 'inconsistent chipping', 'short game contact'] },
];

/** Fault drills as catalog features — searched by lookupFeature so both the local
 *  router AND the brain's navigate tool open any drill CARD by name. */
export const DRILL_FEATURES: AppFeature[] = DRILLS.map(d => ({
  id: `drill-${d.id}`,
  name: `${d.title} Drill`,
  aliases: Array.from(new Set([
    ...d.aliases,
    ...d.aliases.map(a => `${a} drill`),
    d.title.toLowerCase(),
    `${d.title.toLowerCase()} drill`,
  ])),
  route: `/drills/${d.id}`,
  category: 'practice',
  blurb: `${d.title} drill card — exercises, video, and a Practice-in-Smart-Motion button`,
  whenToUse: `they want the ${d.title.toLowerCase()} drill`,
}));

/** Normalize a transcript for matching: lowercase, collapse separators/space. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Conservative feature match for the deterministic router.
 *   1. Exact alias / name equality (after normalization) — strongest.
 *   2. Whole-phrase alias contained in the transcript, longest alias first
 *      (so "smart tempo" beats a bare "tempo" when both appear).
 * Returns null on no confident match — the caller then falls back to the cloud
 * classifier. We do NOT fuzzy-match single short words to avoid mis-routing.
 */
export function lookupFeature(transcript: string): AppFeature | null {
  const t = norm(transcript);
  if (!t) return null;

  // Search the named features AND the fault drills (so "open the over-the-top
  // drill" resolves to its SmartMotion deep-link, same as Smart Tempo does).
  const ALL = [...APP_FEATURES, ...DRILL_FEATURES];

  // Pass 1: exact equality on name or any alias.
  for (const f of ALL) {
    if (norm(f.name) === t) return f;
    if (f.aliases.some(a => norm(a) === t)) return f;
  }

  // Pass 2: longest alias contained as a whole phrase in the transcript.
  let best: { f: AppFeature; len: number } | null = null;
  for (const f of ALL) {
    for (const a of [f.name, ...f.aliases]) {
      const na = norm(a);
      // Require >=2 chars and word-boundary containment to stay conservative.
      if (na.length < 2) continue;
      const re = new RegExp(`(^|\\s)${na.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s)`);
      if (re.test(t) && (!best || na.length > best.len)) best = { f, len: na.length };
    }
  }
  return best?.f ?? null;
}

/**
 * COMPACT feature list for the brain system prompt. One short line per feature:
 *   "Name — blurb (say: alias1, alias2)"
 * Kept tight (capped aliases) because this string is paid for on EVERY turn.
 * ~1.0–1.4k chars total across the catalog.
 */
export function catalogForPrompt(): string {
  const features = APP_FEATURES.map(f => {
    const says = f.aliases.slice(0, 3).join(', ');
    return `- ${f.name} — ${f.blurb} (say: ${says})`;
  }).join('\n');
  // Drills as ONE compact line (not one verbose line each) so the brain knows it
  // can navigate to any by name without paying 11 lines of prompt every turn.
  const drills = DRILLS.map(d => d.title).join(', ');
  return `${features}\n- FAULT DRILLS (open any by name via navigate, e.g. "open the over-the-top drill"): ${drills}`;
}
