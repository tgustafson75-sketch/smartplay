/**
 * 2026-06-13 (Tim) — Quick how-to help: ONE source of truth for short, friendly
 * orientation on each surface. Powers BOTH the first-time QuickTutorial overlays
 * (text + caddie narration) AND the on-demand "how do I use this?" answer, so they
 * never drift apart. Max ~3 lines each; an icon for orientation.
 *
 * Pure, no imports → unit-testable and usable from both a component and the voice
 * handler. detectHelpRequest is narrow (a real "how do I use X" / "how does X work"
 * ask), and maps the spoken feature name to a help key.
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
      'Dock the phone, line up the ball box, and hit record.',
      'Swing — I detect the strike and analyze your motion.',
      'Review the read, then re-record or save it to your library.',
    ],
    spoken: "Smart Motion is your swing camera. Line up the ball, hit record, take your swing, and I'll read it back.",
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

const ALIASES: Record<string, string> = {
  play: 'play', round: 'play', 'play tab': 'play',
  drill: 'drills', drills: 'drills',
  'smart motion': 'smartmotion', smartmotion: 'smartmotion', motion: 'smartmotion',
  scorecard: 'scorecard', score: 'scorecard', scoring: 'scorecard',
  'swing lab': 'swinglab', swinglab: 'swinglab', practice: 'swinglab',
};

export function getScreenHelp(key: string | null | undefined): ScreenHelp | null {
  if (!key) return null;
  return SCREEN_HELP[key] ?? null;
}

/**
 * Detect a "how do I use X / how does X work / how do you use X" request and resolve
 * the feature. Returns null when it isn't a how-to ask. `currentKey` (the screen the
 * user is on) is the fallback when they say "this" / don't name a feature.
 */
export function detectHelpRequest(raw: string, currentKey?: string | null): { key: string } | null {
  const t = (raw ?? '').trim().toLowerCase();
  if (!t) return null;
  const isHowTo =
    /\bhow\s+(?:do|does|can|could|would|should)\b[^.?!]*\b(?:use|works?)\b/.test(t) ||
    /\bhow\s+do\s+i\s+(?:use|do)\s+this\b/.test(t) ||
    /\bwhat\s+do\s+i\s+do\s+here\b/.test(t);
  if (!isHowTo) return null;
  // Named feature wins; else "this" → the current screen.
  for (const [alias, key] of Object.entries(ALIASES)) {
    if (t.includes(alias)) return { key };
  }
  if (currentKey && SCREEN_HELP[currentKey]) return { key: currentKey };
  return { key: 'swinglab' }; // sensible default overview when unspecified
}
