/**
 * 2026-11-01 — The one-line golf program summary Kevin reads each turn.
 *
 * Rides the per-turn context tail (services/caddieRequestBody.ts, contextSuffix path), so it never
 * touches the cached system prompt. Self-gating: no active Swing Rx means no line at all, never a
 * "none" placeholder. Kept short because the tail is cut first when the context block is full.
 */
import type { LoggedSetEvent } from './sessionTypes';
import { computeRxProgress, type SwingPrescription } from './swingRx';

export const GOLF_PROGRAM_LINE_MAX = 300;

export function golfProgramLine(rx: SwingPrescription | null, loggedSets: LoggedSetEvent[]): string | null {
  if (!rx) return null;
  const p = computeRxProgress(rx, loggedSets);
  const line = `GOLF PROGRAM: active Swing Rx for ${rx.label} (${rx.movements.length} movements). `
    + `${p.setsLogged} of ${p.targetSets} Rx sets logged since the import.`;
  return line.length > GOLF_PROGRAM_LINE_MAX ? line.slice(0, GOLF_PROGRAM_LINE_MAX) : line;
}
