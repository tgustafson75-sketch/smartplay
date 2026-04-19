/**
 * useSituationalContext
 *
 * Lightweight situational awareness layer for the CADDIE.
 * Reads recent shot results, optional heart-rate data, and current hole
 * to determine pressure level and round phase, then subtly adjusts responses.
 *
 * Rules:
 *  - Never blocks or delays voice pipeline
 *  - Always falls back gracefully when data is absent
 *  - Watch/HR input is optional — app works fine without it
 *  - Does NOT add extra voice triggers — only modifies existing responses
 */

import { useRef } from 'react';
import { useRoundStore } from '../store/roundStore';

type Pressure   = 'normal' | 'elevated';
type RoundPhase = 'early' | 'mid' | 'late';
type PerfTrend  = 'confident' | 'struggling';

// ── Pressure ─────────────────────────────────────────────────────────────────

/**
 * Derive pressure level from the last 3 shot results.
 * Elevated = 2+ misses in the same direction within the last 3 shots.
 */
function detectPressure(shotResults: string[]): Pressure {
  if (shotResults.length < 3) return 'normal';
  const recent = shotResults.slice(-3);
  const missesRight = recent.filter((r) => r === 'right').length;
  const missesLeft  = recent.filter((r) => r === 'left').length;
  if (missesRight >= 2 || missesLeft >= 2) return 'elevated';
  return 'normal';
}

/**
 * Append a short calming cue when pressure is elevated.
 * Operates on the final built string — one sentence max, no hype.
 */
function applyPressureAdjustment(response: string, pressure: Pressure): string {
  if (pressure !== 'elevated') return response;
  if (/smooth|breathe|easy|one thought|stay with/i.test(response)) return response;
  const base = response.replace(/[.!?]+$/, '');
  return `${base}. Smooth swing.`;
}

// ── Round phase ───────────────────────────────────────────────────────────────

function getRoundPhase(hole: number): RoundPhase {
  if (hole <= 6)  return 'early';
  if (hole <= 14) return 'mid';
  return 'late';
}

// ── Performance trend ─────────────────────────────────────────────────────────

function getPerformanceTrend(shotResults: string[]): PerfTrend {
  if (shotResults.length < 3) return 'struggling'; // not enough data — play safe
  const recent = shotResults.slice(-3);
  const good = recent.filter((r) => r === 'good' || r === 'center').length;
  return good >= 2 ? 'confident' : 'struggling';
}

/**
 * Adjust response for round phase + performance trend.
 * Changes are intentionally minimal — one appended phrase or a safe swap.
 */
function applyRoundAdjustment(
  response: string,
  phase: RoundPhase,
  trend: PerfTrend,
): string {
  if (phase === 'early') return response; // no change — stay neutral

  if (phase === 'mid') {
    // Avoid double-appending a consistency cue
    if (/consistent|pattern|stay with/i.test(response)) return response;
    const base = response.replace(/[.!?]+$/, '');
    return `${base}. Stay consistent.`;
  }

  if (phase === 'late') {
    if (trend === 'struggling') {
      // Override to a conservative play — keep it short
      return 'Play safe. Center.';
    }
    if (trend === 'confident') {
      if (/go at|attack|pin/i.test(response)) return response;
      const base = response.replace(/[.!?]+$/, '');
      return `${base}. You can go at it.`;
    }
  }

  return response;
}

export function useSituationalContext() {
  const shots       = useRoundStore((s) => s.shots);
  const currentHole = useRoundStore((s) => s.currentHole);

  // Heart-rate state — updated externally if watch is present
  const hrPressureRef = useRef<Pressure>('normal');

  /**
   * Call this if a connected watch reports heart rate.
   * Safe to call with any numeric value — no-ops below threshold.
   */
  const updateHeartRate = (hr: number): void => {
    hrPressureRef.current = hr > 110 ? 'elevated' : 'normal';
  };

  /**
   * Compute the current pressure level from shot pattern + optional HR.
   * Either source can independently raise pressure.
   */
  const getPressure = (): Pressure => {
    const shotResults = shots.map((s) => s.result);
    const shotPressure = detectPressure(shotResults);
    if (shotPressure === 'elevated' || hrPressureRef.current === 'elevated') {
      return 'elevated';
    }
    return 'normal';
  };

  /**
   * Adjust a caddie response string based on current situational context.
   * Applies pressure adjustment first, then round-phase adjustment.
   * Only modifies the string — never speaks, never triggers state changes.
   *
   * @param response  The response string from buildResponse / getAIResponse
   * @returns         Adjusted response string
   */
  const adjustForContext = (response: string): string => {
    const pressure = getPressure();
    return applyPressureAdjustment(response, pressure);
  };

  return { adjustForContext, updateHeartRate, getPressure };
}
