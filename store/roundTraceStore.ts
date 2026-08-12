/**
 * 2026-08-12 (Tim, driving to a nine-hole league) — "I want you to plan something in the issue log
 * that essentially you can watch this entire round go into the issue log, the entire dialogue,
 * everything I'm trying to do, tick by tick. It's gonna make for a long issue log, but find a way
 * for us to gather some meaningful diagnostics."
 *
 * A ROUND TRACE: a dedicated ring buffer that records what the app actually did, in order, for one
 * round — and then mails it.
 *
 * WHY NOT THE EXISTING ISSUE LOG. issueLogStore caps at 100 entries and is shared with real errors
 * and the tester's own notes. A round produces several hundred events, so tracing into it would
 * evict exactly the errors we care about — the trace would destroy the evidence it exists to gather.
 *
 * WHY IT IS NOT PERSISTED. A trace is for the round happening right now. Persisting hundreds of
 * events per round would grow AsyncStorage without bound and would survive into rounds it doesn't
 * describe. It lives in memory, gets mailed at the end, and disappears.
 *
 * DESIGN RULE: tracing must never change what it observes. Every write is a plain array push behind
 * an `active` check — no awaits, no network, no store subscriptions. Off, it costs one boolean read.
 */
import { create } from 'zustand';

export type TraceEvent =
  | 'round'        // lifecycle: start, hole change, end
  | 'course'       // resolution: search, select, geometry build
  | 'gps'          // fixes, accuracy, hole detection
  | 'voice'        // a turn, step by step, with timings
  | 'watch'        // swings received
  | 'shot'         // shots, scores, putts
  | 'caddie'       // what the caddie said and why
  | 'error';       // anything that failed

export interface TraceRow {
  /** ms since the trace started — far easier to read than wall clock when scanning a round. */
  t: number;
  event: TraceEvent;
  /** Short label: "hole_advance", "transcribe_ok", "swing_detected". */
  tag: string;
  /** Small structured payload. Kept flat and short so the emailed trace stays scannable. */
  data?: Record<string, string | number | boolean | null>;
}

/**
 * 2000 rows is roughly a five-hour round at a busy tick rate, and about 200KB of text — large for an
 * email but well inside what a mail client renders. The buffer drops the OLDEST rows when it fills,
 * because a truncated beginning is far less costly than losing the end, which is where a round's
 * problems usually surface.
 */
const MAX_ROWS = 2000;

interface RoundTraceState {
  active: boolean;
  startedAt: number | null;
  label: string | null;
  rows: TraceRow[];
  start: (label: string) => void;
  stop: () => void;
  push: (event: TraceEvent, tag: string, data?: TraceRow['data']) => void;
  clear: () => void;
}

export const useRoundTraceStore = create<RoundTraceState>()((set, get) => ({
  active: false,
  startedAt: null,
  label: null,
  rows: [],

  start: (label) => {
    set({ active: true, startedAt: Date.now(), label, rows: [] });
  },

  stop: () => set({ active: false }),

  push: (event, tag, data) => {
    const s = get();
    if (!s.active || s.startedAt == null) return;
    const row: TraceRow = { t: Date.now() - s.startedAt, event, tag, data };
    const rows = s.rows.length >= MAX_ROWS ? [...s.rows.slice(1), row] : [...s.rows, row];
    set({ rows });
  },

  clear: () => set({ active: false, startedAt: null, label: null, rows: [] }),
}));
