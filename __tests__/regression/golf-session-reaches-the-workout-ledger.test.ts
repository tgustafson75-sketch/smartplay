/**
 * 2026-11-01 — A GOLF WORKOUT IS ONE OF THE APP'S WORKOUTS, NOT A SECOND LEDGER.
 *
 * The golf workout keeps per-set data for Swing Rx progress. The session itself has to land in the
 * shared workout history (useWorkoutStore) so the dashboard, the correlation engines and Kevin read
 * the same numbers as every other workout. And the golf store has to be in the cloud backup list,
 * or a phone change loses prescriptions and logged sets.
 *
 * Break-tested: removing the completeSession write, or the backup key, fails this file.
 */
import fs from 'fs';
import path from 'path';
import { useWorkoutStore } from '../../store/workoutStore';
import { useGolfWorkoutStore, golfWorkoutUnlocked } from '../../store/golfWorkoutStore';

const ROOT = path.resolve(__dirname, '../..');
const backupSrc = fs.readFileSync(path.join(ROOT, 'services/cloudSync/growMostlyKeys.ts'), 'utf8');

describe('a finished golf session lands in the shared workout history', () => {
  beforeEach(() => {
    useWorkoutStore.setState({ history: [] });
    useGolfWorkoutStore.setState({ prescriptions: [], loggedSets: [] });
  });

  it('writes one golf_workout entry with the session title, exercises and duration', () => {
    const start = Date.UTC(2026, 10, 1, 9, 0, 0);
    const stored = useGolfWorkoutStore.getState().completeSession({
      title: 'Foundation · Control',
      exercises: ['THORACIC ROTATION', 'PALLOF PRESS'],
      startedAt: start,
      now: start + 30 * 60_000,
    });
    expect(stored).toBe(true);
    const [entry] = useWorkoutStore.getState().history;
    expect(entry.source).toBe('golf_workout');
    expect(entry.title).toBe('Foundation · Control');
    expect(entry.exercises).toEqual(['THORACIC ROTATION', 'PALLOF PRESS']);
    expect(entry.durationMin).toBe(30);
    expect(entry.focus).toBe('strength');
  });

  it('does not write per-set logs into the workout history', () => {
    useGolfWorkoutStore.getState().logSet({ exerciseId: 'pallofPress', weight: 0, reps: 12 });
    expect(useWorkoutStore.getState().history).toHaveLength(0);
    expect(useGolfWorkoutStore.getState().loggedSets).toHaveLength(1);
  });
});

describe('the golf store is backed up with the other workout data', () => {
  it('lists golf-workout-v1 in the grow-mostly backup keys', () => {
    expect(backupSrc).toMatch(/'golf-workout-v1'/);
  });
});

describe('the paywall seam', () => {
  it('is open until 2.0, and is the only place the golf gate lives', () => {
    expect(golfWorkoutUnlocked()).toBe(true);
  });
});
