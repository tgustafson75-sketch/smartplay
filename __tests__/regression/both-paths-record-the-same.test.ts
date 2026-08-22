/**
 * WHAT THE CLASSIFIER CAN RECORD, THE BRAIN MUST BE ABLE TO RECORD.
 *
 * 2026-08-21. Tim: "How the fuck do we get this far? As many times as I've asked, I can give that
 * and it doesn't record? What happened to a growing brain? Not being able to wire that in makes it
 * fake."
 *
 * HOW IT HAPPENED, because the mechanism matters more than the instance. The classifier path was
 * built first — f4e0b31e (2026-07-01) added set_hole_note specifically so a bare lie note would be
 * REMEMBERED and factored into advice. The brain-tool architecture arrived later, each tool was
 * added deliberately one at a time, and NOBODY EVER COMPARED THE TWO LISTS. Every audit asked "is
 * this tool wired correctly"; none asked "what can the other path do that this one cannot".
 *
 * So hands-free, "I'm 150 out with my 7-iron on twelve, downhill lie" records four things. Said in
 * CONVERSATION — how most people actually talk to it — the caddie answered warmly and remembered
 * nothing. A caddie that cannot retain what you just told it is not growing, whatever the learning
 * pipeline behind it does.
 *
 * This test is the comparison nobody was doing.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');
const brainTools = read('api/_brainTools.ts');
const dispatch = read('services/voice/conversationalToolDispatch.ts');
const contract = read('types/toolAction.ts');

/**
 * Intents that WRITE STATE the caddie later reasons from. Deliberately not every classifier intent —
 * the brain answers rules_query and club_query conversationally and needs no tool for them. These
 * are the ones where the player TELLS the caddie something and expects it to stick.
 */
const MUST_BE_RECORDABLE_BY_THE_BRAIN = [
  ['set_hole_note', 'the June narrative brain — "off to the right, downhill lie" must be remembered'],
  ['state_yardage', '"I\'m 150 out" — paced by the player, beats our GPS estimate'],
  ['club_change', '"I\'m hitting my 7" — or the shot is attributed to the wrong club'],
  ['declare_hole', '"we\'re on 12" — everything else hangs off the hole'],
  ['set_session_focus', 'what he wants to work on; existed on the classifier path since early on'],
  ['set_playing_condition', 'what the ball is doing TODAY — aim around it, do not diagnose it'],
] as const;

describe('anything the player can tell the caddie, the caddie can record', () => {
  it.each(MUST_BE_RECORDABLE_BY_THE_BRAIN.map(([t, why]) => [t, why] as const))(
    '%s is a brain tool (%s)', (tool) => {
      expect(brainTools).toMatch(new RegExp(`name: '${tool}'`));
    });

  it.each(MUST_BE_RECORDABLE_BY_THE_BRAIN.map(([t]) => [t] as const))(
    '%s is dispatched, not just declared', (tool) => {
      // Declared-but-undispatched is how recommend_club and register_bag were silently dropped.
      expect(dispatch).toMatch(new RegExp(`case '${tool}'`));
    });

  it.each(MUST_BE_RECORDABLE_BY_THE_BRAIN.map(([t]) => [t] as const))(
    '%s is TYPED — the untyped payload is the drop class', (tool) => {
      expect(contract).toMatch(new RegExp(`type: '${tool}'`));
    });

  it('a lie note with no hole lands on the CURRENT hole instead of asking which', () => {
    // Asking "which hole?" after a bare lie note is what made the narrative brain feel robotic —
    // the whole point of f4e0b31e was that it should just know.
    // Take the WHOLE case, up to the next one — slicing at the first `break;` stops at the
    // empty-note guard and would test nothing.
    const start = dispatch.indexOf("case 'set_hole_note'");
    const block = dispatch.slice(start, dispatch.indexOf("case 'state_yardage'", start));
    expect(block).toMatch(/r\.currentHole/);
  });
});
