/**
 * 2026-07-23 — Course Cloud upload endpoint.
 *
 * A consenting client POSTs the hole geometry it just derived (AI-vision over a satellite
 * tile, or bundled/OSM coords) so every later player of that course reads it back instantly
 * from api/course-geometry — the AI pass happens once per course, not once per user.
 *
 *   POST /api/course-geometry-share
 *     { course_id, contributor, holes: [{ hole, tee_lat, tee_lng, green_lat, green_lng,
 *       green_front_lat, green_front_lng, green_back_lat, green_back_lng, par, yardage,
 *       source?, confidence? }, ...] }
 *
 * PRIVACY: coords only. `contributor` is hashed server-side to an opaque id (never stored
 * raw, never reversible to an identity) purely to de-dupe/rate one device's submissions.
 * Gated by the client's ONE community-data consent toggle (settingsStore.shareCommunityData);
 * the server additionally requires the shared app key so it isn't an open write endpoint.
 * Rows live in smartplay.course_geometry* (service-key only). Requires migration 0006.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';
import { applyCors } from './_cors';
import { getSmartPlaySupabase } from './_supabase';
import { recordContribution, type SharedHoleInput } from './_courseCloud';

// Same public app key the messaging gate uses — a low bar that stops drive-by writes from
// non-app clients without requiring per-user auth. Rotate via env if ever abused.
const APP_KEY = process.env.SPC_APP_KEY || 'spc_share_k1_2f8d61b4c07a49e3a1d5e9f60b3c7a29';
const CONTRIB_SALT = process.env.SPC_CONTRIB_SALT || 'spc_course_cloud_salt_v1';
const MAX_HOLES = 36;

function norm(v: unknown): string {
  return String(v ?? '').trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  // App-key gate — constant-time compare so a wrong key can't be timed out.
  const provided = norm(req.headers['x-app-key']);
  const expected = APP_KEY;
  const ok = provided.length === expected.length &&
    createHash('sha256').update(provided).digest('hex') === createHash('sha256').update(expected).digest('hex');
  if (!ok) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const db = getSmartPlaySupabase();
  if (!db) return res.status(200).json({ ok: false, error: 'not_configured' });

  const body = (req.body ?? {}) as { course_id?: unknown; contributor?: unknown; holes?: unknown };
  const courseId = norm(body.course_id);
  if (!courseId) return res.status(400).json({ ok: false, error: 'no_course_id' });
  if (!Array.isArray(body.holes) || body.holes.length === 0) return res.status(400).json({ ok: false, error: 'no_holes' });
  if (body.holes.length > MAX_HOLES) return res.status(413).json({ ok: false, error: 'too_many_holes' });

  // Opaque, non-reversible contributor id. Falls back to a shared bucket when the client
  // sends no identifier (still lets us count, just can't distinguish that device).
  const contributorRaw = norm(body.contributor) || 'anon';
  const contributorHash = createHash('sha256').update(`${CONTRIB_SALT}:${contributorRaw}`).digest('hex');

  try {
    const written = await recordContribution(db, courseId, contributorHash, body.holes as SharedHoleInput[]);
    return res.status(200).json({ ok: true, written });
  } catch (e) {
    console.error('[course-geometry-share] failed:', e instanceof Error ? e.message : e);
    return res.status(200).json({ ok: false, error: 'write_failed' });
  }
}
