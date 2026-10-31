/**
 * 2026-10-31 (Brain recheck r19, BRAIN-C) — A SETTINGS ORDER IN THE FOLLOW-UP LOOP IS APPLIED, NOT HANDED TO THE BRAIN.
 *
 * The first turn sends an utterance through voiceCommandRouter, and an unblocked change_setting hit is applied
 * there. The caddie-tab follow-up loop (hooks/useVoiceCaddie processFollowUp) skips the router, and the brain
 * has no theme, handedness or risk-mode tool. So "switch to dark mode" said after a question changed nothing,
 * and the decline note never fired, because it only covers a precheck decline. This applies the order through
 * the same handler the first turn uses. Null for anything that is not a settings order, so it goes to the brain.
 */
import type { AppContext } from '../../types/voiceIntent';
import { precheckLocalIntent } from '../localIntentPrecheck';
import { changeSettingHandler } from '../intents/changeSettingHandler';

export async function followUpSettingLine(utterance: string): Promise<string | null> {
  const hit = precheckLocalIntent(utterance);
  if (hit?.intent_type !== 'change_setting') return null;
  // changeSettingHandler.execute takes the router's context and reads none of it, so the follow-up
  // loop, which has no router context in scope, passes none.
  const result = await changeSettingHandler.execute(hit, undefined as unknown as AppContext);
  return result.voice_response ?? null;
}
