/**
 * 2026-09-23 (triple-check) — goToTab had one strategy (dismissTo) for two situations.
 *
 * From ABOVE the tabs (briefing, recap, greeting) dismissTo is right: it pops back to the tab bar
 * already in the stack instead of mounting a second one. From INSIDE the tabs it is a no-op: expo-router
 * aims the POP_TO at the tab navigator, no tab router handles POP_TO, and nothing happens — so voice
 * "open course X" on the Caddie tab stopped switching to Play. Inside the tabs the call has to be the
 * replace that always worked there (the tab router override turns it into a tab jump).
 */
let mockRootState: { index?: number; routes: { name: string }[] } | undefined;
jest.mock('expo-router/build/global-state/router-store', () => ({
  get store() { return { state: mockRootState }; },
}), { virtual: true });

import { goToTab } from '../../services/safeBack';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __calls: { method: string; args: unknown[] }[]; __reset: () => void };

describe('goToTab picks the action that works where the player is', () => {
  beforeEach(() => routerMock.__reset());

  it('inside the tab bar it jumps tabs (replace), not a POP_TO the tab router ignores', () => {
    mockRootState = { index: 0, routes: [{ name: '(tabs)' }] };
    goToTab('play');
    expect(routerMock.__calls).toEqual([{ method: 'replace', args: ['/(tabs)/play'] }]);
  });

  it('above the tab bar it pops back to it instead of stacking a second one', () => {
    mockRootState = { index: 1, routes: [{ name: '(tabs)' }, { name: 'round/briefing' }] };
    goToTab('caddie');
    expect(routerMock.__calls).toEqual([{ method: 'dismissTo', args: ['/(tabs)/caddie'] }]);
  });

  it('before the tab bar exists (first run) it still lands on it', () => {
    mockRootState = { index: 0, routes: [{ name: 'greeting' }] };
    goToTab('caddie');
    expect(routerMock.__calls).toEqual([{ method: 'dismissTo', args: ['/(tabs)/caddie'] }]);
  });
});
