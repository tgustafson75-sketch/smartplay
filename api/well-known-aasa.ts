import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 2026-07-30 (Tim — Meta Ray-Ban glasses / DAT registration) — Apple App Site Association for the
 * Meta Wearables DAT app-link universal link (https://api.smartplaycaddie.com/glasses). Meta's
 * developer console verifies this file when registering our app so the "connect in the Meta app"
 * consent handshake can return the user to SmartPlay Caddie.
 *
 *   Team ID   : B6KTPCWF7A
 *   Bundle ID : com.smartplaycaddie.app
 *   Path      : /glasses (+ subpaths)
 *
 * Served (via a vercel.json route) at BOTH /.well-known/apple-app-site-association and the legacy
 * root path, as application/json with NO redirect — Apple/Meta reject a redirected or mistyped AASA.
 */
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(JSON.stringify({
    applinks: {
      details: [
        { appIDs: ['B6KTPCWF7A.com.smartplaycaddie.app'], components: [{ '/': '/glasses*' }] },
      ],
    },
    webcredentials: { apps: ['B6KTPCWF7A.com.smartplaycaddie.app'] },
  }));
}
