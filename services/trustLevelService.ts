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
 * L1 / L2: off (companion-or-quieter, opt-in voice)
 * L3 / L4: on (engaged-or-immersive, voice-first)
 */
export function defaultWakeWordOn(level?: TrustLevel): boolean {
  const l = level ?? getTrustLevel();
  return l >= 3;
}

/**
 * Whether proactive Kevin engagement is enabled at this level. Consumed by
 * proactiveKevin and conversationalLoggingOrchestrator gating.
 *
 * L1: false — Kevin only responds to explicit voice/tap.
 * L2: false — minimal proactive (only on clear emotional signals; Phase A.4 hints).
 * L3: true  — between-shots walking conversation triggers active.
 * L4: true  — fully proactive across surfaces.
 */
export function proactiveEnabled(level?: TrustLevel): boolean {
  const l = level ?? getTrustLevel();
  return l >= 3;
}

/**
 * Whether the psychologist register can engage. The walking conversation
 * between shots is psychologist-mode regulation per the role spec.
 *
 * L1 / L2: dormant.
 * L3:      walking conversation enabled.
 * L4:      full regulatory engagement + character breadth in conversation.
 */
export function psychologistEnabled(level?: TrustLevel): boolean {
  const l = level ?? getTrustLevel();
  return l >= 3;
}
