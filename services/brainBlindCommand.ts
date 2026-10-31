/**
 * 2026-10-31 (Brain recheck r20, BRAIN-R20-3) — A COMMAND THE BRAIN CANNOT CARRY IS NOT AN ANSWER.
 *
 * When the caddie has just asked a question, the next utterance is routed straight to the brain as prose
 * (conversational), so "send it home" after "lay up or send it home?" cannot become navigate-home (2026-05-16).
 * That bypass is right for answers. It is wrong for a command the brain has NO tool for: "I had three putts",
 * "undo that", "end the round" were said to the brain, which answered in prose, and nothing reached the card.
 * api/_brainTools has no putts, undo, end-round, correction, club-removal or ball tool.
 *
 * So on an answering turn these commands are routed like any other command (the router, then the classifier),
 * and only conversational answers keep the bypass. The set is the router-only write intents; a yardage correction
 * already has its own carve-out (carriesYardageCorrection).
 */
import { precheckLocalIntent } from './localIntentPrecheck';

const BRAIN_BLIND_INTENTS = new Set<string>([
  'log_putts', 'undo', 'end_round', 'correct_last_shot', 'remove_club', 'set_ball', 'quick_round',
  'set_club_distance', 'set_club_variant',
]);

/** "I had three putts", "took 2 putts", "three putts on that one". A count said as a fact is a write. */
const PUTT_COUNT_RX = /\b(?:i\s+)?(?:had|took|got|needed|did|made)\s+(?:\d{1,2}|one|two|three|four|five|six|seven)\s+putts?\b/i;
/** "end the round", "finish this round", "wrap up my round". */
const END_ROUND_RX = /\b(?:end|finish|close|wrap\s+up)\s+(?:the|this|my)\s+round\b/i;

/**
 * 2026-10-31 (Brain recheck r22, BRAIN-AR-2) — a SETTINGS ORDER after a caddie question is a command too. The brain has no
 * theme, handedness or cart/ghost tool, so "switch to dark mode" said after "lay up or go for it?" was answered in prose and
 * nothing changed. Routed like the rest of this set (the router applies it, and the decline note reaches the brain when it
 * is not an order).
 *
 * Risk mode is the exception, and it stays an answer: "go for it" and "play it safe" are how a player answers the caddie's
 * own lay-up question (2026-10-27 B3/B4). Routing them as an order would set the posture with no club.
 */
export function isBrainBlindCommand(raw: string | null | undefined): boolean {
  const text = String(raw ?? '').trim();
  if (!text) return false;
  if (PUTT_COUNT_RX.test(text) || END_ROUND_RX.test(text)) return true;
  try {
    const hit = precheckLocalIntent(text);
    const type = hit?.intent_type;
    if (type === 'change_setting') return hit?.parameters?.setting_name !== 'risk_mode';
    return !!type && BRAIN_BLIND_INTENTS.has(type);
  } catch {
    return false;
  }
}
