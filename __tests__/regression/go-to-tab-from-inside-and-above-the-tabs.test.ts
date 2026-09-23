/**
 * 2026-09-23 (triple-check) — goToTab had one strategy (dismissTo) for two situations.
 *
 * From ABOVE the tabs (briefing, recap, greeting) dismissTo is right: it pops back to the tab bar
 * already in the stack instead of mounting a second one. From INSIDE the tabs it is a no-op: expo-router
 * aims the POP_TO at the tab navigator, no tab router handles POP_TO, and nothing happens — so voice
 * "open course X" on the Caddie tab stopped switching to Play. Inside the tabs the call has to be the
 * replace that always worked there (the tab router override turns it into a tab jump).
 */
type MockNav = { index?: number; routes: { name: string; state?: MockNav }[] };
let mockRootState: MockNav | undefined;
/** The shape expo-router 6 ACTUALLY produces: the container root holds one '__root' slot whose
 *  nested state is the app's root stack. The first version of this test mocked the stack flat —
 *  a shape the app never has — and passed while the fix never ran. */
const real = (stack: MockNav): MockNav => ({ index: 0, routes: [{ name: '__root', state: stack }] });
import { goToTab, _setRouterStateReaderForTests } from '../../services/safeBack';
// Injected, not jest.mock'ed: mocking the real router-store path was intermittently resolved to the
// real module under parallel workers, which silently took the dismissTo branch.
_setRouterStateReaderForTests(() => mockRootState);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __calls: { method: string; args: unknown[] }[]; __reset: () => void };

describe('goToTab picks the action that works where the player is', () => {
  beforeEach(() => routerMock.__reset());

  it('inside the tab bar it jumps tabs (replace), not a POP_TO the tab router ignores', () => {
    mockRootState = real({ index: 0, routes: [{ name: '(tabs)' }] });
    goToTab('play');
    expect(routerMock.__calls).toEqual([{ method: 'replace', args: ['/(tabs)/play'] }]);
  });

  it('above the tab bar it pops back to it instead of stacking a second one', () => {
    mockRootState = real({ index: 1, routes: [{ name: '(tabs)' }, { name: 'round/briefing' }] });
    goToTab('caddie');
    expect(routerMock.__calls).toEqual([{ method: 'dismissTo', args: ['/(tabs)/caddie'] }]);
  });

  it('before the tab bar exists (first run) it still lands on it', () => {
    mockRootState = real({ index: 0, routes: [{ name: 'greeting' }] });
    goToTab('caddie');
    expect(routerMock.__calls).toEqual([{ method: 'dismissTo', args: ['/(tabs)/caddie'] }]);
  });

  /**
   * The mocks above stand in for expo-router's internals. These two pin the REAL library to the shape
   * the mocks assume — so an expo-router upgrade that moves the store module or renames the slot fails
   * here instead of silently turning every in-tab jump back into the no-op it was.
   */
  it('the real expo-router still has the router-store module and the __root slot this relies on', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const base = path.join(__dirname, '../../node_modules/expo-router/build');
    expect(fs.existsSync(path.join(base, 'global-state/router-store.js'))).toBe(true);
    const constants = fs.readFileSync(path.join(base, 'constants.js'), 'utf8');
    expect(constants).toMatch(/INTERNAL_SLOT_NAME = '__root'/);
    expect(fs.readFileSync(path.join(base, 'ExpoRoot.js'), 'utf8')).toMatch(/name=\{constants_1\.INTERNAL_SLOT_NAME\}/);
  });
});
