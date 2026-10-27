/**
 * 2026-10-27 (SmartMotion review audit R2, R3, R4, R5, R10) — every card on the review is about the swing on
 * screen, says what it measured and what it estimated, and the way out of a failed read is always offered.
 *
 * Driven through the owners the screen calls: services/swing/smartMotionReview and
 * services/swingMetricsService.synthesizeSwingMetrics.
 */
import { synthesizeSwingMetrics, isSwingDerived } from '../../services/swingMetricsService';
import { analyzeStrike, type AcousticAnalysis } from '../../services/acousticsAnalyzer';
import {
  drillRouteFor, speedTempoCard, strikeReadForSwing, ballReadKey, offerAnalyzeAtMoment, type GradedStrike,
} from '../../services/swing/smartMotionReview';

const fmt = (y: number) => `${y} yds`;
const trans = () => 'smooth transition';

describe('R3 — the club + effort carry is an estimate, never "Speed measured"', () => {
  const noSpeed = synthesizeSwingMetrics({ club: '7i', estimatedCarryYds: 150, profile: { handicap: 12 } });

  it('the estimate is not a read of this swing (it is the same for every swing of the club)', () => {
    expect(noSpeed.carry_yards.value).toBe(150);
    expect(isSwingDerived(noSpeed.carry_yards.source)).toBe(false);
    expect(noSpeed.carry_yards.estimateNote).toBe('club + effort estimate');
  });

  it('THE REPORT: no tempo, no speed read — the card shows the estimate labelled, and does not say "Speed measured"', () => {
    const card = speedTempoCard({ tempo: null, metrics: noSpeed, formatCarry: fmt, transitionLabel: trans });
    expect(card.note).not.toMatch(/measured/i);
    expect(card.value).toBe('~150 yds');
    expect(card.note).toBe('No tempo or speed read from this swing · est. carry 150 yds (club + effort)');
  });

  it('with tempo: the carry rides along as an estimate', () => {
    const card = speedTempoCard({ tempo: { ratio: 3.04, sequencingScore: 80 }, metrics: noSpeed, formatCarry: fmt, transitionLabel: trans });
    expect(card.value).toBe('3.0:1');
    expect(card.note).toBe('Tempo · est. carry 150 yds (club + effort) · smooth transition');
  });

  it('a speed read from THIS swing is named for what it is', () => {
    const watch = synthesizeSwingMetrics({ club: '7i', measuredClubSpeedMph: 84, profile: { handicap: 12 } });
    const card = speedTempoCard({ tempo: null, metrics: watch, formatCarry: fmt, transitionLabel: trans });
    expect(card.value).toBe('84 mph');
    expect(card.note).toBe('Club speed measured; no readable tempo on this swing.');
  });

  it('nothing at all says so', () => {
    const none = synthesizeSwingMetrics({ club: null });
    expect(speedTempoCard({ tempo: null, metrics: none, formatCarry: fmt, transitionLabel: trans }))
      .toEqual({ value: null, note: 'No speed or tempo measured from this swing.' });
  });
});

describe('R2 — the CONTACT grade is the strike heard in THIS swing\'s window', () => {
  const grade = (peak: number, decay: number): AcousticAnalysis => analyzeStrike({
    reading: { impact_ms: 0, peak_db: peak, confidence: 0.9, audio_uri: null } as never,
    noise_floor_db: -60, decay_db: decay, club: '7i',
  });
  const graded: GradedStrike[] = [
    { impactMs: 2000, read: { ...grade(-8, 20), quality: 'pure' } as AcousticAnalysis },
    { impactMs: 7000, read: { ...grade(-20, 4), quality: 'bad' } as AcousticAnalysis },
  ];

  it('THE REPORT: swing 2 does not show swing 1\'s (louder) grade', () => {
    expect(strikeReadForSwing(graded, { strikeMs: 7010, startMs: 5000, endMs: 9500 })?.quality).toBe('bad');
    expect(strikeReadForSwing(graded, { strikeMs: 1990, startMs: 0, endMs: 4500 })?.quality).toBe('pure');
  });

  it('a swing with no strike heard in its window has no grade (not the set\'s loudest)', () => {
    expect(strikeReadForSwing(graded, { strikeMs: 12000, startMs: 10000, endMs: 14000 })).toBeNull();
    expect(strikeReadForSwing(graded, null)).toBeNull();
  });

  it('two strikes in one window (impact + rebound): the one nearest the swing\'s impact', () => {
    const withEcho: GradedStrike[] = [graded[0]!, { impactMs: 3200, read: { ...graded[1]!.read, quality: 'okay' } }];
    expect(strikeReadForSwing(withEcho, { strikeMs: 2010, startMs: 0, endMs: 4500 })?.quality).toBe('pure');
  });
});

