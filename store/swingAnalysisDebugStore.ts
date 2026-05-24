/**
 * 2026-05-24 — Owner-tool swing-analysis telemetry.
 *
 * Captures the LAST swing-analysis call's frame counts so the owner
 * can verify in-app, without a Vercel dashboard or adb logcat, that
 * the pipeline is multi-frame end-to-end. The server now echoes its
 * REAL imageBlocks / textBlocks / mode / shortGame counts in the
 * `_debug` field of the /api/swing-analysis response; the client
 * pairs that with `wireFrames.length` (what it actually posted) and
 * stashes both here. The /swing-analysis-debug screen reads this and
 * shows PASS when the counts agree.
 *
 * Persisted to AsyncStorage so the last result survives app restarts
 * (helpful when Tim records, foregrounds the owner screen, and the
 * record path may have unmounted the analysis surface in between).
 * Capped at one entry — only the most recent run matters here. If we
 * later want a history, switch to an array with a small cap. Same
 * pattern as other small persisted stores (issueLogStore,
 * voiceMissStore).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export interface SwingAnalysisDebugEntry {
  /** ms-since-epoch when the analysis returned. */
  at: number;
  /** Count of image frames the client POSTed (wireFrames.length). */
  framesSent: number;
  /** Server's echoed count of image blocks reaching Sonnet. Null when
   *  the server didn't include the _debug field (legacy deploys). */
  imageBlocks: number | null;
  /** Server's echoed count of text blocks. Null on legacy deploys. */
  textBlocks: number | null;
  /** Server's echoed analysis mode ('analysis' | 'tentative'). Null on
   *  legacy deploys. */
  mode: string | null;
  /** Server's echoed short-game routing flag. Null on legacy deploys. */
  shortGame: boolean | null;
  /** Echoed back so the screen has context — what perspective routed
   *  this swing to /api/swing-analysis (vs /api/putting-analysis).
   *  Null when the caller didn't supply one. */
  perspective: string | null;
}

interface SwingAnalysisDebugState {
  last: SwingAnalysisDebugEntry | null;
  record: (entry: SwingAnalysisDebugEntry) => void;
  clear: () => void;
}

export const useSwingAnalysisDebugStore = create<SwingAnalysisDebugState>()(
  persist(
    (set) => ({
      last: null,
      record: (entry) => {
        set({ last: entry });
        console.log('[swing-analysis-debug] recorded',
          'sent', entry.framesSent,
          'server', entry.imageBlocks,
          'mode', entry.mode,
          'persp', entry.perspective);
      },
      clear: () => set({ last: null }),
    }),
    {
      name: 'swing-analysis-debug-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
