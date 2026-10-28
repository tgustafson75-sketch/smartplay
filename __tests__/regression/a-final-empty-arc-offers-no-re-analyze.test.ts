/**
 * 2026-10-27 (Phase SB8, recheck TRACE-REANALYZE-NOOP).
 *
 * "THE CLUBHEAD COULD NOT BE SEEN" OFFERED A RE-ANALYZE THAT COULD NOT CHANGE IT. Swing Trace on a swing whose
 * stored arc is today's tracker's honest empty answer showed the note with Re-analyze, on the library swing page
 * and in SmartMotion's review. Re-analyze re-reads the whole set (paid), may re-split it, and then runs the same
 * tracker over the same clip and window — the same empty arc, the same note. Where today's answer is stored, the
 * note stands alone; Re-analyze stays where it can change something (no answer stored, an older build's arc, or
 * no body read).
 *
 * The stored answer is judged by the shot run's own rule (shotDetail.storedArcIsFinal, the one hasFinalArc uses).
 */
import * as fs from 'fs';
import * as path from 'path';
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { storedArcIsFinal } from '../../services/swing/orchestrator/shotDetail';
import { BODY_READ_VERSION, CLUB_ARC_VERSION } from '../../services/swing/analysisVersion';
import { swingTraceNote, swingTraceNoteOffersReanalyze } from '../../services/swing/overlayVisibility';

const read = { frames: [{ timestampMs: 1000, keypoints: [] }], angle: 'down_the_line' };
const ARC = [{ x: 0.1, y: 0.1, tMs: 1 }, { x: 0.2, y: 0.2, tMs: 2 }, { x: 0.3, y: 0.3, tMs: 3 }];

function seed(arc: Record<string, unknown>): void {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'live_capture', analysis_status: 'ok', club: '7i', biomechanics: read, analysis_version: BODY_READ_VERSION,
      shots: [0, 1].map((i) => ({
        id: `sh${i}`, club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: i * 4, clipEndSeconds: i * 4 + 3,
        biomechanics: read, analysis_version: BODY_READ_VERSION, ...(i === 1 ? arc : {}),
      })),
    }] as never,
  });
}
const setOS = (os: string) => { (require('react-native') as { Platform: { OS: string } }).Platform.OS = os; };
/** The note and its button, as both screens build them for swing 2 (trace on, body read, nothing pending). */
function noteFor() {
  const s = useSwingSessionStore.getState().sessionHistory[0];
  const shot = s.shots[1];
  const note = swingTraceNote({
    wanted: true, drawn: false, hasArc: Array.isArray(shot.club_arc) && shot.club_arc.length >= 3, hasBody: true, pending: false,
    settled: storedArcIsFinal(s, shot, false),
  });
  return { note, reanalyze: swingTraceNoteOffersReanalyze(note) };
}

beforeEach(() => setOS('android'));
afterEach(() => setOS('ios'));

describe('a final empty arc says so, and offers no Re-analyze', () => {
  it('THE REPORT: today\'s tracker stored an honest empty arc — "could not be seen", no Re-analyze', () => {
    seed({ club_arc: [], club_arc_source: 'tracker', club_arc_version: CLUB_ARC_VERSION });
    expect(noteFor()).toEqual({ note: 'no_clubhead', reanalyze: false });
  });

  it('on iOS a stored vision answer is final too (asking the model again about the same frames)', () => {
    setOS('ios');
    seed({ club_arc: [], club_arc_source: 'vision', club_arc_version: CLUB_ARC_VERSION });
    expect(noteFor()).toEqual({ note: 'no_clubhead', reanalyze: false });
  });

  it('no answer stored (no copy, no network): it says it could not trace, with Re-analyze', () => {
    seed({});
    expect(noteFor()).toEqual({ note: 'no_trace', reanalyze: true });
  });

  it('an older build\'s tracker arc is not final: Re-analyze stays', () => {
    seed({ club_arc: [], club_arc_source: 'tracker', club_arc_version: 1 });
    expect(noteFor().reanalyze).toBe(true);
  });

  it('on Android a vision answer is not final (the free tracker can still run): Re-analyze stays', () => {
    seed({ club_arc: [], club_arc_source: 'vision', club_arc_version: CLUB_ARC_VERSION });
    expect(noteFor().reanalyze).toBe(true);
  });

  it('no body read keeps Re-analyze; tracing offers nothing', () => {
    expect(swingTraceNoteOffersReanalyze('no_body')).toBe(true);
    expect(swingTraceNoteOffersReanalyze('tracing')).toBe(false);
    expect(swingTraceNoteOffersReanalyze(null)).toBe(false);
  });

  it('both screens gate the button on the shared rule and pass the stored answer (wiring, secondary)', () => {
    const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
    const lib = src('app/swinglab/swing/[swing_id].tsx');
    const sm = src('app/swinglab/smartmotion.tsx');
    expect(lib).toContain('{swingTraceNoteOffersReanalyze(traceNote) && (');
    expect(lib).toMatch(/settled: !!session && !!shot && storedArcIsFinal\(session, shot,/);
    expect(sm).toContain('{swingTraceNoteOffersReanalyze(reviewTraceNote) ? (');
    expect(sm).toMatch(/settled: !!cageSession && !!reviewShot && storedArcIsFinal\(cageSession, reviewShot,/);
    for (const s of [lib, sm]) expect(s).toMatch(/t\('swinglab_swing\.swing_detail\.trace_not_answered'\)/);
    const en = require('../../i18n/locales/en.json') as { swinglab_swing: { swing_detail: Record<string, string> } };
    expect(en.swinglab_swing.swing_detail.trace_not_answered).toBe("Couldn't trace this swing just now.");
  });
});
