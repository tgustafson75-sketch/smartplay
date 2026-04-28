import type { VercelRequest, VercelResponse } from '@vercel/node';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
        return res.status(status).json({ error: `Upstream error ${status}`, raw: body });
      }
      console.log('[golfcourseapi] search response keys:', Object.keys(body as object));
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
        return res.status(status).json({ error: `Upstream error ${status}`, raw: body });
      }
      console.log('[golfcourseapi] detail response keys:', Object.keys(body as object));
      return res.status(200).json(body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error('[golfcourseapi] detail exception:', msg);
      return res.status(500).json({ error: msg });
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use ?action=search&q=... or ?action=detail&id=...' });
}
