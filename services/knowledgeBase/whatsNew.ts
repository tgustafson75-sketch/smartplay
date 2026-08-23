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
  /**
   * 2026-08-21 (Tim) — "if there's something they need to know HOW TO USE, if it's been simplified,
   * the highlighted tutorial shows them the new method."
   *
   * Set this ONLY when the way you do something has changed. A better answer needs no instruction;
   * a moved control, a removed setting, or a new gesture does — and a player who cannot find the new
   * method experiences an improvement as a regression.
   */
  howTo?: string;
}

export const WHATS_NEW: WhatsNewEntry[] = [
  // 2026-08-23 — the playing-number pass. Written for the PLAYER, not the changelog.
  {
    when: 'Aug 2026',
    note: 'Downhill and uphill finally count. If you\'ve got 230 to a green that sits well below you, that is not a 230-yard shot and I will stop calling it one — I work out what it actually plays and give you the club for that. Same going up. The app has known the elevation for a while; I just wasn\'t using it, which is exactly how you end up long through the back.',
  },
  {
    when: 'Aug 2026',
    note: 'I know which way the wind is blowing across YOUR shot now, not just what the forecast says. Into your face, at your back or across it — measured against the line of the hole you\'re actually playing. And if the hole isn\'t mapped, I\'ll tell you I don\'t know rather than guessing "it\'s into you" and costing you a club.',
  },
  {
    when: 'Aug 2026',
    note: 'Rain shortens the shot and I account for it. A wet ball carries less and wet ground gives you nothing back, so I\'ll club you up and tell you not to expect the run.',
  },
  // 2026-08-23 — the club-call pass.
  {
    when: 'Aug 2026',
    note: 'The weather actually changes the club I give you now. Into the wind, cold air, wet turf — the ball flies shorter, so I work out what the shot really plays and give you the club for THAT number, not the one on the screen. 150 into a stiff breeze on a cold wet day isn\'t a smooth 7; I\'ll hand you the 4 and tell you why in three words.',
  },
  {
    when: 'Aug 2026',
    note: 'When you ask me go or lay up, I do the sums before I answer. What you need to carry, what your longest club that reaches actually carries, and the gap between them — that gap is the whole answer. If you clear it comfortably I\'ll tell you to take it on instead of talking you out of a shot you had all along.',
  },
  {
    when: 'Aug 2026',
    note: 'Your routine is back where it belongs. Say "save that routine" after I\'ve talked you through a warm-up and I\'ll keep it, then ask for it any time and I\'ll run you through it in my own words rather than reading it back at you. It works off the course too — that\'s rather the point of a warm-up.',
    howTo: 'After I give you a warm-up, say "save that routine". To hear it again, ask for "my routine" — say "my", because "give me a good warm-up routine" means you want a NEW one and I\'ll go and think of one.',
  },
  {
    when: 'Aug 2026',
    note: 'If you\'ve told me you\'re new to the game, I\'ll stop talking like a coaching manual. No clubface, no swing path, no angle of attack — just where to aim and what to swing. Ask me why and I\'ll happily go deeper, but you shouldn\'t need a diagram to use your own caddie.',
  },
  {
    when: 'Aug 2026',
    note: 'Tap in through your earbuds and you get the right one of us. On the range that\'s your coach, between shots it\'s the head game, and out on the course it\'s me on the bag — instead of the same greeting whoever you actually needed.',
  },
  // 2026-08-23 — the one-caddie pass. Written for the PLAYER, not the changelog.
  {
    when: 'Aug 2026',
    note: 'I keep the thread now when you switch how you\'re talking to me. Ask me something on the caddie screen, then follow up through your earbuds, and I still know what we were on about — before, each way in had its own memory and the other half of the conversation was gone.',
  },
  {
    when: 'Aug 2026',
    note: 'I\'m the same caddie now no matter how you reach me. Typing, tapping the mic, your earbuds, your watch — they used to reach me with different amounts of what I know about you, which is why my tone and my answers kept shifting mid-round. One of me now, and I carry everything to every one of them.',
  },
  {
    when: 'Aug 2026',
    note: 'If you play left-handed, I finally know it. Every "aim left", every "your miss is right", every bunker I place for you was mirrored — I was telling lefties the exact opposite of the right thing. It reaches me now and I call every direction from your side of the ball.',
    howTo: 'Settings → your profile → Handedness. It was already there for swing analysis; now it reaches me too.',
  },
  {
    when: 'Aug 2026',
    note: 'I\'ll tell you when a number is soft. If GPS drops and I fall back to the scorecard yardage, I say so instead of handing you a card number as though I\'d just measured it. And when you\'ve told me your own number, I use yours.',
  },
  {
    when: 'Aug 2026',
    note: 'I think harder before I answer. The reasoning behind my club calls got a real upgrade — the hazard carries, your own tendencies with that club, how the round is actually going. Same two sentences; a lot more behind them.',
  },
  {
    when: 'Aug 2026',
    note: 'When GPS is still finding you or a swing won\'t read, that\'s me talking, not a stock message. Those moments were falling back to a canned line every single time — you were never actually hearing from me.',
  },
  // 2026-08-21/22 — written for the PLAYER, not the changelog. Each says what changed for them.
  {
    when: 'Aug 2026',
    note: 'You can bring your gym work in from the card it belongs to. Import your SmartPump export straight from TRAIN YOUR SWING on the dashboard — it was buried in Settings, which is not where you were looking.',
    howTo: 'Dashboard → TRAIN YOUR SWING → the download arrow next to the share icon. PDF, photo, CSV or JSON all work, and re-importing skips anything already in.',
  },
  {
    when: 'Aug 2026',
    note: 'Every yardage I quote now comes off the tees you actually play. If you\'re on the forward tees I was reading you the back card — on some holes that was 70 yards out, and I was picking your club off it.',
    howTo: 'Settings → your profile → Preferred Tee. It was already there; now it reaches the hole yardages, the course layout and me.',
  },
  {
    when: 'Aug 2026',
    note: 'Course search finds the course now when you add the town — "Sharp Park Pacifica" used to come back empty. Results show the city and state too, so two courses with the same name are finally telling apart.',
  },
  {
    when: 'Aug 2026',
    note: 'Your course handicap now uses the right rating. Courses are rated twice — men\'s and women\'s — and the two often sit on identical yardages, so the wrong one could slip in and quietly give you the wrong strokes.',
    howTo: 'Settings → your profile → Course Rating Set. Pick Men\'s or Women\'s once and every course you play uses it. Left unset, nothing is guessed.',
  },
  {
    when: 'Aug 2026',
    note: 'Tell me what you\'ve got and I\'ll remember it. "I\'m 150 out, downhill lie, hitting my 7" now sticks — the yardage, the lie, the club and the hole all land, and I factor them into the next thing I tell you instead of asking again.',
  },
  {
    when: 'Aug 2026',
    note: 'Having one of those days? Say "I\'m hitting everything left today" and I\'ll aim around it for the rest of the round instead of giving you a swing lesson on the tee. If you overcorrect later, I\'ll notice that too and settle you down rather than chasing it.',
    howTo: 'Just say it out loud, any time — "I\'m pulling everything", "everything\'s coming up short", "my back\'s tight". No menu, no setting.',
  },
  {
    when: 'Aug 2026',
    note: 'I now know where the trouble actually is. Instead of "158 yards", you\'ll hear what clears the bunker and what your own miss would do — measured from the hole\'s real layout, not guessed.',
  },
  {
    when: 'Aug 2026',
    note: 'The first thing you say after opening the app is much faster. It used to sit and think — sometimes long enough that you gave up and tried again. That wait is gone.',
  },
  {
    when: 'Aug 2026',
    note: 'Tap the mic, tap your earbud, or use the mic by the text box — all three now behave the same. The earbud used to be the slowest by a long way.',
  },
  {
    when: 'Aug 2026',
    note: 'SmartMotion no longer asks whether you filmed down-the-line or face-on — it works it out from the video itself, so there\'s one less thing to get wrong.',
    howTo: 'Nothing to set. Just film and hit Analyze. If you walk into frame after hitting record, it now finds you instead of coming back empty.',
  },
  {
    when: 'Aug 2026',
    note: 'SmartFinder: the drop-down is gone — the tools sit right on the camera. Move the reticle and the yardage moves with it.',
    howTo: 'Double-tap anywhere in the view to zoom in on the flag for a tighter look, or just ask: "zoom in on the pin". Double-tap again to come back out.',
  },
  { when: 'Aug 2026', note: 'Your swing read now names the faults you can see plainly — a bent lead arm, a chicken wing through impact, swaying off the ball, an incomplete finish, excess head movement — measured from your real motion, not guessed. If it can\'t measure something cleanly, it stays quiet instead of making it up.' },
  { when: 'Aug 2026', note: 'Ask me about a course and I can now look it up on the web — course details, local knowledge, rules, conditions — and give you real, current facts instead of guessing.' },
  { when: 'Aug 2026', note: 'Voice scoring is sharper: say your score walking off the green and it lands on the RIGHT hole every time, even when GPS has already moved you to the next tee. Putts follow the hole you just scored.' },
  { when: 'Aug 2026', note: 'Take the club I suggest and I learn from it — your real carry distances build up as you play, so my numbers get more yours over time.' },
  { when: 'Aug 2026', note: 'Faster swing reads, and every swing in a multi-swing session now shows its own skeleton, numbers, and the correct fault region — not just the first one.' },
  { when: 'Aug 2026', note: 'A 9-hole course can now be played twice around as a full 18 — scorecard, handicap posting, and GPS all handle the second loop, including greens you marked on the front nine.' },
  { when: 'Aug 2026', note: 'Tell me what\'s in your bag and your yardages any time — in onboarding or mid-round — and I\'ll register it correctly.' },
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
