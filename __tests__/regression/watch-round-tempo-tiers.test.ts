/**
 * 2026-08-12 (Tim) — "How are we going to capture that by swing? By swing, by shot, by hole, then a
 * compilation at the end? … I always had this, but we needed to capture it, and everything was
 * always half built. The watch was the original thought."
 *
 * THE DESIGN PROBLEM: the watch emits SWINGS, a round is made of SHOTS, and an IMU cannot tell a
 * rehearsal from the real one. So nothing here guesses which swing "was the shot". It groups what
 * the wrist genuinely measured by HOLE and reads the one signal that survives that ambiguity —
 * TEMPO — because a fast waggle and a fast swing both say the same thing about the player.
 *
 * THREE TIERS:
 *   1 CAPTURE   every swing is stamped with the hole AT CAPTURE (the round moves on; reconstructing
 *               it later attaches the swing to wherever the player has since walked)
 *   2 PER HOLE  one line on the active-round card, and ONLY when the hole ran off the player's own
 *               baseline. A tempo number every hole is a stat readout, and thinking about your
 *               tempo ratio over the ball is how you play worse
 *   3 END       the compilation — did tempo hold or go late — persisted onto the round AND turned
 *               into a caddie observation, so it becomes something the caddie knows about you
 *               rather than a line you read once
 */
import {
  groupSwingsByHole, roundTempoBaseline, holeTempoFlag, roundTempoStory, type RoundSwing,
} from '../../services/round/roundSwingRead';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const t0 = 1_760_000_000_000;
const swing = (hole: number | null, ratio: number, i = 0): RoundSwing =>
  ({ timestamp: t0 + hole! * 600_000 + i * 1000, tempoRatio: ratio, hole });
/** n swings on a hole at a given ratio. */
const onHole = (hole: number, ratio: number, n = 3): RoundSwing[] =>
  Array.from({ length: n }, (_, i) => swing(hole, ratio, i));

describe('TIER 1 — grouping by the hole the swing happened on', () => {
  it('groups and orders by time', () => {
    const g = groupSwingsByHole([...onHole(2, 3), ...onHole(1, 3)]);
    expect([...g.keys()].sort()).toEqual([1, 2]);
    expect(g.get(1)!.length).toBe(3);
  });

  it('drops swings taken off-course', () => {
    // Range and cage swings have no hole; pooling them would corrupt the round baseline.
    expect(groupSwingsByHole([swing(null, 3), ...onHole(4, 3)]).size).toBe(1);
  });

  it('ignores impossible tempo values rather than averaging them in', () => {
    const g = groupSwingsByHole([{ timestamp: t0, tempoRatio: 0, hole: 1 }, ...onHole(1, 3)]);
    expect(g.get(1)!.length).toBe(3);
  });
});

describe('TIER 2 — the per-hole line stays quiet unless something changed', () => {
  const steady = [1,2,3,4,5,6].flatMap(h => onHole(h, 3.0));

  it('says nothing without enough swings to know the player', () => {
    expect(roundTempoBaseline(onHole(1, 3.0))).toBeNull();
    expect(holeTempoFlag(onHole(1, 3.0), 1, null)).toBeNull();
  });

  it('says nothing on a hole that matched the baseline', () => {
    const base = roundTempoBaseline(steady);
    expect(base).not.toBeNull();
    expect(holeTempoFlag(steady, 3, base)).toBeNull();
  });

  it('speaks when the hole ran genuinely quick', () => {
    const withQuick = [...steady, ...onHole(7, 2.2)];
    const flag = holeTempoFlag(withQuick, 7, roundTempoBaseline(withQuick));
    expect(flag).not.toBeNull();
    expect(flag!.direction).toBe('quick');
    expect(flag!.text.toLowerCase()).toContain('quickened');
  });

  it('needs more than one swing on the hole — one is an anecdote', () => {
    const withOne = [...steady, swing(8, 2.0)];
    expect(holeTempoFlag(withOne, 8, roundTempoBaseline(withOne))).toBeNull();
  });
});

