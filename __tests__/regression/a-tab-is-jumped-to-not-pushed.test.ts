/**
 * 2026-10-27 (Brain review B7) — A TAB IS JUMPED TO, NEVER PUSHED, ON EVERY VOICE ROUTE.
 *
 * On SmartFinder mid-round, "open the scorecard" on the earbud became navigate '/(tabs)/scorecard'
 * (openToolHandler), and the brain's navigate tool emits the catalog's '/(tabs)/…' routes. The shared
 * dispatcher did router.push(path), which from a screen above the tabs mounts a SECOND tab navigator —
 * the back-loop services/safeBack.goToTab exists to prevent. Driven through the real dispatcher with
 * the router sitting on a pushed screen; the call must be dismissTo, never push.
 */
import { _setRouterStateReaderForTests } from '../../services/safeBack';
import { dispatchConversationalToolActions } from '../../services/voice/conversationalToolDispatch';

type MockNav = { index?: number; routes: { name: string; state?: MockNav }[] };
const real = (stack: MockNav): MockNav => ({ index: 0, routes: [{ name: '__root', state: stack }] });
const ABOVE_TABS = real({ index: 1, routes: [{ name: '(tabs)' }, { name: 'smartfinder' }] });

_setRouterStateReaderForTests(() => ABOVE_TABS);
const routerMock = require('expo-router') as { __calls: { method: string; args: unknown[] }[]; __reset: () => void };

describe('a voice navigate to a tab, from a screen above the tabs', () => {
  beforeEach(() => routerMock.__reset());

  it.each([
    ['/(tabs)/scorecard', 'scorecard'],
    ['/(tabs)/dashboard', 'dashboard'],
    ['/(tabs)/play', 'play'],
    ['/(tabs)/swinglab', 'swinglab'],
    ['/(tabs)/caddie', 'caddie'],
  ])('navigate %s pops back to the tab bar (dismissTo), never pushes a second one', (path, tab) => {
    dispatchConversationalToolActions([{ type: 'navigate', path }]);
    expect(routerMock.__calls.filter((c) => c.method === 'push')).toEqual([]);
    expect(routerMock.__calls).toEqual([{ method: 'dismissTo', args: [`/(tabs)/${tab}`] }]);
  });

  it('navigate_replace to a tab is the same jump, not a replace that drops the tab bar below', () => {
    dispatchConversationalToolActions([{ type: 'navigate_replace', path: '/(tabs)/dashboard' }]);
    expect(routerMock.__calls).toEqual([{ method: 'dismissTo', args: ['/(tabs)/dashboard'] }]);
  });

  it('a screen that is not a tab still pushes as before', () => {
    dispatchConversationalToolActions([{ type: 'navigate', path: '/round/briefing' }]);
    expect(routerMock.__calls).toEqual([{ method: 'push', args: ['/round/briefing'] }]);
  });

  /**
   * The Caddie tab's own tool switch is the second dispatcher: the SmartMotion screen's mic feeds it
   * from ABOVE the tabs (caddie.tsx subscribeSmartMotionUtterance → processTurn → handleToolAction).
   * It is a component closure no unit test can drive, so this pins that its navigate and
   * navigate_replace cases take the same jump before they push or replace.
   */
  it("the Caddie tab's switch jumps to a tab before it pushes or replaces", () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
    for (const [name, call] of [['navigate', 'router.push(action.path'], ['navigate_replace', 'router.replace(action.path']]) {
      const start = src.indexOf(`case '${name}':`);
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("case '", start + 6));
      const jump = body.indexOf('goToTabPath(action.path)');
      expect(jump).toBeGreaterThan(-1);
      expect(jump).toBeLessThan(body.indexOf(call));
    }
    // and open_swinglab, reached the same way, jumps rather than pushing '/(tabs)/swinglab'
    expect(src).not.toMatch(/router\.push\(\s*['"]\/\(tabs\)\/swinglab['"]/);
  });
});
