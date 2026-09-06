/**
 * GET /flags — remote kill switches (Layer 0).
 *
 * 2026-09-06 (Tim) — the app must be able to dark a feature on a phone already in a player's pocket,
 * with no rebuild, no OTA and no store review. This is the read side of that.
 *
 * WHY EDGE CONFIG AND NOT A JSON FILE IN THIS REPO: a committed file would require a git push to flip
 * a switch, and the whole point is flipping one mid-round from a phone. Edge Config values are edited
 * from the Vercel dashboard or REST API and take effect on the next read.
 *
 * WHY A PLAIN FETCH AND NOT @vercel/edge-config: this is one GET of one small document. The SDK would
 * be a new dependency for a single read, and every other upstream in api/ is called with plain fetch.
 * The connection string in EDGE_CONFIG already carries the store id and read token.
 *
 * THE TOKEN NEVER LEAVES THE SERVER. The mobile app holds no Vercel credential — it reads this route,
 * which is public and returns nothing secret. That is the entire reason this endpoint exists rather
 * than the app talking to Edge Config directly.
 *
 * FAIL-OPEN IS THE CONTRACT. If Edge Config is unreachable or malformed, this returns the all-ON
 * defaults with 200, not a 5xx. A kill switch whose outage kills the app is worse than no kill switch:
 * the client already treats any failure as "keep what you have", and a 5xx here would be a second way
 * to say the same thing with more moving parts. The `source` field says which happened so a probe can
 * tell a real read from a fallback without changing how any client behaves.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';

/** Shipped defaults. Every feature ON. Must mirror DEFAULT_FLAGS in store/flagStore.ts. */
const DEFAULTS = {
  flags: {
    smartvision: true,
    smartfinder: true,
    swinglab: true,
    cage_capture: true,
    voice_caddie: true,
    kevin_tool_routing: true,
    lie_analysis: true,
    swing_analysis: true,
  },
  course_geometry: { disabled_course_ids: [] as string[] },
  min_supported_build: 0,
  updated_at: '2026-09-06T00:00:00Z',
};

/**
 * The single upstream read, bounded. 3s is not a tuned threshold — it is shorter than Vercel's own
 * function ceiling so a hung Edge Config returns defaults rather than holding the connection open.
 */
const READ_TIMEOUT_MS = 3_000;

type Items = Record<string, unknown>;

/** Read every item in the store. Returns null on any failure — the caller serves defaults. */
async function readStore(connection: string): Promise<Items | null> {
  // EDGE_CONFIG is `https://edge-config.vercel.com/<id>?token=<t>`; items live at `<id>/items`.
  let url: URL;
  try {
    url = new URL(connection);
  } catch {
    return null;
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/items`;

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    return json as Items;
  } catch {
    return null;
  }
}

/** Keep only real booleans, and only for keys we ship. An unknown key is ignored; a missing or
 *  non-boolean known key keeps its default rather than darkening the feature. */
function mergeFlags(raw: unknown): typeof DEFAULTS.flags {
  const out = { ...DEFAULTS.flags };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULTS.flags) as (keyof typeof DEFAULTS.flags)[]) {
    if (typeof src[key] === 'boolean') out[key] = src[key] as boolean;
  }
  return out;
}

/** Course ids are opaque strings; anything else in the array is dropped rather than coerced. */
function mergeDisabledCourses(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const list = (raw as Record<string, unknown>).disabled_course_ids;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  /**
   * 30s fresh / 300s stale-while-revalidate. The success criterion is "flip it and see it within 60
   * seconds on the next app foreground", and the client's own minimum fetch interval is also 60s, so
   * a 30s edge TTL cannot be the thing that misses that window.
   */
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');

  const connection = process.env.EDGE_CONFIG;
  const items = connection ? await readStore(connection) : null;

  if (!items) {
    // Fail-open. Not an error to the caller — see the header comment.
    res.status(200).json({ ...DEFAULTS, source: connection ? 'defaults_unreachable' : 'defaults_unconfigured' });
    return;
  }

  const minBuild = items.min_supported_build;
  const updatedAt = items.updated_at;

  res.status(200).json({
    flags: mergeFlags(items.flags),
    course_geometry: { disabled_course_ids: mergeDisabledCourses(items.course_geometry) },
    min_supported_build: typeof minBuild === 'number' && Number.isFinite(minBuild) ? minBuild : DEFAULTS.min_supported_build,
    updated_at: typeof updatedAt === 'string' ? updatedAt : DEFAULTS.updated_at,
    source: 'edge_config',
  });
}
