/**
 * 2026-06-13 — Practice-session primitive (Practice Engine).
 *
 * The new container the Practice Engine is built on: a session holds N analyzed
 * Smart Motion swings under one shared intent and aggregates across them — exactly
 * like roundStore stamps shots with a roundId, here swings carry a practiceSessionId.
 * Practice runs THROUGH Smart Motion (no separate capture flow); this store is just
 * the session state + the running tally.
 *
 * 'open_range' = the honest mash-quantifier (Tim+Tank): keep hitting, it keeps a
 * running read (services/practice/openRangeStats.summarizeOpenRange) and surfaces
 * the blocked-practice nudge. 'focus' = a structured session (irons/wedges/driver
 * speed/putting) the Session Runner will drive — same primitive, an intent set.
 *
 * Persisted so a range session survives the app backgrounding mid-session. The
 * stamp helper (recordPracticeSwingIfActive) no-ops when no session is active, so
 * Smart Motion can call it unconditionally after each analysis. See memory
 * practice-engine-smartmotion.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import {
  summarizeOpenRange,
  type RangeSwingSample,
  type OpenRangeSummary,
} from '../services/practice/openRangeStats';

export type PracticeKind = 'open_range' | 'focus';

export interface PracticeSwing extends RangeSwingSample {
  id: string;
  at: number;
}

export interface PracticeSession {
  id: string;
  kind: PracticeKind;
  /** For 'focus' sessions: irons / wedges / driver_speed / putting / etc. */
  focus: string | null;
  /** cage / range / course — where the session is happening. */
  environment: string | null;
  /** Target rep count for a 'focus' session (the Session Runner walks the plan to
   *  this length). null for open-ended 'open_range'. */
  targetReps: number | null;
  startedAt: number;
  endedAt: number | null;
  swings: PracticeSwing[];
  // 2026-06-14 (Tim — points/history) — drill provenance + a display label so the
  // unified practice-history list can show drills alongside Open Range / Focus, and a
  // swingCount for records that carry a count but no per-swing samples (drills).
  drillId?: string | null;
  label?: string | null;
  swingCount?: number | null;
}

interface StartOpts {
  focus?: string | null;
  environment?: string | null;
  targetReps?: number | null;
}

interface PracticeSessionState {
  active: PracticeSession | null;
  history: PracticeSession[];
  startSession: (kind: PracticeKind, opts?: StartOpts) => void;
  /** Append an analyzed swing to the active session (no-op when none active). */
  recordSwing: (sample: RangeSwingSample) => void;
  endSession: () => void;
  /**
   * 2026-06-14 (Tim) — push an ALREADY-completed session straight to history
   * (for the drill flow, which awards at save and has no active-session lifecycle).
   * Keeps drills in the same unified practice history without touching the award path.
   */
  recordCompletedSession: (input: {
    kind: PracticeKind;
    focus?: string | null;
    drillId?: string | null;
    label?: string | null;
    swingCount?: number | null;
    environment?: string | null;
    // 2026-06-30 (audit M4) — per-swing samples (club/tempo/tier/divergence) so the
    // practice-detail screen shows real striation + tempo trend, not just "Session logged".
    swingSamples?: RangeSwingSample[];
  }) => void;
  /** Live read of the active session, or null. */
  activeSummary: () => OpenRangeSummary | null;
}

/** "driver_speed" → "Driver Speed", "irons" → "Irons". For the points label. */
function prettyFocus(focus: string): string {
  return focus.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

let _seq = 0;
function newId(prefix: string): string {
  _seq += 1;
  // Time + a per-session counter — unique without Math.random (kept deterministic-ish).
  return `${prefix}_${Date.now().toString(36)}_${_seq}`;
}

export const usePracticeSessionStore = create<PracticeSessionState>()(
  persist(
    (set, get) => ({
      active: null,
      history: [],
      startSession: (kind, opts) =>
        set({
          active: {
            id: newId('ps'),
            kind,
            focus: opts?.focus ?? null,
            environment: opts?.environment ?? null,
            targetReps: opts?.targetReps ?? null,
            startedAt: Date.now(),
            endedAt: null,
            swings: [],
          },
        }),
      recordSwing: (sample) => {
        const active = get().active;
        if (!active) return; // not in a practice session → nothing to stamp
        const swing: PracticeSwing = { ...sample, id: newId('sw'), at: Date.now() };
        set({ active: { ...active, swings: [...active.swings, swing] } });
      },
      endSession: () => {
        const active = get().active;
        if (!active) return;
        const ended: PracticeSession = { ...active, endedAt: Date.now() };
        set((s) => ({ active: null, history: [ended, ...s.history].slice(0, 50) }));
        // 2026-06-14 (Tim — wire the points) — EVERY session-based practice surface
        // (Open Range, Focus, SmartPlan) funnels through here, so award practice
        // points on completion (per-key ledger + the visible tier). Previously only
        // the Drills screen awarded; these surfaces granted nothing. Real swings only.
        const swings = active.swings.length;
        if (swings > 0) {
          try {
            const key = active.focus ? `focus:${active.focus}` : active.kind;
            const label = active.focus ? prettyFocus(active.focus) : (active.kind === 'open_range' ? 'Open Range' : 'Practice');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const pp = require('./practicePointsStore') as typeof import('./practicePointsStore');
            pp.usePracticePointsStore.getState().awardPracticePoints({ key, label, swings, now: Date.now() });
          } catch { /* award best-effort, never blocks ending a session */ }
        }
      },
      recordCompletedSession: ({ kind, focus, drillId, label, swingCount, environment, swingSamples }) => {
        const now = Date.now();
        // 2026-06-30 (audit M4) — stamp the collected per-swing samples so the detail
        // screen renders real per-club striation + tempo trend (was always empty here).
        const swings: PracticeSwing[] = (swingSamples ?? []).map((sample) => ({ ...sample, id: newId('sw'), at: now }));
        const session: PracticeSession = {
          id: newId('ps'),
          kind,
          focus: focus ?? null,
          environment: environment ?? null,
          targetReps: null,
          startedAt: now,
          endedAt: now,
          swings,
          drillId: drillId ?? null,
          label: label ?? null,
          swingCount: swingCount ?? (swings.length || null),
        };
        set((s) => ({ history: [session, ...s.history].slice(0, 50) }));
      },
      activeSummary: () => {
        const active = get().active;
        return active ? summarizeOpenRange(active.swings) : null;
      },
    }),
    {
      name: 'practice-session-v1',
      version: 1,
      // 2026-06-15 (audit) — passthrough migrate so a future version bump upgrades
      // cleanly instead of zustand silently discarding persisted state.
      migrate: (s) => s as never,
      // 2026-06-16 (Tim — clean state at restart) — persist ONLY history. The `active`
      // session is transient: persisting it re-spawned a "still running" session on
      // relaunch (stuck spinner, double-logged history, ghost swings stamped into a
      // dead session). It always starts null now; an unfinished session is dropped on
      // cold launch by design (a crash mid-practice shouldn't resurrect as live).
      partialize: (s) => ({ history: s.history }),
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);

/**
 * Stamp an analyzed swing into the active practice session if one is running.
 * Smart Motion calls this unconditionally after each swing analysis; it no-ops
 * when no session is active (the roundContextStamp pattern), so the capture flow
 * never needs to branch on "are we practicing?".
 */
export function recordPracticeSwingIfActive(sample: RangeSwingSample): void {
  usePracticeSessionStore.getState().recordSwing(sample);
}
