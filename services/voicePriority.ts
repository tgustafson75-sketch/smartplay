/**
 * voicePriority.ts — Priority-based voice message selector
 *
 * Collects candidate messages, picks the highest-priority winner, applies
 * silence rules, then speaks exactly once via VoiceEngine.
 *
 * NEVER queues multiple messages. NEVER overlaps speech.
 * The VoiceEngine's own dedup/gap/lock guarantees still apply underneath.
 */

import { speakJob, PRIORITY as ENGINE_PRIORITY } from './VoiceEngine';

// ── Public priority constants (maps to VoiceEngine levels) ───────────────────
export const VOICE_PRIORITY = Object.freeze({
  INFO:     ENGINE_PRIORITY.AMBIENT,    // 1
  CONTEXT:  ENGINE_PRIORITY.STRATEGY,  // 2
  CRITICAL: ENGINE_PRIORITY.CRITICAL,  // 4
} as const);

export type VoicePriority = typeof VOICE_PRIORITY[keyof typeof VOICE_PRIORITY];

export interface VoiceMessage {
  text:     string;
  priority: VoicePriority;
}

// ── Safe-speak guard ─────────────────────────────────────────────────────────
// Tracks the last spoken message per speak-group so repeated calls are silenced.
const _lastSpoken = new Map<string, { text: string; ts: number }>();

/**
 * Returns true if this message should be spoken, given the guard rules.
 * @param text     The candidate message text.
 * @param groupKey Optional key to scope dedup (e.g. 'rangebook', 'hole-advice'). Defaults to 'global'.
 * @param force    When true, bypass silence rules (e.g. explicit user tap).
 */
export function shouldSpeak(text: string, groupKey = 'global', force = false): boolean {
  if (!text) return false;
  if (force)  return true;
  const rec = _lastSpoken.get(groupKey);
  if (!rec) return true;
  if (rec.text === text) return false;         // duplicate message
  if (Date.now() - rec.ts < 10_000) return false; // within 10 s cooldown
  return true;
}

// ── Core selectors ────────────────────────────────────────────────────────────

/**
 * Picks the single highest-priority message from an array of candidates.
 * Ties are resolved by first-in (stable).
 */
export function selectMessage(messages: VoiceMessage[]): VoiceMessage | null {
  if (!messages || messages.length === 0) return null;
  return messages.reduce<VoiceMessage>((best, cur) =>
    cur.priority > best.priority ? cur : best,
    messages[0],
  );
}

/**
 * Select the winner, apply silence rules, speak once, then clear the list.
 *
 * @param messages  Candidate pool — mutated in-place (cleared after call).
 * @param groupKey  Scope key for the should-speak dedup guard.
 * @param force     Bypass silence rules.
 * @param gender    Voice gender forwarded to VoiceEngine.
 * @returns         The text that was spoken, or null if silenced.
 */
export async function selectAndSpeak(
  messages: VoiceMessage[],
  groupKey  = 'global',
  force     = false,
  gender?: string | null,
): Promise<string | null> {
  const winner = selectMessage(messages);

  // Clear immediately — regardless of whether we speak
  messages.length = 0;

  if (!winner) return null;
  if (!shouldSpeak(winner.text, groupKey, force)) return null;

  // Record before speak so concurrent calls see it instantly
  _lastSpoken.set(groupKey, { text: winner.text, ts: Date.now() });

  try {
    await speakJob(winner.text, winner.priority, gender ?? null);
  } catch {
    // VoiceEngine errors are always silent — engine resets itself
  }

  return winner.text;
}

/**
 * Convenience: speak a single message with priority check (no array needed).
 * Use this when you have exactly one candidate and want the silence rules applied.
 */
export async function safeSpeak(
  text:     string,
  priority: VoicePriority = VOICE_PRIORITY.INFO,
  groupKey  = 'global',
  force     = false,
  gender?: string | null,
): Promise<void> {
  await selectAndSpeak([{ text, priority }], groupKey, force, gender);
}
