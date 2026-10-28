/**
 * 2026-10-28 (Brain review r4) — A SHOT OR A MOOD FROM ANOTHER TIME OR ANOTHER PLAYER IS NOT HIS.
 *
 * r3 (1e63fa9a) pointed api/kevin's log_shot / log_emotional_state fallbacks at his words, but the
 * extractors still took any sentence with an i/my/me in it as "him, now":
 *
 *   "My buddy chunked his wedge into the bunker"           → wedge, chunked, bunker on his hole
 *   "Last year I hit my driver right into the water here" → driver right, logged on this hole
 *   "If I hit my 7 iron thin it goes over the green"       → a thin 7 iron
 *   "I usually hit my driver right, any tips"              → driver right
 *   "Tell me about when I hit my driver left on 3 earlier" → driver left, again
 *   "I am not nervous at all today" / "Am I too anxious over putts" → anxious
 *   "My buddy is so frustrated he wants to quit"           → frustrated
 *
 * and neither client dispatcher checked for a round before logShot, so an off-round story landed in
 * the per-club stats and the learned distances.
 *
 * BEHAVIOURAL: the real extractors api/kevin runs, and the real earbud dispatcher against the real
 * round store. The Caddie tab's twin is a component closure, so its guard is asserted in source.
 */
import { detectEmotionalState, extractShotReport } from '../../api/_brain';
import { useRoundStore } from '../../store/roundStore';
import { dispatchConversationalToolActions } from '../../services/voice/conversationalToolDispatch';

describe('the shot fallback records only his shot, now', () => {
  it.each([
    'My buddy chunked his wedge into the bunker',
    'Last year I hit my driver right into the water here',
    'If I hit my 7 iron thin it goes over the green',
    'I usually hit my driver right, any tips',
    'Tell me about when I hit my driver left on 3 earlier',
    'I always pull my 7 iron left',
    'Was I right to hit my driver left of the bunker',
  ])('"%s" logs nothing', (u) => {
    expect(extractShotReport(u)).toBeNull();
  });

  it.each([
    ['I hit my 7 iron and pulled it left of the green', '7 iron'],
    ['I striped my drive right down the middle', 'driver'],
    ['I chunked my wedge, came up 20 yards short', 'wedge'],
    ["I pulled my 7 iron left, didn't hold the green", '7 iron'],
    ['I hit my driver right and my buddy laughed', 'driver'],
  ])('"%s" is still his %s', (u, club) => {
    expect(extractShotReport(u)?.club).toBe(club);
  });
});

describe('the mood fallback records only how HE feels, now', () => {
  it.each([
    'I am not nervous at all today',
    'Am I too anxious over putts',
    'My buddy is so frustrated he wants to quit',
    "I'm not feeling great",
    'I was so nervous yesterday',
  ])('"%s" logs nothing', (u) => {
    expect(detectEmotionalState(u)).toBeNull();
  });

  it.each([
    ["I'm so nervous", 'anxious'],
    ['I am so damn frustrated, I have topped three in a row', 'frustrated'],
    ['Honestly I feel great today, everything is clicking', 'confident'],
    ["I'm frustrated, my buddy keeps talking", 'frustrated'],
  ])('"%s" is %s', (u, state) => {
    expect(detectEmotionalState(u)?.state).toBe(state);
  });
});

describe('no round, no shot', () => {
  type Shot = { hole: number };
  const shots = (): Shot[] => ((useRoundStore.getState() as unknown as { shots?: Shot[] }).shots ?? []);

  it('the earbud dispatcher drops a log_shot when no round is active', () => {
    useRoundStore.setState({ isRoundActive: false, currentHole: 1, shots: [] } as never);
    dispatchConversationalToolActions([{ type: 'log_shot', club: 'driver', direction: 'right' }]);
    expect(shots()).toEqual([]);
  });

  it('and still logs it in a round', () => {
    useRoundStore.setState({ isRoundActive: true, currentHole: 4, shots: [] } as never);
    dispatchConversationalToolActions([{ type: 'log_shot', club: 'driver', direction: 'right' }]);
    expect(shots().map((s) => s.hole)).toEqual([4]);
  });

  it("the Caddie tab's log_shot breaks before logShot when no round is active", () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
    const start = src.indexOf("case 'log_shot':");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("case '", start + 10));
    const guard = body.indexOf('if (!useRoundStore.getState().isRoundActive) break;');
    expect(guard).toBeGreaterThan(-1);
    expect(body.indexOf('logShot(shot)')).toBeGreaterThan(guard);
  });
});
