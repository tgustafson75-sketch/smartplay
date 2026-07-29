/**
 * 2026-07-29 (Tim — "the caddie should answer about any features in the app OR any updates, so it's
 * baked in and I send fewer emails to users"). The catalog (appCatalog) tells the caddie what the app
 * HAS; how-to (howTo) tells it HOW; this tells it WHAT'S NEW. Injected into the brain prompt alongside
 * both so the caddie can answer "what's new / any updates / what did you just add / what changed" with
 * the REAL, current changelog — in its own voice — instead of the user emailing to find out.
 *
 * ADDITIVE + SAFE: prompt-only knowledge; changes nothing in the voice/tool pipeline. Keep each entry
 * to ONE short, USER-FACING line (no internal jargon, no file names). Newest first. When something
 * ships, add a line here — that's the single place the "what's new" answer reads from.
 */

export interface WhatsNewEntry {
  /** Human month/year for the spoken answer ("added this week", "in July"). */
  when: string;
  /** One user-facing sentence — what it does FOR the player. */
  note: string;
}

export const WHATS_NEW: WhatsNewEntry[] = [
  { when: 'Jul 2026', note: 'Ask me anything about the app — I now know every tool and how to use it, and I\'ll tell you what\'s new, so you don\'t have to go hunting or read a manual.' },
  { when: 'Jul 2026', note: 'If your course isn\'t in the list, just say "add a course" (or snap your scorecard) and I\'ll pull it in — new courses are getting added all the time.' },
  { when: 'Jul 2026', note: 'Two-angle swing analysis: combine a down-the-line and a face-on capture of the same swing for a fuller read.' },
  { when: 'Jul 2026', note: 'Shot map: on the hole view, your shots from past rounds now show as colored dots + lines, building a per-hole map of how you actually play it over time.' },
  { when: 'Jul 2026', note: 'Your caddie remembers your shots — ask "how did I play this hole last time" and it replays the sequence (club, distance, result), not just the score.' },
  { when: 'Jul 2026', note: 'A lot of new courses with real hole flyovers — including Coyote Creek (Tournament & Valley), Pruneridge, Wente Vineyards, Yocha Dehe, Crane Creek Reserve, and Manatee Cove; plus tighter, corrected hole framing on the existing library.' },
  { when: 'Jul 2026', note: 'The first voice response after opening the app is faster and more reliable — no more "having trouble connecting" on that first ask.' },
  { when: 'Jul 2026', note: 'Import your Arccos "Smart Club Distances" — snap the screen and it seeds your bag carries (tag the club by hand, since Arccos Air guesses club from distance).' },
  { when: 'Jul 2026', note: 'Each caddie personality (Kevin, Serena, Tank) now sounds truly like themselves on every reply, not just the opener.' },
  { when: 'Jul 2026', note: 'Cleaner branded hole view — course, hole, and distance shown neatly in the corner over a crisp satellite flyover.' },
  { when: 'Jul 2026', note: 'Ask the caddie by voice to switch the hole view between satellite and the static photo, and open practice tools (Focus Session, Shot Shapes, Setup Check, Fit Profile, Import Range) by name.' },
];

/**
 * Compact "what's new" block for the brain prompt. Newest first; the caddie speaks these in its own
 * voice when asked about updates/changes — and can offer to open the relevant screen.
 */
export function whatsNewForPrompt(): string {
  const lines = WHATS_NEW.map(e => `- (${e.when}) ${e.note}`).join('\n');
  return `WHAT'S NEW (answer "what's new / any updates / what did you add / what changed" with these REAL, recent updates — speak them naturally in your own voice, newest first; offer to open the relevant screen):\n${lines}`;
}
