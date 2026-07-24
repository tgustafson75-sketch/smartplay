/**
 * 2026-07-24 (full-app audit, root D) — the ONE service-safe source of the current
 * swinger's handedness. Mirrors the derivation SmartMotion's screen already does
 * (app/swinglab/smartmotion.tsx): the active family member when recording someone
 * else, otherwise the account holder — defaulting to 'right' only when neither is set.
 *
 * Why this exists: computeBiomechanics signs the weight-shift metric toward the LEAD
 * ankle, which is handedness-dependent (righty lead = left foot, lefty lead = right).
 * Call sites that didn't thread handedness defaulted to 'right' and read a LEFTY's
 * weight shift inverted (a good forward move looked like hanging back). Callers that
 * run outside React (videoUpload, poseEstimator, swing detail) read handedness here
 * so every analysis path agrees with the on-screen capture guides.
 */
import { useFamilyStore } from '../store/familyStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';

export function resolveSwingerHandedness(): 'right' | 'left' {
  try {
    const fam = useFamilyStore.getState();
    const active = fam.active_member_id
      ? fam.members.find((m) => m.id === fam.active_member_id)
      : null;
    if (active?.handedness === 'left' || active?.handedness === 'right') {
      return active.handedness;
    }
  } catch { /* family store is optional context */ }
  try {
    const h = usePlayerProfileStore.getState().handedness;
    if (h === 'left' || h === 'right') return h;
  } catch { /* profile store is optional context */ }
  return 'right';
}
