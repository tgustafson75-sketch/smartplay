/**
 * 2026-09-10 — "TWO PARS AND ONE BOGEY, AND IT WOULD TELL ME TO FORGET THE LAST THREE."
 *
 * That is Tim's 2026-08-10 report. `recomputeMentalState` was written for it: it DERIVES
 * `consecutiveBadHoles` from the real scorecard tail, and roundStore.logScore calls it at the single
 * seam every score path funnels through.
 *
 * `updateMentalState` did the opposite — it INCREMENTED (`s.consecutiveBadHoles + 1`). The 08-11
 * purge removed every caller and left tombstones in app/(tabs)/caddie.tsx and
 * services/intents/logScoreHandler.ts saying the job was done. It missed
 * components/caddie/CockpitCaddieScreen.tsx — the stepper Tim actually scores on.
 *
 * So every cockpit score counted its own bad hole twice: two doubles derive to 2 ('tight') and were
 * bumped to 3 ('spiraling'), one hole early, every time. The increment-based action is now gone
 * entirely rather than left in the interface for the next scoring surface to find.
 */
import fs from 'fs';
import path from 'path';
import { useRelationshipStore } from '../../store/relationshipStore';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('the mental state is derived, never incremented', () => {
  it('no surface calls an increment-based mental-state writer', () => {
    // Whole-app sweep: the 08-11 purge was declared complete and was not.
    const dirs = ['app', 'services', 'components', 'hooks', 'store'];
    const hits: string[] = [];
    const walk = (d: string) => {
      const abs = path.join(ROOT, d);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(d, e.name);
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        src.split('\n').forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*')) return;      // tombstones are allowed
          if (/\.updateMentalState\s*\(/.test(line)) hits.push(`${rel}:${i + 1}`);
        });
      }
    };
    dirs.forEach(d => walk(d));
    expect(hits).toEqual([]);
  });

  it('the increment-based action no longer exists to be re-wired', () => {
    const rel = read('store/relationshipStore.ts');
    expect(rel).not.toMatch(/^\s+updateMentalState:\s*\(holescore/m);
    // and the deprecation note has to say WHY, or the next person just adds it back
    expect(rel).toMatch(/updateMentalState[\s\S]{0,400}recomputeMentalState/);
  });

  it('recomputeMentalState SETS from the tail rather than adding to what is there', () => {
    const rel = useRelationshipStore.getState();
    useRelationshipStore.setState({ consecutiveBadHoles: 5 });
    // Two pars and a bogey: nothing here is a bad hole (bad = 2+ over).
    rel.recomputeMentalState([
      { strokes: 4, par: 4 },
      { strokes: 4, par: 4 },
      { strokes: 5, par: 4 },
    ]);
    expect(useRelationshipStore.getState().consecutiveBadHoles).toBe(0);
    expect(useRelationshipStore.getState().currentMentalState).not.toBe('spiraling');
  });

  it('two bad holes read as two, not three', () => {
    // The exact off-by-one: derive 2, increment to 3, and the caddie resets a round that is fine.
    useRelationshipStore.setState({ consecutiveBadHoles: 0 });
    useRelationshipStore.getState().recomputeMentalState([
      { strokes: 4, par: 4 },
      { strokes: 6, par: 4 },
      { strokes: 6, par: 4 },
    ]);
    expect(useRelationshipStore.getState().consecutiveBadHoles).toBe(2);
    expect(useRelationshipStore.getState().currentMentalState).not.toBe('spiraling');
  });

  it('the cockpit stepper writes the score and nothing else', () => {
    // The tombstone comment names updateMentalState on purpose — assert there is no CALL, the same
    // way the sweep above does, or the explanation of the bug trips the guard against it.
    const src = read('components/caddie/CockpitCaddieScreen.tsx');
    const calls = src.split('\n').filter(l => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*')) return false;
      return /\.updateMentalState\s*\(/.test(l);
    });
    expect(calls).toEqual([]);
    expect(src).toContain('logScore(hole, val)');
  });
});

describe('a lie read cannot survive into the next round', () => {
  it('startRound clears pendingLieAnalysis, not just its sibling', () => {
    // endRound and discardRound always did; startRound never did, and endRound is only reached by
    // an explicit tap — a phone dying in a pocket is the normal end of a round.
    const rs = read('store/roundStore.ts');
    const at = rs.indexOf('startRound: (course, holes, options)');
    expect(at).toBeGreaterThan(-1);
    // startRound is long (preserve-previous-round, prefetch, referral) before it reaches its set().
    // Cut at the NEXT top-level action instead of guessing a byte count.
    const rest = rs.slice(at);
    const nextAction = rest.search(/\n {6}[a-zA-Z_][A-Za-z0-9_]*: \(/g);
    const body = nextAction > 500 ? rest.slice(0, nextAction) : rest.slice(0, 20000);
    expect(body).toContain('isRoundActive: true');
    expect(body).toMatch(/pendingKevinRec: null/);
    expect(body).toMatch(/pendingLieAnalysis: null/);
  });
});

describe('live distances are claimed only when greens exist', () => {
  it('the first-tee message counts greens, not hole rows', () => {
    // A golfcourseapi build returns 18 hole rows whether or not any carries a green — the Hemet
    // failure exactly — so `holes.length > 0` announced live distances for a round of estimates.
    const src = read('app/(tabs)/caddie.tsx');
    expect(src).toMatch(/const mappedGreens = mappedHoleCount\(geom\)/);
    expect(src).not.toMatch(/hasMapping = !!geom && geom\.holes\.length > 0/);
  });

  it('the honest branch is still reachable', () => {
    const src = read('app/(tabs)/caddie.tsx');
    expect(src).toMatch(/couldn't pull full GPS mapping/);
  });
});
