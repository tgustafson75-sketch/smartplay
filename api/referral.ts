/**
 * 2026-09-03 — Referrals. Tim: "And a referral link. If a friend signs up, user gets 30 days."
 *
 * See supabase/migrations/0009_referrals.sql for the identity model and why "signs up" is settled by
 * the friend PLAYING rather than by an install. The short version: this app has no accounts, so
 * there is no sign-up event to count, and an install is a tap an emulator can farm. A referral pays
 * out when the friend starts a round or records a swing — the same real-use bar the light-use trial
 * extension uses, and the cheapest possible defence, because a fake install has to play golf.
 *
 * ── WHY THE SERVER OWNS THE CODE DERIVATION ────────────────────────────────────────────────────
 * The code is sha256(REFERRAL_SALT + install), and the salt lives ONLY here. A salt shipped inside
 * the app bundle is not a salt — anyone could mint codes for install ids they guessed, or walk a
 * code back to the install id that appears on diagnostic reports. So the client never computes its
 * own code; it asks for it once and caches it. One owner, and the secret stays server-side.
 * [[two-owners-is-the-root-cause]]
 *
 * A code is a DEPOSIT SLIP, NOT A KEY. Redemption is keyed on the install id, which the server
 * hashes itself, so publishing your referral link cannot let anyone drain the days it earns.
 *
 * Actions (POST, app-key gated):
 *   code    { install }         → this install's shareable code
 *   claim   { install, code }   → the FRIEND records who sent them. Once per install, ever.
 *   qualify { install }         → the friend played; their referral becomes payable
 *   redeem  { install }         → the REFERRER banks the days earned since last time
 *   status  { install }         → counts for the share screen
 *
 * GET /r/<code> is the public landing page — no app key, it is opened in a browser by someone who
 * does not have the app yet.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';
import { applyCors } from './_cors';
import { requireAppKey } from './_appKey';
import { allowInference } from './_inferLimit';
import { getSmartPlaySupabase } from './_supabase';

const TABLE = 'referrals';

/** Days a qualified referral is worth. Stored per row at claim time so changing this never re-prices
 *  a referral somebody already earned. */
const REWARD_DAYS = 30;

/**
 * Lifetime cap on referrals a single code is paid for. Twelve is a year of the product, which is
 * generous for a real advocate and still a ceiling — an uncapped multiplier on a subscription is a
 * business decision nobody made, and it is much easier to raise this later than to claw days back.
 */
const MAX_PAID_REFERRALS = 12;

/** Codes are short enough to read aloud and type, long enough not to be walked. */
const CODE_LENGTH = 10;

function codeFor(install: string): string {
  const salt = process.env.REFERRAL_SALT ?? '';
  return createHash('sha256')
    .update(`smartplay-referral:${salt}:${install}`)
    .digest('base64url')
    .replace(/[-_]/g, '')
    .slice(0, CODE_LENGTH)
    .toUpperCase();
}

