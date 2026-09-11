/**
 * 2026-09-10 — three from the round-lifecycle audit.
 *
 * 1. A PENALTY COUNTED TWICE. `addPenalty` logs a synthetic shot (`outcome: 'manual_penalty'`,
 *    `penalty_strokes: 1`) representing no swing, and bumps `scores[hole]` by exactly one — the
 *    correct golf answer. `computeHoleScore` counted that entry in `shots.length` AND added its
 *    penalty stroke, returning one more than the store's own score. It is the shot-card PREFILL, so
 *    the box opened a stroke high and a tap wrote it into the Index.
 *
 * 2. `roundStore.penalties` HAD NO WRITER. addPenalty stopped writing it deliberately and nothing
 *    migrated the read, so the caddie was told zero penalties in every request and every saved
 *    round recorded zero on every hole, permanently.
 *
 * 3. THE PLAY TAB COULD NOT START A BACK NINE. `pendingStartFactors` had no startHole, and the ref
 *    type for runStartRound was narrower than the function itself — so a back nine launched from
 *    the course-discovery screen began on hole 1, got clamped to 1..9, then converted to an
 *    18-hole round and never posted to the handicap Index.
 */
import fs from 'fs';
import path from 'path';
import { useRoundStore } from '../../store/roundStore';
import type { ShotResult } from '../../store/roundStore';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const holes = Array.from({ length: 18 }, (_, i) => ({
  hole: i + 1, par: 4, distance: 380, front: 370, back: 390,
  teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
  frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false,
}));

const swing = (hole: number, extra: Partial<ShotResult> = {}): ShotResult => ({
  id: `s${hole}-${Math.random()}`,
  feel: null, direction: null, shape: null, club: '7I',
  hole, timestamp: Date.now(), acousticContact: null, ...extra,
} as ShotResult);

describe('a penalty counts once', () => {
  beforeEach(() => {
    useRoundStore.getState().startRound('Test GC', holes as never, {} as never);
  });

  it('a penalty-only entry is a stroke, not a stroke plus a swing', () => {
    const r = useRoundStore.getState();
    r.logShot(swing(1));            // one real swing
    r.addPenalty(1);                // + one penalty stroke, no swing
    // 1 swing + 1 penalty = 2
    expect(useRoundStore.getState().computeHoleScore(1)).toBe(2);
  });

  it('agrees with the stored score when every stroke was logged', () => {
    /**
     * Only meaningful on an ALREADY-SCORED hole. On an unscored hole addPenalty deliberately writes
     * a placeholder 1 ("the real total overwrites it when the player scores the hole"), so the two
     * are intentionally different there — comparing them would assert a bug that isn't one.
     */
    const r = useRoundStore.getState();
    r.logShot(swing(3));
    r.logShot(swing(3));
    r.logScore(3, 2);               // two swings, hole scored honestly
    r.addPenalty(3);                // + a penalty stroke → stored becomes 3
    expect(useRoundStore.getState().scores[3]).toBe(3);
    expect(useRoundStore.getState().computeHoleScore(3)).toBe(3);
  });

  it('the placeholder on an UNSCORED hole is still just a placeholder', () => {
    // Documenting the intended asymmetry so the next reader does not "fix" it.
    const r = useRoundStore.getState();
    r.logShot(swing(4));
    r.addPenalty(4);
    expect(useRoundStore.getState().scores[4]).toBe(1);        // placeholder
    expect(useRoundStore.getState().computeHoleScore(4)).toBe(2); // derived truth
  });

  it('a REAL shot carrying a penalty still counts both — swing and stroke', () => {
    // Water, OB and stroke-and-distance come from rulesEngine as genuine swings WITH penalty
    // strokes. Dropping penalty_strokes from the sum would have broken these.
    const r = useRoundStore.getState();
    r.logShot(swing(5, { penalty_strokes: 1 } as Partial<ShotResult>));
    expect(useRoundStore.getState().computeHoleScore(5)).toBe(2);
  });

  it('two penalties on a hole count two, not four', () => {
    const r = useRoundStore.getState();
    r.logShot(swing(7));
    r.addPenalty(7);
    r.addPenalty(7);
    expect(useRoundStore.getState().computeHoleScore(7)).toBe(3);
  });

  it('hole stats report penalties from the shots, not the dead map', () => {
    const r = useRoundStore.getState();
    r.logShot(swing(9));
    r.addPenalty(9);
    const stats = useRoundStore.getState().getHoleStats();
    const h9 = stats.find(h => h.hole === 9);
    expect(h9?.penalties).toBe(1);
  });

  it('the dead map is no longer read for that number', () => {
    const rs = read('store/roundStore.ts');
    expect(rs).not.toMatch(/penalties: s\.penalties\[hole\] \?\? 0/);
  });
});

describe('a back nine can be started from the Play tab', () => {
  it('the handoff carries which nine', () => {
    const rs = read('store/roundStore.ts');
    const at = rs.indexOf('pendingStartFactors: {');
    expect(at).toBeGreaterThan(-1);
    expect(rs.slice(at, at + 1200)).toMatch(/startHole\?: number/);
  });

  it('the Play tab computes it from the chips, exactly as the caddie modal does', () => {
    const play = read('app/(tabs)/play.tsx');
    expect(play).toMatch(/startHole: \(setupNineHole && setupBackNine\) \? 10 : 1/);
    // and both handoffs must carry it — there are two setPendingStartFactors call sites
    const calls = play.split('setPendingStartFactors({').length - 1;
    const withStart = play.split(/startHole: \(setupNineHole && setupBackNine\)/).length - 1;
    expect(withStart).toBe(calls);
  });

  it('the consumer passes it through instead of defaulting to 1', () => {
    const caddie = read('app/(tabs)/caddie.tsx');
    expect(caddie).toMatch(/startHole: factors\?\.startHole \?\? 1/);
  });

  it('the ref type is not narrower than the function it points at', () => {
    // This is what made the bug unfixable from the call site: runStartRound accepted startHole,
    // the ref's type did not, so the handoff could not compile it even if it wanted to.
    const caddie = read('app/(tabs)/caddie.tsx');
    const at = caddie.indexOf('const runStartRoundRef = useRef<');
    expect(at).toBeGreaterThan(-1);
    expect(caddie.slice(at, at + 900)).toMatch(/startHole\?: number/);
  });

  it('the chip only appears when a nine-hole round is selected', () => {
    const play = read('app/(tabs)/play.tsx');
    expect(play).toMatch(/\{setupNineHole \? \(/);
    expect(play).toMatch(/setupBackNine \? t\('play\.play_tab\.back_9'\) : t\('play\.play_tab\.front_9'\)/);
  });
});
