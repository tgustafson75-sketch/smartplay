/**
 * 2026-06-13 (Tim) — Quick how-to help: ONE source of truth for short, friendly
 * orientation on each surface. Powers BOTH the first-time QuickTutorial overlays
 * (text + caddie narration) AND the on-demand "how do I use this?" answer, so they
 * never drift apart. Max ~3 lines each; an icon for orientation.
 *
 * Pure, no imports → unit-testable and usable from both a component and the voice
 * handler. detectHelpRequest is narrow (a real "how do I use X" / "how does X work"
 * ask about the APP), and maps the spoken feature name to a help key.
 */

export interface ScreenHelp {
  key: string;
  title: string;
  /** Ionicons glyph name (caller casts to the icon type). */
  icon: string;
  lines: string[];
  /** Shorter spoken version for the caddie's narration. */
  spoken: string;
}

export const SCREEN_HELP: Record<string, ScreenHelp> = {
  play: {
    key: 'play',
    title: 'Play a Round',
    icon: 'golf-outline',
    lines: [
      'Pick your course — closest courses are one tap, or search any course.',
      'Set how you’ll play it: tees, walking or cart, format, and your mental focus.',
      'Tap Start Round when you’re ready — I’ll be on the bag.',
    ],
    spoken: "This is the Play tab. Pick your course, set the conditions and how you want to play, then start your round when you're ready.",
  },
  drills: {
    key: 'drills',
    title: 'Drills',
    icon: 'fitness-outline',
    lines: [
      'Pick a drill — each one opens the camera in Smart Motion.',
      'Set up face-on, start recording, and run a few short reps.',
      'I analyze your form and log your practice points.',
    ],
    spoken: "These are your drills. Pick one, set up face-on, start recording and run a few reps — I'll analyze your form and track your practice.",
  },
  smartmotion: {
    key: 'smartmotion',
    title: 'Smart Motion',
    icon: 'camera-outline',
    lines: [
      'Dock the phone so I can see you head to feet, and hit record — I find the ball myself.',
      'Swing — I detect the strike and analyze your motion.',
      'Review the read, then re-record or save it to your library.',
    ],
    spoken: "Smart Motion is your swing camera. Stand the phone where it can see all of you, hit record, take your swing, and I'll read it back.",
  },
  scorecard: {
    key: 'scorecard',
    title: 'Scorecard',
    icon: 'create-outline',
    lines: [
      'Tap a hole to enter your score — it tracks against par as you go.',
      'Putts and penalties feed your stats and handicap.',
      'When the round’s done, save it to your history.',
    ],
    spoken: "Here's your scorecard. Tap each hole to log your score — it tracks against par, and your putts and penalties feed your stats. Save it to history when you're done.",
  },
  swinglab: {
    key: 'swinglab',
    title: 'SwingLab',
    icon: 'school-outline',
    lines: [
      'Smart Motion records and analyzes your swing.',
      'Drills, Tempo Trainer, and the Practice Engine build your game.',
      'Your Swing Library keeps every analyzed swing.',
    ],
    spoken: "This is SwingLab — your practice home. Smart Motion records your swing, and drills and the practice engine help you improve.",
  },
};

/**
 * 2026-10-28 (Brain review r3) — feature names, split by how safely they name the APP.
 *
 * The old table was matched with a substring test against the whole sentence, behind a how-to test
 * that accepted any "how do/does … use/work". Round 1 (B10) put this step in front of every brain
 * turn, so "How should I use the wind on this hole?", "How does lag putting work?" and "How do I use
 * my hybrid out of the rough?" got the SwingLab tour (the fallback), "How do I use my wedges to score
 * better?" got the scorecard ('score'), and "How would you use the slope around the green?" got the
 * Play tab ('round' inside 'around'). Kevin never heard any of them.
 *
 * So a feature is help only when it IS the object of use/work. A product name stands alone; a golf
 * word ("round", "score", "practice") names the app only with a screen noun after it ("the play tab",
 * "the practice screen").
 */
