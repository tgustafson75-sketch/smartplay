/**
 * Psychologist role — cross-round, observational, regulation.
 *
 * The Psychologist layer operates on the arc of a season, the player's relationship
 * with the game. Reads internal state from routine, tempo, score context, recent
 * shot quality. Intervenes before the player notices they need it. The walking
 * conversation between shots is the psychologist register at work — keeping the
 * player's nervous system in the right zone.
 *
 * Psychologist surfaces are minimal today and grow over time. The relationship
 * engine and proactive-Kevin orchestrator are the two existing surfaces that
 * already operate in this register. Filler library is the rhythmic dimension.
 *
 * No functional impact on the running app.
 */

export {
  shouldFireProactive,
  markProactiveFired,
  resetProactiveState,
} from '../proactiveKevin';
export type { ProactiveTrigger, ProactiveTriggerType } from '../proactiveKevin';
export { relationshipEngine } from '../relationshipEngine';
export {
  initFillerLibrary,
  isLibraryGenerated,
  getClipForCategory,
  classifyQuery,
} from '../fillerLibrary';

export const PSYCHOLOGIST_ROLE_ID = 'psychologist' as const;
