/**
 * services/billing/purchases.ts — THE ONE OWNER OF "IS THIS PLAYER ENTITLED".
 *
 * 2026-08-29 (Tim — "the apple store is the subscription handler right … do what is needed").
 * Yes. On iOS the App Store runs checkout, the free trial, renewals, cancellations, refunds, tax
 * and dunning; Google Play does the same on Android. App Store guideline 3.1.1 makes that mandatory
 * for in-app digital subscriptions — Stripe inside the app is a rejection, which is why the paywall
 * has sat behind a kill-switch instead of being wired to a card form.
 *
 * It is also the only path that WORKS here, independent of the rule. A Stripe purchase happens on a
 * server and has to be delivered back to a phone, and this app has no accounts and no server-side
 * identity: `subscription_status` is a local field in playerProfileStore that `api/*` never writes.
 * The store SDKs carry entitlement on the Apple ID / Play account themselves, so nothing has to be
 * built to connect a payment to a player. [[billing-stripe-vs-iap-constraint]]
 *
 * RevenueCat wraps both stores so this is one integration rather than two, and receipt validation,
 * restore and cross-platform entitlement come with it.
 *
 * ── WHY EVERY NATIVE CALL IS BEHIND `sdk()` ──────────────────────────────────────────────────────
 * react-native-purchases is a NATIVE module, and testers are frozen on a TestFlight binary that does
 * not contain it while this repo ships JS to that binary over the air.
 *
 * 2026-08-29, adversarial audit 1 — CORRECTING WHAT THIS COMMENT FIRST CLAIMED. I wrote that a bare
 * import would crash them at boot. It would not: this version of the SDK reads
 * `NativeModules.RNPurchases` into a variable that is simply undefined when the native side is
 * absent, and explicitly guards its NativeEventEmitter construction — its own comment says "Only
 * create event emitter if native module is available to avoid crash on import" (their issue #1298,
 * i.e. it DID crash on import until they fixed it). Importing throws nothing today.
 *
 * What actually happens is worse for being quieter: `Purchases.configure` exists as a plain static
 * method either way, so no presence check on the object can tell you anything. The absence only
 * surfaces when a method is CALLED and the SDK's own `throwIfNativeModuleNotAvailable()` fires.
 * That is why `initBilling()` — which wraps the real `configure` call in a try/catch — is the single
 * honest answer to "is billing usable here", and why `billingAvailable()` delegates to it rather
 * than asking whether the module could be required.
 *
 * The lazy require and the LOCK forbidding a static import elsewhere both STAY. A static import puts
 * the SDK on the boot path for every user on every launch, where an SDK regression or an RN upgrade
 * would land on them at boot rather than on the one screen that sells a subscription — the SDK's own
 * history shows that is not hypothetical.
 * [[ota-must-work-on-the-shipped-ios-build]] [[caddie-failsafe-no-walls]]
 *
 * `statusFromCustomerInfo` is exported and PURE on purpose: the jest suite cannot load a native
 * module, so the mapping — which is where the real logic lives — is tested directly.
 */

import { Platform } from 'react-native';
import { PRICING } from '../../lib/pricing';
import type { SubscriptionStatus } from '../../store/playerProfileStore';

/**
 * Report a failure we are deliberately swallowing. Never throws — a reporting problem must not
 * become a billing problem, which is the whole reason these catches were bare to begin with.
 */
function reportSilentFailure(e: unknown, context: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../analytics') as typeof import('../analytics')).captureError(e, context);
  } catch { /* reporting is best-effort */ }
}


/**
 * The entitlement identifier configured in the RevenueCat dashboard.
 *
 * 2026-08-30 — CORRECTED from 'full' to 'smartplay_caddie_pro', which is what the dashboard
 * actually has. I chose 'full' on 08-29 to match the app's own Lite/Full edition language and
 * recorded it for Cowork to create; the project was set up with a different name, and RevenueCat's
 * onboarding snippet is what surfaced it.
 *
 * The dashboard wins, always — the SDK returns entitlements keyed by ITS identifier, so a mismatch
 * is not a naming inconsistency, it is every paying customer reading as unsubscribed with nothing
 * in the app able to explain why. Pinned by a test for exactly that reason. [[cowork-task-list]]
 */
export const ENTITLEMENT_ID = 'smartplay_caddie_pro';

/**
 * Product identifiers live in lib/pricing.ts next to the prices, and ONLY there. They were briefly
 * duplicated here too, which the orphan sweep caught within minutes — a second copy of an id that
 * must match a dashboard by hand is the same defect this file's header is about.
 * [[two-owners-is-the-root-cause]]
 */

