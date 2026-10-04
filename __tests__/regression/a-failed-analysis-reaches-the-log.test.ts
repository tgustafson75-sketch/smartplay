/**
 * 2026-10-03 — Tim's imported mp4 "WILL NOT ANALYZE" and his issue log held nothing about it:
 * a dozen paths end a swing analysis in 'failed' and none reported beyond console/analytics.
 * They all land on setSessionAnalysisStatus, so the report lives there — once per transition.
 */
const mockAdd = jest.fn();
jest.mock('../../store/issueLogStore', () => ({ useIssueLogStore: { getState: () => ({ addAppEvent: mockAdd }) } }));

import { useSwingSessionStore } from '../../store/swingSessionStore';

const seed = (status: string) => useSwingSessionStore.setState({
  activeSession: null,
  sessionHistory: [{
    id: 's1', source: 'uploaded_video', analysis_status: status, analysis_error: null,
    upload: { duration_sec: 14.5, source_device: 'phone' },
    shots: [{ id: 'sh1', clipUri: 'file:///x/clip.mp4', clipStartSeconds: 5.3, clipEndSeconds: 7.8 }],
  }] as never,
});

beforeEach(() => mockAdd.mockClear());

describe('a failed swing analysis reaches the issue log', () => {
  it('reports the reason and what the clip was, as an analysis_error', () => {
    seed('analyzing_pose');
    useSwingSessionStore.getState().setSessionAnalysisStatus('s1', 'failed', 'No usable swing in the upload.');
    expect(mockAdd).toHaveBeenCalledWith('swing_analysis_failed', expect.objectContaining({
      reason: 'No usable swing in the upload.', from: 'analyzing_pose', source: 'uploaded_video',
      durationSec: 14.5, clipExt: 'mp4', windowSec: 2.5,
    }), 'analysis_error');
  });

  it('once per failure, not on every re-write of the same status', () => {
    seed('failed');
    useSwingSessionStore.getState().setSessionAnalysisStatus('s1', 'failed', 'again');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('a success reports nothing', () => {
    seed('analyzing_pose');
    useSwingSessionStore.getState().setSessionAnalysisStatus('s1', 'ok');
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
