/**
 * 2026-09-03 — the light-use trial extension, for THIS player, right now.
 *
 * services/billing/trialUsage holds the rule and is pure. This is the one place that goes and gets
 * the facts the rule needs, so the paywall, the debug screen and any later surface all ask the same
 * question and cannot each assemble their own slightly different answer.
 * [[two-owners-is-the-root-cause]]
 *
 * The trial LENGTH is read from PRICING.trialDays and never restated. A second copy of that number
 * is the exact defect the trial-countdown guard exists to prevent — the paywall promised 14 days
 * while featureAccess counted down from a hardcoded 7. The extension length is a genuinely different
 * number and lives in trialUsage as TRIAL_EXTENSION_DAYS.
 */

import { PRICING } from '../../lib/pricing';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRoundStore } from '../../store/roundStore';
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { planTrialExtension, type TrialExtensionOffer } from './trialUsage';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Every moment the player did something real with the app. Rounds and swing sessions only —
 * see trialUsage for why an app open is deliberately not one of these.
 *
 * Defensive throughout: this runs on the paywall, and a store that failed to rehydrate must produce
 * "no activity" rather than take the screen down. A wrong answer here costs the player a free week
 * they should have had; a throw costs them the ability to pay us at all.
 */
export function gatherTrialActivity(): number[] {
  const out: number[] = [];
  try {
    for (const r of useRoundStore.getState().roundHistory ?? []) {
      if (typeof r?.startedAt === 'number') out.push(r.startedAt);
    }
  } catch { /* no round history is a legitimate answer — it is the whole premise of this feature */ }
  try {
    // SwingSession stamps its moment as `date`, not `startedAt` — the round record uses the other
    // name, and assuming they matched cost a typecheck here rather than a silent zero at runtime.
    for (const sess of useSwingSessionStore.getState().sessionHistory ?? []) {
      if (typeof sess?.date === 'number') out.push(sess.date);
    }
  } catch { /* same */ }
  return out;
}

/** Should this player be offered another week? Reads live store state; safe to call on render. */
export function currentTrialExtensionOffer(now: number = Date.now()): TrialExtensionOffer {
  const p = usePlayerProfileStore.getState();
  return planTrialExtension({
    status: p.subscription_status,
    trialStartedAt: p.trial_started_at,
    trialDurationMs: PRICING.trialDays * MS_PER_DAY,
    activityTimestamps: gatherTrialActivity(),
    extensionGrantedAt: p.trial_extension_granted_at,
    now,
  });
}
