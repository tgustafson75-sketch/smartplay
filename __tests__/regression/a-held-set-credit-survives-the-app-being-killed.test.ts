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
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { usePracticePointsStore } from '../../store/practicePointsStore';
import { classifyPracticeSwings } from '../../services/swing/practiceSwings';
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
const demoteB = () => {
  const shots = useSwingSessionStore.getState().sessionHistory[0].shots;
  useSwingSessionStore.getState().setShotPracticeMarks('s', classifyPracticeSwings(shots as never, {
    a: { ball_struck: 'yes' }, b: { ball_struck: 'no' }, c: { ball_struck: 'yes' },
  }));
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
beforeEach(() => { seed(); books = { stamped: new Set(), samples: new Map() }; });

describe('a set\'s held practice credit survives the app being killed', () => {
  it('THE REPORT: Save mid-read, the app dies, the read had demoted swing b — the next launch credits a and c once', async () => {
    const l = credit.createSetCreditLedger((sid, s) => credit.creditSmartMotionSet(sid, s, books));
    l.readStarted('s');
    expect(l.request('s', snap).pending).toBe(true);   // Save: "Saved to your Swing Library"
    demoteB();                                           // the set's classifier ran before the kill
    // -- killed: the ledger is gone, its flush never runs --
    expect(credited()).toEqual([]);
    expect(sess().creditedPractice).not.toBe(true);
    // What is written to disk carries the held credit (the store's own partialize).
    const disk = useSwingSessionStore.persist.getOptions().partialize!(useSwingSessionStore.getState()) as { sessionHistory: { practiceCreditPending?: unknown }[] };
    expect(disk.sessionHistory[0].practiceCreditPending).toEqual(snap);

    expect(await launch()).toEqual(['s']);
    expect(credited()).toEqual([2]);
    expect(usePracticePointsStore.getState().total).toBeGreaterThan(0);
    expect(sess().creditedPractice).toBe(true);
    expect(held() ?? null).toBeNull();

    const pts = usePracticePointsStore.getState().total;
    expect(await launch()).toEqual([]);                  // and never twice
    expect(credited()).toEqual([2]);
    expect(usePracticePointsStore.getState().total).toBe(pts);
  });

  it('the app lives: the ledger applies the credit when the read settles and nothing is left held for the launch', async () => {
    const l = credit.createSetCreditLedger((sid, s) => credit.creditSmartMotionSet(sid, s, books));
    l.readStarted('s');
    l.request('s', snap);
    demoteB();
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
