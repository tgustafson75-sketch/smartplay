/**
 * 2026-08-31 — SHAREABLE SWING LINKS.
 *
 * Tim: "I want to be able to send out, even if it's by link form, exactly what you would get from
 * swing library analysis — the reports, the video playback. Maybe better ways to have that linkable,
 * instead of exporting PDFs or photos."
 *
 * A PDF is a dead end. It cannot move, it cannot be corrected, and nobody forwards one. A link is
 * the product doing its own marketing: a coach opens it on a phone, sees the swing MOVING with the
 * skeleton and club trace on it, reads the same analysis the player read, and there is one button to
 * get the app.
 *
 *   POST /api/swing-share   { payload }            → { ok, id, url }     (app-key gated)
 *   GET  /api/swing-share?id=<id>                  → text/html, the public page
 *   GET  /api/swing-share?id=<id>&format=json      → the payload, for the app to re-open its own share
 *   POST /api/swing-share   { id, revoke: true }   → withdraw a share
 *
 * WHY FRAMES AND NOT VIDEO. The clip is 60-120s and 60-200MB — too slow to upload from a course and
 * a real bandwidth bill. The analysis already extracts 3-8 keyframes around the swing and the pose is
 * already computed, so the share carries those and the page ANIMATES them with the overlay drawn on
 * top. Under ~1MB, seconds on cellular, and it moves. Real video needs clip trimming, which needs a
 * native module this app does not ship. [[speed-is-the-wow]]
 *
 * PRIVACY (Tim's call): unlisted, no expiry. The id is 16 bytes of crypto randomness — not guessable,
 * not enumerable, not derived from anything about the player. No email or account id is stored.
 *
 * HONESTY: the page renders only what the analysis actually produced. A missing tempo or an
 * unconfirmed strike is shown as absent, never filled in — the same rule the app screen obeys, for
 * the same reason. This page is seen by people who are not yet customers.
 * [[illustration-data-points]] [[feels-like-a-real-caddie]]
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes, createHash } from 'crypto';
import { applyCors } from './_cors';
import { requireAppKey } from './_appKey';
import { allowInference } from './_inferLimit';
import { getSmartPlaySupabase } from './_supabase';

const TABLE = 'swing_shares';
/** Frames are base64 JPEGs; this bounds one share to roughly a megabyte and a half of JSON. */
const MAX_PAYLOAD_BYTES = 1_500_000;
const MAX_FRAMES = 12;
const SITE = 'https://smartplaycaddie.com';

