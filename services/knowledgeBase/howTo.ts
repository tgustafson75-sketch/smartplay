/**
 * 2026-07-19 (Tim — "the caddie needs to know EVERYTHING about the app: new users will ask how do
 * I import my GHIN / old scores, how do I change something — and the caddie should give that
 * context, plus offer a quick tutorial + verbal walkthrough").
 *
 * ADDITIVE + SAFE: this is app-USAGE how-to knowledge injected into the brain prompt alongside the
 * feature catalog (appCatalog.catalogForPrompt). It changes nothing in the voice/tool pipeline — it
 * just makes the caddie able to answer "how do I …" with the real, current steps. Keep each entry
 * to ONE short line (prompt budget). Steps are the ACTUAL flows in this build — verify before edit.
 */

export interface HowTo {
  /** Short task id. */
  id: string;
  /** What the user might say / ask. */
  asks: string[];
  /** One-line answer with the real steps. */
  steps: string;
}

export const HOW_TO: HowTo[] = [
  {
    id: 'import-rounds',
    asks: ['import my old rounds', 'import my scores', 'bring in my old data', 'import a scorecard', 'import from Golfshot', 'import from 18Birdies'],
    steps: 'Open Settings → "Import a round", then snap a photo of a paper scorecard OR a screenshot from Golfshot / 18Birdies / GHIN — it reads the scores and you confirm before it saves.',
  },
  {
    id: 'import-ghin-handicap',
    asks: ['import my GHIN', 'import my handicap', 'bring in my handicap scores', 'add my handicap'],
    steps: 'Snap a screenshot of your GHIN (or GHIN score history) and import it the same way as a scorecard (Settings → Import a round); your handicap and past scores come in from that. You can also set your handicap directly in your profile.',
  },
  {
    id: 'import-range',
    asks: ['import my range session', 'import Toptracer', 'bring in my range numbers'],
    steps: 'Open SwingLab → Range Import (or say "import my range numbers") and snap your Toptracer stats screen — it maps your carry distances into your bag.',
  },
  {
    id: 'import-workout',
    asks: ['import my workout', 'import SmartPump', 'add my gym data'],
    steps: 'Settings → Import a SmartPump workout (PDF, CSV, or JSON); it correlates your training with your on-course performance on the Dashboard.',
  },
  {
    id: 'backup-restore',
    asks: ['back up my data', 'restore my data', 'save my data', 'move to a new phone', 'so I don\'t lose my data'],
    steps: 'Settings → Backup & Restore. Turn on backup with your email + a passphrase; on a new phone, use the same email + passphrase to restore. Your data otherwise lives only on this device.',
  },
  {
    id: 'change-caddie',
    asks: ['change my caddie', 'change your voice', 'pick a different caddie', 'switch caddie', 'build a custom caddie'],
    steps: 'Settings → Caddie Team — pick Kevin, Serena, Harry, or Tank, or build a Custom caddie. Same brain, different delivery. On-course you can also just say "switch to Tank".',
  },
  {
    id: 'set-bag',
    asks: ['set my club distances', 'edit my bag', 'my yardages are wrong', 'add my clubs'],
    steps: 'Dashboard → My Bag lets you add clubs and edit distances. Distances also build automatically as you track shots on the course.',
  },
  {
    id: 'start-round',
    asks: ['start a round', 'play a round', 'how do I play'],
    steps: 'Play tab → search your course → Start Round. Yardages and the caddie come online automatically once GPS locks.',
  },
  {
    id: 'record-swing',
    asks: ['record my swing', 'analyze my swing', 'use SmartMotion', 'film my swing'],
    steps: 'SwingLab → Smart Motion. Prop the phone up, line up the ball box, hit record, and swing — it detects the strike and reads your motion back, tempo, and clubhead path.',
  },
  {
    id: 'get-drill',
    asks: ['get a drill', 'what drill should I do', 'work on my swing', 'fix my slice'],
    steps: 'SwingLab → Drills for targeted fixes, or just ask me ("what should I work on?") and I\'ll point you to the right drill and open it in Smart Motion.',
  },
  {
    id: 'connect-earbuds',
    asks: ['connect my earbuds', 'use my AirPods', 'hands free', 'tap to talk'],
    steps: 'Pair your earbuds in your phone\'s Bluetooth, then in Settings turn on "Earbud tap-to-talk" — a tap wakes me hands-free, and you\'ll feel a buzz when I\'m listening.',
  },
  {
    id: 'connect-glasses-watch',
    asks: ['connect my glasses', 'use my Ray-Bans', 'connect my watch'],
    steps: 'Ray-Ban Meta glasses: Settings → Connect Ray-Ban Glasses (Android). A temple tap wakes me. Galaxy Watch swing capture is in Settings as well.',
  },
  {
    id: 'track-shots',
    asks: ['track my shots', 'mark my shot', 'log a shot'],
    steps: 'During a round, mark where your shot came to rest and I log the club and distance — that quietly builds your real bag yardages over time.',
  },
  {
    id: 'change-settings',
    asks: ['change a setting', 'settings', 'turn something off', 'change something'],
    steps: 'Everything is under Settings (gear icon) — caddie voice, permissions, backup, imports, devices, and privacy. Tell me what you want to change and I\'ll point you to it.',
  },
  {
    id: 'see-scorecard',
    asks: ['see my scorecard', 'keep score', 'add players'],
    steps: 'The Scorecard tab keeps score hole by hole during a round; add the people you\'re playing with and their handicaps there too.',
  },
];

/**
 * Compact how-to block for the brain prompt. One line per task so the caddie can answer "how do I
 * …" accurately with the real steps (and offer to open the relevant screen).
 */
export function howToForPrompt(): string {
  const lines = HOW_TO.map(h => `- ${h.steps}`).join('\n');
  return `HOW-TO (answer "how do I …" questions with these REAL steps, and offer to open the screen):\n${lines}`;
}
