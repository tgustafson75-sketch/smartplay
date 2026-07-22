/**
 * 2026-07-06 / hardened 2026-07-07 — Server-mediated data backup (the OTA way, no
 * client Supabase key). The client posts its snapshot to OUR API; the SERVER writes
 * it to Supabase with the service key it already has (api/_supabase.ts). No client
 * key, no Supabase auth/dashboard login.
 *
 *   POST /api/backup   { key, secret, data }   → upsert the snapshot
 *   GET  /api/backup?key=<email>&secret=<pass>  → fetch the snapshot
 *
 * SECURITY (2026-07-07 audit fix): the identity is a user's email PLUS a passphrase.
 * The row is keyed by sha256(email::secret), so email alone is useless — you cannot
 * enumerate, read, or overwrite anyone's data without their passphrase, and a wrong
 * passphrase is indistinguishable from "no backup" (different hash → no row). The
 * passphrase is never stored server-side, only its contribution to the row key.
 * Rows live in smartplay.device_backups (service-key only; RLS denies clients).
 * Requires migration 0004_device_backups.sql.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';
import { getSmartPlaySupabase } from './_supabase';
import { hitInMemory } from './_rateLimit';

const TABLE = 'device_backups';
const MIN_SECRET_LEN = 4;
const MAX_DATA_BYTES = 8 * 1024 * 1024; // 8 MB — a structured snapshot is far smaller

function norm(v: unknown): string {
  return String(v ?? '').trim();
}

// The persisted round store — zustand writes it into the snapshot as a JSON STRING
// under this AsyncStorage key. Its state.roundHistory is append-only (every finished
// round, each with a stable id), and is the data this whole feature exists to protect.
const ROUND_STORE_KEY = 'round-store-v1';

type RoundRec = { id?: unknown; endedAt?: unknown };

/** Pull state.roundHistory out of a persisted round-store blob (string or object). */
function extractRoundHistory(blob: unknown): RoundRec[] | null {
  try {
    const obj = typeof blob === 'string' ? JSON.parse(blob) : blob;
    const hist = (obj as { state?: { roundHistory?: unknown } })?.state?.roundHistory;
    return Array.isArray(hist) ? (hist as RoundRec[]) : null;
  } catch { return null; }
}

/** Write a merged roundHistory back into a persisted round-store blob, preserving the
 *  rest of `blob`'s state (settings, current values). Returns the same type it got. */
function withRoundHistory(blob: unknown, history: RoundRec[]): unknown {
  const wasString = typeof blob === 'string';
  const obj = wasString ? JSON.parse(blob as string) : { ...(blob as object) };
  obj.state = { ...(obj.state ?? {}), roundHistory: history };
  return wasString ? JSON.stringify(obj) : obj;
}

/** Union two round histories by id, newest-wins on collision (larger endedAt), so a
 *  backup from a device that is MISSING rounds can never delete them from the cloud. */
function unionRoundHistory(prev: RoundRec[], next: RoundRec[]): RoundRec[] {
  const byId = new Map<string, RoundRec>();
  const add = (r: RoundRec) => {
    const id = r?.id == null ? null : String(r.id);
    if (id == null) return; // real records always have an id; skip id-less noise
    const cur = byId.get(id);
    if (!cur) { byId.set(id, r); return; }
    const re = Number(r.endedAt ?? 0), ce = Number(cur.endedAt ?? 0);
    if (re > ce) { byId.set(id, r); return; }
    // 2026-07-10 (audit D6) — on EQUAL endedAt (the same round re-uploaded), keep the
    // copy with more shot detail. compactHistoryForPersist strips shots from rounds >50,
    // so a `>=` tie-break let a compacted blob overwrite the cloud's still-full copy.
    if (re === ce) {
      const rs = Array.isArray((r as { shots?: unknown[] }).shots) ? (r as { shots: unknown[] }).shots.length : 0;
      const cs = Array.isArray((cur as { shots?: unknown[] }).shots) ? (cur as { shots: unknown[] }).shots.length : 0;
      if (rs > cs) byId.set(id, r);
    }
  };
  prev.forEach(add);
  next.forEach(add);
  return Array.from(byId.values());
}

/**
 * Merge the incoming snapshot OVER the stored one. Non-round keys are last-write-wins
 * (settings etc. — the most recent device's values are fine). The round store is
 * UNIONED so no finished round is ever lost when the same Backup ID is used from a
 * second/fresh phone that has fewer rounds locally. On any parse trouble we keep
 * whichever blob has MORE rounds — we never shrink the round history.
 */
