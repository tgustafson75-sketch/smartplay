/**
 * 2026-10-28 (Brain review r9) — ANOTHER GOLFER'S YARDAGE, OR A HYPOTHETICAL, IS NOT HIS BAG.
 *
 * set_club_distance was an acting intent with no subject guard, and its `my <club> goes N` capture let
 * a possessive sit inside the club phrase. "My buddy's driver goes 300" came back set_club_distance
 * {club_phrase: "buddy's driver", 300} at confidence 'high'; parseSpokenClub found 'driver', and
 * registerBagFromSpeech wrote 300 over Tim's own driver number — every club pick after it read the
 * wrong yardage, and the caddie never heard the sentence. A conditional ("if my driver carries 250"),
 * a hedge ("maybe") and reported speech ("Mike says") did the same.
 *
 * BEHAVIOURAL: the real precheck, which runs before /api/kevin on the tab mic, the typed box, the
 * earbud and the watch. 'conversational' is the route every router sends to the brain.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const kind = (u: string) => precheckLocalIntent(u)?.intent_type ?? null;

describe('a yardage that is not his own stated number goes to the caddie', () => {
  it.each([
    "My buddy's driver goes 300",
    "My son's 7 iron carries 140",
    'If my driver carries 250 I can clear that bunker',
    'Mike says my 7 iron goes 170',
    'Maybe my 7 iron goes 160 now',
    'My dad’s 3 wood goes 210',
  ])('"%s"', (u) => {
    expect(kind(u)).toBe('conversational');
  });

  it('a correction said about someone else is not his last shot', () => {
    expect(kind('my partner, actually that was a 7 iron')).toBe('conversational');
  });
});

describe('his own bag numbers still register offline', () => {
  it.each([
    'my 7 iron goes 165',
    'my driver carries about 250',
    'Kevin, my 3 wood goes 230 and carries 215',
    'I think my pitching wedge goes 120',
  ])('"%s"', (u) => {
    expect(kind(u)).toBe('set_club_distance');
  });
});
