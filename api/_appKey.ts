import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

/**
 * 2026-07-23 (QA — inference-endpoint auth, root-cause tie-in) — shared app-key gate.
 *
 * Several endpoints invoke PAID inference (image generation, vision, LLM) and shipped fully
 * unauthenticated, so a curl loop could bill them indefinitely. This is the single, constant-time
 * gate they share — extracted from api/image-edit.ts so every gated route checks the key identically
 * instead of copy-pasting the hash dance (and drifting).
 *
 * It's a LOW bar on purpose: the key ships inside the app bundle (public), so this stops drive-by /
 * automated abuse, NOT a determined attacker. Real per-user auth is a broader architectural decision.
 * The client sends it via appKeyHeaders() (services/apiBase.ts) — keep the two in lockstep.
 *
 * Rollout is TWO-PHASE per endpoint to avoid a 401 window: (1) OTA a client build that sends the
 * header, THEN (2) push the server that requires it. Never flip the server gate before the client
 * that calls it is sending the header.
 */
const APP_KEY = process.env.SPC_APP_KEY || 'spc_share_k1_2f8d61b4c07a49e3a1d5e9f60b3c7a29';
const APP_KEY_HASH = createHash('sha256').update(APP_KEY).digest('hex');

/** Constant-time check of the caller's x-app-key header against the shared key. */
export function isAppKeyValid(req: VercelRequest): boolean {
  const provided = String(req.headers['x-app-key'] ?? '').trim();
  // Length-gate first so the hash compare only runs on plausibly-correct input; the
  // sha256 compare itself is what makes the match constant-time (no early-exit on the raw key).
  return provided.length === APP_KEY.length &&
    createHash('sha256').update(provided).digest('hex') === APP_KEY_HASH;
}

/**
 * Enforce the app-key gate. Returns true when authorized; when NOT, it has already written a 401
 * and the caller must `return` immediately. Usage:
 *   if (!requireAppKey(req, res)) return;
 */
export function requireAppKey(req: VercelRequest, res: VercelResponse): boolean {
  if (isAppKeyValid(req)) return true;
  res.status(401).json({ error: 'unauthorized' });
  return false;
}