function mergeSnapshots(prev: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...prev, ...next };
  try {
    const prevHist = extractRoundHistory(prev[ROUND_STORE_KEY]);
    const nextHist = extractRoundHistory(next[ROUND_STORE_KEY]);
    if (prevHist && nextHist) {
      merged[ROUND_STORE_KEY] = withRoundHistory(next[ROUND_STORE_KEY], unionRoundHistory(prevHist, nextHist));
    } else if (prevHist && (!nextHist || prevHist.length > (nextHist?.length ?? 0))) {
      // Incoming has no parseable / fewer rounds — keep the stored round blob intact.
      merged[ROUND_STORE_KEY] = prev[ROUND_STORE_KEY];
    }
    // 2026-07-08 (audit) — the round union alone left ~34 OTHER learned-data stores
    // (CNS tendencies, the bag, learned club distances, handicap/profile, practice/workout
    // history, family) as last-write-wins → a fresh/second phone with near-default blobs would
    // WIPE the cloud's richer copies. For these grow-mostly stores, keep whichever blob has MORE
    // data (longer serialized JSON ≈ more learned) so an emptier device can't clobber them.
    // Non-learned/config stores (settings, ui state) stay last-write-wins — most recent wins.
    // 2026-07-21 (QA audit, H2) — a true structural id-union across these stores was evaluated
    // and deliberately NOT shipped: most grow-mostly stores are editable, not append-only
    // (clubBag.removeClub, family.removeMember hard-delete, coachKnowledge FIFO+remove,
    // workout/practice caps). Without per-record tombstones, unioning to preserve one device's
    // divergent adds also RESURRECTS records the user deleted on the other device — a new bug.
    // The length heuristic below stays as the safe approximation; the correct multi-device fix
    // (tombstone/versioned sync) is tracked in QA_REPORT.md.
    for (const key of GROW_MOSTLY_KEYS) {
      const p = prev[key], n = next[key];
      const pLen = typeof p === 'string' ? p.length : p != null ? JSON.stringify(p).length : 0;
      const nLen = typeof n === 'string' ? n.length : n != null ? JSON.stringify(n).length : 0;
      // 2026-07-10 (audit D4) — only guard against a NEAR-EMPTY incoming blob (a fresh/second
      // device sitting at defaults). A modest shrink is a legitimate edit (removed a few clubs,
      // cleared a profile field) and MUST propagate — the old `pLen > nLen` reverted every such
      // deletion on the next backup + resurrected the removed data on restore. Keep the stored
      // copy only when the incoming is dramatically smaller (<60% of it), which reads as a
      // fresh device, not an edit.
      if (pLen > 0 && nLen < pLen * 0.6) merged[key] = p;
    }
  } catch { /* keep the last-write-wins merge; better than throwing on backup */ }
  return merged;
}

// Learned/earned data that only grows over a player's history — never let a fresh or
// second device's near-empty blob overwrite the cloud's richer copy. (Round history has its
// own id-union above.) Keys mirror store/cloudSync BACKED_UP_STORE_KEYS learned-data set.
const GROW_MOSTLY_KEYS = [
  'caddie-memory-v1', 'club-stats-v1', 'club-bag-v1', 'player-profile-v2',
  'practice-points', 'points-store-v1', 'workout-store-v1', 'family-store-v1',
  'vocabulary-profile-v1',
  // 2026-07-10 (audit D1) — was the misspelled 'practice-session-store-v1'; the real
  // persist key is 'practice-session-v1' (store/practiceSessionStore.ts), so the guard
  // never ran and practice-session history was clobbered last-write-wins.
  'practice-session-v1',
  // 2026-07-10 (audit D3) — these are backed up but were NOT protected → an emptier 2nd
  // device wiped them last-write-wins. Irreplaceable learned/authored data.
  'custom-courses-v1', 'course-captures-v1', 'watch-store-v1', 'guest-profiles-v1',
  'green-rolls-v1', 'tee-goals-v1', 'tournament-v1',
  // 2026-07-20 (bug-hunt fix) — same class as D3: these four accumulate irreplaceable
  // learned data (coaching knowledge, relationship history, team-intelligence handoffs,
  // practice counters) but were left out, so an emptier device clobbered the cloud copy.
  'coach-knowledge-v1', 'relationship-store-v1', 'team-intelligence-store-v1', 'practice-store',
];

/** The storage key is a hash of the (lower-cased) email + the passphrase. Email
 *  alone can't derive it, so there's no enumeration/overwrite without the secret. */
function storageKey(email: string, secret: string): string {
  return createHash('sha256').update(`${email.toLowerCase()}::${secret}`).digest('hex');
}

// 2026-07-10 (audit S3) — per-IP read throttle to stop passphrase brute-forcing. Counts
// attempts per (ip, minute) in a `backup_rate_limit` table (migration 0005). Fail-OPEN:
// any error (table absent / db hiccup) returns false so a real restore is never blocked.
const RATE_LIMIT_PER_MIN = 30;
// 2026-07-21 (QA audit, H6) — process-local limits that DON'T depend on migration 0005 and
// are keyed partly on the requested EMAIL, which a brute-forcer targeting one victim cannot
// rotate the way they can rotate IP / X-Forwarded-For. Generous enough that a real restore
// (a handful of GETs) is never blocked; a passphrase-guessing flood trips fast.
const EMAIL_LIMIT_PER_MIN = 12; // guesses against ONE backup identity / minute / instance
const IP_LIMIT_PER_MIN = 40;    // requests from one IP / minute / instance

