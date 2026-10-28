/**
 * 2026-10-27 (Phase SB5 — recheck finding "credit held in memory only" of the SB4x credit ledger).
 *
 * A 4-swing set at the range: the review opens once swing 1's read lands, the rest is still being read. Tim
 * taps Save (or Back, or New Set); the credit waits for the read (SB4x) and is HELD — only in the screen's
 * memory. He pockets the phone, Android kills the app before the read settles: the held credit was gone.
 * Nothing else credits that set (the library backfill is one-time and long used), so it never earned its
 * points or its Practice history session.
 *
 * Now the held credit is also on the swing session, and the launch applies it once — without the swings a
 * read demoted. Driven through the real ledger, the real launch sweep and the real stores.
 *
 * 2026-10-27 (recheck "the launch credits swings the read never got to demote") — this test demoted swing b
 * BEFORE the simulated kill, which a real kill does not do: the classifier runs at the END of the set's read,
 * the kill cut that read short, and nothing resumes it. At launch the sweep "waited for the live read" — none
 * exists at boot — and credited all three swings for good. Now the kill comes first, and the launch READS
 * the set (the one run, here stubbed: it runs the classifier as the real read does) before crediting it.
 *
 * 2026-10-27 (recheck R3 "the no-launch verdict writes 'ok' mid-read") — the sweep took status 'ok' as "the
 * read reached its end". SmartMotion's no-launch check (a practice swing beside a ball on the spot: the ball
 * never left) writes setSessionAnalysis → 'ok' while swings 2+ are still being read; killed after Save, the
 * set was credited at launch unread, its practice swing for good. The read now stamps its end (readEndedAt).
 */
const mockReads: { id: string; extras: unknown }[] = [];
let mockReadOutcome: 'classified' | 'offline' = 'classified';
jest.mock('../../services/swing/orchestrator/uploadRun', () => ({
  runSwingAnalysis: async (id: string, extras?: unknown) => {
    mockReads.push({ id, extras });
    await new Promise((r) => setTimeout(r, 5));        // the read takes time: the credit must wait for it
    const { useSwingSessionStore: st } = jest.requireActual('../../store/swingSessionStore');
    if (mockReadOutcome === 'offline') { st.getState().setSessionAnalysisStatus(id, 'failed', 'no signal'); return { readFailed: 'no signal' }; }
    mockClassifierRan();                                // the set's classifier, at the end of its read
    st.getState().setSessionAnalysisStatus(id, 'ok');
    return { primary_issue: null, drill_recommendation: null, analyses: {} };
  },
}));
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { usePracticePointsStore } from '../../store/practicePointsStore';
import { classifyPracticeSwings } from '../../services/swing/practiceSwings';
import { noLaunchIssue } from '../../services/swing/contactVerdict';
import * as credit from '../../services/practice/smartMotionPracticeCredit';
import type { SetCreditBooks, SetCreditSnapshot } from '../../services/practice/smartMotionPracticeCredit';

const snap: SetCreditSnapshot = { swingCount: 3, drillShotCount: null, club: '7i', drill: null, clubKey: '7 Iron', announce: true };

function seed(): void {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{ id: 's', source: 'live_capture', analysis_status: 'pending', club: '7i', date: 1, shots: ['a', 'b', 'c'].map((id) => ({ id })) }] as never,
  });
  usePracticeSessionStore.setState({ active: null, history: [] } as never);
  usePracticePointsStore.setState({ total: 0, byDrill: {} } as never);
}
const mockDemoteB = () => {
  const shots = useSwingSessionStore.getState().sessionHistory[0].shots;
  useSwingSessionStore.getState().setShotPracticeMarks('s', classifyPracticeSwings(shots as never, {
    a: { ball_struck: 'yes' }, b: { ball_struck: 'no' }, c: { ball_struck: 'yes' },
  }));
};
/** The end of the set's read as the real read writes it: the classifier's marks, then its end stamp. */
const mockClassifierRan = () => {
  mockDemoteB();
  useSwingSessionStore.getState().setSessionReadEnded('s', Date.now());
};
const credited = () => usePracticeSessionStore.getState().history.map((h) => h.swingCount);
const sess = () => useSwingSessionStore.getState().sessionHistory[0];
const held = () => (sess() as { practiceCreditPending?: unknown }).practiceCreditPending;
/** A launch: the stores keep what was persisted; the screen's ledger (memory) is gone. */
const launch = (): Promise<string[]> => {
  const apply = (credit as { applyHeldSetCredits?: () => Promise<string[]> }).applyHeldSetCredits;
  return apply ? apply() : Promise.resolve([]);
};

let books: SetCreditBooks;
beforeEach(() => { seed(); books = { stamped: new Set(), samples: new Map() }; mockReads.length = 0; mockReadOutcome = 'classified'; });

