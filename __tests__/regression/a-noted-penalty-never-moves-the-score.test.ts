/**
 * 2026-09-11 (Tim) — "Remove all auto penalty counts, let user note penalties on the scorecard
 * like drops and lost balls."
 *
 * TWO RULES, AND THEY PULL IN OPPOSITE DIRECTIONS, WHICH IS WHY BOTH ARE PINNED HERE.
 *
 * 1. The app never adds a stroke on its own. Logging a shot as water / OB / unplayable used to have
 *    services/rulesEngine silently add one or two. The player said where the ball went; the app
 *    decided what it cost them — wrong wherever OB is played as a local-rule drop, wherever the ball
 *    turns up, and wherever the player already counted it. The rules VOICE is kept (Kevin still says
 *    "Water — that's one and a drop", still asks stroke-and-distance vs forward); the silent
 *    arithmetic is gone.
 *
 * 2. A penalty noted on the SCORECARD must not move the score. There the player types a TOTAL that
 *    already contains the penalty, so adding one would count it twice — the exact shape of the
 *    2026-09-10 double-count. It records WHAT happened so the round knows about the two drops, not
 *    just that the hole was a 6.
 *
 * The caddie-tab +penalty button is deliberately unchanged: mid-hole, shot-by-shot, no total has
 * been entered yet, so there a penalty IS a stroke.
 */
import fs from 'fs';
import path from 'path';
import { useRoundStore } from '../../store/roundStore';

const holes = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, yards: 380 }));
const caddie = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('the app never counts a penalty for you', () => {
  it('a logged shot outcome carries ZERO penalty strokes', () => {
    // resolvePenalty still runs (the rules voice), but its stroke count must not reach the shot.
    expect(code(caddie)).not.toMatch(/penalty_strokes:\s*resolution\.penalty_strokes/);
    expect(code(caddie)).toMatch(/penalty_strokes:\s*0\s*,/);
  });

  it('describing a shot does not rewrite the score you entered', () => {
    /**
     * Tim: "when you mark direction when scoring it actually adds score instead of describing last
     * shot." commitShot logged the shot and then pushed computeHoleScore straight into the score
     * box, so tapping Left moved a total the player owns. The shot is still logged; the overwrite
     * is gone. The prefill when the CARD OPENS is a different moment and stays.
     */
    const commit = code(caddie).slice(code(caddie).indexOf('const commitShot'));
    const body = commit.slice(0, commit.indexOf('handleDirectionTap'));
    expect(body).toContain('logShot(shot)');            // still recorded for data/reconciliation
    expect(body).not.toMatch(/setHoleScore\(suggested\)/);
  });

  it('keeps the rules VOICE — the knowledge is not what was removed', () => {
    expect(code(caddie)).toMatch(/resolution\.kevin_voice_line/);
    expect(code(caddie)).toMatch(/rules_decision:\s*resolution\.rules_decision/);
  });
});

describe('a noted penalty never moves the score', () => {
  beforeEach(() => {
    useRoundStore.getState().startRound('Test GC', holes as never, {} as never);
  });

  it('records the note without touching the entered score', () => {
    const r = useRoundStore.getState();
    r.logScore(7, 6);                       // the player types their total, penalty included
    r.noteHolePenalty(7, 1);                // ...and notes a lost ball
    const s = useRoundStore.getState();
    expect(s.scores[7]).toBe(6);            // unchanged
    expect(s.notedPenalties[7]).toBe(1);    // recorded
  });

  it('computeHoleScore never reads the noted map', () => {
    const r = useRoundStore.getState();
    r.logShot({ id: 'x1', hole: 3, timestamp: Date.now(), feel: null, direction: null, shape: null,
      club: '7I', acousticContact: null, outcome: 'clean', penalty_strokes: 0 } as never);
    const before = useRoundStore.getState().computeHoleScore(3);
    useRoundStore.getState().noteHolePenalty(3, 1);
    useRoundStore.getState().noteHolePenalty(3, 1);
    expect(useRoundStore.getState().computeHoleScore(3)).toBe(before);
  });

  it('the round STAT still knows about it, so the caddie can', () => {
    const r = useRoundStore.getState();
    r.logScore(9, 5);
    r.noteHolePenalty(9, 2);
    const stats = useRoundStore.getState().getHoleStats();
    const nine = stats.find((h: { hole: number }) => h.hole === 9);
    expect(nine?.penalties).toBe(2);
  });

  it('un-notes back to zero and drops the key rather than storing 0', () => {
    const r = useRoundStore.getState();
    r.noteHolePenalty(4, 1);
    r.noteHolePenalty(4, -1);
    expect(useRoundStore.getState().notedPenalties[4]).toBeUndefined();
  });

  it('never goes negative', () => {
    useRoundStore.getState().noteHolePenalty(5, -1);
    expect(useRoundStore.getState().notedPenalties[5]).toBeUndefined();
  });

  it('does not outlive the round', () => {
    useRoundStore.getState().noteHolePenalty(11, 1);
    useRoundStore.getState().endRound();
    expect(Object.keys(useRoundStore.getState().notedPenalties)).toEqual([]);
  });
});
