import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 2026-06-13 — YouTube song search for the clean in-app music portal (Tim/Cecily).
 *
 * Holds the YouTube Data API key SERVER-SIDE (env YOUTUBE_API_KEY) so it's never in
 * the app bundle, and ENFORCES kid-safe search for everyone: safeSearch=strict +
 * type=video + videoEmbeddable=true (so it plays in our embedded player, not a
 * link-out). Returns the single best match — the client opens just that video in a
 * clean embed (no comments, no suggestions). The "play [song]" voice intent calls this.
 *
 * Failure is non-fatal BY DESIGN: any error / missing key returns 200 + { videoId: null }
 * so the client says "couldn't find that one" instead of crashing or going silent.
 *
 * SETUP (one-time): set YOUTUBE_API_KEY in Vercel env (a Google Cloud key with
 * "YouTube Data API v3" enabled; restrict it to that API). Then redeploy.
 */

const TIMEOUT_MS = 8_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q) return res.status(400).json({ error: 'q required' });

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    // Honest non-fatal: not configured yet → client degrades gracefully.
    return res.status(200).json({ videoId: null, reason: 'not_configured' });
  }

  const params = new URLSearchParams({
    part: 'snippet',
    q,
    type: 'video',
    videoEmbeddable: 'true',     // must be playable in our embed
    safeSearch: 'strict',        // kid-clean for everyone
    maxResults: '1',
    key,
  });
  const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!upstream.ok) {
      console.warn('[youtube-search] upstream non-ok', upstream.status);
      return res.status(200).json({ videoId: null, reason: `upstream_${upstream.status}` });
    }
    const data = (await upstream.json()) as {
      items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }[];
    };
    const item = data.items?.[0];
    const videoId = item?.id?.videoId ?? null;
    if (!videoId) return res.status(200).json({ videoId: null, reason: 'no_match' });
    return res.status(200).json({
      videoId,
      title: item?.snippet?.title ?? q,
      channelTitle: item?.snippet?.channelTitle ?? null,
    });
  } catch (e) {
    clearTimeout(timer);
    console.warn('[youtube-search] error', e);
    return res.status(200).json({ videoId: null, reason: 'error' });
  }
}
