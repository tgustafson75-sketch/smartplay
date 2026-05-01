import type { ParsedShotRecord } from '../types/parsedShot';
import { useVocabularyProfileStore } from '../store/vocabularyProfileStore';

/** Compact stringified signature of a parsed shot's meaning — used to detect when a phrase
 *  is being remapped to a different meaning (potential correction signal). */
export function signatureFor(p: ParsedShotRecord): string {
  return [p.club ?? '-', p.direction ?? '-', p.outcome ?? '-', p.distance ?? '-'].join('|');
}

/** Record a parsed utterance into the user's vocabulary profile. Skipped when confidence is low
 *  or the utterance is empty — we only learn from phrases the parser was confident about. */
export function recordParsedShot(parsed: ParsedShotRecord): void {
  if (!parsed.raw_utterance) return;
  if (parsed.confidence === 'low') return;
  useVocabularyProfileStore.getState().recordPhrase(parsed.raw_utterance, signatureFor(parsed));
}

/** Mark a phrase as having been corrected by the user. Reduces its weight so future
 *  parses don't repeat the wrong mapping. */
export function recordCorrection(phrase: string): void {
  useVocabularyProfileStore.getState().recordCorrection(phrase);
}

/** Top phrases this user has said, by frequency × recency. Injected into the parse-shot
 *  system prompt so Haiku weights ambiguous phrasings toward this user's established meanings. */
export function getRecentUserPhrases(limit = 20): string[] {
  return useVocabularyProfileStore.getState().getTopPhrases(limit);
}

/** Total parsed shots accumulated across all rounds. Used to gauge vocabulary maturity
 *  (parser quality measurably improves after ~30 shots). */
export function getTotalShotsParsed(): number {
  return useVocabularyProfileStore.getState().totalShotsParsed;
}
