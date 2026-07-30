import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 2026-07-30 (Tim — Meta Ray-Ban glasses / DAT) — landing page for the DAT app-link universal link
 * (https://api.smartplaycaddie.com/glasses). On a device with the app installed + associated-domains
 * entitled, iOS/Android intercept this URL and open the app directly (this HTML never shows). This
 * fallback only renders when the app isn't installed / can't catch the link, so the user isn't left
 * on a 404 mid-handshake.
 */
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>SmartPlay Caddie — Glasses</title></head>' +
    '<body style="font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">' +
    '<div style="max-width:420px"><h1 style="color:#22c55e;margin:0 0 12px">SmartPlay Caddie</h1>' +
    '<p style="line-height:1.5;color:#cbd5e1">Returning you to the app… If it didn’t open automatically, launch <b>SmartPlay Caddie</b> and tap <b>Connect Glasses</b> again.</p></div>' +
    '</body></html>'
  );
}
