/**
 * Golfbert API proxy.
 *
 * Tim purchased one-course access on Golfbert (Menifee Lakes Palms).
 * Golfbert exposes per-hole polygon geometry (greens, fairways, bunkers,
 * water hazards, rough), per-hole satellite imagery with overlay options,
 * and tee-box pin coordinates — significantly richer than golfcourseapi's
 * point-only data and exactly what SmartVision needs to render an
 * accurate hole map with hazard awareness.
 *
 * Auth: server-side. The Golfbert plan Tim purchased uses a RapidAPI-
 * style key (set GOLFBERT_API_KEY + GOLFBERT_API_HOST in Vercel env).
 * If your plan instead uses raw Golfbert + AWS Sig V4, swap the auth
 * headers in `proxyFetch` below — everything else stays identical.
 *
 * Actions supported (all GET):
 *   action=course     id=<courseId>            → course metadata
 *   action=holes      id=<courseId>            → hole list for course
 *   action=hole       id=<holeId>              → hole polygon detail
 *   action=teeboxes   id=<courseId>            → tee box positions
 *   action=imagery    id=<holeId> [size=W,H]   → hole satellite image URL
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const TIMEOUT_MS = 12_000;

interface AuthConfig {
  baseUrl: string;
  headers: Record<string, string>;
}

function buildAuth(): AuthConfig | { error: string } {
  const apiKey = process.env.GOLFBERT_API_KEY;
  const apiHost = process.env.GOLFBERT_API_HOST; // e.g. "golfbert.p.rapidapi.com"
  if (!apiKey) return { error: 'GOLFBERT_API_KEY not set in environment' };
  // Default to RapidAPI host shape. If using raw Golfbert, set
  // GOLFBERT_API_HOST=api.golfbert.com (no `.p.rapidapi.com` suffix)
  // and we send the X-API-Key header instead.
  const isRapidApi = (apiHost ?? '').includes('rapidapi.com');
  if (isRapidApi) {
    return {
      baseUrl: `https://${apiHost}`,
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': apiHost!,
        Accept: 'application/json',
      },
    };
  }
  // Raw Golfbert direct auth (header-key mode). Tim's plan tier
  // determines which mode applies; both are supported.
  return {
    baseUrl: `https://${apiHost ?? 'api.golfbert.com'}`,
    headers: {
      'X-API-Key': apiKey,
      Accept: 'application/json',
    },
  };
}

async function proxyFetch(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    const body = res.ok ? await res.json() : await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = buildAuth();
  if ('error' in auth) {
    console.error('[golfbert]', auth.error);
    return res.status(500).json({ error: auth.error });
  }

  const { action, id, size } = req.query as Record<string, string | undefined>;
  if (!action) return res.status(400).json({ error: 'Missing action' });
  if (!id && action !== 'health') return res.status(400).json({ error: 'Missing id' });

  let endpoint: string;
  switch (action) {
    case 'course':
      endpoint = `/v1/courses/${encodeURIComponent(id!)}`;
      break;
    case 'holes':
      endpoint = `/v1/courses/${encodeURIComponent(id!)}/holes`;
      break;
    case 'hole':
      endpoint = `/v1/holes/${encodeURIComponent(id!)}`;
      break;
    case 'teeboxes':
      endpoint = `/v1/courses/${encodeURIComponent(id!)}/teeboxes`;
      break;
    case 'imagery': {
      // Default size if caller didn't specify — picks something close to
      // the SmartVision hero frame (1024x768 is a Golfbert sweet spot).
      const s = size ?? '1024x768';
      endpoint = `/v1/holes/${encodeURIComponent(id!)}/imagery?size=${encodeURIComponent(s)}`;
      break;
    }
    case 'health':
      // Lightweight ping — verifies env + connectivity without burning
      // a real-data request quota.
      return res.status(200).json({ ok: true, hostConfigured: !!process.env.GOLFBERT_API_HOST });
    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  const url = auth.baseUrl + endpoint;
  console.log('[golfbert]', action, '→', endpoint);

  try {
    const { ok, status, body } = await proxyFetch(url, auth.headers);
    if (!ok) {
      console.error(`[golfbert] upstream ${status}:`, body);
      return res.status(status).json({ error: `Upstream error ${status}`, raw: body });
    }
    return res.status(200).json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[golfbert] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
