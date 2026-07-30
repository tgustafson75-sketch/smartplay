import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 2026-07-30 (Tim — Meta Ray-Ban glasses / DAT registration) — Android Digital Asset Links for the
 * DAT app-link universal link (https://api.smartplaycaddie.com/glasses). Lets the Meta AI app verify
 * that our app owns the domain so the connect-consent handshake can hand control back to us.
 *
 *   Package     : com.smartplaycaddie.app
 *   SHA-256     : from the signing cert Meta displayed as base64 hash
 *                 "Sg1474RimYYdJtg8n0T9RYokBKb26hyUixyKCALRc1c" → the hex fingerprint below.
 *
 * IMPORTANT: this MUST be the fingerprint of the key that actually signs the shipped build. If EAS
 * re-signs (app-signing / upload key rotation), update this fingerprint to match, or the app-link
 * verification silently fails. Served as application/json at /.well-known/assetlinks.json.
 */
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(JSON.stringify([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.smartplaycaddie.app',
        sha256_cert_fingerprints: [
          '4A:0D:78:EF:84:62:99:86:1D:26:D8:3C:9F:44:FD:45:8A:24:04:A6:F6:EA:1C:94:8B:1C:8A:08:02:D1:73:57',
        ],
      },
    },
  ]));
}