/**
 * RevenueCat PUBLIC SDK keys. These are publishable — they are meant to ship in the client, exactly
 * like the Mapbox token already in eas.json. The secret keys never come near this repo.
 *
 * Read from EXPO_PUBLIC_* with a literal fallback because, as services/apiBase.ts documents, those
 * vars arrive EMPTY in an OTA-delivered bundle: they are inlined at BUILD time, so a JS-only update
 * carries whatever the binary was built with. The fallback is what actually runs in the field.
 */
/**
 * 2026-08-30 — the TEST STORE key, deliberately, and it must not reach a paid launch.
 *
 * RevenueCat's key prefixes say which store is behind them: `appl_` is App Store, `goog_` is Play,
 * and `test_` is RevenueCat's own Test Store. Tim supplied one `test_` value for BOTH platforms,
 * which is the tell — real platform keys always differ.
 *
 * It is here on purpose. Apple sandbox purchases need the Paid Applications agreement to be active,
 * that needs banking and tax, and that is blocked on an EIN. The Test Store is the only way to
 * exercise a real purchase, restore and trial before then, so the flow can be proven rather than
 * assumed while the paperwork clears.
 *
 * It is also a launch-breaking mistake waiting to happen: flip SUBSCRIPTIONS_ENABLED with this in
 * place and every player transacts against a test store instead of Apple. A sim LOCK fails the
 * build if a `test_` key is ever present while subscriptions are ON, so that combination cannot
 * ship. Replace these with the appl_/goog_ keys before the switch moves. [[cowork-task-list]]
 */
/**
 * 2026-08-30, later — iOS now has a REAL App Store key; Android does not yet.
 *
 * Cowork created the RevenueCat App Store app config (appf2c54cc4f4, bundle com.smartplaycaddie.app),
 * imported both products, attached them to entitlement `smartplay_caddie_pro`, and rebuilt the
 * default offering as $rc_monthly → Full Monthly / $rc_annual → Full Annual. Creating that config
 * ISSUED A NEW PUBLIC SDK KEY — RevenueCat scopes keys per app config, so the Test Store key no
 * longer addresses the right store on iOS.
 *
 * Android stays on the Test Store key because `goog_` cannot exist yet: it needs a Play app config,
 * which needs the Play Console account, which is blocked. The LOCK below still applies and is doing
 * exactly its job — a `test_` key anywhere in this file blocks turning subscriptions ON, so Android
 * getting its real key is now a precondition for launch rather than a detail someone might forget.
 */
const TEST_STORE_KEY = 'test_xTYhIjxcMjCQkAzNExcmQzhFdvA';
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || 'appl_ghJChGpGSaSvMcbTqNwACOIItDt';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || TEST_STORE_KEY;

function apiKey(): string {
  return Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySdk = any;

let cachedSdk: AnySdk | null = null;
let sdkMissing = false;

/**
 * The native module, or null. Never throws. Null means "this binary has no billing" — which is the
 * normal state for every tester until the next native build ships.
 */
function sdk(): AnySdk | null {
  if (cachedSdk) return cachedSdk;
  if (sdkMissing) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases');
    const Purchases = mod?.default ?? mod;
    // NOTE (audit 1): this proves the JS module loaded, NOT that the native side exists — configure
    // is a static method that is present either way. initBilling() is what establishes usability.
    if (!Purchases || typeof Purchases.configure !== 'function') {
      sdkMissing = true;
      return null;
    }
    cachedSdk = Purchases;
    return cachedSdk;
  } catch {
    // Native side absent (OTA bundle on an older binary, or a jest/node context).
    sdkMissing = true;
    return null;
  }
}

let configured = false;

/**
 * Configure the SDK once. Safe to call on every launch and from more than one place.
 *
 * Returns whether billing is actually available, so a caller can tell "not configured" apart from
 * "configured and this player has nothing" — the two look identical if you only read the status.
 */