describe('a set\'s held practice credit survives the app being killed', () => {
  it('THE REPORT: Save mid-read, the app dies before the classifier — the launch reads the set, then credits a and c once', async () => {
    const l = credit.createSetCreditLedger((sid, s) => credit.creditSmartMotionSet(sid, s, books));
    l.readStarted('s');
    expect(l.request('s', snap).pending).toBe(true);   // Save: "Saved to your Swing Library"
    // -- killed mid-read: the classifier never ran, the ledger is gone, its flush never runs --
    expect(sess().shots.some((x) => (x as { practice?: unknown }).practice)).toBe(false);
    expect(credited()).toEqual([]);
    expect(sess().creditedPractice).not.toBe(true);
    // What is written to disk carries the held credit (the store's own partialize).
    const disk = useSwingSessionStore.persist.getOptions().partialize!(useSwingSessionStore.getState()) as { sessionHistory: { practiceCreditPending?: unknown }[] };
    expect(disk.sessionHistory[0].practiceCreditPending).toEqual(snap);

    expect(await launch()).toEqual(['s']);
    // The set was read first (its first read to reach the end, not a second look), and b was not credited.
    expect(mockReads).toEqual([{ id: 's', extras: { deferredRead: true } }]);
    expect(credited()).toEqual([2]);
    expect(usePracticePointsStore.getState().total).toBeGreaterThan(0);
    expect(sess().creditedPractice).toBe(true);
    expect(held() ?? null).toBeNull();

    const pts = usePracticePointsStore.getState().total;
    expect(await launch()).toEqual([]);                  // and never twice
    expect(credited()).toEqual([2]);
    expect(usePracticePointsStore.getState().total).toBe(pts);
    expect(mockReads).toHaveLength(1);
  });

  it('THE R3 REPORT: the no-launch verdict wrote \'ok\' mid-read, then the kill — the launch still reads the set before crediting', async () => {
    const l = credit.createSetCreditLedger((sid, s) => credit.creditSmartMotionSet(sid, s, books));
    l.readStarted('s');
    // Swing 1's read landed, the review opened; the ball never left the spot on the practice swing.
    useSwingSessionStore.getState().setSessionAnalysis('s', noLaunchIssue(), null);
    expect(sess().analysis_status).toBe('ok');           // 'ok' while swings 2+ are still being read
    expect(l.request('s', snap).pending).toBe(true);     // Save
    // -- killed mid-read: the classifier never ran --
    expect(await launch()).toEqual(['s']);
    expect(mockReads).toEqual([{ id: 's', extras: { deferredRead: true } }]);
    expect(credited()).toEqual([2]);                     // b, the practice swing, is not credited
    expect(await launch()).toEqual([]);
    expect(credited()).toEqual([2]);
  });

  it('the end stamp is persisted (the launch reads it from disk)', () => {
    mockClassifierRan();
    const disk = useSwingSessionStore.persist.getOptions().partialize!(useSwingSessionStore.getState()) as { sessionHistory: { readEndedAt?: unknown }[] };
    expect(typeof disk.sessionHistory[0].readEndedAt).toBe('number');
  });

  it('killed after the read reached its end (classifier ran) but before the credit: credited at once, no read', async () => {
    const l = credit.createSetCreditLedger((sid, s) => credit.creditSmartMotionSet(sid, s, books));
    l.readStarted('s');
    l.request('s', snap);
    mockClassifierRan();
    useSwingSessionStore.getState().setSessionAnalysisStatus('s', 'ok');
    // -- killed before readEnded / flush --
    expect(await launch()).toEqual(['s']);
    expect(mockReads).toEqual([]);
    expect(credited()).toEqual([2]);
  });

  it('the launch read cannot be done (no signal): credited as the screen credits an offline set, once', async () => {
    mockReadOutcome = 'offline';
    const l = credit.createSetCreditLedger((sid, s) => credit.creditSmartMotionSet(sid, s, books));
    l.readStarted('s');
    l.request('s', snap);
    expect(await launch()).toEqual(['s']);
    expect(mockReads).toHaveLength(1);
    expect(credited()).toEqual([3]);
    expect(await launch()).toEqual([]);
    expect(mockReads).toHaveLength(1);
  });

  it('a hold that outlived its credit is cleared at launch, and no read is spent on it', async () => {
    const l = credit.createSetCreditLedger((sid, s) => credit.creditSmartMotionSet(sid, s, books));
    l.readStarted('s');
    l.request('s', snap);
    useSwingSessionStore.getState().setSessionCreditedPractice('s', true);
    expect(await launch()).toEqual([]);
    expect(mockReads).toEqual([]);
    expect(credited()).toEqual([]);
    expect(held() ?? null).toBeNull();
  });

  it('the app lives: the ledger applies the credit when the read settles and nothing is left held for the launch', async () => {
    const l = credit.createSetCreditLedger((sid, s) => credit.creditSmartMotionSet(sid, s, books));
    l.readStarted('s');
    l.request('s', snap);
    mockDemoteB();
    l.readEnded('s');
    expect(l.flush('s')).toBe(true);
    expect(credited()).toEqual([2]);
    expect(held() ?? null).toBeNull();
    expect(await launch()).toEqual([]);
    expect(credited()).toEqual([2]);
  });

  it('credited with no read in flight: nothing is held at all', () => {
    const l = credit.createSetCreditLedger((sid, s) => credit.creditSmartMotionSet(sid, s, books));
    expect(l.request('s', snap).pending).toBe(false);
    expect(held() ?? null).toBeNull();
    expect(credited()).toEqual([3]);
  });
});
