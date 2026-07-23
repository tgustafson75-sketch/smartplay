/**
 * Course Cloud merge rule (api/_courseCloud.chooseBestReport) — the correctness-critical
 * step: from many contributors' reports for one hole, which coords become canonical.
 * A wrong winner = wrong geometry served to every future player, so this is worth pinning.
 */
import { chooseBestReport, bucketConfidence } from '../../api/_courseCloud';

describe('chooseBestReport — source rank dominates', () => {
  it('prefers a curated/bundled source over a higher-confidence AI-vision guess', () => {
    const best = chooseBestReport([
      { source: 'ai_vision', confidence: 0.95, created_at: '2026-07-23T10:00:00Z' },
      { source: 'bundled', confidence: 0.5, created_at: '2026-07-20T10:00:00Z' },
    ]);
    expect(best?.source).toBe('bundled');
  });

  it('ranks osm and user_walk above ai_vision', () => {
    expect(chooseBestReport([
      { source: 'ai_vision', confidence: 0.9 },
      { source: 'osm', confidence: 0.4 },
    ])?.source).toBe('osm');
    expect(chooseBestReport([
      { source: 'ai_vision', confidence: 0.9 },
      { source: 'user_walk', confidence: 0.4 },
    ])?.source).toBe('user_walk');
  });
});

describe('chooseBestReport — tie-breaks within the same source', () => {
  it('higher confidence wins when source is equal', () => {
    const best = chooseBestReport([
      { source: 'ai_vision', confidence: 0.4, created_at: '2026-07-23T10:00:00Z' },
      { source: 'ai_vision', confidence: 0.8, created_at: '2026-07-01T10:00:00Z' },
    ]);
    expect(best?.confidence).toBe(0.8);
  });

  it('most recent wins when source and confidence are equal', () => {
    const best = chooseBestReport([
      { source: 'ai_vision', confidence: 0.6, created_at: '2026-07-01T10:00:00Z' },
      { source: 'ai_vision', confidence: 0.6, created_at: '2026-07-23T10:00:00Z' },
    ]);
    expect(best?.created_at).toBe('2026-07-23T10:00:00Z');
  });
});

describe('chooseBestReport — edges', () => {
  it('returns null on empty input', () => {
    expect(chooseBestReport([])).toBeNull();
  });
  it('treats an unknown source as lowest rank', () => {
    const best = chooseBestReport([
      { source: 'mystery', confidence: 0.99 },
      { source: 'ai_vision', confidence: 0.1 },
    ]);
    expect(best?.source).toBe('ai_vision');
  });
});

describe('bucketConfidence', () => {
  it('buckets high/medium/low at 0.75 and 0.5 thresholds', () => {
    expect(bucketConfidence(0.9)).toBe('high');
    expect(bucketConfidence(0.75)).toBe('high');
    expect(bucketConfidence(0.6)).toBe('medium');
    expect(bucketConfidence(0.5)).toBe('medium');
    expect(bucketConfidence(0.49)).toBe('low');
    expect(bucketConfidence(0)).toBe('low');
  });
});
