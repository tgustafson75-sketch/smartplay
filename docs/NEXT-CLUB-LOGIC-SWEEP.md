# NEXT SESSION — CLUB LOGIC, ONCE AND FOR ALL

Tim, 2026-08-24:

> "We need to focus totally and thoroughly on club logic. For the whole project, something I
> thought was going to be the simpler aspect of the app has turned out to be the most complicated
> missing part, and that's the clubs. And it's fucking crazy, and we need to fix that once and for
> all."

He is right, and today's session is the evidence. **Every one of the day's worst defects was a club
defect**, and each looked like a different bug until you line them up:

| What the player saw | What it actually was |
|---|---|
| "Six iron" for a 209-yard shot (39 yards short) | Club MATCH left to the model |
| "Smooth 7" in 46F rain into 16mph | Playing number never computed |
| "230" quoted on a hole playing 209 | Elevation never reached the caddie |
| "Beyond your longest club" on a 235-carry 3-wood over 210 | Margin never computed |
| Bad back, same club as a healthy player | Speed loss never in the number |
| "Got it, 7 iron" in two different code paths | Two copies of the club ack, branches inverted |
| Club tendencies stopped mattering | A computed club flattened them |

## Why it keeps happening: nobody owns "a club"

**33 files touch club identity.** There are two separate normalisers already
(`services/clubNormalize.ts` -> `normalizeClub`, `services/clubRecognition.ts` -> `clubLabel`) plus
`clubIdToServerKey`, and six club-named services:

    clubBagReconcile - clubConfidence - clubNormalize - clubRecognition - clubTendency - shotClubResolver

A club is simultaneously: a NAME the player says ("my seven", "7i", "seven iron"), an ID the camera
returns (`res.club_id`), a KEY the server wants (`clubIdToServerKey`), a CARRY number, a row in the
bag, and a thing with a learned shape. Nothing owns the conversion between those, so each surface
does its own and they disagree at the edges.

## The sweep, in order

1. **Inventory every representation** of a club across the 33 files — name, id, server key, label,
   carry, tendency — and write down which module converts which to which. Expect duplicates.
2. **One owner for club IDENTITY.** A single module that turns anything a player, camera, watch or
   payload says into one canonical club, with the label and server key derived from it. Everything
   else imports it. Guard the shape, not a file list.
3. **One owner for club SELECTION.** Started today in `api/kevin.ts` (first club at or above the
   playing number) but it lives inside the brain. It should be a pure function that the brain,
   SmartFinder, the offline caddie and the shot-strategy path all call, so they cannot disagree
   about which club covers 176 yards.
4. **Carry vs total, everywhere.** `bagDistances()` returns honest CARRY. Verify every consumer
   treats it as carry — the go/no-go gate, the lay-up rule, "can I reach". One wrong assumption
   here is a ball in the water.
5. **The gaps in the bag.** What happens at 205 when the player carries 195 and 215? Today the
   answer is "the first club at or above", which gives the 215 every time. A real caddie sometimes
   says "hard 4 iron". Decide the rule deliberately rather than letting it fall out of a `find()`.
6. **Left-handed and gender-specific bags**, now that both reach the brain.
7. **Re-probe** with `--only=clubDistances`, `--only=weather`, `--only=riskMode`, plus the 209 and
   176 cases in the handoff. Cheap, targeted, `--repeat=3`.

## The rule that fixed all of today's club bugs

**Arithmetic belongs in code, not the model.** Club match, playing number, physical-limitation speed
loss and go/no-go margin each survived two or more prompt rewrites and fell instantly once computed
and handed over as a fact. Do not write another instruction about club selection — compute it.

**And the trap on the other side:** a computed fact stated forcefully FLATTENS everything around it.
"THE CLUB IS THE 7 IRON, do not substitute" took club_tendencies from 3/3 to 0/3. Any computed line
must say what it does NOT settle.
