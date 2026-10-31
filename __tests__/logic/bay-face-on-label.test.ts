import { bayLessonLabel, type BayLessonExport } from '../../services/bayExchange';

function lesson(view?: 'down_the_line' | 'face_on' | 'unknown'): BayLessonExport {
  return {
    format: 'smartplay/bay-lesson',
    version: 1,
    exportedAt: 1,
    source: { app: 'smartbay-ai', bay: 'test bay', coach: 'kevin' },
    player: null,
    lesson: { at: 1, focus: null, swings: 3, targetFault: 'sway', target: { label: 'Sway', cue: 'Stay over the ball' }, drill: null, findings: [], compare: [] },
    shots: [{ id: 's1', swingAt: 1, tempo: 3, faults: [], sim: null, ...(view ? { view } : {}) }],
  } as BayLessonExport;
}

describe('the practice label says when a lesson was filmed from the front', () => {
  it('marks a face-on lesson, so side-only faults read as not called', () => {
    expect(bayLessonLabel(lesson('face_on'))).toBe('SmartBay lesson · Sway · from the front');
  });

  it('leaves a down-the-line lesson labelled as before', () => {
    expect(bayLessonLabel(lesson('down_the_line'))).toBe('SmartBay lesson · Sway');
  });

  it('leaves an older lesson with no view labelled as before', () => {
    expect(bayLessonLabel(lesson())).toBe('SmartBay lesson · Sway');
  });
});
