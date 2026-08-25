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
  {
    when: 'Aug 2026',
    note: 'A drill now answers the thing it said it would watch. Pick a posture drill and you get your posture read back, a tempo drill and you get your tempo. Before, every drill gave the same general swing report no matter what its card promised.',
  },
  {
    when: 'Aug 2026',
    note: 'Shot Shapes tells you when it cannot compare. It needs the ball marked before you swing to read what actually launched \u2014 it used to just show nothing, which looked broken. Now it says what it needs.',
    howTo: 'Tap the ball in the camera before recording, then pick your shape. The review compares what you went for with what launched.',
  },
  {
    when: 'Aug 2026',
    note: 'Move the SmartFinder reticle and the yardage moves with it. On a mapped hole it works out what you\'re pointing at \u2014 the green, the front edge, a bunker, the water \u2014 and gives you the real GPS distance to it. Point somewhere it doesn\'t know and it says nothing rather than guessing.',
    howTo: 'Drag the reticle onto whatever you want the number for. The distance updates as you move.',
  },
  {
    when: 'Aug 2026',
    note: 'SmartFinder learns how YOU hold the phone. The close-range read worked off an assumed height for everybody, and that assumption is a straight multiplier on the number \u2014 hold it a bit lower than average and every reading came back long. Now, whenever you aim near the green and I already know that distance from GPS, I work out your real phone height and use it from then on. Nothing to set up.',
  },
  {
    when: 'Aug 2026',
    note: 'The swing title and the angle tag agree now. A swing could show "down-the-line" in its title and "Face-on" on the tag right underneath \u2014 the title was written once when you filmed and never updated when the angle was corrected. The angle lives in one place now, and swings already saved get fixed on screen.',
  },
  {
    when: 'Aug 2026',
    note: 'If you tell me a number, I club to YOUR number. Shoot it with a rangefinder or just say it, and that is the distance I work from \u2014 I was quoting your number back to you while quietly picking the club for the scorecard yardage, which on a hole playing longer than the card meant a club too little. Say the number and it is the number.',
  },
  {
    when: 'Aug 2026',
    note: 'I call your clubs by their right names. If you carry a 7 wood I was saying "5 wood", and a 3 iron came out as "4 iron" \u2014 and worse, the distance you\'d logged for that club was being filed against the neighbouring one, so your 5 wood quietly inherited your 7 wood\'s number. Fixed everywhere, including offline.',
  },
  {
    when: 'Aug 2026',
    note: 'The clubs you haven\'t tracked yet get YOUR numbers, not a stock chart. Once you\'ve logged a couple of clubs I know roughly how far you hit it, so the rest of the bag is scaled to you instead of to an average golfer. If you hit it long, your untracked 5 iron stops being listed as a stranger\'s 5 iron. Clubs you HAVE logged always win \u2014 this only fills the gaps.',
  },
  {
    when: 'Aug 2026',
    note: 'When you Mark Green, it now counts for your shot distances too. It was already changing the yardage I read you, but the distance recorded against your last shot on that hole still used the map\'s guess \u2014 so the number you heard and the number in your history could disagree. One answer now. Bad course coordinates can also no longer sneak in and wreck a hole\'s distances.',
  },
  // 2026-08-24 — the orphan sweep: things that were built months ago and never connected.
  {
    when: 'Aug 2026',
    note: 'Ask me how your last round went. I know your recent scores, every course you\'ve played and what you\'ve been grinding on in practice — so "how did I do last time out?" gets an answer instead of me offering to go and look it up. I could only ever talk about the course you were standing on before.',
  },
  {
    when: 'Aug 2026',
    note: 'Your weekly practice plan steers my coaching now. If you\'ve written down what you\'re working on and what\'s giving you trouble, I weigh it when I suggest a drill or explain a miss, instead of coaching you as though I\'d never read it.',
  },
  {
    when: 'Aug 2026',
    note: 'I know what you\'ve shot here before. Ask "is that a good score for me at this course?" and I answer from your actual rounds instead of offering to go and look something up.',
  },
  {
    when: 'Aug 2026',
    note: 'I stopped repeating myself in the swing lab. The framing cue, the time-up call, the club confirmation — they used to be the same sentence every single time. They vary now, like a person would.',
  },
  // 2026-08-24 — the SmartMotion honesty pass.
  {
    when: 'Aug 2026',
    note: 'I can tell you HOW you struck it now, not just that you did. The mic grades every strike — flush, thin, fat, off the heel or toe — so the Contact card says something real instead of "not cross-checked". A pure one sounds different and I can hear it.',
  },
  {
    when: 'Aug 2026',
    note: 'The swing count stopped lying to you. If I could only analyse one swing out of five, I say "heard 5 · analysed 1" rather than "1 swing detected" — because the microphone did hear them, and you should know the difference between me missing a swing and me not being able to read it.',
  },
  {
    when: 'Aug 2026',
    note: 'Your body numbers arrive with everything else. Sway, tilt, posture and weight used to sit blank until you tapped the video — they were waiting on the player to load. They don\'t wait any more.',
  },
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
