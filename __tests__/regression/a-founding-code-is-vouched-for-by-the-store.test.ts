/**
 * 2026-09-29 — EARLY-ACCESS / FOUNDING CODES THROUGH THE STORE.
 *
 * Since 1.0.2 a promo-granted 'active' lapses at promo end unless the STORE says the player is
 * entitled (services/billing/trialLifecycle). A code of our own would therefore lapse; a code the App
 * Store or Google Play redeems is a store entitlement and does not. This proves the whole path with
 * the SDK stubbed at its boundary:
 *
 *   iOS     → Apple's offer-code sheet, then the grant arrives LATER through the SDK listener.
 *   Android → Play's redeem page by URL, then the grant is read when the app comes back.
 *   Both    → written exactly the way the launch read writes it (syncEntitlementFromStore), so the
 *             redeemed player is 'active' with store_entitlement_active=true — and the promo-lapse
 *             rule leaves them alone.
 */
import { AppState, Linking, Platform } from 'react-native';

const sdk = {
  configure: jest.fn(),
  getCustomerInfo: jest.fn(),
  invalidateCustomerInfoCache: jest.fn(async () => undefined),
  presentCodeRedemptionSheet: jest.fn(async () => undefined),
  addCustomerInfoUpdateListener: jest.fn(),
  removeCustomerInfoUpdateListener: jest.fn(() => true),
};
jest.mock('react-native-purchases', () => ({ __esModule: true, default: sdk }));

import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { startCodeRedemption, syncEntitlementFromStore, PLAY_REDEEM_URL } from '../../services/billing/redeemCode';
import { planTrialLifecycle } from '../../services/billing/trialLifecycle';
import { ENTITLEMENT_ID } from '../../services/billing/purchases';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const NOT_ENTITLED = { entitlements: { active: {}, all: {} } };
const ENTITLED = { entitlements: { active: { [ENTITLEMENT_ID]: { isActive: true, periodType: 'NORMAL' } }, all: { [ENTITLEMENT_ID]: {} } } };

let appListeners: ((s: string) => void)[];
let opened: string[];
const originalOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  appListeners = [];
  opened = [];
  sdk.getCustomerInfo.mockResolvedValue(NOT_ENTITLED);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: string) => void) => {
    appListeners.push(fn);
    return { remove: () => { appListeners = appListeners.filter((f) => f !== fn); } };
  }) as never);
  jest.spyOn(Linking, 'openURL').mockImplementation(async (u: string) => { opened.push(u); return true; });
  usePlayerProfileStore.setState({ subscription_status: 'free', store_entitlement_active: null, promo_expires_at: null } as never);
});
afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
  jest.restoreAllMocks();
});

const storeListener = () => sdk.addCustomerInfoUpdateListener.mock.calls.at(-1)?.[0] as (() => void) | undefined;

describe('iOS — Apple\'s offer-code sheet', () => {
  beforeEach(() => { (Platform as { OS: string }).OS = 'ios'; });

  it('presents the sheet, and the grant that lands afterwards unlocks the app at once', async () => {
    const onGranted = jest.fn();
    await expect(startCodeRedemption({ onGranted })).resolves.toBe('started');
    expect(sdk.presentCodeRedemptionSheet).toHaveBeenCalledTimes(1);
    expect(usePlayerProfileStore.getState().subscription_status).toBe('free');

    // Apple redeems FOUNDER; the SDK pushes new CustomerInfo.
    sdk.getCustomerInfo.mockResolvedValue(ENTITLED);
    storeListener()!();
    await flush();

    const p = usePlayerProfileStore.getState();
    expect(p.subscription_status).toBe('active');
    expect(p.store_entitlement_active).toBe(true);
    expect(onGranted).toHaveBeenCalledTimes(1);
    // A fresh read — the SDK's cache is exactly what would still say "not entitled" here.
    expect(sdk.invalidateCustomerInfoCache).toHaveBeenCalled();
    // The watch is over: no listener left behind.
    expect(sdk.removeCustomerInfoUpdateListener).toHaveBeenCalled();
    expect(appListeners).toHaveLength(0);
  });

  it('closing the sheet without a code changes nothing and claims nothing', async () => {
    const onGranted = jest.fn();
    await startCodeRedemption({ onGranted });
    appListeners.forEach((f) => f('inactive'));
    appListeners.forEach((f) => f('active'));
    await flush();
    expect(usePlayerProfileStore.getState().subscription_status).toBe('free');
    expect(usePlayerProfileStore.getState().store_entitlement_active).toBe(false);
    expect(onGranted).not.toHaveBeenCalled();
  });

  it('an existing subscriber who opens the sheet is not told a code worked', async () => {
    usePlayerProfileStore.setState({ subscription_status: 'active', store_entitlement_active: true } as never);
    sdk.getCustomerInfo.mockResolvedValue(ENTITLED);
    const onGranted = jest.fn();
    await startCodeRedemption({ onGranted });
    storeListener()!();
    await flush();
    expect(onGranted).not.toHaveBeenCalled();
  });

  it('a sheet that cannot be shown says so instead of watching for nothing', async () => {
    sdk.presentCodeRedemptionSheet.mockRejectedValueOnce(new Error('no storekit'));
    await expect(startCodeRedemption({ onGranted: jest.fn() })).resolves.toBe('unavailable');
    expect(sdk.addCustomerInfoUpdateListener).not.toHaveBeenCalled();
  });
});

