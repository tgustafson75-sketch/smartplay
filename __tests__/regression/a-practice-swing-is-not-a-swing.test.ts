/**
 * 2026-10-17 — Tim at the range, SmartMotion live capture: "It's counting the practice swings sometimes
 * as a swing." Field traces: captures of swings=2/3, every arc anchor `heard=false`.
 *
 * The range locator reads frames ~2.5s apart, and a practice swing looks like a swing in them. What a
 * practice swing never has is a strike. These run the real range fusion (correlateStrikesWithVideo) and
 * then the practice rule (splitPracticeSwings) on the shape of Tim's captures.
 */
import fs from 'fs';
import path from 'path';
import {
  correlateStrikesWithVideo, filterReboundStrikes, splitPracticeSwings, PRACTICE_STRIKE_NEAR_MS,
} from '../../services/swing/swingSegmentation';
import type { DetectedStrike } from '../../services/swing/strikeDetector';

const strike = (timeMs: number, confidence: DetectedStrike['confidence'] = 'high'): DetectedStrike => ({ timeMs, peakDb: -12, attackMs: 8, confidence });
const DUR = 60_000;

describe('a practice swing in a capture where the mic hears the player is not counted', () => {
  // Practice swing at 8.0s (nothing struck), the real swing at 16.5s by the locator whose strike was heard
  // at 17.3s (0.8s off: beyond the 600ms match, inside the locator's own error), a second real swing at
  // 30.0s heard at 30.2s.
  const video = [{ timeSec: 8.0, confidence: 'high' as const }, { timeSec: 16.5, confidence: 'high' as const }, { timeSec: 30.0, confidence: 'low' as const }];
  const strikes = filterReboundStrikes([strike(17_300), strike(30_200, 'medium')]);
  const fused = correlateStrikesWithVideo(strikes, video, DUR, { recoverUnmatchedHighConf: true });

  it('the fusion alone counts the practice swing (the defect)', () => {
    expect(fused).toHaveLength(3);
  });

  it('the practice swing is split out; both real swings stay, renumbered', () => {
    const { swings, practice } = splitPracticeSwings(fused, strikes, video);
    expect(practice.map((p) => p.strikeMs)).toEqual([8000]);
    expect(swings.map((s) => s.index)).toEqual([1, 2]);
    // the real swing whose strike missed the 600ms match is still heard here, and stays
    expect(swings.some((s) => s.strikeMs === 16_500)).toBe(true);
    expect(swings.some((s) => s.strikeMs === 30_200)).toBe(true);
  });

  it("the real swing's window stops short of the practice swing", () => {
    const { swings } = splitPracticeSwings(fused, strikes, video);
    const real = swings.find((s) => s.strikeMs === 16_500)!;
    expect(real.startMs).toBeGreaterThan(8000);
  });
});

describe('conservative: never drops what the mic could not rule out', () => {
  const video = [{ timeSec: 8.0, confidence: 'high' as const }, { timeSec: 16.5, confidence: 'high' as const }];

  it('nothing heard at all (foam balls, metering off): every swing is kept', () => {
    const fused = correlateStrikesWithVideo([], video, DUR);
    expect(splitPracticeSwings(fused, [], video).swings).toHaveLength(2);
  });

  it('only a LOW-confidence strike near a swing proves nothing about this player: every swing is kept', () => {
    const strikes = [strike(16_600, 'low')];
    const fused = correlateStrikesWithVideo(strikes, video, DUR);
    expect(splitPracticeSwings(fused, strikes, video).practice).toEqual([]);
  });

  it("a neighbour's loud strike far from every camera swing (recovered as its own swing) is not proof", () => {
    const strikes = [strike(45_000)];
    const fused = correlateStrikesWithVideo(strikes, video, DUR, { recoverUnmatchedHighConf: true });
    expect(fused).toHaveLength(3);
    expect(splitPracticeSwings(fused, strikes, video).practice).toEqual([]);
  });

  it('a heard swing is never a practice swing', () => {
    const strikes = [strike(8_100), strike(16_400)];
    const fused = correlateStrikesWithVideo(strikes, video, DUR);
    expect(splitPracticeSwings(fused, strikes, video).practice).toEqual([]);
  });

  it('a strike of any confidence within the locator error keeps that swing', () => {
    const strikes = [strike(16_500), strike(8_000 + PRACTICE_STRIKE_NEAR_MS - 50, 'low')];
    const fused = correlateStrikesWithVideo(strikes, video, DUR);
    expect(splitPracticeSwings(fused, strikes, video).practice).toEqual([]);
  });

  it('a capture never empties', () => {
    const strikes = [strike(16_500)];
    const fused = correlateStrikesWithVideo(strikes, [{ timeSec: 16.5, confidence: 'high' }], DUR);
    expect(splitPracticeSwings(fused, strikes, [{ timeSec: 16.5 }]).swings).toHaveLength(1);
  });
});

describe('both SmartMotion branches that add camera swings apply the rule', () => {
  // Source check, secondary to the behaviour above: the screen is a 7,000-line component with no harness.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app/swinglab/smartmotion.tsx'), 'utf8');
  it('range fusion and the cage video fallback both go through withoutPracticeSwings', () => {
    expect(src).toMatch(/segsForAnalysis = withoutPracticeSwings\(segsForAnalysis, filterReboundStrikes\(acousticStrikes\), swings\);/);
    expect(src).toMatch(/const fused = withoutPracticeSwings\(acousticStrikes\.length > 0/);
  });
});