describe('TIER 3 — the end-of-round compilation', () => {
  const holes = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18];

  it('WORKS ON A NINE-HOLE ROUND — a league round is not a truncated eighteen', () => {
    // 2026-08-12: Tim played a nine-hole men's league at Wachusett. The original 9-hole floor plus a
    // fixed 6-hole "late" window meant a nine would either never qualify or leave 3 holes of
    // baseline against 6 of closing — not a comparison. The window is now a THIRD of the round.
    const nine = [1,2,3,4,5,6,7,8,9].flatMap(h => onHole(h, h <= 6 ? 3.0 : 2.3, 2));
    const story = roundTempoStory(nine);
    expect(story.enough).toBe(true);
    expect(story.quickenedBy!).toBeGreaterThan(0);
    expect(story.headline).toContain('quickened');
  });

  it('still needs a real arc — under six holes there is nothing to compare', () => {
    expect(roundTempoStory([1,2,3,4].flatMap(h => onHole(h, 3.0, 2))).enough).toBe(false);
  });

  it('stays quiet on a short or watch-less round', () => {
    expect(roundTempoStory([]).enough).toBe(false);
    expect(roundTempoStory(onHole(1, 3)).enough).toBe(false);
  });

  it('reports a real late quickening in the player own numbers', () => {
    const swings = holes.flatMap(h => onHole(h, h <= 12 ? 3.0 : 2.3));
    const story = roundTempoStory(swings);
    expect(story.enough).toBe(true);
    expect(story.quickenedBy!).toBeGreaterThan(0);
    expect(story.headline).toContain('quickened');
  });

  it('tells a steady player they were steady, rather than inventing a finding', () => {
    const story = roundTempoStory(holes.flatMap(h => onHole(h, 3.0)));
    expect(story.enough).toBe(true);
    expect(story.headline).toContain('held');
  });

  it('names the opposite pattern too', () => {
    const story = roundTempoStory(holes.flatMap(h => onHole(h, h <= 12 ? 2.5 : 3.4)));
    expect(story.headline).toContain('slowed');
  });

  it('never claims causation', () => {
    const story = roundTempoStory(holes.flatMap(h => onHole(h, h <= 12 ? 3.0 : 2.3)));
    for (const w of ['because', 'caused', 'due to']) {
      expect(story.headline!.toLowerCase()).not.toContain(w);
    }
  });
});

describe('the tiers are actually wired, not just written', () => {
  it('TIER 1 — the bridge stamps the hole at capture', () => {
    const b = read('services/watchSwingBridge.ts');
    expect(b).toContain('const hole = rs.isRoundActive ? rs.currentHole : null;');
    expect(read('store/watchStore.ts')).toContain('hole?: number | null;');
  });

  it('TIER 2 — the active-round card reads it', () => {
    const d = read('app/(tabs)/dashboard.tsx');
    expect(d).toContain('holeTempoFlag(watchSwings, rs.currentHole, baseline)');
    expect(d).toContain('{holeTempo && (');
  });

  it('TIER 3 — the story is frozen onto the round while the swings still exist', () => {
    // watchStore persists deviceName only, so end-of-round is the last moment this can be captured.
    const r = read('store/roundStore.ts');
    expect(r).toContain('tempoStory: (() => {');
    expect(r).toContain('rd.roundTempoStory(ws.sessionSwings ?? [])');
  });

  it('TIER 3 — and reaches the CADDIE, not just a card', () => {
    // getTopObservations feeds the brain prompt; typed 'mental' because tempo degrading under
    // fatigue is a state reading, not a swing fault.
    const r = read('store/roundStore.ts');
    expect(r).toContain("type: 'mental',");
    expect(r).toContain('tempo quickens over the closing holes');
  });
});
