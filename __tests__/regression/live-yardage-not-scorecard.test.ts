import * as fs from 'fs';
import * as path from 'path';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useRoundStore } from '../../store/roundStore';

const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');

/**
 * 2026-08-22 — from Tim's screenshot at Greenhill, hole 9. Three different yardages on one screen:
 *
 *     map 422y   ·   PLAYS 472 (+50)   ·   caddie: "a par 5 at 450 yards, start with your driver"
 *
 * 450 was the SCORECARD length, and STROKE was 2 — he was in the fairway getting a tee briefing.
 * Two causes: the prompt labelled the live distance `Yards:` right beside `Hole:` and `Par:`, which
 * reads as the hole's length; and the stroke number was never sent at all, so the brain could not
 * know he had already hit.
 */
describe('the caddie quotes the shot in front of you, not the card', () => {
  it('sends which stroke the player is about to hit', () => {
    useRoundStore.setState({ currentHole: 9, shots: [] } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).currentStroke).toBe(1);

    useRoundStore.setState({
      currentHole: 9,
      shots: [{ hole: 9, penalty_strokes: 0 }],
    } as never);
    // One shot hit → he is playing his SECOND.
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).currentStroke).toBe(2);
  });

  it('counts penalties like the on-screen strip does', () => {
    useRoundStore.setState({
      currentHole: 9,
      shots: [{ hole: 9, penalty_strokes: 1 }],
    } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).currentStroke).toBe(3);
  });

  it('ignores shots from other holes', () => {
    useRoundStore.setState({
      currentHole: 9,
      shots: [{ hole: 8, penalty_strokes: 0 }, { hole: 8, penalty_strokes: 0 }],
    } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).currentStroke).toBe(1);
  });

  it('the prompt no longer labels the live distance in a way that reads as hole length', () => {
    const kevin = read('api/kevin.ts');
    expect(kevin).not.toMatch(/Par: \$\{currentPar\} \| Yards: \$\{currentYardage\}/);
    expect(kevin).toMatch(/DISTANCE REMAINING RIGHT NOW/);
    expect(kevin).toMatch(/never quote a scorecard yardage as the distance they are hitting/);
  });

  it('the prompt tells the brain he has already teed off', () => {
    const kevin = read('api/kevin.ts');
    expect(kevin).toMatch(/PLAYING THEIR STROKE/);
    expect(kevin).toMatch(/ALREADY TEED OFF/);
    expect(kevin).toMatch(/Do NOT brief the tee shot or suggest a driver off the tee/);
  });

  it('the server actually destructures the field the client sends', () => {
    // The classic half-fix: send it and never read it.
    expect(read('api/kevin.ts')).toMatch(/currentStroke = null,/);
    expect(read('services/caddieRequestBody.ts')).toMatch(/currentStroke:/);
  });
});
