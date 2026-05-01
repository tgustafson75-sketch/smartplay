import { useVoiceHintsStore } from '../store/voiceHintsStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { isVoiceSuppressed } from './voicePermissionService';

/**
 * Hint copy lives here so future Trust Spectrum levels (Phase E) can override
 * per-level without rewriting the consumer sites.
 */
const HINTS = {
  first_tee:  "Tap me or just talk — what mode are you playing today?",
  first_shot: "What'd you hit? Voice or tap, your call.",
  first_tool: "You can also just say 'open SmartFinder' next time.",
};

/**
 * The user is in their first round when relationshipStore.roundsTogether is 0
 * AND they're currently mid-round. This is the "highest leverage" window for
 * voice introduction per the Phase A.4 spec.
 */
function isFirstRoundUser(): boolean {
  return useRelationshipStore.getState().roundsTogether === 0;
}

/** First-tee hint: returns the line if not yet shown AND user is in first round. */
export function getFirstTeeHint(): string | null {
  if (isVoiceSuppressed()) return null;
  if (!isFirstRoundUser()) return null;
  if (useVoiceHintsStore.getState().first_tee_shown) return null;
  useVoiceHintsStore.getState().markFirstTeeShown();
  return HINTS.first_tee;
}

/** Picks the first-shot prompt: hint version on the very first detected shot,
 *  normal phrasing thereafter. */
export function getFirstShotPrompt(defaultPrompt: string): string {
  if (isVoiceSuppressed()) return defaultPrompt;
  if (!isFirstRoundUser()) return defaultPrompt;
  if (useVoiceHintsStore.getState().first_shot_shown) return defaultPrompt;
  useVoiceHintsStore.getState().markFirstShotShown();
  return HINTS.first_shot;
}

/** First-tool-launch hint: returns the line if applicable, null otherwise. */
export function getFirstToolHint(): string | null {
  if (isVoiceSuppressed()) return null;
  if (!isFirstRoundUser()) return null;
  if (useVoiceHintsStore.getState().first_tool_shown) return null;
  useVoiceHintsStore.getState().markFirstToolShown();
  return HINTS.first_tool;
}

/**
 * Vocabulary profile banner trigger. Returns true exactly once: when the
 * user crosses the configurable threshold of voice-logged shots and the banner
 * has not been shown yet. Subsequent calls return false until reset.
 */
export function shouldShowVocabBanner(): boolean {
  const s = useVoiceHintsStore.getState();
  if (s.vocab_banner_shown) return false;
  if (s.voice_logged_shot_count < s.vocab_banner_threshold) return false;
  return true;
}

export function getVocabBannerCount(): number {
  return useVoiceHintsStore.getState().voice_logged_shot_count;
}

export function markVocabBannerSeen(): void {
  useVoiceHintsStore.getState().markVocabBannerShown();
}

/**
 * Called by the conversational orchestrator on each successful voice-logged
 * shot. Drives the vocab banner threshold trigger.
 */
export function recordVoiceLoggedShot(): void {
  useVoiceHintsStore.getState().incrementVoiceShotCount();
}
