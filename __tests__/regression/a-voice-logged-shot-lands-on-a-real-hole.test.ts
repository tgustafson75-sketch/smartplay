/**
 * 2026-10-27 (Brain review B11) — A VOICE-LOGGED SHOT LANDS ON A HOLE THAT EXISTS.
 *
 * The brain's log_shot has a free-number `hole` ("Hole number IF they named one"). The earbud's
 * dispatcher bounded it to 1..MAX_ROUND_HOLES on 09-11; the Caddie tab's twin (also fed by the
 * SmartMotion mic) accepted any hole > 0, and roundStore.logShot stores what it is given — so
 * log_shot {hole: 22} filed a shot on hole 22, where no shot map or per-club stat can show or fix it.
 *
 * Both twins now resolve the hole through store/roundStore.shotHoleFor. The earbud twin was already
 * bounded, so the dispatcher cases below guard the shared resolver; the tab case is the one that
 * failed before the fix. Driven through the real dispatcher and the real round store.
 */
import { useRoundStore, MAX_ROUND_HOLES } from '../../store/roundStore';
import { dispatchConversationalToolActions } from '../../services/voice/conversationalToolDispatch';

type Shot = { hole: number };
const shots = (): Shot[] => ((useRoundStore.getState() as unknown as { shots?: Shot[] }).shots ?? []);

describe('log_shot with a hole that cannot exist', () => {
  beforeEach(() => {
    useRoundStore.setState({ isRoundActive: true, currentHole: 7, shots: [] } as never);
  });

  it.each([22, 19, 0, -3, 27])('hole %d falls back to the hole the player is on', (hole) => {
    dispatchConversationalToolActions([{ type: 'log_shot', club: '7i', hole }]);
    expect(shots().map((s) => s.hole)).toEqual([7]);
  });

  it('a hole the player named, in range, is honoured', () => {
    dispatchConversationalToolActions([{ type: 'log_shot', club: '7i', hole: 3 }]);
    expect(shots().map((s) => s.hole)).toEqual([3]);
  });

  /**
   * The Caddie tab's switch is a component closure no unit test can drive. Its log_shot case must
   * resolve the hole through the same shotHoleFor, not its own expression that can drift again.
   */
  it("the Caddie tab's log_shot uses the same bounded resolver", () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
    const start = src.indexOf("case 'log_shot':");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("case '", start + 10));
    expect(body).toMatch(/const shotHole = shotHoleFor\(a\.hole, currentHole\)/);
  });

  it('the shared resolver bounds the hole for both', () => {
    // Loosely typed so this file still compiles (and fails on behaviour) against a tree without it.
    const { shotHoleFor } = jest.requireActual('../../store/roundStore') as { shotHoleFor?: (h: unknown, cur: number) => number };
    expect(typeof shotHoleFor).toBe('function');
    expect(shotHoleFor!(22, 7)).toBe(7);
    expect(shotHoleFor!(Number.NaN, 7)).toBe(7);
    expect(shotHoleFor!('4', 7)).toBe(7);
    expect(shotHoleFor!(3.4, 7)).toBe(3);
    expect(shotHoleFor!(MAX_ROUND_HOLES, 7)).toBe(MAX_ROUND_HOLES);
  });
});