/** True if the request should be throttled. Combines a spoof-resistant in-memory per-email
 *  + per-IP layer (always on) with the cross-instance DB per-IP counter (fail-open). */
async function isRateLimited(
  db: ReturnType<typeof getSmartPlaySupabase>,
  req: VercelRequest,
  email: string,
): Promise<boolean> {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || 'unknown';
  const minute = Math.floor(Date.now() / 60_000);

  // Layer 1 — in-memory, migration-independent, per-email (spoof-proof) + per-IP.
  const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
  if (hitInMemory(`email:${emailHash}:${minute}`, EMAIL_LIMIT_PER_MIN)) return true;
  if (hitInMemory(`ip:${ip}:${minute}`, IP_LIMIT_PER_MIN)) return true;

  // Layer 2 — DB per-IP across instances. Fail-OPEN so a DB blip never blocks a legit restore.
  if (!db) return false;
  try {
    const k = `${ip}:${minute}`;
    const { data } = await db.from('backup_rate_limit').select('n').eq('k', k).maybeSingle();
    const n = ((data as { n?: number } | null)?.n ?? 0) + 1;
    await db.from('backup_rate_limit').upsert({ k, n, at: new Date().toISOString() }, { onConflict: 'k' });
    return n > RATE_LIMIT_PER_MIN;
  } catch {
    return false; // table not migrated yet / transient error → don't block a legit restore
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = getSmartPlaySupabase();
  if (!db) return res.status(200).json({ ok: false, error: 'not_configured' });

  try {
    if (req.method === 'GET') {
      const email = norm(req.query.key);
      const secret = norm(req.query.secret);
      if (!email) return res.status(400).json({ ok: false, error: 'no_key' });
      if (secret.length < MIN_SECRET_LEN) return res.status(400).json({ ok: false, error: 'no_secret' });
      // 2026-07-10 (audit S3) — rate-limit the READ (brute-force) path per IP. The backup row
      // is protected only by sha256(email::passphrase); a known email + no throttle let an
      // attacker hammer passphrase guesses. Raising MIN_SECRET_LEN would lock out existing
      // users, so we throttle instead. Fail-OPEN if the rate-limit table isn't present yet
      // (migration 0005), so this can never break a legitimate restore.
      if (await isRateLimited(db, req, email)) return res.status(429).json({ ok: false, error: 'rate_limited' });
      const { data, error } = await db
        .from(TABLE)
        .select('data, updated_at')
        .eq('backup_key', storageKey(email, secret))
        .maybeSingle();
      if (error) return res.status(200).json({ ok: false, error: error.message });
      if (!data) return res.status(200).json({ ok: true, found: false });
      return res.status(200).json({ ok: true, found: true, data: data.data, updated_at: data.updated_at });
    }

    if (req.method === 'POST') {
      const body = (req.body ?? {}) as { key?: unknown; secret?: unknown; data?: unknown };
      const email = norm(body.key);
      const secret = norm(body.secret);
      if (!email) return res.status(400).json({ ok: false, error: 'no_key' });
      if (secret.length < MIN_SECRET_LEN) return res.status(400).json({ ok: false, error: 'no_secret' });
      if (body.data == null || typeof body.data !== 'object') {
        return res.status(400).json({ ok: false, error: 'no_data' });
      }
      // Size cap — a malicious/over-large payload can't blow up storage.
      const serialized = JSON.stringify(body.data);
      if (serialized.length > MAX_DATA_BYTES) {
        return res.status(413).json({ ok: false, error: 'too_large' });
      }
      const key = storageKey(email, secret);
      // 2026-07-08 (pre-release sweep — HIGH: phone-swap data loss) — this used to be a
      // whole-blob REPLACE. Using the same Backup ID from a fresh/second phone (or a
      // mis-tap of "Back up now" instead of "Restore") would overwrite the cloud rounds
      // with the near-empty local snapshot. Read the existing snapshot first and UNION the
      // append-only round history so a device with fewer rounds can never delete them.
      const existing = await db.from(TABLE).select('data').eq('backup_key', key).maybeSingle();
      // 2026-07-08 (audit) — if the pre-read FAILED (transient Supabase blip), we CANNOT safely
      // merge; a blind write here would revert to the destructive whole-blob replace and could
      // wipe the cloud. Reject so the client retries later rather than risking data loss.
      if (existing.error) {
        return res.status(200).json({ ok: false, error: 'read_failed_retry' });
      }
      const incoming = body.data as Record<string, unknown>;
      const toStore = existing.data?.data && typeof existing.data.data === 'object'
        ? mergeSnapshots(existing.data.data as Record<string, unknown>, incoming)
        : incoming;
      const { error } = await db
        .from(TABLE)
        .upsert(
          { backup_key: key, data: toStore, updated_at: new Date().toISOString() },
          { onConflict: 'backup_key' },
        );
      if (error) return res.status(200).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e instanceof Error ? e.message : 'unknown' });
  }
}
