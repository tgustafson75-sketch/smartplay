/**
 * 2026-10-10 (Tim) — "We are not changing prices. We are just adjusting what's behind it to encourage
 * more play usage, feedback and improvement. We should be relatively liberal allowing usage of features
 * right now."
 *
 * THE ONE PLACE TO ADJUST WHAT IS FREE AND WHAT NEEDS PRO — without an app update or a store review.
 * Edit FEATURE_EDITION below and push: Vercel deploys it, and every install picks it up the next time it
 * opens or comes back to the foreground (services/remoteAppConfig). The app's built-in table
 * (services/featureAccess FEATURE_EDITION) is only the fallback for an install that has never reached
 * this endpoint.
 *
 *   'lite' = free for everyone        'pro' = needs a subscription
 *
 * round_start is always free (the front door is never walled) — the app ignores a 'pro' here for it.
 * Prices and trials are NOT here: they live in App Store Connect / Play Console.
 *
 * Note for a future store submission: if every feature is 'lite', the subscription unlocks nothing new —
 * set the gates you intend before submitting a build for review.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const FEATURE_EDITION = {
  round_start: 'lite',
  // 2026-10-10 — opened for the first ~30 players: usage, feedback and improvement over gating.
  voice_advanced: 'lite',   // talking to the caddie
  smartvision: 'lite',      // satellite hole view
  smartfinder: 'lite',      // camera rangefinder
  cage_mode: 'lite',        // SmartMotion swing analysis
} as const;

const UPDATED_AT = '2026-10-10';

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  // Short CDN cache: a change reaches players within minutes, without every launch hitting the function.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).json({ v: 1, updatedAt: UPDATED_AT, featureEdition: FEATURE_EDITION });
}
