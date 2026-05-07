/**
 * Golfbert API proxy.
 *
 * Tim purchased one-course access on Golfbert (Menifee Lakes Palms),
 * direct (not RapidAPI). Direct auth = AWS Signature V4 signing with an
 * IAM access key + secret key, PLUS Golfbert's own API token sent as a
 * usage-plan header.
 *
 * Vercel env vars expected:
 *   GOLFBERT_API_PUBLIC      Golfbert API token (vpg-prefixed, sent as X-API-Key)
 *   GOLFBERT_AWS_ACCESS_KEY  AWS IAM access key id (AKIA…)
 *   GOLFBERT_AWS_SECRET_KEY  AWS IAM secret access key
 *   GOLFBERT_AWS_REGION      AWS region (default: us-east-1)
 *   GOLFBERT_API_HOST        Hostname (default: api.golfbert.com)
 *   GOLFBERT_AWS_SERVICE     Service name (default: execute-api)
 *
 * If Golfbert later instructs us to send the API token as a Bearer
 * Authorization header instead of X-API-Key, swap TOKEN_HEADER below
 * and redeploy — everything else stays identical.
 *
 * Actions supported (all GET):
 *   action=course     id=<courseId>            → course metadata
 *   action=holes      id=<courseId>            → hole list for course
 *   action=hole       id=<holeId>              → hole polygon detail
 *   action=teeboxes   id=<courseId>            → tee box positions
 *   action=imagery    id=<holeId> [size=W,H]   → hole satellite image URL
 *   action=health                              → env-config sanity check
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, createHmac } from 'node:crypto';

const TIMEOUT_MS = 12_000;

/** Header to carry the Golfbert API token. Switch to "authorization" with
 *  a "Bearer " prefix if Golfbert returns 403 with this header. */
const TOKEN_HEADER = 'x-api-key';

interface AuthConfig {
  apiToken: string;
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  host: string;
}

function buildAuth(): AuthConfig | { error: string } {
  const apiToken = process.env.GOLFBERT_API_PUBLIC;
  const accessKey = process.env.GOLFBERT_AWS_ACCESS_KEY;
  const secretKey = process.env.GOLFBERT_AWS_SECRET_KEY;
  const region = process.env.GOLFBERT_AWS_REGION ?? 'us-east-1';
  const host = process.env.GOLFBERT_API_HOST ?? 'api.golfbert.com';
  const service = process.env.GOLFBERT_AWS_SERVICE ?? 'execute-api';
  if (!apiToken) return { error: 'GOLFBERT_API_PUBLIC not set' };
  if (!accessKey) return { error: 'GOLFBERT_AWS_ACCESS_KEY not set' };
  if (!secretKey) return { error: 'GOLFBERT_AWS_SECRET_KEY not set' };
  return { apiToken, accessKey, secretKey, region, service, host };
}

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** Sign an empty-body GET request with AWS SigV4 and return the headers
 *  to send. Reference: AWS SigV4 spec; matches what aws4 produces. */
function signRequest(
  auth: AuthConfig,
  pathname: string,
  query: string,
): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(''); // empty body (GET)
  const canonicalHeaders = `host:${auth.host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-date';
  const canonicalRequest = [
    'GET',
    pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${auth.region}/${auth.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac('AWS4' + auth.secretKey, dateStamp);
  const kRegion = hmac(kDate, auth.region);
  const kService = hmac(kRegion, auth.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${auth.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Host: auth.host,
    'X-Amz-Date': amzDate,
    Authorization: authorization,
    [TOKEN_HEADER]: auth.apiToken,
    Accept: 'application/json',
  };
}

async function signedFetch(
  auth: AuthConfig,
  pathname: string,
  query: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `https://${auth.host}${pathname}${query ? `?${query}` : ''}`;
  const headers = signRequest(auth, pathname, query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* leave as text */ }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

type Action = 'course' | 'holes' | 'hole' | 'teeboxes' | 'imagery' | 'health';

function buildEndpoint(action: Action, id?: string, size?: string): { pathname: string; query: string } {
  switch (action) {
    case 'course':
      return { pathname: `/v1/courses/${encodeURIComponent(id!)}`, query: '' };
    case 'holes':
      return { pathname: `/v1/courses/${encodeURIComponent(id!)}/holes`, query: '' };
    case 'hole':
      return { pathname: `/v1/holes/${encodeURIComponent(id!)}`, query: '' };
    case 'teeboxes':
      return { pathname: `/v1/courses/${encodeURIComponent(id!)}/teeboxes`, query: '' };
    case 'imagery': {
      const s = size ?? '1024x768';
      return { pathname: `/v1/holes/${encodeURIComponent(id!)}/imagery`, query: `size=${encodeURIComponent(s)}` };
    }
    case 'health':
      return { pathname: '', query: '' };
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
  if (action !== 'health' && !id) return res.status(400).json({ error: 'Missing id' });

  if (action === 'health') {
    return res.status(200).json({
      ok: true,
      host: auth.host,
      region: auth.region,
      tokenHeader: TOKEN_HEADER,
      hasApiToken: !!auth.apiToken,
      hasAwsKeys: !!auth.accessKey && !!auth.secretKey,
    });
  }

  if (!isAction(action)) {
    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  const { pathname, query } = buildEndpoint(action, id, size);

  try {
    const { ok, status, body } = await signedFetch(auth, pathname, query);
    if (!ok) {
      console.error(`[golfbert] ${action} upstream ${status}:`, body);
      return res.status(status).json({ error: `Upstream error ${status}`, raw: body });
    }
    return res.status(200).json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[golfbert] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}

function isAction(s: string): s is Action {
  return ['course', 'holes', 'hole', 'teeboxes', 'imagery', 'health'].includes(s);
}
