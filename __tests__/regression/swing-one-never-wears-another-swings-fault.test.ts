/**
 * 2026-10-27 — SEAM between three fixes (SB3a reset, SB3b practice demotion, SB3d/R7 "swing 1's own read").
 *
 * The library's swing 1 falls back to the SESSION headline when it has no per-swing read — meant for a legacy
 * single-read swing 1. Two of today's fixes made "swing 1 has no per-swing read" mean something else:
 *   - SB3a: a Re-analyze clears every swing's per-swing read first; if swing 1's new read then fails while
 *     swings 2-3 read fine, the headline (built from swings 2-3) is painted, ringed and captioned on swing 1;
 *   - SB3b: a demoted practice swing is not read again, so a practice swing 1 wore the counted swings' fault.
 * The headline stands in for swing 1 only when it is not a practice swing and the headline does not name
 * other swings only (detected_in_shots empty = legacy/unknown → it still stands in).
 *
 * Driven through the real store (the reset and the practice marks are the fixers' own actions) and the owners
 * both library cards call (faultSpotlight.swingFaultOnScreen / swingBodyFaultRead).
 */
import { useSwingSessionStore, type SwingSession } from '../../store/swingSessionStore';
import { swingBodyFaultRead, swingFaultOnScreen } from '../../services/swing/faultSpotlight';

const SID = 'seam_r7';
const headline = {
  issue_id: 'over_the_top', primary_fault: 'over_the_top', name: 'Over the top', category: 'swing_path',
  severity: 'significant', occurrence_count: 2, visual_reference_path: null, mechanical_breakdown: '', feel_cue: '',
  detected_in_shots: [`${SID}_shot_1`, `${SID}_shot_2`],
};
const read = (f: string) => ({ detected_issue: f, primary_fault: f, severity: 'moderate', confidence: 'high', observation: '', fault_frame_index: 2, visual_reference_path: null });

function seed(): void {
  const shots = [0, 1, 2].map((i) => ({
    id: `${SID}_shot_${i}`, clipUri: 'file:///clip.mp4', clipStartSeconds: i * 5, clipEndSeconds: i * 5 + 4,
    detectionMethod: 'manual', perShotAnalysis: read(i === 0 ? 'early_extension' : 'over_the_top'),
  }));
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{ id: SID, source: 'uploaded_video', date: 1, club: '7i', shots, primary_issue: headline, analysis_status: 'ok' } as unknown as SwingSession],
  });
}
const shot0 = () => useSwingSessionStore.getState().sessionHistory[0].shots[0];
const pi = () => useSwingSessionStore.getState().sessionHistory[0].primary_issue;

beforeEach(seed);

describe('swing 1 never wears another swing\'s fault', () => {
  it('a Re-analyze whose swing-1 read failed: the headline that names swings 2-3 is not swing 1\'s fault', () => {
    useSwingSessionStore.getState().resetDerivedAnalysis(SID);          // SB3a, at the start of the re-analysis
    // swings 2-3 read again (the headline still names them); swing 1's read failed — nothing written for it
    expect(shot0().perShotAnalysis).toBeUndefined();
    expect(swingFaultOnScreen(0, pi(), shot0().perShotAnalysis, shot0())).toEqual({ faultId: null, severe: false });
    expect(swingBodyFaultRead(0, pi(), shot0().perShotAnalysis, shot0())).toBeNull();
  });

  it('a demoted practice swing 1 (not read again) shows no fault, not the counted swings\' headline', () => {
    useSwingSessionStore.getState().resetDerivedAnalysis(SID);
    useSwingSessionStore.getState().setShotPracticeMarks(SID, { [`${SID}_shot_0`]: { reason: 'no_ball_seen' } });
    const legacyHeadline = { ...headline, detected_in_shots: [] as string[] };   // even with no attribution
    expect(swingFaultOnScreen(0, legacyHeadline, shot0().perShotAnalysis, shot0()).faultId).toBeNull();
    expect(swingBodyFaultRead(0, legacyHeadline, shot0().perShotAnalysis, shot0())).toBeNull();
  });

  it('guards: a legacy swing 1 (headline names no swing, or names swing 1) still uses the headline', () => {
    useSwingSessionStore.getState().resetDerivedAnalysis(SID);
    const legacy = { ...headline, detected_in_shots: [] as string[] };
    expect(swingFaultOnScreen(0, legacy, undefined, shot0()).faultId).toBe('over_the_top');
    const names1 = { ...headline, detected_in_shots: [`${SID}_shot_0`] };
    expect(swingBodyFaultRead(0, names1, undefined, shot0())).toEqual({ primary_fault: 'over_the_top', detected_issue: 'over_the_top' });
    // a restored practice swing counts again
    useSwingSessionStore.getState().setShotPracticeMarks(SID, { [`${SID}_shot_0`]: { reason: 'no_ball_seen', restoredByUser: true } });
    expect(swingFaultOnScreen(0, legacy, undefined, shot0()).faultId).toBe('over_the_top');
  });

  it('guard: swing 1\'s own read always wins', () => {
    expect(swingFaultOnScreen(0, pi(), shot0().perShotAnalysis, shot0()).faultId).toBe('early_extension');
  });
});
