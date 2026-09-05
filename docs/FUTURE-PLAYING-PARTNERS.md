# PARKED — Scoring the people you're actually playing with

Tim, 2026-09-05, after a round at Menifee: *"I don't see any longer where I can score other people
I am playing with... maybe I had tabs behind my scorecard that they had a separate tab, a little bit
simpler interface... I didn't equate that to being tournament mode."*

**First, the honest answer: it was never there.** Searched the history — no `playingPartners`, no
`partnerScores`, no deleted file of that shape. Nothing regressed. Tournament mode is the only
multi-player scoring the app has ever had, and Tim had reasonably assumed it was something else.

*"I'm a one man team, and I can't see everything all the time for six months."* Recording that
because it is the correct read of what happened, not an excuse for it.

---

## Why tournament mode does not cover this

`app/tournament.tsx` + `store/tournamentStore.ts` are real and good at what they do — six formats,
skins carry-over, match play, a shareable leaderboard. But for "I'm playing with Dave and Mike":

- **It demands a format and teams before a single score can be entered.** You have to decide you're
  playing best-ball before you can write down a 5.
- **It is standalone by design** (its own store, deliberately untouched by the caddie/GPS flow). So
  it does not know the course, the holes, or the pars you are already playing.
- **Nothing reaches the scorecard**, there is no per-hole analysis, and the only export is a text
  leaderboard through the Share sheet.

It is the right tool for the guys' weekend. It is the wrong tool for a Tuesday fourball.

---

## The shape that fits this app

Tim's framing, which is the design constraint: *"without breaking logic but with the lens that it's
a future user connection possibility / socials, and can't break the primary user's data, but also
can analyze the playing partners hole by hole or by match, and then each scorecard exportable. If
they are Caddie users, their app must be able to smartly use the data."*

**1. Partners are a sibling array in `roundStore`, never merged into the player's own fields.**
This is the whole safety argument and it should be structural, not disciplined. Handicap posting,
stats, tendencies, the player model and the brain's context all read the player's own scores; a
separate array is invisible to every one of them by construction rather than by remembering to
exclude it. Anything that reads `scores` must keep reading only `scores`.

**2. Entry lives on the existing scorecard as tabs** — you, then one tab per partner. Same stepper,
same hole flow, same par context. This is what Tim actually pictured.

**3. Per-hole analysis reuses the round's own computation**, pointed at a partner's column. READ
ONLY — it must never feed the player model, the handicap calculator, or the caddie's memory of how
*you* play.

**4. Export per player**, so each partner leaves with their own card rather than a leaderboard
screenshot.

**5. Each partner record carries an optional identity field — designed now, unused now.**
Something like `caddieIdentity: string | null` holding the same `sha256(email::passphrase)` shape
cloud backup already uses. It does nothing on day one. It is the seam that lets a partner who is
also a Caddie user claim their card later without a migration, and it costs one nullable field to
leave open. Do not build the sync; do build the field.

---

## Decisions taken

- **Scope: scores + export first.** Per-hole analysis is a small addition once the data exists, and
  splitting it keeps the first change small on a store that cannot afford a big one.
- **Timing: after the store reviews clear.** It touches `roundStore`, the most load-bearing store in
  the app, and both binaries were in review the night this was written. It is JS, so it ships by OTA
  whenever it is ready — waiting costs nothing.

## Risks to respect when it is built

- `roundStore` is where a mistake is most expensive. Additive only.
- Cloud backup: `growMostlyKeys` decides what syncs. Partner data is **other people's** scores —
  decide deliberately whether it leaves the device, and what the privacy policy already says about
  it, BEFORE adding the key.
- The brain must never read a partner's score as the player's. Whatever builds the caddie payload
  needs an explicit test for that, not an assumption.
- Handicap posting must ignore partners entirely. Same.

## Related

`docs/FUTURE-GHOST-MATCH.md` — playing against an opponent who isn't you. Different feature, same
underlying want: the app currently models exactly one golfer, and both of these are about it holding
more than one.
