/**
 * 2026-07-29 (Tim). The app changelog. Originally injected into the brain prompt, but Tim (rightly)
 * pulled it out — a prompted announcement bloats every voice turn and risks the voice path. It now
 * surfaces VISUALLY in Tools → What's New (app/whats-new.tsx) with a version pill + "N new" badge
 * (store/whatsNewStore.ts). The caddie still HAS the app (appCatalog), knows HOW (howTo), and can
 * mention updates conversationally (howTo "what's new" entry) — the full list just isn't in the prompt.
 *
 * SINGLE SOURCE OF TRUTH: to announce a feature to every user, add ONE short, USER-FACING line below
 * (no internal jargon / file names). Newest first. The screen + the Tools-menu badge both read it.
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
  { when: 'Jul 2026', note: 'Each caddie personality (Kevin, Serena, Harry) now sounds truly like themselves on every reply, not just the opener.' },
  { when: 'Jul 2026', note: 'Cleaner branded hole view — course, hole, and distance shown neatly in the corner over a crisp satellite flyover.' },
  { when: 'Jul 2026', note: 'Ask the caddie by voice to switch the hole view between satellite and the static photo, and open practice tools (Focus Session, Shot Shapes, Setup Check, Fit Profile, Import Range) by name.' },
];

// 2026-07-29 (Tim) — the changelog is surfaced in the Tools → What's New SCREEN (app/whats-new.tsx),
// NOT injected into the brain prompt (a prompted announcement bloats every voice turn). WHATS_NEW above
// is the single source both the screen and the Tools-menu badge read from. (The caddie can still speak
// updates conversationally via the how-to entry "what's new" without the full list in every prompt.)