describe('R4 — Drills opens the drill for the fault TOP FOCUS names', () => {
  it('THE REPORT: primary_fault leads, as it does in the headline', () => {
    expect(drillRouteFor({ primary_fault: 'early_extension', detected_issue: 'over_the_top' })).toBe('/drills/early_extension');
  });
  it('a primary fault with no drill falls to the detected issue that has one; nothing usable goes to the list', () => {
    expect(drillRouteFor({ primary_fault: 'no_dominant_fault', detected_issue: 'over_the_top' })).toBe('/drills/over_the_top');
    expect(drillRouteFor({ primary_fault: 'not_a_catalog_fault', detected_issue: 'sway' })).toBe('/drills/sway');
    expect(drillRouteFor({ primary_fault: 'inconclusive', detected_issue: 'none' })).toBe('/drills');
    expect(drillRouteFor({ primary_fault: 'not_a_catalog_fault', detected_issue: 'also_not_one' })).toBe('/drills');
    expect(drillRouteFor(null)).toBe('/drills');
  });
});

describe('R5 — a ball read is cached against the strike it was read from', () => {
  const ball = { x: 0.5, y: 0.8, r: 0.02 };
  it('THE REPORT: "Analyze the swing at" moves swing 1\'s strike — the old trace is not served', () => {
    expect(ballReadKey({ swingIndex: 0, strikeMs: 1500, ballArea: ball }))
      .not.toBe(ballReadKey({ swingIndex: 0, strikeMs: 41700, ballArea: ball }));
  });
  it('a moved ball region is a different read too; the same swing, strike and ball is a hit', () => {
    expect(ballReadKey({ swingIndex: 0, strikeMs: 1500, ballArea: ball }))
      .not.toBe(ballReadKey({ swingIndex: 0, strikeMs: 1500, ballArea: { ...ball, x: 0.3 } }));
    expect(ballReadKey({ swingIndex: 1, strikeMs: 6000, ballArea: ball }))
      .toBe(ballReadKey({ swingIndex: 1, strikeMs: 6000, ballArea: { ...ball } }));
  });
});

describe('R10 — no swing found always offers "Analyze the swing at"', () => {
  it('THE REPORT: a watch-tempo stand-in line on screen does not hide the way out', () => {
    expect(offerAnalyzeAtMoment({ noSwingFound: true, segmentCount: 1, partialLineCount: 1 })).toBe(true);
  });
  it('only for a capture with no swing found and at most one segment', () => {
    expect(offerAnalyzeAtMoment({ noSwingFound: true, segmentCount: 0, partialLineCount: 0 })).toBe(true);
    expect(offerAnalyzeAtMoment({ noSwingFound: false, segmentCount: 1, partialLineCount: 0 })).toBe(false);
    expect(offerAnalyzeAtMoment({ noSwingFound: true, segmentCount: 3, partialLineCount: 2 })).toBe(false);
  });
});

describe('R3 — the one carry stays on the tiles, flagged an estimate', () => {
  it('the club + effort carry shows, marked est', () => {
    const { carryOnScreen } = require('../../services/swing/smartMotionReview') as typeof import('../../services/swing/smartMotionReview');
    expect(carryOnScreen(synthesizeSwingMetrics({ club: '7i', estimatedCarryYds: 150 }))).toEqual({ yds: 150, estimate: true });
    expect(carryOnScreen(synthesizeSwingMetrics({ club: null }))).toBeNull();
  });
});
