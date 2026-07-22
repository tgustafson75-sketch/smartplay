/**
 * Pose Detection API proxy.
 *
 * Tim subscribed to a RapidAPI pose-detection endpoint. The pose API
 * gives us per-frame body keypoints (head/shoulders/hips/wrists/etc) —
 * the foundation for real biomechanical swing analysis (hip turn,
 * shoulder coil, weight transfer, posture maintenance, etc).
 *
 * Wire format (verified by probe):
 *   POST <host>/v1/detect/pose
 *   Headers: x-rapidapi-key, x-rapidapi-host
 *   Body:    multipart/form-data with field `srcImg` containing the
 *            image FILE bytes (URL form is rejected with 415 — the
 *            API requires a real file upload).
 *   Response: { data: <keypoints>, meta, warnings, error? }
 *             Standard REST envelope. Empty `data` indicates a "no
 *             person detected" outcome rather than an error.
 *
 * Auth: server-side. POSE_API_KEY + POSE_API_HOST env vars on Vercel
 * (or the generic RAPIDAPI_KEY / RAPIDAPI_HOST as fallback). Without
 * them, every action returns 200 with { data: null, configured: false }
 * — clients fall through silently (no biomechanics card renders).
 *
 * 2026-05-21 — Fix H (Option B): the unconfigured branch used to return
 * HTTP 503 to signal "intentionally not configured." Functionally correct
 * but the wrong status code — 503 fired false Vercel function-failure
 * alerts even though every client (poseAnalysisApi.analyzePoseFromUri,
 * videoUpload fire-and-forget background biomechanics) already treated
 * !res.ok as a no-op. Returning 200 with a null/configured-false payload
 * keeps the UX behaviour identical (biomechanics card stays hidden) but
 * stops the false alert. NOT fabrication — null in, no card out.
 *
 * Client side passes either:
 *   - imageUrl: the proxy fetches the image, then forwards as multipart
 *   - imageBase64: the proxy decodes + forwards as multipart
 * The proxy handles fetch/decode so the client doesn't have to deal
 * with multipart construction in React Native.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertPublicHttpUrl } from './_ssrfGuard';

const TIMEOUT_MS = 25_000;

interface AuthConfig {
  url: string;
  headers: Record<string, string>;
}

function buildAuth(): AuthConfig | { error: string } {
  // Prefer pose-specific env vars; fall back to a generic RAPIDAPI_*
  // pair so a single key can power multiple RapidAPI subscriptions.
  const key = process.env.POSE_API_KEY ?? process.env.RAPIDAPI_KEY ?? '';
  const host = process.env.POSE_API_HOST ?? process.env.RAPIDAPI_HOST ?? '';
  if (!key || !host) return { error: 'POSE_API_KEY + POSE_API_HOST not set in environment' };
  return {
    url: `https://${host}/v1/detect/pose`,
    headers: {
      'x-rapidapi-key': key,
      'x-rapidapi-host': host,
    },
  };
}

/** Fetch an image URL into a Buffer for forwarding as multipart.
 *  2026-07-21 (QA audit, finding #3) — validate the user-supplied URL against the SSRF
 *  allowlist BEFORE fetching (https + non-internal IP), refuse redirects (which could 30x
 *  into an internal target), and return a GENERIC error so the response can't be used as an
 *  internal-network reachability/port oracle. Detailed reasons are logged server-side only. */
async function fetchImageBuffer(imageUrl: string): Promise<{ buffer: Buffer; contentType: string } | { error: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await assertPublicHttpUrl(imageUrl); // throws SsrfBlockedError on scheme/IP violation
    const r = await fetch(imageUrl, { signal: controller.signal, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400) {
      console.warn('[pose-analysis] refused redirect for image URL');
      return { error: 'Image could not be loaded' };
    }
    if (!r.ok) {
      console.warn(`[pose-analysis] image fetch non-ok: ${r.status}`);
      return { error: 'Image could not be loaded' };
    }
    const arr = await r.arrayBuffer();
    return {
      buffer: Buffer.from(arr),
      contentType: r.headers.get('content-type') ?? 'image/jpeg',
    };
  } catch (e) {
    console.warn('[pose-analysis] image fetch blocked/failed:', e instanceof Error ? e.message : e);
    return { error: 'Image could not be loaded' };
  } finally {
    clearTimeout(t);
  }
}

