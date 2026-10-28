/**
 * 2026-10-27 (Brain review B12) — THE ANSWER TO A CLARIFYING QUESTION IS PART OF THE TURN.
 *
 * When the router asks a clarifying question ("Want me to open that? Just say it again") and the
 * player's answer is not itself a command, the turn falls through to the caddie. It used to fall
 * through with only the ORIGINAL words, and the answer was never recorded, so Kevin answered the
 * question the player had already narrowed or corrected ("watch my swing" → "Want me to open
 * that?" → "no, I mean how did my last one look").
 *
 * This records the answer as the player's turn and returns what the caddie is asked: both halves.
 * Returns null when nothing usable was said (the caller ends the loop).
 */
import { recordUserTurn } from '../conversationState';

export function answerToClarification(original: string, answer: string | null | undefined): string | null {
  const said = (answer ?? '').trim();
  if (!said) return null;
  recordUserTurn(said);
  const asked = original.trim();
  return asked ? `${asked} — ${said}` : said;
}
