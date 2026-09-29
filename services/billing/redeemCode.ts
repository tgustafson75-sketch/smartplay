/**
 * 2026-09-29 — EARLY-ACCESS / FOUNDING CODES, REDEEMED THROUGH THE STORE.
 *
 * Why the store and not a code of our own: since 1.0.2 a promo-granted 'active' lapses at promo end
 * unless the store says the player is entitled (services/billing/trialLifecycle, rung 1). A code the
 * App Store or Google Play redeems IS a store entitlement, so it survives that rule by construction —
 * the store vouches for it, and nothing here has to.
 *
 *   iOS     → Apple's offer-code sheet (purchases.presentOfferCodeSheet — the SDK stays behind the
 *             one lazy require in purchases.ts; a sim LOCK forbids naming it anywhere else).
 *   Android → Play's redeem page by URL. There is no in-app sheet on Play.
 *
 * Either way the grant arrives LATER than the tap — the sheet's promise settles on presentation, and
 * the Play page is another app — so a short watch re-reads the store when the app comes back to the
 * foreground or the SDK pushes new CustomerInfo, and writes the answer exactly the way the launch read
 * does (syncEntitlementFromStore, below — the one owner of that sequence).
 */
import { AppState, Linking, Platform } from 'react-native';
import { usePlayerProfileStore, type SubscriptionStatus } from '../../store/playerProfileStore';
import {
  onStoreCustomerInfoUpdate,
  planEntitlementWrite,
  presentOfferCodeSheet,
  refreshEntitlement,
} from './purchases';

/** Google Play's code-redemption page. An empty code opens the page with the field blank. */
export const PLAY_REDEEM_URL = 'https://play.google.com/redeem?code=';

/** How long after opening redemption a store answer still counts as that redemption's. */
export const REDEEM_WATCH_MS = 15 * 60 * 1000;

export type EntitlementSync = {
  /** The store's own answer — null when it could not be asked. */
  storeEntitled: boolean | null;
  /** The status written, or null when planEntitlementWrite left the profile alone. */
  wrote: SubscriptionStatus | null;
};

/**
 * Ask the store and write its answer to the profile — THE sequence, one owner.
 *
 * Moved out of app/_layout.tsx's launch effect so the code-redemption path cannot write entitlement
 * any differently from the launch read: `before` read ahead of the await, the status RE-read after it
 * (something may have granted during the flight), the store's trial start written before the status,
 * the store's own answer recorded, and planEntitlementWrite deciding whether the status may change.
 * `isCancelled` lets the launch effect abandon a read that outlived it. Never throws.
 */
export async function syncEntitlementFromStore(opts?: { fresh?: boolean; isCancelled?: () => boolean }): Promise<EntitlementSync | null> {
  const profile = () => usePlayerProfileStore.getState();
  const before = profile().subscription_status;
  const snapshot = await refreshEntitlement(before, { fresh: opts?.fresh === true });
  if (opts?.isCancelled?.()) return null;
  /**
   * Re-read rather than trusting `before`. The trial-lifecycle effect can grant lifetime to an owner
   * account while this store call is in flight, and writing a stale 'free' over that grant would lock
   * Tim out of his own app on his own launch. [[two-owners-is-the-root-cause]]
   */
  const nowStatus = profile().subscription_status;
  /**
   * Correct the trial's START before the status, because app/(tabs)/caddie.tsx reads the countdown
   * off `trial_started_at` — which initTrial stamped at FIRST APP OPEN. Under IAP the trial begins at
   * purchase, so without this a player who subscribes a fortnight after installing is told their
   * brand-new trial has already run out.
   */
  if (snapshot.trialStartedAt != null) profile().setTrialStartedAt(snapshot.trialStartedAt);
  // Remember what the store said, so a later promo expiry can tell its 'active' from theirs. A store
  // subscriber whose status a lapsed promo moved to 'expired' before this read landed gets it back
  // through planEntitlementWrite's storeEntitled rule just below.
  if (snapshot.storeEntitled != null) profile().setStoreEntitlementActive(snapshot.storeEntitled);
  /**
   * 2026-09-18 — THE DECISION LIVES IN THE MODULE, because the launch effect is where it was wrong.
   * The three lines it replaced protected 'lifetime' and nothing else, and the case that mattered was
   * the TRIAL: on a fresh install `before` is the default 'free', the store has never heard of the
   * player so the mapping echoes 'free' back, and initTrial granted 'trial' while the read was in
   * flight — so the echo landed on top and every new customer lost the trial on their first launch.
   * Found on Tim's own App Store install. See planEntitlementWrite.
   */
  const write = planEntitlementWrite({ before, mapped: snapshot.status, now: nowStatus, storeEntitled: snapshot.storeEntitled });
  if (write != null) profile().setSubscriptionStatus(write);
  return { storeEntitled: snapshot.storeEntitled, wrote: write };
}

export type RedeemStart = 'started' | 'unavailable' | 'unsupported';

let stopActiveWatch: (() => void) | null = null;

/**
 * Open the platform's code redemption and watch for the grant.
 *
 * `onGranted` fires at most once, and only when the store turns from not-entitled to entitled inside
 * the watch window — a player who already subscribes and closes the sheet is not told a code worked.
 * Resolves 'unavailable' when the sheet or page could not be opened (the caller says so), and
 * 'unsupported' off iOS/Android.
 */
export async function startCodeRedemption(opts: { onGranted: () => void; now?: () => number }): Promise<RedeemStart> {
  const os = Platform.OS;
  if (os !== 'ios' && os !== 'android') return 'unsupported';
  const now = opts.now ?? Date.now;
  const wasEntitled = usePlayerProfileStore.getState().store_entitlement_active === true;

  if (os === 'ios') {
    const r = await presentOfferCodeSheet();
    if (r !== 'presented') return 'unavailable';
  } else {
    try {
      await Linking.openURL(PLAY_REDEEM_URL);
    } catch (e) {
      console.log('[redeemCode] Play redeem page failed to open:', e);
      return 'unavailable';
    }
  }

  // One watch at a time — a second tap replaces the first rather than doubling every read.
  stopActiveWatch?.();
  const deadline = now() + REDEEM_WATCH_MS;
  let done = false;
  let inFlight = false;
  let again = false;
  const check = async (): Promise<void> => {
    if (done) return;
    // A trigger during a read is not dropped: that read may have left before the grant landed.
    if (inFlight) { again = true; return; }
    if (now() > deadline) { stop(); return; }
    inFlight = true;
    try {
      const r = await syncEntitlementFromStore({ fresh: true });
      if (!done && r?.storeEntitled === true && !wasEntitled) {
        stop();
        opts.onGranted();
      }
    } finally {
      inFlight = false;
    }
    if (again && !done) { again = false; await check(); }
  };
  let lastState = AppState.currentState;
  const appSub = AppState.addEventListener('change', (next) => {
    const cameBack = next === 'active' && lastState !== 'active';
    lastState = next;
    if (cameBack) void check();
  });
  const unlistenStore = onStoreCustomerInfoUpdate(() => { void check(); });
  const timer = setTimeout(() => stop(), REDEEM_WATCH_MS);
  // Node (jest) timers hold the process open for the whole window; RN's are plain numbers.
  (timer as unknown as { unref?: () => void }).unref?.();
  function stop() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try { appSub.remove(); } catch { /* already removed */ }
    unlistenStore();
    if (stopActiveWatch === stop) stopActiveWatch = null;
  }
  stopActiveWatch = stop;
  return 'started';
}
