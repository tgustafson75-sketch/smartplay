/**
 * 2026-09-29 (Tim — "check recent shots card on Dashboard tab. It's full of ? and I don't think it's
 * wired correctly.")
 *
 * `roundStore.shots` has eleven writers and not all of them write shots. The scorecard's quick-score
 * writes one blank PLACEHOLDER row per stroke (`qs-<hole>-<i>`, club/direction/distance null), and
 * the card drew every one as a "?" icon with two dashes; addPenalty writes a club-less penalty STROKE;
 * the cockpit quick taps write club-less rows whose one fact (a direction, "short of target") the card
 * never drew. The caddie read the same rows raw ("club ?"), and off the course read nothing while the
 * card showed the last round.
 *
 * These drive the REAL functions over one record from each writer, shaped exactly as that writer
 * builds it (file cited on each), and the real caddie payload builder over the real store.
 */
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useRoundStore, type ShotResult } from '../../store/roundStore';
import {
  recentShotFacts, recordedShots, recentShotsView, recentShotsForCaddie, recentShotDistanceYards,
} from '../../services/round/recentShots';

const T = 1_780_000_000_000;
const base = { feel: null, direction: null, shape: null, club: null, acousticContact: null } as const;

// app/(tabs)/scorecard.tsx handleQuickScore — one per stroke, nothing known.
const quickScore = (hole: number, i: number): ShotResult => ({
  ...base, id: `qs-${hole}-${i}`, hole, timestamp: T, outcome: 'clean', penalty_strokes: 0, rules_decision: undefined,
});
// store/roundStore.ts addPenalty — a stroke, not a swing.
const penaltyStroke: ShotResult = {
  ...base, id: 'pen1', hole: 2, timestamp: T, outcome: 'manual_penalty', penalty_strokes: 1, rules_decision: undefined,
};
// components/caddie/CockpitCaddieScreen.tsx handleLogDirection / handleLogDistance.
const cockpitDirection: ShotResult = { ...base, id: 'c1', hole: 3, timestamp: T + 1, direction: 'left' };
const cockpitDistance: ShotResult = { ...base, id: 'c2', hole: 3, timestamp: T + 2, outcome_text: 'short of target' };
// services/intents/logShotHandler.ts — canonical club, said distance, outcome 'clean' by default.
const voiceIntent: ShotResult = {
  ...base, id: 'v1', hole: 4, timestamp: T + 3, club: '7I', distance_yards: 152, outcome: 'clean', logged_via: 'voice',
};
// app/(tabs)/caddie.tsx / conversationalToolDispatch brain log_shot — raw ClubId, free text.
const brainShot: ShotResult = {
  ...base, id: 'b1', hole: 5, timestamp: T + 4, club: 'DR', direction: 'right', outcome_text: 'in the trees', logged_via: 'voice',
};
// services/conversationalLoggingOrchestrator.ts logUntagged — club-less, distance only after back-fill.
const untaggedPending: ShotResult = {
  ...base, id: 'auto-untagged-1', hole: 6, timestamp: T + 5,
  start_location: { lat: 33.7, lng: -117.2 }, end_location: null,
};
const untaggedBackfilled: ShotResult = {
  ...untaggedPending, id: 'auto-untagged-2', end_location: { lat: 33.7022, lng: -117.2 }, gps_distance_yards: 241, distance_yards: 241,
};
// A tracked row whose end was recorded but no distance ever stamped (older data).
const endOnly: ShotResult = {
  ...base, id: 'track-1', hole: 7, timestamp: T + 6, club: 'Driver',
  start_location: { lat: 33.7, lng: -117.2 }, end_location: { lat: 33.7022, lng: -117.2 },
};

describe('which rows are shots', () => {
  it('a quick-score placeholder is never a shot — it has no fact to show', () => {
    expect(recentShotFacts(quickScore(1, 0))).toBeNull();
    expect(recordedShots([quickScore(1, 0), quickScore(1, 1), quickScore(1, 2)])).toEqual([]);
  });

  it('a penalty stroke is not a swing', () => {
    expect(recentShotFacts(penaltyStroke)).toBeNull();
  });

  it('a club-less quick tap IS a shot, and its one fact survives', () => {
    expect(recentShotFacts(cockpitDirection)).toMatchObject({ club: null, clubAsLogged: null, direction: 'left', distanceYards: null });
    expect(recentShotFacts(cockpitDistance)).toMatchObject({ club: null, outcomeText: 'short of target' });
  });

  it('an untagged GPS shot waits for its distance, then shows it', () => {
    expect(recentShotFacts(untaggedPending)).toBeNull();
    expect(recentShotFacts(untaggedBackfilled)).toMatchObject({ club: null, distanceYards: 241 });
  });

  it('the club is read in the ONE vocabulary, whichever writer spelled it', () => {
    expect(recentShotFacts(voiceIntent)!.club).toBe('7I');
    expect(recentShotFacts(brainShot)!.club).toBe('Driver');
    expect(recentShotFacts({ ...brainShot, club: 'seven iron' })!.club).toBe('7I');
    expect(recentShotFacts({ ...brainShot, club: 'unknown' })!.club).toBeNull();
  });

  it("'clean' is not reported as a result — it means no penalty logged, not a good shot", () => {
    expect(recentShotFacts(voiceIntent)!.outcome).toBeNull();
    expect(recentShotFacts({ ...voiceIntent, outcome: 'water' })!.outcome).toBe('water');
  });
});