const norm = (v: unknown): string => String(v ?? '').trim();
/** Install ids are minted as `spc-<base36>`; anything else is not one of ours. */
const validInstall = (v: string): boolean => /^spc-[a-z0-9]{6,32}$/i.test(v);
const validCode = (v: string): boolean => new RegExp(`^[A-Z0-9]{${CODE_LENGTH}}$`).test(v);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  // The landing page is opened by someone who does not have the app, in a browser. No app key.
  if (req.method === 'GET') return landing(req, res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  if (!requireAppKey(req, res)) return;
  if (!allowInference(req, res, 'referral', 30)) return;

  const db = getSmartPlaySupabase();
  // Referrals are additive: with no database the app must still work, so this reports "off" rather
  // than an error the UI would have to explain. [[caddie-failsafe-no-walls]]
  if (!db) return res.status(200).json({ ok: false, error: 'not_configured' });

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;
  const action = norm(body.action);
  const install = norm(body.install);
  if (!validInstall(install)) return res.status(400).json({ ok: false, error: 'bad_install' });

  const myCode = codeFor(install);

  try {
    if (action === 'code') {
      return res.status(200).json({ ok: true, code: myCode });
    }

    if (action === 'claim') {
      const code = norm(body.code).toUpperCase();
      if (!validCode(code)) return res.status(400).json({ ok: false, error: 'bad_code' });
      // You cannot invite yourself. Cheap to check because the server holds the derivation.
      if (code === myCode) return res.status(200).json({ ok: false, error: 'self_referral' });

      // The primary key does the real work: a second claim from the same install conflicts and is
      // ignored, so "one install is referred once, ever" is a database guarantee rather than a
      // check this handler could later forget. [[two-owners-is-the-root-cause]]
      const { error } = await db.from(TABLE).insert({
        referred_install: install,
        referrer_code: code,
        reward_days: REWARD_DAYS,
      });
      if (error) {
        // 23505 = unique_violation. Already claimed is not a failure worth alarming anyone about.
        if ((error as { code?: string }).code === '23505') {
          return res.status(200).json({ ok: false, error: 'already_claimed' });
        }
        throw error;
      }
      return res.status(200).json({ ok: true, claimed: true, rewardDays: REWARD_DAYS });
    }

    if (action === 'qualify') {
      // The friend played. Idempotent: only the first qualification stamps a time, so replaying this
      // call cannot manufacture a second payout.
      const { data, error } = await db.from(TABLE)
        .update({ qualified_at: new Date().toISOString() })
        .eq('referred_install', install)
        .is('qualified_at', null)
        .select('referrer_code');
      if (error) throw error;
      return res.status(200).json({ ok: true, qualified: (data?.length ?? 0) > 0 });
    }

    if (action === 'redeem') {
      // Everything this code has EVER been paid for, so the cap is a lifetime one and cannot be
      // reset by redeeming in batches.
      const { count: paidCount, error: paidErr } = await db.from(TABLE)
        .select('referred_install', { count: 'exact', head: true })
        .eq('referrer_code', myCode)
        .not('redeemed_at', 'is', null);
      if (paidErr) throw paidErr;
      const remaining = Math.max(0, MAX_PAID_REFERRALS - (paidCount ?? 0));
      if (remaining === 0) return res.status(200).json({ ok: true, days: 0, referrals: 0, capped: true });

      const { data: due, error: dueErr } = await db.from(TABLE)
        .select('referred_install, reward_days')
        .eq('referrer_code', myCode)
        .not('qualified_at', 'is', null)
        .is('redeemed_at', null)
        .limit(remaining);
      if (dueErr) throw dueErr;
      if (!due || due.length === 0) return res.status(200).json({ ok: true, days: 0, referrals: 0 });

      const ids = due.map((r) => r.referred_install as string);
      // Mark BEFORE returning. If the client never receives the response the days are lost rather
      // than paid twice — the safe direction for a grant that cannot be taken back, and the reason
      // this is not a read-then-write from the client's side.
      const { error: markErr } = await db.from(TABLE)
        .update({ redeemed_at: new Date().toISOString() })
        .in('referred_install', ids)
        .is('redeemed_at', null);
      if (markErr) throw markErr;

      const days = due.reduce((sum, r) => sum + (Number(r.reward_days) || 0), 0);
      return res.status(200).json({ ok: true, days, referrals: due.length });
    }

    if (action === 'status') {
      const { count: qualified } = await db.from(TABLE)
        .select('referred_install', { count: 'exact', head: true })
        .eq('referrer_code', myCode).not('qualified_at', 'is', null);
      const { count: pending } = await db.from(TABLE)
        .select('referred_install', { count: 'exact', head: true })
        .eq('referrer_code', myCode).is('qualified_at', null);
      return res.status(200).json({
        ok: true,
        code: myCode,
        qualified: qualified ?? 0,
        pending: pending ?? 0,
        rewardDays: REWARD_DAYS,
      });
    }

    return res.status(400).json({ ok: false, error: 'bad_action' });
  } catch (e) {
    console.error('[referral] failed', action, e instanceof Error ? e.message : e);
    return res.status(200).json({ ok: false, error: 'server_error' });
  }
}

/**
 * The page a friend lands on. Deliberately plain HTML with no build step and no tracking: it exists
 * to say what this is and send them to the right store.
 *
 * It also SHOWS the code, because deferred deep linking does not work without a third-party
 * attribution SDK — a friend who taps the link, installs from the store and opens the app arrives
 * with no memory of the link at all. A code they can read and type works every time, on both
 * platforms, with no extra dependency. [[hands-free-zero-setup-is-the-product]]
 */
function landing(req: VercelRequest, res: VercelResponse) {
  const raw = norm((req.query.code as string) ?? '').toUpperCase();
  const code = validCode(raw) ? raw : null;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>You've been invited to SmartPlay Caddie</title>
<meta name="robots" content="noindex">
<style>
:root{color-scheme:dark}
body{margin:0;background:#060f09;color:#e5e7eb;font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
     display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{max-width:420px;width:100%;text-align:center}
h1{font-size:26px;margin:0 0 10px;color:#fff;letter-spacing:-.4px}
p{color:#9ca3af;margin:0 0 22px}
.code{font:700 30px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:5px;color:#00C896;
      background:#0d2418;border:1.5px solid #00C896;border-radius:12px;padding:18px 12px;margin:0 0 10px;
      word-break:break-all}
.hint{font-size:13px;color:#6b7280;margin:0 0 26px}
a.btn{display:block;background:#00C896;color:#04140d;text-decoration:none;font-weight:800;
      padding:15px;border-radius:11px;margin-bottom:11px}
a.alt{background:transparent;color:#9ca3af;border:1px solid #1f3242}
</style></head><body><div class="card">
<h1>Your caddie's waiting</h1>
<p>A friend thinks you'd get on with SmartPlay Caddie — a golf caddie that actually watches your swing.</p>
${code ? `<div class="code">${code}</div>
<p class="hint">Install the app, then enter this code in Settings → Invite a friend. Your friend gets rewarded once you've played a round.</p>` : ''}
<a class="btn" href="https://apps.apple.com/app/smartplay-caddie/id0000000000">Get it on iPhone</a>
<a class="btn alt" href="https://play.google.com/store/apps/details?id=com.smartplaycaddie.app">Get it on Android</a>
</div></body></html>`);
}
