import { useTrustLevelStore, type TrustLevel } from '../store/trustLevelStore';

/**
 * Phase E — convenience layer over trustLevelStore.
 *
 * Synchronous getter for use outside React components (e.g. modeSelector,
 * orchestrators, intent handlers). React components should subscribe via
 * useTrustLevelStore(s => s.level) for reactive updates.
 */
export function getTrustLevel(): TrustLevel {
  return useTrustLevelStore.getState().level;
}

/**
 * Per-level wake-word default state. Phase G ships actual wake-word detection;
 * Phase E only stages the default. The user can still override in Settings →
 * Voice — this getter answers "what should the default be on a fresh install?"
 *
 * L1 / L2: off (quiet-or-companion, opt-in voice)
 * L3:      on (active, voice-first)
 */
export function defaultWakeWordOn(level?: TrustLevel): boolean {
  const l = level ?? getTrustLevel();
  return l >= 3;
}

/**
 * MAY THE CADDIE SPEAK WITHOUT BEING ASKED? The one owner of that question.
 *
 * 2026-08-30 — this said "Consumed by proactiveKevin and conversationalLoggingOrchestrator gating"
 * and was consumed by NOTHING. Meanwhile proactiveKevin's mayInterject() took trustLevel and used
 * it only to pick a debounce: L2 got four minutes, everything else got two. So the ladder ran
 * BACKWARDS — L1 "Quiet · tap or type to talk", the level whose own store entry says tap-to-talk
 * only, was exactly as talkative as L3 voice-first, and twice as talkative as L2.
 *
 * A player who chose Quiet was interrupted every two minutes. [[no-push-nagging-no-ads]]
 *
 * THE OLD DOC CLAIMED L2 IS FALSE, and that is the half not restored. The shipped L2 behaviour —
 * speak, but at half the rate — is the more recent and more deliberate design (the 08-27
 * interruption-clock work), and it matches L2's own label, "Companion". Silencing L2 to satisfy a
 * comment would be taking a feature away on the strength of prose. L1 is where both specs agreed,
 * and L1 is what was broken.
 */
/*
 * proactiveEnabled() was DELETED here rather than wired, and that is the whole lesson of the bug it
 * failed to prevent. It answered "may the caddie speak unprompted" — and so does proactiveDebounceMs
 * by returning null. Keeping both would have rebuilt, on the same afternoon, the two-owners shape
 * that let the L1 defect exist: a correct predicate nobody imported, sitting beside the code that
 * actually decided. One function decides now.
 */

/**
 * How long every proactive voice must wait since the LAST one, or null when the caddie must not
 * speak unprompted at all. Null and a number are different answers and must not be collapsed: a
 * very long debounce still eventually talks.
 *
 * The interruption cost is shared across every trigger, so the interval belongs to the trust level
 * rather than to any one voice. proactiveKevin owns the clock; this owns the policy.
 */
export function proactiveDebounceMs(level?: TrustLevel): number | null {
  const l = level ?? getTrustLevel();
  if (l <= 1) return null;          // Quiet — tap or type to talk. Never unprompted.
  if (l === 2) return 4 * 60 * 1000; // Companion — half the rate of active.
  return 2 * 60 * 1000;              // Active — voice-first.
}

/**
 * Whether the psychologist register can engage. The walking conversation
 * between shots is psychologist-mode regulation per the role spec.
 *
 * L1 / L2: dormant.
 * L3:      walking conversation + full regulatory engagement enabled.
 */
export function psychologistEnabled(level?: TrustLevel): boolean {
  const l = level ?? getTrustLevel();
  return l >= 3;
}
