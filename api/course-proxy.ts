import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowInference } from './_inferLimit';

const BASE = 'https://api.golfcourseapi.com';
const TIMEOUT_MS = 10_000;

async function proxyFetch(url: string, apiKey: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = res.ok ? await res.json() : await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/**
 * 2026-09-23 — EVERY ANSWER FROM THE PAID KEY IS SHARED, AND THE LIMIT HAS ITS OWN NAME.
 *
 * Nothing here was cached, so the same search or the same course cost quota on every phone, every
 * time — and one course open costs several calls (relaxed re-queries, detail, the download engine's
 * resolve, the geometry build's own detail). On 09-23 the key hit "daily usage limit exceeded" and
 * every uncached course in the app stopped loading. A course's card does not change hour to hour:
 * the CDN serves repeats without invoking this function at all.
 *
 * Only a 200 is cached. The upstream quota answer is passed on as `course_db_daily_limit` so the
 * client can tell it apart from our own per-IP throttle (`rate_limited`) and say which one it is.
 */
export const SEARCH_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800';
export const DETAIL_CACHE_CONTROL = 'public, s-maxage=604800, stale-while-revalidate=2592000';

function upstreamError(status: number, body: unknown): { error: string; raw: unknown } {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  if (status === 429 && /daily usage limit/i.test(text)) return { error: 'course_db_daily_limit', raw: body };
  return { error: `Upstream error ${status}`, raw: body };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 2026-08-08 (course-engine audit gap #4) — proxies the PAID golfcourseapi key; add the same IP
  // throttle as course-geometry so the quota can't be burned by a loop.
  if (!allowInference(req, res, 'course-proxy', 60)) return;
  const apiKey = process.env.GOLFCOURSE_API_KEY;
  if (!apiKey) {
    console.error('[golfcourseapi] GOLFCOURSE_API_KEY not set in environment');
    return res.status(500).json({ error: 'GOLFCOURSE_API_KEY not set in environment.' });
  }

  const { action, q, id } = req.query as Record<string, string | undefined>;

  if (action === 'search') {
    if (!q) return res.status(400).json({ error: 'Missing search query (q=...)' });

    const url = `${BASE}/v1/search?search_query=${encodeURIComponent(q)}`;
    console.log('[golfcourseapi] search ->', url);

    try {
      const { ok, status, body } = await proxyFetch(url, apiKey);
      if (!ok) {
        console.error(`[golfcourseapi] search upstream ${status}:`, body);
        return res.status(status).json(upstreamError(status, body));
      }
      console.log('[golfcourseapi] search response keys:', Object.keys(body as object));
      res.setHeader('Cache-Control', SEARCH_CACHE_CONTROL);
      return res.status(200).json(body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error('[golfcourseapi] search exception:', msg);
      return res.status(500).json({ error: msg });
    }
  }

  if (action === 'detail') {
    if (!id) return res.status(400).json({ error: 'Missing course id (id=...)' });

    const url = `${BASE}/v1/courses/${encodeURIComponent(id)}`;
    console.log('[golfcourseapi] detail ->', url);

    try {
      const { ok, status, body } = await proxyFetch(url, apiKey);
      if (!ok) {
        console.error(`[golfcourseapi] detail upstream ${status}:`, body);
        return res.status(status).json(upstreamError(status, body));
      }
      console.log('[golfcourseapi] detail response keys:', Object.keys(body as object));
      res.setHeader('Cache-Control', DETAIL_CACHE_CONTROL);
      return res.status(200).json(body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error('[golfcourseapi] detail exception:', msg);
      return res.status(500).json({ error: msg });
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use ?action=search&q=... or ?action=detail&id=...' });
}
