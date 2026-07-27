import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/**
 * 2026-07-27 — SESSION FOCUS (Tim).
 *
 * "I get to the range and want to say: hey, I'm here, I want to work on my slice, this is what we're
 * doing — and have everything for the rest of the session point at that." A lightweight, conversational
 * intent the caddie HOLDS for the session and orients around (drill picks, how it reads each swing,
 * encouragement all tie back to it) — the loose seed of a guided flow, not a rigid step runner.
 *
 * Durable (persisted) so it survives the conversation history rolling over mid-session — that was the
 * whole gap. Auto-EXPIRES after a day's worth of hours so a stale goal never silently drives the caddie
 * tomorrow. Read via activeFocus()/sessionFocusPromptLine(), which drop a stale focus on read.
 */

// A stated focus colors the SESSION, not the week. 8h covers a long range/round day and is gone by the
// next morning. Explicit clear or a new focus overrides it sooner.
const FOCUS_TTL_MS = 8 * 60 * 60 * 1000;

export interface SessionFocus {
  /** What to work on, in the player's words ("my slice", "tempo", "chipping distance control"). */
  goal: string;
  /** Optional extra detail ("staying in posture"). */
  note?: string | null;
  /** Where the session is, when the caddie knows it. */
  context?: 'range' | 'course' | 'practice' | null;
  /** ms epoch the focus was set — drives the TTL. */
  startedAt: number;
}

interface SessionFocusState {
  focus: SessionFocus | null;
  setFocus: (goal: string, opts?: { note?: string | null; context?: SessionFocus['context']; now?: number }) => void;
  clearFocus: () => void;
  /** The active focus, or null when none / expired. Reading a stale focus auto-clears it (no ghosts). */
  activeFocus: (now?: number) => SessionFocus | null;
}

export const useSessionFocusStore = create<SessionFocusState>()(
  persist(
    (set, get) => ({
      focus: null,
      setFocus: (goal, opts) => {
        const g = (goal ?? '').trim();
        if (!g) return;
        set({ focus: { goal: g.slice(0, 120), note: opts?.note?.trim()?.slice(0, 120) ?? null, context: opts?.context ?? null, startedAt: opts?.now ?? Date.now() } });
      },
      clearFocus: () => set({ focus: null }),
      activeFocus: (now) => {
        const f = get().focus;
        if (!f) return null;
        const t = now ?? Date.now();
        if (!(f.startedAt > 0) || t - f.startedAt > FOCUS_TTL_MS) { set({ focus: null }); return null; }
        return f;
      },
    }),
    { name: 'session-focus-v1', storage: createJSONStorage(() => getPersistStorage()) },
  ),
);

/**
 * One-line focus framing for the brain prompt (injected FIRST in the caddie context), or null when
 * there's no active focus. Tells the brain to orient the whole session around it — and to let it go if
 * the player clearly moves on. Pure read; auto-expires a stale focus.
 */
export function sessionFocusPromptLine(now?: number): string | null {
  const f = useSessionFocusStore.getState().activeFocus(now);
  if (!f) return null;
  // 2026-07-27 (full-app audit) — DON'T bake the location ("at the range") into the line. The focus
  // persists up to 8h across contexts, so a range focus would inject "…at the range" into on-course reads.
  // Keep it location-neutral; the brain already knows the current context from the rest of the block.
  const note = f.note ? ` (${f.note})` : '';
  return `SESSION FOCUS — the player set this session to work on ${f.goal}${note}. Orient everything around it: tie your reads, drill picks, and encouragement back to this focus rather than treating each shot fresh. If they clearly move on to something else, let it go naturally.`;
}