/** URL-safe, unguessable, and short enough to read aloud if someone has to. */
function newShareId(): string {
  return randomBytes(16).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

type Frame = { b64: string; timeMs?: number };
type SharePayload = {
  title?: string;
  player?: string;
  club?: string;
  capturedAt?: number;
  /** Base64 JPEGs in time order — the loop. */
  frames?: Frame[];
  /** Normalized keypoints per frame, same order, for the overlay. */
  pose?: { x: number; y: number; name: string; score: number }[][];
  /** The caddie's read, as shown in the app. */
  headline?: string;
  observation?: string;
  fault?: string;
  fix?: string;
  drill?: string;
  /** The player's own words about the swing. Rendered as ITS OWN section, never merged with the
   *  analysis prose — a felt sensation is evidence, not a measurement. */
  feel?: string;
  /** Measured numbers. Anything absent is RENDERED absent, never guessed. */
  metrics?: { label: string; value: string }[];
};

/** Only the fields the page renders survive — an unknown key is dropped rather than stored. */
function sanitize(input: unknown): SharePayload | null {
  if (!input || typeof input !== 'object') return null;
  const p = input as Record<string, unknown>;
  const str = (v: unknown, max = 600): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

  const framesIn = Array.isArray(p.frames) ? p.frames.slice(0, MAX_FRAMES) : [];
  const frames: Frame[] = [];
  for (const f of framesIn) {
    const b64 = typeof (f as Frame)?.b64 === 'string' ? (f as Frame).b64 : null;
    if (!b64 || b64.length < 100) continue;
    // Reject anything that is not plain base64 — no data: prefixes, no smuggled markup.
    if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) continue;
    frames.push({ b64: b64.replace(/\s/g, ''), timeMs: typeof (f as Frame).timeMs === 'number' ? (f as Frame).timeMs : undefined });
  }
  if (frames.length === 0) return null;

  const metrics = Array.isArray(p.metrics)
    ? p.metrics
        .slice(0, 8)
        .map((m) => ({ label: str((m as { label?: string })?.label, 40) ?? '', value: str((m as { value?: string })?.value, 40) ?? '' }))
        .filter((m) => m.label && m.value)
    : undefined;

  const pose = Array.isArray(p.pose)
    ? p.pose.slice(0, MAX_FRAMES).map((kps) =>
        (Array.isArray(kps) ? kps : []).slice(0, 40).map((k) => {
          const kk = k as { x?: unknown; y?: unknown; name?: unknown; score?: unknown };
          return {
            x: typeof kk.x === 'number' && Number.isFinite(kk.x) ? kk.x : 0,
            y: typeof kk.y === 'number' && Number.isFinite(kk.y) ? kk.y : 0,
            name: typeof kk.name === 'string' ? kk.name.slice(0, 24) : '',
            score: typeof kk.score === 'number' && Number.isFinite(kk.score) ? kk.score : 0,
          };
        }),
      )
    : undefined;

  return {
    title: str(p.title, 80),
    player: str(p.player, 40),
    club: str(p.club, 40),
    capturedAt: typeof p.capturedAt === 'number' ? p.capturedAt : undefined,
    frames,
    pose,
    headline: str(p.headline, 160),
    observation: str(p.observation, 1200),
    fault: str(p.fault, 120),
    fix: str(p.fix, 1200),
    drill: str(p.drill, 200),
    feel: str(p.feel, 600),
    metrics,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  if (req.method === 'GET') return handleGet(req, res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  // Creating a share spends a database write and stores a megabyte; gate and throttle it.
  if (!requireAppKey(req, res)) return;
  if (!allowInference(req, res, 'swing-share', 20)) return;

  const db = getSmartPlaySupabase();
  if (!db) return res.status(200).json({ ok: false, error: 'not_configured' });

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;

  // Withdrawal. Kept as a row, not deleted — see the migration: a revoked link should say so.
  if (body.revoke === true && typeof body.id === 'string') {
    await db.from(TABLE).update({ revoked_at: new Date().toISOString() }).eq('id', body.id);
    return res.status(200).json({ ok: true, revoked: true });
  }

  const payload = sanitize(body.payload);
  if (!payload) return res.status(400).json({ ok: false, error: 'no_frames' });

  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ ok: false, error: 'too_large' });
  }

  const creatorHash = typeof body.creator === 'string' && body.creator
    ? createHash('sha256').update(`smartplay-share:${body.creator}`).digest('hex').slice(0, 32)
    : null;

  const id = newShareId();
  const { error } = await db.from(TABLE).insert({ id, payload, creator_hash: creatorHash });
  if (error) {
    console.log('[swing-share] insert failed:', error.message);
    return res.status(200).json({ ok: false, error: 'store_failed' });
  }
  return res.status(200).json({ ok: true, id, url: `${SITE}/s/${id}` });
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const wantsJson = req.query.format === 'json';
  if (!id || !/^[A-Za-z0-9_-]{10,64}$/.test(id)) {
    return wantsJson ? res.status(400).json({ ok: false, error: 'bad_id' }) : sendPage(res, 404, notFoundHtml());
  }

  const db = getSmartPlaySupabase();
  if (!db) return wantsJson ? res.status(200).json({ ok: false, error: 'not_configured' }) : sendPage(res, 503, notFoundHtml());

  const { data, error } = await db.from(TABLE).select('payload, revoked_at').eq('id', id).maybeSingle();
  if (error || !data) return wantsJson ? res.status(404).json({ ok: false, error: 'not_found' }) : sendPage(res, 404, notFoundHtml());
  if (data.revoked_at) return wantsJson ? res.status(410).json({ ok: false, error: 'revoked' }) : sendPage(res, 410, revokedHtml());

  // Best-effort view counter — never allowed to delay or fail the render.
  void db.from(TABLE)
    .update({ views: ((data as { views?: number }).views ?? 0) + 1, last_viewed_at: new Date().toISOString() })
    .eq('id', id)
    .then(() => undefined, () => undefined);

  if (wantsJson) return res.status(200).json({ ok: true, payload: data.payload });
  return sendPage(res, 200, sharePage(data.payload as SharePayload, id));
}