/** Decode a base64-image-data string into a Buffer. */
function decodeBase64Image(b64: string): Buffer {
  // Strip optional data: URI prefix.
  const stripped = b64.startsWith('data:') ? b64.split(',', 2)[1] ?? '' : b64;
  return Buffer.from(stripped, 'base64');
}

/** Build a multipart/form-data body manually (no formdata-node dep). */
function buildMultipart(buffer: Buffer, contentType: string): { body: Buffer; boundary: string } {
  const boundary = `----PoseProxy${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="srcImg"; filename="frame.jpg"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    body: Buffer.concat([Buffer.from(head, 'utf-8'), buffer, Buffer.from(tail, 'utf-8')]),
    boundary,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = buildAuth();
  if ('error' in auth) {
    // 2026-05-21 — Fix H (Option B): return 200 with a null payload so
    // Vercel doesn't see this as a function failure. UX is identical —
    // clients check `configured === false` (or `data == null`) and
    // render no biomechanics card. NOT a real upstream failure; the
    // `configured: false` flag tells the client this is the env-gated
    // off state, distinguishable from a 5xx upstream error.
    return res.status(200).json({ data: null, configured: false, reason: auth.error });
  }

  const body = (req.body ?? {}) as { imageUrl?: string; imageBase64?: string };

  // Resolve image bytes — accept URL OR base64 to keep the client side
  // simple in React Native (where multipart is painful to construct).
  let imageBytes: Buffer;
  let contentType = 'image/jpeg';
  if (typeof body.imageUrl === 'string' && body.imageUrl.length > 0) {
    const fetched = await fetchImageBuffer(body.imageUrl);
    if ('error' in fetched) return res.status(400).json({ error: fetched.error });
    imageBytes = fetched.buffer;
    contentType = fetched.contentType;
  } else if (typeof body.imageBase64 === 'string' && body.imageBase64.length > 0) {
    try {
      imageBytes = decodeBase64Image(body.imageBase64);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid base64 image data', detail: e instanceof Error ? e.message : 'unknown' });
    }
  } else {
    return res.status(400).json({ error: 'Provide imageUrl OR imageBase64 in body' });
  }

  if (imageBytes.length < 100) {
    return res.status(400).json({ error: 'Image bytes too small' });
  }

  const { body: multipartBody, boundary } = buildMultipart(imageBytes, contentType);

  const upstreamController = new AbortController();
  const upstreamTimer = setTimeout(() => upstreamController.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(auth.url, {
      method: 'POST',
      headers: {
        ...auth.headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      // Type escape: this file is compiled under the project tsconfig
      // which mixes DOM + Node lib types. Vercel's build environment
      // drops global BodyInit (causing TS2304) while the Expo-side lib
      // includes it but rejects Buffer/Uint8Array against the narrowed
      // union (TS2769). Both are spurious — Node 18+ fetch accepts a
      // Buffer at runtime. `as unknown as never` short-circuits both.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: multipartBody as any,
      signal: upstreamController.signal,
    });
    clearTimeout(upstreamTimer);
    const text = await upstream.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    if (!upstream.ok) {
      console.error(`[pose] upstream ${upstream.status}:`, text.slice(0, 200));
      return res.status(upstream.status).json({ error: `Upstream error ${upstream.status}`, raw: parsed });
    }
    return res.status(200).json(parsed);
  } catch (e) {
    clearTimeout(upstreamTimer);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[pose] exception:', msg);
    return res.status(502).json({ error: msg });
  }
}
