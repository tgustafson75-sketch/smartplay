/**
 * 2026-09-29 (review) — a paywall deferred during a round was pushed at round end unconditionally, so
 * a player who subscribed / restored / redeemed meanwhile was still sold what they had just bought.
 * The resume (app/_layout.tsx → services/billing/deferredPaywallResume) now re-asks canAccess against
 * the status as it is at resume time, and consumes the flag either way.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { resumeDeferredPaywall } from '../../services/billing/deferredPaywallResume';

const KEY = '@smartplay/paywall_deferred';
const defer = (reason: string) => AsyncStorage.setItem(KEY, JSON.stringify({ reason, ts: Date.now() }));

beforeEach(async () => {
  await AsyncStorage.clear();
  usePlayerProfileStore.setState({ subscription_status: 'free', email: '' } as never);
});

describe('the resume re-checks access', () => {
  it.each(['active', 'trial', 'lifetime'] as const)('a player who is now %s is NOT shown the deferred paywall', async (status) => {
    await defer('smartfinder');
    usePlayerProfileStore.setState({ subscription_status: status } as never);
    const show = jest.fn();
    expect(await resumeDeferredPaywall(show)).toBe('skipped');
    expect(show).not.toHaveBeenCalled();
    // ...and it does not come back next launch.
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('a non-feature reason (the trial-expired banner) is skipped for a subscriber too', async () => {
    await defer('trial_expired_banner');
    usePlayerProfileStore.setState({ subscription_status: 'active' } as never);
    const show = jest.fn();
    await resumeDeferredPaywall(show);
    expect(show).not.toHaveBeenCalled();
  });

  it('a player still locked out IS shown it (the deferral still works)', async () => {
    await defer('smartvision');
    usePlayerProfileStore.setState({ subscription_status: 'expired' } as never);
    const show = jest.fn();
    expect(await resumeDeferredPaywall(show)).toBe('shown');
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('nothing deferred → nothing shown', async () => {
    const show = jest.fn();
    expect(await resumeDeferredPaywall(show)).toBe('none');
    expect(show).not.toHaveBeenCalled();
  });
});

describe('it waits for the profile to hydrate before deciding', () => {
  it('the pre-hydration default (free) is not mistaken for a locked-out subscriber', async () => {
    await defer('smartfinder');
    const persist = usePlayerProfileStore.persist;
    const realHas = persist.hasHydrated;
    const realOn = persist.onFinishHydration;
    let hydrated = false;
    let finish: (() => void) | null = null;
    persist.hasHydrated = () => hydrated;
    persist.onFinishHydration = ((fn: () => void) => { finish = fn; return () => { finish = null; }; }) as never;
    try {
      const show = jest.fn();
      const p = resumeDeferredPaywall(show);
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(show).not.toHaveBeenCalled();
      // Hydration lands: the persisted status is 'active'.
      usePlayerProfileStore.setState({ subscription_status: 'active' } as never);
      hydrated = true;
      (finish as unknown as () => void)();
      expect(await p).toBe('skipped');
      expect(show).not.toHaveBeenCalled();
    } finally {
      persist.hasHydrated = realHas;
      persist.onFinishHydration = realOn;
    }
  });
});
