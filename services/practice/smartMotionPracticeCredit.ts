/**
 * SMARTMOTION PRACTICE CREDIT — every swing of a set counts, read or not, however the player leaves.
 *
 * 2026-10-27 (capture-half audit C5). Three ways a real swing went uncounted:
 *   1. The stamp into the active practice session was keyed by CLIP, so a 5-swing set stamped once.
 *   2. It waited for the cloud read (`analysis != null`), so a swing recorded with no signal was never
 *      stamped at all — the offline read lands later, on another screen, and nothing stamps it then.
 *   3. Points were credited only on Save / New Set; Back left the set in the library with no credit.
 *
 * The rule, pure: each swing of the set is stamped once (keyed by session + swing), a swing the read
 * demoted as a practice swing is never stamped or credited, the swing on screen carries what was
 * measured on it, and the rest carry only what is known (the club) — never an invented tempo or line.
 */
import type { RangeSwingSample } from './openRangeStats';
import { isPracticeSwing, type PracticeMark } from '../swing/practiceSwings';

type ShotLike = { practice?: PracticeMark | null } | null | undefined;

export const swingStampKey = (sessionId: string, index: number): string => `${sessionId}#${index}`;

export interface StampInput {
  sessionId: string;
  /** Swings in the set (segments). A single-swing capture is 1. */
  swingCount: number;
  /** The saved session's shots, in set order (practice demotion lives here once the read lands). */
  shots: readonly ShotLike[];
  stamped: ReadonlySet<string>;
  club: string | null;
  /** Stamp only this swing (the one on screen); omitted = every swing still unstamped. */
  only?: number;
  /** What was measured on the swing on screen. */
  measured?: { index: number; sample: RangeSwingSample } | null;
  /**
   * 2026-10-27 (seam review of SB3b × SB3e) — false while the set's READ is still running. The review shows
   * swing 1 as soon as ITS read lands, but the practice classifier runs only after every swing is read, so a
   * swing-1 stamp then was credited before the read could demote it. The swing on screen waits for the read to
   * settle (offline it settles at once, failed — still stamped). Absent = settled.
   * 2026-10-27 (Phase SB4x) — the whole set too: Save / New Set / Back mid-read wait (createSetCreditLedger).
   */
  readSettled?: boolean;
}

export function samplesToStamp(input: StampInput): { key: string; index: number; sample: RangeSwingSample }[] {
  if (input.readSettled === false) return [];
  const n = Math.max(1, input.swingCount, input.shots.length);
  const indexes = input.only != null ? [input.only] : Array.from({ length: n }, (_, i) => i);
  const out: { key: string; index: number; sample: RangeSwingSample }[] = [];
  for (const i of indexes) {
    if (i < 0 || i >= n) continue;
    const key = swingStampKey(input.sessionId, i);
    if (input.stamped.has(key)) continue;
    if (isPracticeSwing(input.shots[i])) continue;
    const sample: RangeSwingSample = input.measured && input.measured.index === i
      ? input.measured.sample
      : { club: input.club, tier: 'none', tempoRatio: null, divergenceDeg: null };
    out.push({ key, index: i, sample });
  }
  return out;
}

/** Swings the set earns credit for: every swing but the ones the read demoted, at least one. */
export function creditedSwingCount(input: { swingCount: number; drillShotCount?: number | null; shots: readonly ShotLike[] }): number {
  const demoted = input.shots.filter(isPracticeSwing).length;
  return Math.max(1, (input.swingCount || input.drillShotCount || 1) - demoted);
}

/** Leaving the screen credits a set that was saved and not credited yet (Save / New Set already did it otherwise). */
export function shouldCreditOnLeave(input: { sessionId: string | null; alreadyCredited: boolean }): boolean {
  return !!input.sessionId && !input.alreadyCredited;
}

/** What a set's credit needs, captured when the player Saves / starts a New Set / leaves (the screen moves on). */
export interface SetCreditSnapshot {
  /** Swings in the set (segments) at the moment the credit was asked for. */
  swingCount: number;
  drillShotCount: number | null;
  club: string | null;
  /** A drill-launched set is credited under the drill; otherwise under `clubKey`. */
  drill: { id: string; label: string | null } | null;
  clubKey: string;
  /** Save / New Set: when the credit lands after the read, the screen says the points (leaving says nothing). */
  announce?: boolean;
}

/** The screen's books, kept per session id so a set's credit survives the screen moving on to the next set. */
export interface SetCreditBooks {
  stamped: Set<string>;
  samples: Map<string, RangeSwingSample[]>;
}

