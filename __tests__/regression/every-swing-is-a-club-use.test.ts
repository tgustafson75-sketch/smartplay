/**
 * 2026-09-11 — A CLUB HIT FOURTEEN TIMES ON THE COURSE RECORDED ZERO USES.
 *
 * Tim: "The which-clubs-to-carry has been weakly woven, since the shots you don't explicitly call
 * out were not being captured in round play, being inferred by user going with recommendation and
 * such. There has always seemed to be at least a partial disconnect there." And then: "club tendency
 * being derived at least partially from using a club in a drill or video. We need to capture useful
 * data from everywhere if we expect to present the user with a real Smart Play."
 *
 * He was right on both. clubStatsStore's rep tally had exactly ONE writer — app/swinglab/smartmotion,
 * the range swing screen. So:
 *
 *   a shot on the course        recorded nothing   (the club he CHOSE, under pressure)
 *   an uploaded video swing     recorded nothing
 *   a live capture session      recorded nothing
 *   a watch swing               recorded nothing
 *
 * And repsFor / bagByUsage had no readers at all, so even the range data was inert.
 *
 * The visible cost was in the moat feature: services/bagRecommendation called a club "idle" on the
 * evidence of ONE course and offered it as a swap candidate — so a club the player hits constantly
 * on the range, in drills, or at every other course was recommended out of the bag.
 */
import { useClubStatsStore } from '../../store/clubStatsStore';
import { composeBagRecommendation } from '../../services/bagRecommendation';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

beforeEach(() => useClubStatsStore.setState({ reps: {}, repsBySource: {} } as never));

describe('one owner counts a use, and remembers where it came from', () => {
  it('counts a use and keeps its source', () => {
    const s = useClubStatsStore.getState();
    s.recordClubUse('7I', 'round', 1);
    s.recordClubUse('7I', 'range', 12);
    expect(useClubStatsStore.getState().repsFor('7I')).toBe(13);
    expect(useClubStatsStore.getState().usesBySource('7I')).toEqual({ round: 1, range: 12 });
  });

  /**
   * The sources do NOT mean the same thing. A range rep says you own and swing the club; a ROUND rep
   * says you chose it under pressure. Flattening them would be fabricated precision.
   */
  it('keeps round use distinguishable from range use', () => {
    useClubStatsStore.getState().recordClubUse('5W', 'range', 20);
    expect(useClubStatsStore.getState().usesBySource('5W').round ?? 0).toBe(0);
    expect(useClubStatsStore.getState().everUsed('5W')).toBe(true);
  });

  it('refuses a nonsense count rather than corrupting the tally', () => {
    const s = useClubStatsStore.getState();
    s.recordClubUse('8I', 'round', 0);
    s.recordClubUse('8I', 'round', -3);
    s.recordClubUse('8I', 'round', Number.NaN);
    expect(useClubStatsStore.getState().repsFor('8I')).toBe(0);
    expect(useClubStatsStore.getState().everUsed('8I')).toBe(false);
  });

  it('a club never swung is honestly unused', () => {
    expect(useClubStatsStore.getState().everUsed('LW')).toBe(false);
    expect(useClubStatsStore.getState().usesBySource('LW')).toEqual({});
  });
});

describe('every source records — not just the range', () => {
  const SOURCES: [string, string, string][] = [
    ['a shot on the course', 'store/roundStore.ts', "recordClubUse(normClub, 'round', 1)"],
    ['a range swing', 'app/swinglab/smartmotion.tsx', "recordClubUse(cn, 'range'"],
    ['a watch swing', 'store/watchStore.ts', "recordClubUse(cn, 'watch', 1)"],
  ];
  it.each(SOURCES)('%s records a club use', (_label, file, needle) => {
    expect(code(file)).toContain(needle);
  });

  it('an uploaded video and a live capture both record', () => {
    const s = code('store/swingSessionStore.ts');
    expect(s).toMatch(/recordUse\(club, 'video', /);
    expect(s).toMatch(/recordUse\(club, 'range', /);
  });

  it('the swing paths record AFTER the dedupe guard, so a retried upload cannot count twice', () => {
    const s = code('store/swingSessionStore.ts');
    for (const m of [...s.matchAll(/recordUse\(club, '(video|range)'/g)]) {
      const before = s.slice(0, m.index ?? 0);
      expect(before).toMatch(/if \(existing\) \{/);
    }
  });

  it('a SIM round does not train the bag', () => {
    // Same rule that stops a sim shot setting a longest drive.
    const r = code('store/roundStore.ts');
    const at = r.indexOf("recordClubUse(normClub, 'round', 1)");
    expect(r.slice(Math.max(0, at - 400), at)).toMatch(/!s\.isSimRound/);
  });

  it('capture never fails the thing it is attached to', () => {
    // A swing must still be ingested if the club model throws.
    for (const f of ['store/swingSessionStore.ts', 'store/watchStore.ts', 'store/roundStore.ts']) {
      const src = code(f);
      const at = src.indexOf('recordClubUse');
      expect(src.slice(Math.max(0, at - 600), at + 200)).toMatch(/try \{/);
    }
  });
});

describe('idle at this course is NOT dead weight', () => {
  const base = {
    courseName: 'Test GC', roundsPlayed: 6,
    clubDistances: { Driver: 220, '7I': 140, '5W': 185, LW: 60 },
    ownedClubs: ['Driver', '7I', '5W', 'LW'],
    inferClub: () => '7I',
    shots: [
      { club: 'Driver', distance_yards: 220, hole: 1 },
      { club: '7I', distance_yards: 140, hole: 1 },
      { club: 'Driver', distance_yards: 218, hole: 2 },
      { club: '7I', distance_yards: 142, hole: 2 },
    ] as never,
  };

  it('a club used elsewhere is NOT called dead weight', () => {
    const rec = composeBagRecommendation({
      ...base,
      everUsed: (c: string) => c === '5W',   // hit constantly on the range, never here
    });
    expect(rec.idle).toEqual(expect.arrayContaining(['5W', 'LW']));
    expect(rec.deadWeight).toEqual(['LW']);
    expect(rec.idleButUsedElsewhere).toEqual(['5W']);
    expect(rec.rationale.join(' ')).toMatch(/fine to leave in the bag/);
  });

  it('a club swung NOWHERE is the dead weight', () => {
    const rec = composeBagRecommendation({ ...base, everUsed: () => false });
    expect(rec.deadWeight).toEqual(expect.arrayContaining(['5W', 'LW']));
    expect(rec.rationale.join(' ')).toMatch(/not here, not on the range, not anywhere/);
  });

  it('with NO usage lookup it calls nothing dead — an unknown is not a finding', () => {
    const rec = composeBagRecommendation(base as never);
    expect(rec.deadWeight).toEqual([]);
    expect(rec.idleButUsedElsewhere).toEqual(rec.idle);
    // and it falls back to the cautious wording it always used
    expect(rec.rationale.join(' ')).toMatch(/swap candidates/);
  });

  it('the live wrapper supplies the usage the store now collects', () => {
    expect(code('services/bagRecommendation.ts')).toMatch(/everUsed: \(club: string\) => clubStats\.everUsed\(/);
  });
});
