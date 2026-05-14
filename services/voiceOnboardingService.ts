import { useVoiceHintsStore } from '../store/voiceHintsStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { isVoiceSuppressed } from './voicePermissionService';
import { getTrustLevel } from './trustLevelService';
import type { TrustLevel } from '../store/trustLevelStore';

/**
 * Hint copy keyed by Trust Spectrum level (Phase E). The consumer functions
 * (getFirstTeeHint / getFirstShotPrompt / getFirstToolHint) call into this map
 * with the current level — adding a new level or tuning copy is a single-file
 * edit.
 *
 * L1 Quiet: hints null. The user picked silence; respect it.
 * L2 Companion: standard hints (this is the original copy).
 * L3 Active: more proactive framing.
 * L4 Full: full-engagement framing.
 */
const HINTS_BY_LEVEL: Record<TrustLevel, {
  first_tee: string | null;
  first_shot: string | null;
  first_tool: string | null;
}> = {
  1: {
    first_tee:  null,
    first_shot: null,
    first_tool: null,
  },
  2: {
    first_tee:  "Tap me or just talk — what mode are you playing today?",
    first_shot: "What'd you hit? Voice or tap, your call.",
    first_tool: "You can also just say 'open SmartFinder' next time.",
  },
  3: {
    first_tee:  "I'll let you know what I notice as we go. What mode are you playing?",
    first_shot: "Talk to me about that one — I'll be chiming in along the way.",
    first_tool: "Just say 'open SmartFinder' anytime. I'll listen for it.",
  },
  4: {
    first_tee:  "I'm right here. Talk to me anytime — what mode are you playing?",
    first_shot: "Tell me about that shot — I'm listening.",
    first_tool: "Just say what you need. I've got you.",
  },
  // L5 Cockpit — minimal surface, tools-first; no proactive hints. The
  // Cockpit screen has its own AskCaddieButton + manual entry affordances.
  5: {
    first_tee:  null,
    first_shot: null,
    first_tool: null,
  },
};

function hintsForCurrentLevel() {
  return HINTS_BY_LEVEL[getTrustLevel()];
}

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
  const hint = hintsForCurrentLevel().first_tee;
  if (hint) useVoiceHintsStore.getState().markFirstTeeShown();
  return hint;
}

/** Picks the first-shot prompt: hint version on the very first detected shot,
 *  normal phrasing thereafter. */
export function getFirstShotPrompt(defaultPrompt: string): string {
  if (isVoiceSuppressed()) return defaultPrompt;
  if (!isFirstRoundUser()) return defaultPrompt;
  if (useVoiceHintsStore.getState().first_shot_shown) return defaultPrompt;
  const hint = hintsForCurrentLevel().first_shot;
  if (!hint) return defaultPrompt;
  useVoiceHintsStore.getState().markFirstShotShown();
  return hint;
}

/** First-tool-launch hint: returns the line if applicable, null otherwise. */
export function getFirstToolHint(): string | null {
  if (isVoiceSuppressed()) return null;
  if (!isFirstRoundUser()) return null;
  if (useVoiceHintsStore.getState().first_tool_shown) return null;
  const hint = hintsForCurrentLevel().first_tool;
  if (hint) useVoiceHintsStore.getState().markFirstToolShown();
  return hint;
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