/** Stamp the swings of `sid` that `samplesToStamp` returns into the active practice session (and the set's samples). */
export function stampSetSwings(
  sid: string,
  books: SetCreditBooks,
  input: Omit<StampInput, 'sessionId' | 'shots' | 'stamped'>,
): number {
  const { useSwingSessionStore } = require('../../store/swingSessionStore') as typeof import('../../store/swingSessionStore');
  const { recordPracticeSwingIfActive } = require('../../store/practiceSessionStore') as typeof import('../../store/practiceSessionStore');
  const shots = useSwingSessionStore.getState().sessionHistory.find((x) => x.id === sid)?.shots ?? [];
  const out = samplesToStamp({ ...input, sessionId: sid, shots, stamped: books.stamped });
  for (const o of out) {
    books.stamped.add(o.key);
    recordPracticeSwingIfActive(o.sample);
    books.samples.set(sid, [...(books.samples.get(sid) ?? []), o.sample]);
  }
  return out.length;
}

/**
 * The set's credit: stamp every swing not yet stamped (never a demoted one), then award once per session —
 * here only when no practice session is running (endSession awards those). Returns the points awarded here.
 */
export function creditSmartMotionSet(sid: string, snap: SetCreditSnapshot, books: SetCreditBooks): number | null {
  const { useSwingSessionStore } = require('../../store/swingSessionStore') as typeof import('../../store/swingSessionStore');
  const { usePracticeSessionStore } = require('../../store/practiceSessionStore') as typeof import('../../store/practiceSessionStore');
  const { usePracticePointsStore } = require('../../store/practicePointsStore') as typeof import('../../store/practicePointsStore');
  stampSetSwings(sid, books, { swingCount: snap.swingCount, club: snap.club });
  const session = useSwingSessionStore.getState().sessionHistory.find((x) => x.id === sid);
  // 2026-10-26 — a swing the read demoted as practice earns no credit (services/swing/practiceSwings).
  const swings = creditedSwingCount({ swingCount: snap.swingCount, drillShotCount: snap.drillShotCount, shots: session?.shots ?? [] });
  // 2026-06-30 (audit M1) — an active Open Range / Focus / SmartPlan session already holds these swings and
  // awards them at endSession. 2026-07-23 (QA) — and a session already credited is never credited again.
  const sessionActive = usePracticeSessionStore.getState().active != null;
  const alreadyCredited = session?.creditedPractice === true;
  const swingSamples = books.samples.get(sid) ?? [];
  let pts: number | null = null;
  if (!sessionActive && !alreadyCredited) {
    if (snap.drill) {
      pts = usePracticePointsStore.getState().awardPracticePoints({ key: snap.drill.id, label: snap.drill.label, swings, now: Date.now() });
      usePracticeSessionStore.getState().recordCompletedSession({ kind: 'focus', focus: snap.drill.id, drillId: snap.drill.id, label: snap.drill.label, swingCount: swings, swingSamples });
    } else {
      pts = usePracticePointsStore.getState().awardPracticePoints({ key: `smartmotion:${snap.clubKey}`, label: snap.clubKey, swings, now: Date.now() });
      usePracticeSessionStore.getState().recordCompletedSession({ kind: 'open_range', focus: snap.clubKey, label: snap.clubKey, swingCount: swings, swingSamples });
    }
  }
  useSwingSessionStore.getState().setSessionCreditedPractice(sid, true);
  books.samples.delete(sid);
  return pts;
}

/**
 * 2026-10-27 (Phase SB4x, review "practice #3" / "capture #1") — WHEN A SET'S CREDIT IS APPLIED: once the
 * set's read has settled. The review opens as soon as swing 1's own read lands, but the practice classifier
 * runs at the END of the set's read, so Save / New Set (a queued go-again too) / Back credited the whole set
 * before any swing could be demoted, then marked it credited for good. Asked for while a read of that
 * session is in flight, the credit is HELD (the first ask's snapshot; later asks join it) and applied once
 * when the last read ends (`flush`). Keyed by the session id it was asked for, never by the screen's current
 * session: reset() and New Set clear that before the read ends. Never applied twice by this ledger.
 *
 * 2026-10-27 (Phase SB5, recheck "credit held in memory only") — a held credit is ALSO written to the swing
 * session (practiceCreditPending): this ledger lives in the screen's memory, and a set saved mid-read whose
 * app was killed before the read settled lost its credit for good. applyHeldSetCredits applies it at launch.
 */
