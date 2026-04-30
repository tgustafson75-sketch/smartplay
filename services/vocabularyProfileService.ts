import type { ParsedShotRecord } from '../types/parsedShot';
import { useVocabularyProfileStore } from '../store/vocabularyProfileStore';

export function signatureFor(p: ParsedShotRecord): string {
  return [p.club ?? '-', p.direction ?? '-', p.outcome ?? '-', p.distance ?? '-'].join('|');
}

export function recordParsedShot(parsed: ParsedShotRecord): void {
  if (!parsed.raw_utterance) return;
  if (parsed.confidence === 'low') return;
  useVocabularyProfileStore.getState().recordPhrase(parsed.raw_utterance, signatureFor(parsed));
}

export function recordCorrection(phrase: string): void {
  useVocabularyProfileStore.getState().recordCorrection(phrase);
}

export function getRecentUserPhrases(limit = 20): string[] {
  return useVocabularyProfileStore.getState().getTopPhrases(limit);
}

export function getTotalShotsParsed(): number {
  return useVocabularyProfileStore.getState().totalShotsParsed;
}
