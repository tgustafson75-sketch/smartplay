/**
 * 2026-10-15 (review G3a, finding 3) — THE CADDIE TAB'S RECAP IS ABOUT THE ROUND THAT WAS SAVED.
 *
 * generateRoundSummary (app/(tabs)/caddie.tsx) runs AFTER endRound() and built its generateRecap call
 * from useRoundStore.getState() — already reset: 'Unknown Course', courseId null, scores {}, shots [],
 * courseHoles []. /api/recap answered 400 (no holes) and the canned "Round complete. Keep building."
 * was saved under the SAME round id as the store's own good recap; whichever landed last won, and the
 * recap screen's mergeRecap takes overall_kevin_summary from that archive.
 *
 * Two halves, both needed:
 *   1. the call is built from roundHistory's record + the pre-endRound snapshot (recapRoundFromRecord);
 *   2. generateRecap never replaces a recap that has the round in it with an empty/canned one —
 *      because there are still two writers and either can fail on a bad signal.
 */
import fs from 'fs';
import path from 'path';

const archive = new Map<string, unknown>();
jest.mock('../../services/planStorage', () => ({
  saveRecap: jest.fn(async (id: string, r: unknown) => { archive.set(id, r); }),
  loadRecap: jest.fn(async (id: string) => archive.get(id) ?? null),
}));

import { generateRecap, recapRoundFromRecord } from '../../services/recapGenerator';
import type { RoundRecord, CourseHole } from '../../store/roundStore';

const holes = [1, 2, 3].map((h) => ({ hole: h, par: 4 })) as unknown as CourseHole[];
const record = {
  id: 'r-77', courseName: 'Hemet GC', courseId: 'api:9', mode: 'break_90',
  startedAt: 1000, endedAt: 2000, totalScore: 14, scoreVsPar: 2,
  scores: { 1: 5, 2: 4, 3: 5 }, shots: [],
} as unknown as RoundRecord;

const base = {
  patternInsights: [], playerName: 'Tim', apiUrl: 'http://localhost:1',
};

afterEach(() => archive.clear());

describe('the recap input comes from the saved record, not the reset store', () => {
  it('carries the course, the scores and the snapshot holes', () => {
    const r = recapRoundFromRecord(record, { courseHoles: holes, roundNotes: 'commit to targets' });
    expect(r.courseName).toBe('Hemet GC');
    expect(r.courseId).toBe('api:9');
    expect(r.scores).toEqual({ 1: 5, 2: 4, 3: 5 });
    expect(r.courseHoles).toHaveLength(3);
    expect(r.preRoundNotes).toBe('commit to targets');
    expect(r.mode).toBe('break_90');
  });

  it('caddie.tsx builds its generateRecap call from roundHistory + the snapshot, never the live store', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
    const start = src.indexOf('const generateRoundSummary = async');
    const end = src.indexOf('// ── Start round', start);
    const fn = src.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(fn).toMatch(/roundHistory\.find\(r => r\.id === roundId\)/);
    expect(fn).toMatch(/recapRoundFromRecord\(endedRecord/);
    expect(fn).toMatch(/\.\.\.recapRound,/);
    // the reset store must not feed the recap or the pattern insights
    expect(fn).not.toMatch(/storeState\.(scores|shots|courseHoles|activeCourse|mode|roundNotes)/);
    // both callers snapshot the pre-round notes before endRound() resets them
    expect((src.match(/roundNotes: preRound\.roundNotes,/g) ?? []).length).toBe(2);
  });
});

describe('an empty recap never replaces one that has the round in it', () => {
  it('a failed/empty generation keeps the existing good recap', async () => {
    // The store's recap landed first: real rows + a real narrative.
    archive.set('r-77', {
      round_id: 'r-77', course_name: 'Hemet GC', hole_comparisons: [{ hole_number: 1 }],
      overall_kevin_summary: 'You kept it in play all day.',
    });
    // The late call: the network is blocked under jest, so the API "fails" → canned summary;
    // and the reset-store input had no scores → no hole rows.
    const out = await generateRecap('r-77', {
      ...base, courseName: 'Unknown Course', courseId: null, mode: 'free_play',
      startedAt: 0, endedAt: 0, totalScore: 0, scoreVsPar: null, scores: {}, shots: [], courseHoles: [],
    });
    const kept = archive.get('r-77') as { overall_kevin_summary: string; course_name: string };
    expect(kept.overall_kevin_summary).toBe('You kept it in play all day.');
    expect(kept.course_name).toBe('Hemet GC');
    expect(out.overall_kevin_summary).toBe('You kept it in play all day.');
  });

  it('with nothing archived yet, the canned recap is still saved (the screen has something)', async () => {
    await generateRecap('r-78', {
      ...base, ...recapRoundFromRecord({ ...record, id: 'r-78' } as RoundRecord, { courseHoles: holes }),
    });
    const saved = archive.get('r-78') as { hole_comparisons: unknown[] };
    expect(saved.hole_comparisons).toHaveLength(3);
  });
});

describe('quick-score placeholders are not shots in the recap', () => {
  it('qs- rows are dropped from every hole; real shots stay', async () => {
    const shot = (id: string, hole: number) => ({ id, hole, club: null, direction: null, feel: null, shape: null, timestamp: 1 });
    await generateRecap('r-79', {
      ...base, ...recapRoundFromRecord({
        ...record, id: 'r-79',
        shots: [shot('qs-1-0', 1), shot('qs-1-1', 1), shot('qs-1-2', 1), shot('real-a', 2)],
      } as unknown as RoundRecord, { courseHoles: holes }),
    });
    const saved = archive.get('r-79') as { hole_comparisons: Array<{ hole_number: number; actual_shots: Array<{ id: string }> }> };
    const byHole = (h: number) => saved.hole_comparisons.find((c) => c.hole_number === h)!.actual_shots.map((x) => x.id);
    expect(byHole(1)).toEqual([]);
    expect(byHole(2)).toEqual(['real-a']);
  });
});