export function createSetCreditLedger<R>(apply: (sid: string, snap: SetCreditSnapshot, late: boolean) => R) {
  const inFlight = new Map<string, number>();
  const held = new Map<string, SetCreditSnapshot>();
  const done = new Set<string>();
  const settled = (sid: string) => (inFlight.get(sid) ?? 0) === 0;
  return {
    readStarted(sid: string): void { inFlight.set(sid, (inFlight.get(sid) ?? 0) + 1); },
    readEnded(sid: string): void {
      const n = (inFlight.get(sid) ?? 0) - 1;
      if (n > 0) inFlight.set(sid, n); else inFlight.delete(sid);
    },
    isSettled: settled,
    /** Save / New Set / leave. Applied now when no read of `sid` is in flight; otherwise held for `flush`. */
    request(sid: string, snap: SetCreditSnapshot): { pending: boolean; result?: R } {
      if (done.has(sid)) return { pending: false };
      if (!settled(sid)) {
        if (!held.has(sid)) {
          held.set(sid, snap);
          holdOnSession(sid, snap);
        }
        return { pending: true };
      }
      const s = held.get(sid) ?? snap;
      held.delete(sid);
      done.add(sid);
      return { pending: false, result: apply(sid, s, false) };
    },
    /** The read of `sid` ended: apply a held credit once no read of it is in flight. True when applied. */
    flush(sid: string): boolean {
      if (!settled(sid) || done.has(sid)) return false;
      const s = held.get(sid);
      if (!s) return false;
      held.delete(sid);
      done.add(sid);
      apply(sid, s, true);
      return true;
    },
  };
}

/** The held credit, on the session (persisted): applyHeldSetCredits finds it if the app dies first. */
function holdOnSession(sid: string, snap: SetCreditSnapshot): void {
  try {
    const { useSwingSessionStore } = require('../../store/swingSessionStore') as typeof import('../../store/swingSessionStore');
    useSwingSessionStore.getState().setSessionPracticeCreditPending(sid, snap);
  } catch { /* the in-memory hold still applies it while the app lives */ }
}

type Persisted = { persist?: { hasHydrated: () => boolean; onFinishHydration: (cb: () => void) => () => void } };
const hydrated = (store: Persisted): Promise<void> => new Promise((resolve) => {
  const p = store.persist;
  if (!p || p.hasHydrated()) { resolve(); return; }
  const off = p.onFinishHydration(() => { off(); resolve(); });
});

/**
 * 2026-10-27 (Phase SB5) — AT LAUNCH: every set whose credit was held for a read the app did not live to see
 * settle is credited now, once, without the swings a read demoted (creditSmartMotionSet). A read of it still
 * going (the read that waited for a connection) is waited for first. Every store it writes has loaded first:
 * points awarded into a store that was still loading would be overwritten by what it loads. Returns the sets
 * credited. Called once at boot (app/_layout).
 */
export async function applyHeldSetCredits(): Promise<string[]> {
  const { useSwingSessionStore } = require('../../store/swingSessionStore') as typeof import('../../store/swingSessionStore');
  const { usePracticeSessionStore } = require('../../store/practiceSessionStore') as typeof import('../../store/practiceSessionStore');
  const { usePracticePointsStore } = require('../../store/practicePointsStore') as typeof import('../../store/practicePointsStore');
  await Promise.all([useSwingSessionStore, usePracticeSessionStore, usePracticePointsStore].map((st) => hydrated(st as unknown as Persisted)));
  const { liveRun } = require('../swing/orchestrator/engine') as typeof import('../swing/orchestrator/engine');
  const { swingRunKey } = require('../swing/orchestrator/shotDetail') as typeof import('../swing/orchestrator/shotDetail');
  const held = () => useSwingSessionStore.getState().sessionHistory.filter((x) => x.practiceCreditPending != null);
  const out: string[] = [];
  for (const { id } of held()) {
    await liveRun(swingRunKey(id))?.done;
    const s = useSwingSessionStore.getState().sessionHistory.find((x) => x.id === id);
    const snap = s?.practiceCreditPending;
    if (!s || !snap) continue;
    if (s.creditedPractice === true) { useSwingSessionStore.getState().setSessionPracticeCreditPending(id, null); continue; }
    try {
      creditSmartMotionSet(id, snap, { stamped: new Set(), samples: new Map() });
      out.push(id);
    } catch { /* non-fatal: still held, tried again next launch */ }
  }
  return out;
}