describe('Android — Play\'s redeem page', () => {
  beforeEach(() => { (Platform as { OS: string }).OS = 'android'; });

  it('opens the redeem page, and reads the grant when the player comes back to the app', async () => {
    const onGranted = jest.fn();
    await expect(startCodeRedemption({ onGranted })).resolves.toBe('started');
    expect(opened).toEqual([PLAY_REDEEM_URL]);
    expect(sdk.presentCodeRedemptionSheet).not.toHaveBeenCalled();

    sdk.getCustomerInfo.mockResolvedValue(ENTITLED);
    appListeners.forEach((f) => f('background'));
    appListeners.forEach((f) => f('active'));
    await flush();
    expect(usePlayerProfileStore.getState().subscription_status).toBe('active');
    expect(onGranted).toHaveBeenCalledTimes(1);
  });
});

describe('why the store, not a code of our own', () => {
  it('a store-redeemed player survives the promo-lapse rule that ends a promo-only grant', async () => {
    (Platform as { OS: string }).OS = 'ios';
    await startCodeRedemption({ onGranted: jest.fn() });
    sdk.getCustomerInfo.mockResolvedValue(ENTITLED);
    storeListener()!();
    await flush();
    const p = usePlayerProfileStore.getState();
    const base = {
      subscriptionsEnabled: true, isOwner: false, status: p.subscription_status,
      promoExpiresAt: 1, firstOpenedAt: 0, trialStartedAt: null, trialDurationMs: 14 * 864e5, now: 2,
    };
    // Redeemed through the store: the promo clears and the access stays.
    expect(planTrialLifecycle({ ...base, storeEntitled: p.store_entitlement_active }).setStatus).toBeUndefined();
    // The same 'active' with no store behind it lapses — which is what a code of our own would be.
    expect(planTrialLifecycle({ ...base, storeEntitled: false }).setStatus).toBe('expired');
  });
});

describe('Settings offers it beside Plans & subscription', () => {
  it('the subscription section carries a Redeem row wired to the store redemption', () => {
    const fs = require('fs') as typeof import('fs');
    const src = (fs.readFileSync(require('path').resolve(__dirname, '../../app/settings.tsx'), 'utf-8') as string)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:\w])\/\/[^\n]*/g, '');
    const section = src.slice(src.indexOf("t('settings.title.subscription')"), src.indexOf("t('settings.title.caddie')"));
    expect(section).toMatch(/onPress=\{\(\) => \{ void handleRedeemCode\(\); \}\}/);
    expect(section).toMatch(/t\('settings\.text\.redeem_code'\)/);
    expect(src).toMatch(/const handleRedeemCode = useCallback\(async \(\) => \{[\s\S]{0,200}startCodeRedemption\(/);
  });
});

describe('the launch read and the redemption write through ONE sequence', () => {
  it('the launch effect delegates to the one owner rather than keeping its own copy', () => {
    const fs = require('fs') as typeof import('fs');
    const src = (fs.readFileSync(require('path').resolve(__dirname, '../../app/_layout.tsx'), 'utf-8') as string)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:\w])\/\/[^\n]*/g, '');
    expect(src).toMatch(/syncEntitlementFromStore\(\{ isCancelled: \(\) => cancelled \}\)/);
    expect(src).not.toMatch(/planEntitlementWrite|refreshEntitlement\(/);
  });

  it('a launch read abandoned by its effect writes nothing', async () => {
    sdk.getCustomerInfo.mockResolvedValue(ENTITLED);
    await expect(syncEntitlementFromStore({ isCancelled: () => true })).resolves.toBeNull();
    expect(usePlayerProfileStore.getState().subscription_status).toBe('free');
    expect(usePlayerProfileStore.getState().store_entitlement_active).toBeNull();
  });

  it('an echo never overwrites a status granted while the read was in flight', async () => {
    let release!: (v: unknown) => void;
    sdk.getCustomerInfo.mockReturnValue(new Promise((r) => { release = r; }));
    const pending = syncEntitlementFromStore();
    usePlayerProfileStore.setState({ subscription_status: 'trial' } as never);
    release(NOT_ENTITLED);
    await pending;
    expect(usePlayerProfileStore.getState().subscription_status).toBe('trial');
  });

  it('the launch read keeps the SDK cache; only redemption asks for a fresh answer', async () => {
    await syncEntitlementFromStore();
    expect(sdk.invalidateCustomerInfoCache).not.toHaveBeenCalled();
  });
});
