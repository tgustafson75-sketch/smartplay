/**
 * 2026-10-31 (Brain recheck r21, BRAIN-R21-2) — DOES THE ROUTER OWN THIS TURN? One test, used by the first turn and by
 * the caddie-tab follow-up loop: a hit is spoken and acted on, anything else goes to the brain.
 */
import type { IntentResult, VoiceIntent } from '../../types/voiceIntent';

/** Open actions that take the screen, so they need a high-confidence match before they fire from the classifier. */
const DISRUPTIVE_OPEN_ACTIONS = new Set([
  'record_swing', 'open_smartvision', 'open_smartfinder', 'open_swinglab',
  'navigate', 'configure_drill', 'set_angle', 'close_swinglab',
]);

export function routedCommandHit(intent: VoiceIntent, result: IntentResult): boolean {
  const actionType = result.tool_action?.type;
  const isDisruptiveOpen = typeof actionType === 'string' && DISRUPTIVE_OPEN_ACTIONS.has(actionType);
  const openGatePassed = !isDisruptiveOpen || intent.confidence === 'high';
  return intent.intent_type !== 'unknown' &&
    intent.intent_type !== 'conversational' &&
    intent.intent_type !== 'social_greeting' &&
    intent.confidence !== 'low' &&
    openGatePassed &&
    (result.success || !!result.follow_up_needed);
}
