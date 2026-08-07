/**
 * 2026-08-07 (Tim — "the caddie learns your miss but the on-course read ignores it"). The manual "dominant
 * miss" in Settings is almost always null (`setGoal`/`setMissType` are only set by the Settings toggle, which
 * most players never touch). Meanwhile the caddie DOES learn the player's miss from their logged shot
 * directions. This resolves the EFFECTIVE dominant miss for the on-course shot read: the manual field when
 * set, else the LEARNED lateral tendency from the player's own shots (current round + recent history).
 *
 * Honest by construction: the learned side only returns 'left'/'right' with a real sample + clear majority
 * (learnedMissDirection); it never fabricates a tendency, and the manual field always wins when present.
 */
import { useRoundStore, type ShotResult } from '../store/roundStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { learnedMissDirection } from './patternDetection';

/** The player's recent shots for tendency: current round + the last few rounds' shots (most-recent first). */
function recentPlayerShots(maxShots = 40): ShotResult[] {
  const rs = useRoundStore.getState();
  const out: ShotResult[] = [...(rs.shots ?? [])];
  // Walk recent rounds newest→oldest until we have enough.
  for (let i = rs.roundHistory.length - 1; i >= 0 && out.length < maxShots; i--) {
    const hs = rs.roundHistory[i]?.shots;
    if (Array.isArray(hs) && hs.length) out.push(...hs);
  }
  return out.slice(0, maxShots);
}

/** 'left' | 'right' | null — the player's confident lateral miss learned from their own shots. */
export function getLearnedMissDirection(): 'left' | 'right' | null {
  return learnedMissDirection(recentPlayerShots());
}

/** The EFFECTIVE dominant miss for the shot read: manual Settings field first, else the learned tendency. */
export function getEffectiveDominantMiss(): 'left' | 'right' | 'straight' | null {
  const manual = usePlayerProfileStore.getState().dominantMiss;
  if (manual) return manual as 'left' | 'right' | 'straight';
  return getLearnedMissDirection();
}
