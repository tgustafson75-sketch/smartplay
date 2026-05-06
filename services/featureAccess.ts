import { type SubscriptionStatus } from '../store/playerProfileStore';

export type FeatureKey = 'round_start' | 'smartvision' | 'cage_mode' | 'voice_advanced' | 'smartfinder';

// Global kill-switch for the subscription system.
// Tim asked to disable subscriptions for now (real billing infra not yet
// wired). When false, every feature is unlocked, the trial never starts
// or expires, and the paywall is a no-op. Flip back to true once a real
// subscription provider (RevenueCat, App Store, etc.) is integrated.
export const SUBSCRIPTIONS_ENABLED = false;

export function canAccess(feature: FeatureKey, status: SubscriptionStatus): boolean {
  if (!SUBSCRIPTIONS_ENABLED) return true;
  return status === 'active' || status === 'trial' || status === 'lifetime';
}

export function trialDaysLeft(trial_started_at: number | null): number | null {
  if (!SUBSCRIPTIONS_ENABLED) return null;
  if (!trial_started_at) return null;
  const elapsed = Date.now() - trial_started_at;
  return Math.max(0, 7 - Math.floor(elapsed / (24 * 60 * 60 * 1000)));
}
