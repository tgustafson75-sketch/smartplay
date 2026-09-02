/**
 * 2026-09-01 (Tim — "make sure that those lessons have a store, not the swing library, probably more
 * appropriate card in the dashboard").
 *
 * A completed lesson used to leave no trace: only the diagnosis path wrote to coachLessonStore, so a
 * player could work three focuses, hear "nice session — take those feels to the course", and the app
 * would remember nothing. A coach who does not remember the last lesson is not a coach.
 * [[close-the-loop-strategy]]
 */
import { useCoachLessonStore } from '../../store/coachLessonStore';

const reset = () => useCoachLessonStore.setState({ lessons: [], sessions: [] });

describe('coachLessonStore sessions', () => {
  beforeEach(reset);

  it('records a completed guided plan with what it actually did', () => {
    useCoachLessonStore.getState().recordSession({
      planId: 'full-tuneup', label: 'Full swing tune-up',
      focusIds: ['weight_shift', 'sequencing', 'posture'],
      repsRead: 7, repsGood: 4, completed: true,
    }, 1_000);
    const s = useCoachLessonStore.getState().lastSession()!;
    expect(s).toMatchObject({ planId: 'full-tuneup', repsRead: 7, repsGood: 4, completed: true });
    expect(s.at).toBe(1_000);
    expect(s.focusIds).toHaveLength(3);
  });

  it('records a session ended early as ended early, not as finished', () => {
    // Pretending otherwise would make the dashboard card lie in the flattering direction.
    useCoachLessonStore.getState().recordSession({
      planId: 'more-power', label: 'More power', focusIds: ['shoulder_turn'],
      repsRead: 2, repsGood: 0, completed: false,
    }, 2_000);
    expect(useCoachLessonStore.getState().lastSession()!.completed).toBe(false);
  });

  it('keeps sessions newest-first — the card reads the top', () => {
    const st = useCoachLessonStore.getState();
    st.recordSession({ planId: null, label: 'Posture', focusIds: ['posture'], repsRead: 1, repsGood: 1, completed: true }, 1_000);
    st.recordSession({ planId: null, label: 'Tempo', focusIds: ['sequencing'], repsRead: 1, repsGood: 0, completed: true }, 2_000);
    expect(useCoachLessonStore.getState().sessions[0].label).toBe('Tempo');
  });

  it('sessionsSince filters by time', () => {
    const st = useCoachLessonStore.getState();
    st.recordSession({ planId: null, label: 'Old', focusIds: [], repsRead: 1, repsGood: 0, completed: true }, 1_000);
    st.recordSession({ planId: null, label: 'New', focusIds: [], repsRead: 1, repsGood: 0, completed: true }, 9_000);
    const recent = useCoachLessonStore.getState().sessionsSince(5_000);
    expect(recent.map((r) => r.label)).toEqual(['New']);
  });

  it('lessons and sessions are separate histories — a lesson never becomes a session', () => {
    const st = useCoachLessonStore.getState();
    st.record({ faultId: 'over_the_top', faultName: 'Over the top', hitCheckpoint: true }, 1_000);
    expect(useCoachLessonStore.getState().sessions).toHaveLength(0);
    expect(useCoachLessonStore.getState().lastLesson()!.faultId).toBe('over_the_top');
  });

  it('clear() empties both', () => {
    const st = useCoachLessonStore.getState();
    st.record({ faultId: 'sway', faultName: 'Sway', hitCheckpoint: false }, 1);
    st.recordSession({ planId: null, label: 'x', focusIds: [], repsRead: 1, repsGood: 0, completed: true }, 1);
    useCoachLessonStore.getState().clear();
    expect(useCoachLessonStore.getState().sessions).toHaveLength(0);
    expect(useCoachLessonStore.getState().lessons).toHaveLength(0);
  });

  it('lastSession is null on a fresh store rather than throwing', () => {
    expect(useCoachLessonStore.getState().lastSession()).toBeNull();
    expect(useCoachLessonStore.getState().sessionsSince(0)).toEqual([]);
  });

  /**
   * THE UPGRADE PATH IS THE DANGEROUS PART. Every tester already has a v1 blob under
   * 'coach-lesson-history-v1' with lessons and NO `sessions` key. If the migration does not
   * materialise the array, the first `.filter` off undefined crashes the dashboard on the first
   * launch after the update — on the most-seen screen in the app. The persist key is deliberately
   * unchanged, so this path is the only thing standing between a v1 device and that crash.
   * [[nobody-chose-cage-the-default-did]] — a version bump must carry the value.
   */
  describe('v1 -> v2 migration', () => {
    // Reach the configured migrate the same way zustand/persist does.
    const migrate = (useCoachLessonStore as unknown as {
      persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } };
    }).persist.getOptions().migrate!;

    it('materialises sessions for a v1 blob that has none', () => {
      const v1 = { lessons: [{ at: 1, faultId: 'sway', faultName: 'Sway', hitCheckpoint: true }] };
      const out = migrate(v1, 1) as { lessons: unknown[]; sessions: unknown[] };
      expect(Array.isArray(out.sessions)).toBe(true);
      expect(out.sessions).toHaveLength(0);
      expect(out.lessons).toHaveLength(1);       // and never drops the history it already had
    });

    it('repairs a v2 blob whose sessions is not an array', () => {
      const broken = { lessons: [], sessions: null } as unknown;
      const out = migrate(broken, 2) as { sessions: unknown[] };
      expect(Array.isArray(out.sessions)).toBe(true);
    });

    it('leaves a healthy v2 blob alone', () => {
      const good = { lessons: [], sessions: [{ at: 5, planId: null, label: 'x', focusIds: [], repsRead: 1, repsGood: 1, completed: true }] };
      const out = migrate(good, 2) as { sessions: unknown[] };
      expect(out.sessions).toHaveLength(1);
    });

    it('survives a persisted blob that is empty or malformed', () => {
      expect(() => migrate(undefined, 1)).not.toThrow();
      expect(Array.isArray((migrate(undefined, 1) as { sessions: unknown[] }).sessions)).toBe(true);
    });
  });
});
