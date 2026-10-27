/**
 * 2026-10-27 (Phase SB4x — review of SB3, findings "practice #3" / "capture #1").
 *
 * SB3g made the REVIEW's swing-1 stamp wait for the set's read to settle (the practice classifier runs at
 * the END of the read). Save, New Set (a queued go-again too) and Back did not: they stamped every swing
 * and awarded the full swing count the moment they were tapped — the review opens as soon as swing 1's
 * own read lands, long before the classifier — then marked the set credited, so a later demotion was
 * never taken back. Credit now waits: asked for mid-read it is held, and applied ONCE when the read
 * settles, without the swings the read demoted. It is keyed by the session id it was asked for, never by
 * the screen's current session (reset() and New Set clear that before the read ends).
 *
 * Driven through the owner the screen calls (services/practice/smartMotionPracticeCredit) on the real
 * swing, practice-session and points stores, with the real classifier.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { usePracticePointsStore } from '../../store/practicePointsStore';
import { classifyPracticeSwings } from '../../services/swing/practiceSwings';
import {
  createSetCreditLedger, creditSmartMotionSet, samplesToStamp,
  type SetCreditBooks, type SetCreditSnapshot,
} from '../../services/practice/smartMotionPracticeCredit';

const snap: SetCreditSnapshot = { swingCount: 3, drillShotCount: null, club: '7i', drill: null, clubKey: '7 Iron' };

function seed(): void {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{ id: 's', source: 'live_capture', analysis_status: 'pending', club: '7i', date: 1, shots: ['a', 'b', 'c'].map((id) => ({ id })) }] as never,
  });
  usePracticeSessionStore.setState({ active: null, history: [] } as never);
  usePracticePointsStore.setState({ total: 0, byDrill: {} } as never);
}
/** What the read's classifier writes when it ends: swing b was swung with no ball. */
function readDemotesB(): void {
  const shots = useSwingSessionStore.getState().sessionHistory[0].shots;
  useSwingSessionStore.getState().setShotPracticeMarks('s', classifyPracticeSwings(shots as never, {
    a: { ball_struck: 'yes' }, b: { ball_struck: 'no' }, c: { ball_struck: 'yes' },
  }));
}
const credited = () => usePracticeSessionStore.getState().history.map((h) => h.swingCount);

let books: SetCreditBooks;
let applied: { sid: string; late: boolean }[];
function ledger() {
  return createSetCreditLedger((sid, s, late) => { applied.push({ sid, late }); return creditSmartMotionSet(sid, s, books); });
}

beforeEach(() => {
  seed();
  books = { stamped: new Set(), samples: new Map() };
  applied = [];
});

describe('a SmartMotion set is credited once its read has settled', () => {
  it('THE REPORT: Save mid-read credits nothing; when the read settles the set is credited once, without the demoted swing', () => {
    const l = ledger();
    l.readStarted('s');
    const r = l.request('s', snap);                 // Save while swings 2-3 are still being read
    expect(r.pending).toBe(true);
    expect(credited()).toEqual([]);
    expect(usePracticePointsStore.getState().total).toBe(0);
    expect(useSwingSessionStore.getState().sessionHistory[0].creditedPractice).not.toBe(true);
    readDemotesB();
    l.readEnded('s');
    expect(l.flush('s')).toBe(true);
    expect(applied).toEqual([{ sid: 's', late: true }]);
    expect(credited()).toEqual([2]);                // a and c; never b
    expect(books.stamped.size).toBe(2);
    expect(useSwingSessionStore.getState().sessionHistory[0].creditedPractice).toBe(true);
  });

  it('never double-credits: Save, then New Set and Back on the same set mid-read, then the read settles — one credit', () => {
    const l = ledger();
    l.readStarted('s');
    l.request('s', snap);
    l.request('s', snap);
    l.request('s', snap);
    readDemotesB();
    l.readEnded('s');
    l.flush('s');
    l.flush('s');
    expect(applied).toHaveLength(1);
    expect(credited()).toEqual([2]);
    // and a later request (Save again after settle) awards nothing more
    l.request('s', snap);
    expect(credited()).toEqual([2]);
  });

  it('a read already settled (or offline, settled at once) credits at Save, with the toast', () => {
    const l = ledger();
    l.readStarted('s');
    readDemotesB();
    l.readEnded('s');
    const r = l.request('s', snap);
    expect(r.pending).toBe(false);
    expect(typeof r.result).toBe('number');
    expect(credited()).toEqual([2]);
  });

  it('a Re-analyze started before the first read settled: credit waits for the LAST read on that set', () => {
    const l = ledger();
    l.readStarted('s');
    l.request('s', snap);
    l.readStarted('s');           // re-analyze joins the queue
    l.readEnded('s');
    expect(l.flush('s')).toBe(false);
    expect(credited()).toEqual([]);
    readDemotesB();
    l.readEnded('s');
    expect(l.flush('s')).toBe(true);
    expect(credited()).toEqual([2]);
  });

  it('the samples of a held set are its own — a next set stamped meanwhile never rides on it', () => {
    const l = ledger();
    l.readStarted('s');
    l.request('s', snap);
    books.samples.set('next', [{ club: 'DR', tier: 'none', tempoRatio: null, divergenceDeg: null }]);
    readDemotesB();
    l.readEnded('s');
    l.flush('s');
    const rec = usePracticeSessionStore.getState().history[0];
    expect(rec.swings.map((x) => x.club)).toEqual(['7i', '7i']);
    expect(books.samples.get('next')).toHaveLength(1);
  });
});