export function initBilling(): boolean {
  if (configured) return true;
  const Purchases = sdk();
  if (!Purchases) return false;
  const key = apiKey();
  // No key = not set up yet (Cowork creates the RevenueCat project). Configuring with an empty
  // string makes the SDK throw on the first call instead of here, which is a worse place to find out.
  if (!key) return false;
  try {
    // Verbose SDK logging in development only — it prints every request and receipt, which is what
    // you want while proving the flow and noise you do not want in a shipped build.
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // setDebugLogsEnabled rather than setLogLevel(LOG_LEVEL.VERBOSE): the enum is a named export
      // on the module and would need a second require of the SDK, which this file exists to avoid
      // doing more than once. Same outcome.
      try { void Purchases.setDebugLogsEnabled?.(true); } catch { /* optional */ }
    }
    Purchases.configure({ apiKey: key });
    configured = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Is billing usable on this device right now?
 *
 * 2026-08-29, audit 1 — was `sdk() != null && apiKey() !== ''`, which could answer YES on a binary
 * with no native billing at all: requiring the module succeeds regardless (see the header), so that
 * test only ever proved a key was set. The paywall reads this to choose between "update the app" and
 * carrying on, so a false yes sent the player down the purchase path to a bare offerings list and the
 * message "not on sale in your region yet" — true-sounding, and wrong.
 *
 * Delegating to initBilling() makes it the same question as "did configure() actually work", which
 * is the only version of it the SDK will answer honestly. Idempotent and cheap after the first call.
 */
export function billingAvailable(): boolean {
  return initBilling();
}

/**
 * Map a RevenueCat CustomerInfo onto the app's SubscriptionStatus.
 *
 * PURE and exported so it can be tested without the native module — this mapping is where the
 * decisions live, and two of them are easy to get wrong:
 *
 *  1. `'lifetime'` is an OWNER GRANT (the allow-list in playerProfileStore), not something the store
 *     knows about. RevenueCat will report no entitlement for those accounts, so a naive mapping
 *     would downgrade Tim to 'free' and lock him out of his own app on first launch. The current
 *     status is passed in specifically so lifetime survives.
 *  2. Someone who HAD the entitlement and no longer does is `'expired'`, not `'free'`. featureAccess
 *     treats both as Lite, but they are different people and the paywall says different things to
 *     them.
 */
export function statusFromCustomerInfo(
  info: { entitlements?: { active?: Record<string, unknown>; all?: Record<string, unknown> } } | null | undefined,
  current: SubscriptionStatus,
): SubscriptionStatus {
  // An owner grant is ours, not the store's. Never let a store read take it away.
  if (current === 'lifetime') return 'lifetime';
  if (!info?.entitlements) return current === 'trial' ? 'trial' : current;

  const active = info.entitlements.active?.[ENTITLEMENT_ID] as
    | { isActive?: boolean; periodType?: string }
    | undefined;

  if (active?.isActive) {
    // periodType is a plain string on the RN surface and an enum internally; compare loosely so a
    // casing change in the SDK cannot silently turn every trial into a paid subscription.
    return String(active.periodType ?? '').toUpperCase() === 'TRIAL' ? 'trial' : 'active';
  }

  // Not active now. Did they ever have it?
  const everHad = info.entitlements.all?.[ENTITLEMENT_ID] != null;
  if (everHad) return 'expired';

  /**
   * 2026-08-30 (audit) — THE STORE HAS NEVER HEARD OF THIS PLAYER, SO IT HAS NO OPINION.
   *
   * This returned 'free' here, and that quietly destroyed every status the store does not issue.
   * RevenueCat hands a non-purchaser `entitlements: { active: {}, all: {} }` — present, so the
   * guard at the top of this function does not fire, and empty, so nothing below matched.
   *
   * A player 6 days into OUR 14-day trial would be written to 'free' on the first launch after
   * billing turns on. planTrialLifecycle then matches no rung for them — its trial rung requires
   * `!trialStartedAt`, and theirs is set — so they stay 'free', resolve to the 'lite' edition, and
   * lose the caddie IN THE MIDDLE of a trial they were told they had. Same shape as the lifetime
   * stamp fixed this morning, pointing the other way.
   *
   * It took a comp with it too: grantPromo writes 'active' locally, and this call is async so it
   * lands AFTER the sync lifecycle effect that granted it — overwriting a 30-day promotion with
   * 'free' on the same launch that created it.
   *
   * Downgrades still happen where the store HAS an opinion: everHad covers refunds, cancellations
   * and lapses, because RevenueCat keeps the entitlement in `all` once it has ever been issued.
   */
  return current;
}

/**
 * When the store-run free trial STARTED, in epoch ms — or null if this player is not in one.
 *
 * 2026-08-29 — this exists because the app measures the trial from the wrong moment. `initTrial()`
 * stamps `trial_started_at` the first time the app is OPENED, which was right when the trial was
 * ours to run. Under IAP the trial starts when the player BUYS, which can be days or weeks later,
 * so the local countdown would report a trial already half gone the moment someone subscribes.
 *
 * Rather than add a second countdown function beside featureAccess.trialDaysLeft — two owners of
 * one number, the exact bug being fixed one file over — this corrects the INPUT. The store's
 * expiry, minus the one configured trial length, is when the trial really began; writing that back
 * makes the existing countdown right without anything else changing.
 * [[two-owners-is-the-root-cause]]
 */
export function trialStartFromCustomerInfo(
  info: { entitlements?: { active?: Record<string, unknown> } } | null | undefined,
): number | null {
  const active = info?.entitlements?.active?.[ENTITLEMENT_ID] as
    | { isActive?: boolean; periodType?: string; expirationDateMillis?: number | null }
    | undefined;
  if (!active?.isActive) return null;
  if (String(active.periodType ?? '').toUpperCase() !== 'TRIAL') return null;
  const ms = active.expirationDateMillis;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return ms - PRICING.trialDays * 24 * 60 * 60 * 1000;
}

/**
 * Ask the store what this player owns and write it to the profile.
 *
 * Best-effort by design: a launch with no network must not change anyone's status. On any failure
 * we return the status unchanged rather than guessing 'free', because guessing 'free' revokes the
 * caddie from someone who paid. [[overstrict-gate-lens]]
 */
export type EntitlementSnapshot = {
  status: SubscriptionStatus;
  /** Non-null only while the store reports an active TRIAL — see trialStartFromCustomerInfo. */
  trialStartedAt: number | null;
};

export async function refreshEntitlement(
  current: SubscriptionStatus,
): Promise<EntitlementSnapshot> {
  const unchanged: EntitlementSnapshot = { status: current, trialStartedAt: null };
  if (!initBilling()) return unchanged;
  const Purchases = sdk();
  if (!Purchases) return unchanged;
  try {
    const info = await Purchases.getCustomerInfo();
    return { status: statusFromCustomerInfo(info, current), trialStartedAt: trialStartFromCustomerInfo(info) };
  } catch (e) {
    /**
     * 2026-08-30 — REPORTED, then swallowed. Returning `unchanged` is still the right behaviour:
     * an offline first tee must never revoke the caddie from someone who paid. But a store read
     * that fails EVERY time looks identical to one that never fails, and the player's status would
     * quietly drift from what they are being charged for with nothing anywhere to show it.
     *
     * captureError was itself an orphan — the only handled-error path to Sentry, called by nothing,
     * so every `catch { }` in the app was invisible in production. Wired here first because this is
     * a path where silence costs money.
     */
    reportSilentFailure(e, { where: 'refreshEntitlement' });
    return unchanged;
  }
}

/** The purchasable packages from the current Offering, or [] if billing is unavailable. */
export async function getPackages(): Promise<unknown[]> {
  if (!initBilling()) return [];
  const Purchases = sdk();
  if (!Purchases) return [];
  try {
    const offerings = await Purchases.getOfferings();
    return offerings?.current?.availablePackages ?? [];
  } catch (e) {
    // An empty list renders a paywall with nothing to buy. Worth knowing about.
    reportSilentFailure(e, { where: 'getPackages' });
    return [];
  }
}

export type PurchaseOutcome =
  | { ok: true; status: SubscriptionStatus; trialStartedAt: number | null }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed'; message?: string };

/**
 * Buy a package. The store presents its own sheet; we never see a card.
 *
 * `cancelled` is separated from `failed` because they need opposite treatment: a player who backed
 * out of Apple's sheet must not be shown an error, and a player whose purchase genuinely failed must
 * not be left thinking it worked.
 */
export async function purchasePackage(pkg: unknown, current: SubscriptionStatus): Promise<PurchaseOutcome> {
  if (!initBilling()) return { ok: false, reason: 'unavailable' };
  const Purchases = sdk();
  if (!Purchases) return { ok: false, reason: 'unavailable' };
  try {
    const result = await Purchases.purchasePackage(pkg);
    const info = result?.customerInfo;
    return { ok: true, status: statusFromCustomerInfo(info, current), trialStartedAt: trialStartFromCustomerInfo(info) };
  } catch (e) {
    const err = e as { userCancelled?: boolean | null; message?: string };
    if (err?.userCancelled) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'failed', message: err?.message };
  }
}

/**
 * Restore purchases. Apple REQUIRES a restore path on any screen that sells a subscription —
 * a paywall without one is a review rejection, not a missing nicety.
 */
export async function restorePurchases(current: SubscriptionStatus): Promise<PurchaseOutcome> {
  if (!initBilling()) return { ok: false, reason: 'unavailable' };
  const Purchases = sdk();
  if (!Purchases) return { ok: false, reason: 'unavailable' };
  try {
    const info = await Purchases.restorePurchases();
    return { ok: true, status: statusFromCustomerInfo(info, current), trialStartedAt: trialStartFromCustomerInfo(info) };
  } catch (e) {
    return { ok: false, reason: 'failed', message: (e as { message?: string })?.message };
  }
}
