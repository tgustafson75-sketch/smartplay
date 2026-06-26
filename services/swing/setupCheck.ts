/**
 * 2026-06-14 (Tim — 20-min "get me ready" routine) — PRE-ROUND SETUP CHECK.
 *
 * The single highest-ROI 10-second pre-round read: one face-on ADDRESS photo →
 * a fundamentals read (grip / stance / ball position / posture). Momentum-first
 * by design — lead with what's dialed in, then ONE tweak — built for the
 * time-constrained golfer ([[time-constrained-golfer-lens]]), NOT a teardown.
 *
 * Rides the existing /api/swing-analysis pipeline via context.swing_tag='setup'
 * (SETUP_SYSTEM_PROMPT, server-staged). The response reuses the standard shape:
 *   - strengths   → the SOUND fundamentals (✓), causal rule-outs included
 *   - fix         → the ONE adjustment (or a KEEP cue when nothing to change)
 *   - observation → the ready / momentum line
 * so no fault-normalizer surgery and the same honesty gate (only what's visible).
 *
 * SERVER-GATED: lights up only once the SETUP_SYSTEM_PROMPT is deployed to
 * Vercel (bundled with the strengths deploy). Until then the entry point is
 * hidden (SETUP_CHECK_ENABLED), so this never shows a half-working read.
 */

import { getApiBaseUrl } from '../apiBase';
import * as ImageManipulator from 'expo-image-manipulator';

// LIVE 2026-06-14 — SETUP_SYSTEM_PROMPT deployed to Vercel (smartplay-beta
// alias re-pointed), so the setup read is wired end-to-end. Was false while the
// server prompt was staged-not-deployed (honesty: no UI on an unwired
// capability — [[no-deferred-wiring-placeholders]]).
export const SETUP_CHECK_ENABLED = true;

export type SetupCheckResult = {
  /** A readable person at address was found. */
  valid: boolean;
  /** When !valid — the honest reason + a reframe suggestion. */
  reason: string | null;
  /** The READY / momentum line — what to hear first. */
  readyNote: string;
  /** Sound, VISIBLE fundamentals (✓), causal rule-outs included. May be empty. */
  strengths: string[];
  /** The ONE adjustment, or a KEEP cue when the setup is sound. Null only on !valid. */
  adjustment: string | null;
  /** A quick setup rehearsal. */
  drill: string | null;
  /** "Frame 1: <visible cue>" — what the read was based on. */
  evidence: string | null;
};

// Framing/validity failure — the photo was reached + read, but no readable address.
const FAILED: SetupCheckResult = {
  valid: false,
  reason: 'Couldn\'t read your setup — stand back so I can see head to feet, face the camera, and try again.',
  readyNote: '',
  strengths: [],
  adjustment: null,
  drill: null,
  evidence: null,
};

// 2026-06-25 (Tank) — NETWORK/server failure is NOT a framing problem; saying "stand
// back" when the analyzer was unreachable is dishonest + sends the user re-staging a
// fine setup. Distinct, honest message + a retry affordance.
const FAILED_NETWORK: SetupCheckResult = {
  valid: false,
  reason: 'Couldn\'t reach the analyzer just now — check your signal and tap Retake to try again.',
  readyNote: '',
  strengths: [],
  adjustment: null,
  drill: null,
  evidence: null,
};

/**
 * Analyze a single address-position photo. Pure-ish: never throws — returns an
 * honest FAILED result on any error (offline / server / unreadable), matching
 * the caddie fail-safe discipline. caddieName threads voice when provided.
 */
export async function analyzeSetup(
  photoUri: string,
  opts?: { angle?: 'down_the_line' | 'face_on'; caddieName?: string; handedness?: 'left' | 'right' | null },
): Promise<SetupCheckResult> {
  // Image read can fail for capture reasons (corrupt file) — that's a FAILED (retake),
  // not a network issue. Done once, outside the network retry loop.
  let b64: string;
  try {
    // Resize to ~1024px long edge so the payload clears the server frame-size
    // gate (413 over ~limit) and the upload stays fast on cell.
    const manip = await ImageManipulator.manipulateAsync(
      photoUri,
      [{ resize: { width: 1024 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
    );
    const FS = await import('expo-file-system/legacy');
    const s = await FS.readAsStringAsync(manip.uri, { encoding: FS.EncodingType.Base64 });
    if (!s) return FAILED;
    b64 = s;
  } catch {
    return FAILED;
  }

  const body = JSON.stringify({
    frames: [{ b64, media_type: 'image/jpeg' }],
    context: {
      club: 'setup',
      swing_number: 1,
      swing_tag: 'setup',
      angle: opts?.angle ?? 'face_on',
      caddie_name: opts?.caddieName,
      handedness: opts?.handedness ?? null,
      // 2026-06-25 — 'full' tier (was 'quick'): setup is a one-shot pre-round read, so
      // it should get the OpenAI fallback when Gemini fails, not Gemini-only. The server
      // also exempts setup from the quick-short-circuit as a belt-and-suspenders.
      tier: 'full',
    },
  });

  // 2026-06-25 (Tank — wouldn't analyze): retry ONCE on a transient/network failure.
  // A cold Lambda can 502 the first call; the retry lands on the now-warm function.
  // A genuine network outage after the retry returns the honest NETWORK message, never
  // the misleading "stand back" framing message.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/swing-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        return FAILED_NETWORK;
      }
      const data = await res.json();

      const validSwing = data?.valid_swing !== false; // default true (legacy-safe)
      if (!validSwing) {
        return {
          ...FAILED,
          reason: (typeof data?.validity_reason === 'string' && data.validity_reason.trim())
            || (typeof data?.follow_up_question === 'string' && data.follow_up_question.trim())
            || FAILED.reason,
        };
      }

      const strengths = Array.isArray(data?.strengths)
        ? data.strengths.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 3)
        : [];
      const adjustment = typeof data?.fix === 'string' && data.fix.trim() ? data.fix.trim() : null;
      const readyNote = typeof data?.observation === 'string' && data.observation.trim()
        ? data.observation.trim()
        : 'You\'re set — go.';
      const drill = typeof data?.drill === 'string' && data.drill.trim() ? data.drill.trim() : null;
      const evidence = typeof data?.evidence === 'string' && data.evidence.trim() ? data.evidence.trim() : null;

      return { valid: true, reason: null, readyNote, strengths, adjustment, drill, evidence };
    } catch {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      return FAILED_NETWORK;
    }
  }
  return FAILED_NETWORK;
}
