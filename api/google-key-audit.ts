import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';
import { requireAppKey } from './_appKey';
import { googleKeys, isCapabilityMiss, type GoogleKeyRef } from './_googleKeys';

/**
 * api/google-key-audit.ts — WHICH GOOGLE PROJECT IS WHICH (2026-08-10, Tim: "there are two SmartPlay
 * Caddie projects in my Google Cloud and API management… I'm not sure which is which because one has
 * everything enabled").
 *
 * Probes every configured Google key against the APIs this app actually depends on and reports, per
 * key, which ones answer. That turns "I think one of them has Places New?" into a table you can read
 * in five seconds — and it stays true, so the next time an API silently loses its enablement you can
 * see it rather than infer it from a broken feature.
 *
 * SECURITY:
 *   - Behind requireAppKey, same as every other privileged route — this reports on credentials.
 *   - Key VALUES are never returned. Each key is identified by its env var name plus `fp`, an
 *     8-hex SHA-1 prefix: enough to tell two keys apart, useless as a credential.
 *   - Probes are the cheapest possible call per API and are read-only.
 *
 *   GET /api/google-key-audit  → { keys: [{ name, fp, apis: { <api>: 'enabled'|'not_enabled'|'error' } }] }
 */

const TIMEOUT_MS = 8_000;

type Verdict = 'enabled' | 'not_enabled' | 'error';

/** One cheap, read-only probe per API surface the app depends on. */
const PROBES: { id: string; run: (key: string) => Promise<Verdict> }[] = [
  {
    id: 'places_new',
    run: async (key) => {
      const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'places.id',
        },
        body: JSON.stringify({
          includedTypes: ['golf_course'],
          maxResultCount: 1,
          locationRestriction: { circle: { center: { latitude: 41.8983, longitude: -71.8353 }, radius: 10_000 } },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.ok) return 'enabled';
      let message: string | null = null;
      try {
        const b = (await r.json()) as { error?: { message?: string } };
        message = b.error?.message ?? null;
      } catch { /* status alone decides */ }
      return isCapabilityMiss({ httpStatus: r.status, message }) ? 'not_enabled' : 'error';
    },
  },
  {
    id: 'places_legacy',
    run: (key) =>
      legacyProbe(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=41.8983,-71.8353&radius=5000&keyword=golf&key=${key}`),
  },
  {
    id: 'geocoding',
    run: (key) =>
      legacyProbe(`https://maps.googleapis.com/maps/api/geocode/json?address=Putnam,CT&key=${key}`),
  },
  {
    id: 'elevation',
    run: (key) =>
      legacyProbe(`https://maps.googleapis.com/maps/api/elevation/json?locations=41.8983,-71.8353&key=${key}`),
  },
];

/** Legacy Maps surfaces report "not enabled" as HTTP 200 + REQUEST_DENIED, so read the BODY. */
async function legacyProbe(url: string): Promise<Verdict> {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) return isCapabilityMiss({ httpStatus: r.status }) ? 'not_enabled' : 'error';
  const d = (await r.json()) as { status?: string; error_message?: string };
  if (d.status === 'OK' || d.status === 'ZERO_RESULTS') return 'enabled';
  return isCapabilityMiss({ status: d.status, message: d.error_message }) ? 'not_enabled' : 'error';
}

async function auditKey(ref: GoogleKeyRef) {
  const apis: Record<string, Verdict> = {};
  await Promise.all(
    PROBES.map(async (p) => {
      try {
        apis[p.id] = await p.run(ref.key);
      } catch {
        apis[p.id] = 'error';
      }
    }),
  );
  return { name: ref.name, fp: ref.fp, apis };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (!requireAppKey(req, res)) return;

  const keys = googleKeys();
  if (keys.length === 0) {
    return res.status(200).json({ keys: [], note: 'No Google key configured in this environment.' });
  }
  const audited = await Promise.all(keys.map(auditKey));

  // A plain-language read of the table, so the answer doesn't require interpreting it.
  const withNew = audited.filter((k) => k.apis.places_new === 'enabled').map((k) => `${k.name}(${k.fp})`);
  const summary =
    withNew.length > 0
      ? `Places API (New) is enabled on: ${withNew.join(', ')} — course-locate will use it automatically.`
      : 'No configured key has Places API (New) enabled; course-locate is running on the legacy keyword fallback.';

  return res.status(200).json({ keys: audited, summary });
}