const FEATURE_NAMES: Record<string, string> = {
  'play tab': 'play',
  drills: 'drills',
  'smart motion': 'smartmotion', smartmotion: 'smartmotion',
  scorecard: 'scorecard', 'score card': 'scorecard',
  'swing lab': 'swinglab', swinglab: 'swinglab',
};
const GOLF_WORD_FEATURES: Record<string, string> = {
  play: 'play', round: 'play',
  drill: 'drills', drills: 'drills',
  motion: 'smartmotion',
  score: 'scorecard', scoring: 'scorecard',
  practice: 'swinglab',
};
const SCREEN_NOUN = '(?:tab|screen|page|section)';
/** "this", "this screen", "the app" — the thing he is looking at. */
const DEICTIC = new RegExp(`^(?:this|(?:this|the)\\s+(?:app|screen|page|tab|thing|feature))$`);
/** What may follow the object without making it a golf question: a place, a name, a please. */
const TAIL = String.raw`(?:\s+(?:here|in\s+(?:the|this)\s+app|on\s+this\s+(?:app|screen|page)|kevin|please))*`;

export function getScreenHelp(key: string | null | undefined): ScreenHelp | null {
  if (!key) return null;
  return SCREEN_HELP[key] ?? null;
}

/** The SCREEN_HELP key for a live route (routeBreadcrumb's pathname), or null off the help surfaces. */
export function helpKeyForRoute(route: string | null | undefined): string | null {
  const r = (route ?? '').split('?')[0].replace(/\/+$/, '');
  if (r === '/play') return 'play';
  if (r === '/scorecard') return 'scorecard';
  if (r === '/swinglab/smartmotion') return 'smartmotion';
  if (r === '/swinglab') return 'swinglab';
  if (r === '/drills' || r.startsWith('/drills/')) return 'drills';
  return null;
}

/** Resolve the object of "use"/"work" to a help key: a feature name, or "this" → the current screen. */
function resolveObject(obj: string, currentKey: string | null | undefined): string | null {
  const o = obj.replace(/^(?:the|my|your|this|that)\s+/, '').trim();
  if (DEICTIC.test(obj.trim())) return currentKey && SCREEN_HELP[currentKey] ? currentKey : null;
  if (FEATURE_NAMES[o]) return FEATURE_NAMES[o];
  const screen = o.match(new RegExp(`^([a-z ]+?)\\s+${SCREEN_NOUN}$`));
  if (screen) {
    const name = screen[1].trim();
    if (name === 'this') return currentKey && SCREEN_HELP[currentKey] ? currentKey : null;
    return FEATURE_NAMES[name] ?? GOLF_WORD_FEATURES[name] ?? null;
  }
  return null;
}

/**
 * Detect a "how do I use X / how does X work / what do I do here" request about the APP and resolve
 * the feature. Returns null for anything else — including every golf "how" question — so it reaches
 * Kevin. `currentKey` (the screen the player is on) answers "this"; with no help screen behind
 * "this", it is null too, because a tour of a screen he is not looking at is not an answer.
 */
export function detectHelpRequest(raw: string, currentKey?: string | null): { key: string } | null {
  const t = (raw ?? '').trim().toLowerCase()
    .replace(/[?.!]+$/, '')
    .replace(/^(?:(?:hey|ok|okay)\s+)?(?:kevin|serena|caddie)\s*,?\s+/, '')
    .trim();
  if (!t) return null;
  const use = t.match(new RegExp(`^how\\s+(?:do|can|could|should|would)\\s+(?:i|you|we|one)\\s+use\\s+([a-z' ]+?)${TAIL}$`));
  const works = t.match(new RegExp(`^how\\s+(?:does|do)\\s+([a-z' ]+?)\\s+work${TAIL}$`));
  const obj = use?.[1] ?? works?.[1];
  if (obj) {
    const key = resolveObject(obj, currentKey);
    return key ? { key } : null;
  }
  if (new RegExp(`^(?:how\\s+do\\s+i\\s+do\\s+this|what\\s+do\\s+i\\s+do\\s+(?:here|on\\s+this\\s+${SCREEN_NOUN}))$`).test(t)) {
    return currentKey && SCREEN_HELP[currentKey] ? { key: currentKey } : null;
  }
  return null;
}
