export interface EvidenceEntry {
  source: string;
  detail: string;
  confidence?: number;
}

export function buildEvidenceStack(entries: EvidenceEntry[]): string[] {
  return entries
    .filter((e) => e.source.trim().length > 0 && e.detail.trim().length > 0)
    .map((e) => {
      const conf = typeof e.confidence === 'number'
        ? ` (${Math.max(0, Math.min(100, Math.round(e.confidence)))}%)`
        : '';
      return `${e.source}: ${e.detail}${conf}`;
    });
}

export function confidenceNote(confidence: number): string {
  if (confidence >= 80) return 'High confidence from multiple strong signals.';
  if (confidence >= 60) return 'Moderate confidence; recommendation is grounded but not absolute.';
  if (confidence >= 45) return 'Limited confidence; use this as a conservative starting point.';
  return 'Low confidence; ask for one more data point before committing.';
}

export function clarifyingQuestion(confidence: number): string | null {
  if (confidence >= 45) return null;
  return 'Can you confirm lie and exact yardage from your rangefinder so I can tighten the call?';
}