describe('distance comes from the data that exists', () => {
  it('said → GPS back-fill → start/end locations, and nothing when none', () => {
    expect(recentShotDistanceYards(voiceIntent)).toBe(152);
    expect(recentShotDistanceYards({ ...cockpitDirection, gps_distance_yards: 188 })).toBe(188);
    const derived = recentShotDistanceYards(endOnly);
    expect(derived).toBeGreaterThan(260); // 0.0022° of latitude ≈ 268 yards
    expect(derived).toBeLessThan(275);
    expect(recentShotDistanceYards(cockpitDirection)).toBeNull();
  });

  it('a corrupt capture is not a distance', () => {
    expect(recentShotDistanceYards({ ...voiceIntent, distance_yards: 900 })).toBeNull();
    expect(recentShotDistanceYards({ ...voiceIntent, distance_yards: 0 })).toBeNull();
  });
});

describe('which round is "recent"', () => {
  const played = { courseName: 'Palms', endedAt: T - 86_400_000, shots: [voiceIntent, brainShot] };
  // services roundStore.addImportedRound — appended AFTER, in import order, with no shots.
  const imported = { courseName: 'Old card', endedAt: T - 200 * 86_400_000, shots: [] as ShotResult[] };
  const sim = { courseName: 'Sim', endedAt: T, shots: [voiceIntent], simulated: true };

  it('a round of quick scores in progress does not hide the last real shots behind "?" rows', () => {
    const v = recentShotsView({ liveShots: [quickScore(1, 0), quickScore(1, 1)], rounds: [played] });
    expect(v.source).toBe('last_round');
    expect(v.shots.map(s => s.id)).toEqual(['v1', 'b1']);
  });

  it('the last round is the newest by date, not the last one appended (an import)', () => {
    const v = recentShotsView({ liveShots: [], rounds: [played, imported] });
    expect(v.source).toBe('last_round');
    expect(v.courseName).toBe('Palms');
  });

  it('a finished sim round is never "your recent shots"', () => {
    expect(recentShotsView({ liveShots: [], rounds: [sim] }).source).toBe('none');
  });

  it('a live round with recorded shots is THIS round, sim flagged as sim', () => {
    expect(recentShotsView({ liveShots: [quickScore(1, 0), cockpitDirection], rounds: [played] }))
      .toMatchObject({ source: 'this_round', simulated: false, shots: [cockpitDirection] });
    expect(recentShotsView({ liveShots: [voiceIntent], isSimRound: true, rounds: [] }).simulated).toBe(true);
  });

  it('only placeholders anywhere → empty, and it knows rows existed (so the card can say why)', () => {
    const v = recentShotsView({ liveShots: [], rounds: [{ courseName: 'X', endedAt: T, shots: [quickScore(1, 0)] }] });
    expect(v).toMatchObject({ source: 'none', shots: [], hasQuickScoredHoles: true });
    expect(recentShotsView({ liveShots: [], rounds: [] }).hasQuickScoredHoles).toBe(false);
    // a penalty stroke or a GPS shot still waiting for its distance is not "scored by total"
    expect(recentShotsView({ liveShots: [penaltyStroke, untaggedPending], rounds: [] }).hasQuickScoredHoles).toBe(false);
  });
});

describe('the caddie is sent the same shots the card draws', () => {
  afterEach(() => useRoundStore.setState({ shots: [], roundHistory: [], isSimRound: false } as never));

  it('recentShots carries no placeholder and no "?" — real club, real distance', () => {
    useRoundStore.setState({
      shots: [voiceIntent, quickScore(5, 0), quickScore(5, 1), quickScore(5, 2), quickScore(5, 3), quickScore(5, 4)],
      roundHistory: [],
    } as never);
    const body = buildCaddieRequestBody({ message: 'what have I been hitting', language: 'en' });
    expect(body.recentShots).toEqual(recentShotsForCaddie([voiceIntent]));
    expect(body.recentShots).toEqual([expect.objectContaining({ hole: 4, club: '7I', distance_yards: 152 })]);
    expect(body.lastRoundShots).toBeNull();
  });

  it('off the course it can answer from the last round — the card\'s list, labelled as the last round', () => {
    useRoundStore.setState({
      shots: [],
      roundHistory: [{ id: 'r1', courseName: 'Palms', endedAt: Date.now() - 2 * 86_400_000, shots: [voiceIntent, quickScore(9, 0), brainShot] }],
    } as never);
    const body = buildCaddieRequestBody({ message: 'what did I hit last round', language: 'en' });
    expect(body.recentShots).toEqual([]);
    expect(body.lastRoundShots).toMatchObject({ course: 'Palms', daysAgo: 2 });
    expect((body.lastRoundShots as { shots: unknown[] }).shots).toEqual([
      expect.objectContaining({ hole: 4, club: '7I', distance_yards: 152 }),
      expect.objectContaining({ hole: 5, club: 'Driver', direction: 'right', outcomeText: 'in the trees' }),
    ]);
  });

  it('holeShots on the current hole skips the placeholders too', () => {
    useRoundStore.setState({ shots: [quickScore(3, 0), cockpitDirection], currentHole: 3, roundHistory: [] } as never);
    const hs = buildCaddieRequestBody({ message: 'x', language: 'en' }).holeShots as unknown[];
    expect(hs).toHaveLength(1);
    expect(hs[0]).toMatchObject({ direction: 'left' });
  });
});
