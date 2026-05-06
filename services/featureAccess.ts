import { type SubscriptionStatus } from '../store/playerProfileStore';

export type FeatureKey = 'round_start' | 'smartvision' | 'cage_mode' | 'voice_advanced' | 'smartfinder';

export function canAccess(feature: FeatureKey, status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'trial' || status === 'lifetime';
}

export function trialDaysLeft(trial_started_at: number | null): number | null {
  if (!trial_started_at) return null;
  const elapsed = Date.now() - trial_started_at;
  return Math.max(0, 7 - Math.floor(elapsed / (24 * 60 * 60 * 1000)));
}
