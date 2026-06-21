// Bundle hash bump: 2026-05-20 EAS asset processor was stuck on the
// prior hash; trivial change forces a new bundle id.
/**
 * Phase 418 — Unified swing validation gate (client side).
 *
 * Single source of truth for "is there a valid analyzable swing in this
 * footage." SmartMotion's pose overlay, metrics strip, and Insight card
 * all gate fabrication on this one call so they can't contradict each
 * other (the prior bug: skeleton + 82 mph "club speed" on floor footage
 * while the caddie correctly said "no player visible").
 *
 * Server emits valid_swing + validity_reason directly (api/swing-analysis
 * Phase 418). For backward compatibility — older API responses, cached
 * results — we fall back to an observation-text heuristic that catches
 * the no-player phrasing the analyst tends to write.
 */

import type { SwingAnalysis } from './poseDetection';

const NO_SWING_PHRASES = [
  'no player',
  'no person',
  'no human',
  'no swing visible',
  'no swing is visible',
  'no swing detected',
  'not in the shot',
  'not in the frame',
  'not in shot',
  'not in frame',
  'camera is pointed at',
  'camera pointed at',
  'pointed at the floor',
  'pointed at the ground',
  'pointed at the ceiling',
  'pointed at the sky',
  'too dark to',
  'frames are unreadable',
  'no analyzable swing',
];

export interface SwingValidity {
  valid: boolean;
  reason: string | null;
}

export function evaluateSwingValidity(analysis: SwingAnalysis | null): SwingValidity {
  if (!analysis) {
    return { valid: false, reason: 'No analysis available yet.' };
  }
  if (typeof analysis.valid_swing === 'boolean') {
    return {
      valid: analysis.valid_swing,
      reason: analysis.valid_swing ? null : (analysis.validity_reason ?? 'No analyzable swing detected.'),
    };
  }
  // Legacy fallback — sniff the observation text.
  const obs = (analysis.observation ?? '').toLowerCase();
  // Body-part guard: if the matched phrase appears within 20 chars of a body-part
  // word it's likely describing the player's anatomy ("hips not in the frame at
  // address"), not a no-player condition. Skip that phrase.
  const BODY_PART_RE = /\b(hip|shoulder|knee|elbow|wrist|foot|feet|head|arm|chest|back|hand|club)\b/i;
  const hit = NO_SWING_PHRASES.find(p => {
    const idx = obs.indexOf(p);
    if (idx < 0) return false;
    const window = obs.slice(Math.max(0, idx - 20), idx + p.length + 20);
    return !BODY_PART_RE.test(window);
  });
  if (hit) {
    return { valid: false, reason: capitalize(analysis.observation) };
  }
  return { valid: true, reason: null };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
