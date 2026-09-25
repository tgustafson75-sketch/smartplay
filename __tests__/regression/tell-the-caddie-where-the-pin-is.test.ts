/**
 * 2026-09-25 (Tim, on his way to play) — "make sure I can tell Caddie the pin location while playing a
 * hole, like this is back right, and he can incorporate that into the analysis and logic."
 *
 * End to end, through the real store, dispatcher, resolver and payload builder: the brain's
 * set_pin_position tool sets THIS hole's pin; every yardage on the hole plays to it; the caddie is told
 * it (and that it is this hole's, not the day's); the next hole is unaffected; a new round starts clean.
 */
import { useRoundStore, PIN_CENTER } from '../../store/roundStore';
import { resolveYardage } from '../../services/yardageResolver';
import { dispatchConversationalToolActions } from '../../services/voice/conversationalToolDispatch';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { UI_TOOLS, BRAIN_TOOLS } from '../../api/_brainTools';
import * as smartFinder from '../../services/smartFinderService';

const holes = [1, 2].map((hole) => ({ hole, par: 4, distance: 150, front: 135, back: 165, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0 }));

describe('telling the caddie where the pin is', () => {
  beforeEach(() => {
    jest.spyOn(smartFinder, 'getLastFix').mockReturnValue({ lat: 33.8, lng: -117.9, accuracy_m: 5, timestamp: Date.now() } as never);
    jest.spyOn(smartFinder, 'classifyAccuracy').mockReturnValue({ level: 'strong' } as never);
    jest.spyOn(smartFinder, 'getGreenYardagesSync').mockReturnValue({ front: 135, middle: 150, back: 165, reason: 'ok' } as never);
    useRoundStore.setState({
      isRoundActive: true, currentHole: 1, activeCourseId: 'c1', userStatedYardage: null, markedFix: null,
      courseHoles: holes, pinPosition: PIN_CENTER, pinDeclared: false, pinByHole: {},
    } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('the brain can call it — declared on the one tool owner and in the UI allow-list', () => {
    expect(BRAIN_TOOLS.some((t: { name: string }) => t.name === 'set_pin_position')).toBe(true);
    expect(UI_TOOLS.has('set_pin_position')).toBe(true);
  });

  it('"pin\'s back right" on hole 1: hole 1 plays to the back pin, hole 2 still to the middle', () => {
    expect(resolveYardage(1).value).toBe(150);
    dispatchConversationalToolActions([{ type: 'set_pin_position', depth: 'back', side: 'right' } as never]);
    expect(useRoundStore.getState().pinByHole[1]).toEqual({ depth: 'back', side: 'right' });
    expect(resolveYardage(1).value).toBe(160);   // 165 back edge − 5 inset
    expect(resolveYardage(2).value).toBe(150);
  });

  it('the caddie hears it every turn on that hole, as THIS hole\'s pin, with the aim note for the side', () => {
    dispatchConversationalToolActions([{ type: 'set_pin_position', depth: 'back', side: 'right' } as never]);
    const body = buildCaddieRequestBody({} as never) as { pinPosition: { depth: string; side: string; scope: string; aim: string | null } | null };
    expect(body.pinPosition).toMatchObject({ depth: 'back', side: 'right', scope: 'hole' });
    expect(body.pinPosition?.aim).toBeTruthy();
    useRoundStore.setState({ currentHole: 2 } as never);
    expect((buildCaddieRequestBody({} as never) as { pinPosition: unknown }).pinPosition).toBeNull();
  });

  it('a hole\'s pin beats the round\'s pin; clearing it falls back to the round\'s', () => {
    useRoundStore.getState().setPinPosition({ depth: 'front', side: 'center' });
    expect(resolveYardage(1).value).toBe(140);
    dispatchConversationalToolActions([{ type: 'set_pin_position', depth: 'back', side: 'left' } as never]);
    expect(resolveYardage(1).value).toBe(160);
    dispatchConversationalToolActions([{ type: 'set_pin_position', clear: true } as never]);
    expect(resolveYardage(1).value).toBe(140);
  });

  it('a named hole is honoured; no round means nothing is recorded', () => {
    dispatchConversationalToolActions([{ type: 'set_pin_position', depth: 'front', side: 'left', hole: 2 } as never]);
    expect(useRoundStore.getState().pinByHole[2]).toEqual({ depth: 'front', side: 'left' });
    useRoundStore.setState({ isRoundActive: false, pinByHole: {} } as never);
    dispatchConversationalToolActions([{ type: 'set_pin_position', depth: 'back', side: 'right' } as never]);
    expect(useRoundStore.getState().pinByHole).toEqual({});
  });

  it('the Play tab pin card is the manual backup: in a round it shows and sets THIS hole\'s pin', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const play = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/play.tsx'), 'utf8');
    expect(play).toMatch(/pinForHole\(\{ pinByHole, pinDeclared, pinPosition: setupPin \}, pinHole\)/);
    expect(play).toMatch(/else setHolePin\(pinHole, \{ depth, side \}\);/);
    expect(play).toMatch(/onPress=\{\(\) => tapPin\(depth, side\)\}/);
    expect(play).toMatch(/const active = !!shownPin && shownPin\.depth === depth/);
  });

  it('hands-free speech routes a pin location to the caddie, never to "mark the green"', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const vi = fs.readFileSync(path.join(__dirname, '../../api/voice-intent.ts'), 'utf8');
    expect(vi).toMatch(/NOT a mark: a pin LOCATION on the green — "pin's back right"[^\n]*is conversational/);
  });

  // ── triple-check (2026-09-25) ───────────────────────────────────────────────────────────────
  it('a side-only or odd-cased call keeps the depth in force — never snaps a back pin to middle', () => {
    useRoundStore.getState().setPinPosition({ depth: 'back', side: 'center' });
    dispatchConversationalToolActions([{ type: 'set_pin_position', side: 'right' } as never]);
    expect(useRoundStore.getState().pinByHole[1]).toEqual({ depth: 'back', side: 'right' });
    expect(resolveYardage(1).value).toBe(160);
    dispatchConversationalToolActions([{ type: 'set_pin_position', depth: 'Front', side: 'Centre' } as never]);
    expect(useRoundStore.getState().pinByHole[1]).toEqual({ depth: 'front', side: 'center' });
  });

  it('every natural way to say it reaches the caddie — none is answered as a yardage or a score', () => {
    const { precheckLocalIntent } = jest.requireActual('../../services/localIntentPrecheck');
    for (const q of ['the pin is at the back of the green', "pin's in the front of the green", 'pin is on the back left of the green', "pin's back right", "they've got the flag tucked back left"]) {
      expect({ q, r: precheckLocalIntent(q) }).toEqual({ q, r: null });
    }
    // ...while the yardage questions still answer instantly.
    expect(precheckLocalIntent('how far to the back of the green')?.parameters?.query_topic).toBe('green_back');
    expect(precheckLocalIntent('yards to the front')?.parameters?.query_topic).toBe('green_front');
  });

  it('a round that ends takes its hole pins with it', () => {
    dispatchConversationalToolActions([{ type: 'set_pin_position', depth: 'back', side: 'right' } as never]);
    useRoundStore.getState().discardRound();
    expect(useRoundStore.getState().pinByHole).toEqual({});
  });
});