function sendPage(res: VercelResponse, status: number, html: string) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Shares are immutable once written, so they cache hard. A revoked link is a different response.
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=600, s-maxage=3600' : 'no-store');
  return res.status(status).send(html);
}

const SHELL = (title: string, body: string, desc = 'A swing, read by the SmartPlay Caddie.') => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<style>
:root{--ink:#080E0B;--raise:#0E1714;--rule:#1D2C25;--green:#00C853;--fg:#F2F5F3;--muted:#8FA79A}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:520px;margin:0 auto;padding:22px 18px 56px}
.brand{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--green);font-weight:700}
h1{font-size:23px;line-height:1.2;margin:14px 0 2px;letter-spacing:-.4px}
.sub{color:var(--muted);font-size:14px;margin:0 0 18px}
.stage{position:relative;border-radius:16px;overflow:hidden;background:#000;aspect-ratio:9/16;max-height:66vh;margin:0 auto}
.stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity .04s linear}
.stage img.on{opacity:1}
.stage svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.ctl{display:flex;gap:8px;align-items:center;margin:12px 0 0}
button{appearance:none;border:1px solid var(--rule);background:var(--raise);color:var(--fg);border-radius:10px;padding:10px 14px;font:inherit;font-size:14px;font-weight:600;min-height:44px;cursor:pointer}
button.play{background:var(--green);border-color:var(--green);color:var(--ink)}
.card{background:var(--raise);border:1px solid var(--rule);border-radius:14px;padding:16px;margin-top:16px}
.card h2{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--green);margin:0 0 8px}
.card p{margin:0;color:#DCE6E0;font-size:15px}
.metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.metric{background:var(--raise);border:1px solid var(--rule);border-radius:12px;padding:12px}
.metric .k{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.metric .v{font-size:19px;font-weight:700;margin-top:3px}
.cta{display:block;text-align:center;background:var(--green);color:var(--ink);text-decoration:none;font-weight:800;border-radius:12px;padding:15px;margin-top:22px;min-height:48px}
footer{text-align:center;color:var(--green);font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-top:20px}
.empty{color:var(--muted);text-align:center;padding:64px 16px}
</style></head><body><div class="wrap">${body}</div></body></html>`;

function notFoundHtml(): string {
  return SHELL('Swing not found · SmartPlay Caddie',
    `<div class="brand">SmartPlay Caddie</div>
     <div class="empty"><p>This swing link doesn’t exist.</p><p style="font-size:14px">The link may have been mistyped.</p></div>
     <a class="cta" href="${SITE}/download">Get SmartPlay Caddie</a>`);
}

function revokedHtml(): string {
  return SHELL('Swing removed · SmartPlay Caddie',
    `<div class="brand">SmartPlay Caddie</div>
     <div class="empty"><p>This swing was removed by the player.</p></div>
     <a class="cta" href="${SITE}/download">Get SmartPlay Caddie</a>`);
}

/** Limbs drawn between named keypoints — the same skeleton the app draws. */
const LIMBS: [string, string][] = [
  ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'], ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'], ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'], ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
];

function sharePage(p: SharePayload, id: string): string {
  const title = p.title || 'Swing analysis';
  const who = [p.player, p.club].filter(Boolean).join(' · ');
  const frames = p.frames ?? [];

  const imgs = frames
    .map((f, i) => `<img src="data:image/jpeg;base64,${f.b64}" alt="Swing frame ${i + 1}" class="${i === 0 ? 'on' : ''}" data-i="${i}">`)
    .join('');

  // The overlay is precomputed per frame as SVG. Keypoints are normalized 0..1, so the SVG uses a
  // 0 0 1 1 viewBox and scales with the image — no layout maths on the client.
  const overlays = (p.pose ?? []).map((kps) => {
    const by = new Map(kps.filter((k) => k.score >= 0.3).map((k) => [k.name, k]));
    const lines = LIMBS.map(([a, b]) => {
      const ka = by.get(a), kb = by.get(b);
      if (!ka || !kb) return '';
      return `<line x1="${ka.x.toFixed(4)}" y1="${ka.y.toFixed(4)}" x2="${kb.x.toFixed(4)}" y2="${kb.y.toFixed(4)}"/>`;
    }).join('');
    const dots = [...by.values()].map((k) => `<circle cx="${k.x.toFixed(4)}" cy="${k.y.toFixed(4)}" r="0.006"/>`).join('');
    return `<g><g stroke="#00E676" stroke-width="0.004" stroke-linecap="round" fill="none">${lines}</g><g fill="#EAFFF2">${dots}</g></g>`;
  });
  const svg = overlays.length
    ? `<svg viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet">${overlays.map((g, i) => `<g data-o="${i}" style="display:${i === 0 ? 'inline' : 'none'}">${g}</g>`).join('')}</svg>`
    : '';

  const card = (h: string, t?: string) => (t ? `<div class="card"><h2>${esc(h)}</h2><p>${esc(t)}</p></div>` : '');
  const metrics = (p.metrics ?? []).length
    ? `<div class="metrics">${(p.metrics ?? []).map((m) => `<div class="metric"><div class="k">${esc(m.label)}</div><div class="v">${esc(m.value)}</div></div>`).join('')}</div>`
    : '';

  const body = `
    <div class="brand">SmartPlay Caddie</div>
    <h1>${esc(title)}</h1>
    <p class="sub">${esc(who || 'Swing analysis')}</p>
    <div class="stage" id="stage">${imgs}${svg}</div>
    <div class="ctl">
      <button class="play" id="pp" aria-label="Play or pause">Pause</button>
      <button id="sp" aria-label="Change speed">1&times;</button>
      <button id="ov" aria-label="Toggle overlay">Overlay on</button>
    </div>
    ${card('The read', p.headline)}
    ${card('What happened', p.observation)}
    ${card('The fix', p.fix)}
    ${card('What the player felt', p.feel)}
    ${card('Drill', p.drill)}
    ${metrics}
    <a class="cta" href="${SITE}/download">Get SmartPlay Caddie</a>
    <footer>Full Swing Ahead</footer>
    <script>
    (function(){
      var imgs=[].slice.call(document.querySelectorAll('#stage img'));
      var ovs=[].slice.call(document.querySelectorAll('#stage svg g[data-o]'));
      if(!imgs.length)return;
      var i=0,playing=true,speed=1,overlay=true,base=180,t=null;
      function show(n){
        imgs.forEach(function(im,k){im.classList.toggle('on',k===n)});
        ovs.forEach(function(g,k){g.style.display=(overlay&&k===n)?'inline':'none'});
      }
      function tick(){ i=(i+1)%imgs.length; show(i); t=setTimeout(tick, base/speed); }
      function start(){ if(t)clearTimeout(t); t=setTimeout(tick, base/speed); }
      document.getElementById('pp').onclick=function(){
        playing=!playing; this.textContent=playing?'Pause':'Play';
        if(playing)start(); else if(t){clearTimeout(t);t=null;}
      };
      document.getElementById('sp').onclick=function(){
        speed = speed===1?0.5: speed===0.5?0.25:1;
        this.innerHTML = speed===1?'1&times;': speed===0.5?'&frac12;&times;':'&frac14;&times;';
        if(playing)start();
      };
      document.getElementById('ov').onclick=function(){
        overlay=!overlay; this.textContent=overlay?'Overlay on':'Overlay off'; show(i);
      };
      show(0); start();
    })();
    </script>`;

  const desc = p.headline || `A swing read by the SmartPlay Caddie${who ? ' — ' + who : ''}.`;
  return SHELL(`${title} · SmartPlay Caddie`, body, desc).replace('</head>', `<link rel="canonical" href="${SITE}/s/${esc(id)}"></head>`);
}
