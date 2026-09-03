/**
 * 2026-09-03 — Referrals, client side. Tim: "a referral link. If a friend signs up, user gets 30 days."
 *
 * The rules and the identity model live in api/referral.ts and supabase/migrations/0009_referrals.sql;
 * this is the app's side of that contract and deliberately holds no policy of its own. In particular
 * it does NOT derive the referral code — the salt is server-only, because a salt shipped in the app
 * bundle is not a salt. The app asks once and caches the answer.
 *
 * EVERY CALL IS BEST-EFFORT. A referral is additive: it must never block a round, a swing, or a
 * launch. Every function here resolves to a null-ish answer rather than throwing, and the callers
 * are all fire-and-forget. [[caddie-failsafe-no-walls]]
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBaseUrl, appKeyHeaders } from '../apiBase';
import { getInstallId } from '../installId';

const CODE_CACHE_KEY = 'referral_code_v1';
/** Set once this install has told the server it played, so the call fires at most once per install. */
const QUALIFIED_KEY = 'referral_qualified_v1';
/** Set once this install has claimed someone's code — the server enforces it too, this saves a trip. */
const CLAIMED_KEY = 'referral_claimed_v1';

export type ReferralStatus = { code: string; qualified: number; pending: number; rewardDays: number };

async function post(action: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  try {
    const install = await getInstallId();
    if (!install) return null;
    const res = await fetch(`${getApiBaseUrl()}/api/referral`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...appKeyHeaders() },
      body: JSON.stringify({ action, install, ...extra }),
      // A referral is never worth making someone wait; the UI has a null path for all of it.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** This install's shareable code, asked for once and cached. Null when offline or not configured. */
export async function getMyReferralCode(): Promise<string | null> {
  try {
    const cached = await AsyncStorage.getItem(CODE_CACHE_KEY);
    if (cached) return cached;
  } catch { /* fall through and ask */ }
  const out = await post('code');
  const code = typeof out?.code === 'string' ? out.code : null;
  if (code) { try { await AsyncStorage.setItem(CODE_CACHE_KEY, code); } catch { /* cache is optional */ } }
  return code;
}

/** The link a player shares. Null when we could not get a code. */
export async function getMyReferralLink(): Promise<string | null> {
  const code = await getMyReferralCode();
  return code ? `https://smartplaycaddie.com/r/${code}` : null;
}

export type ClaimResult = 'claimed' | 'already_claimed' | 'self_referral' | 'bad_code' | 'failed';

/** The FRIEND records who invited them. The server allows this once per install, ever. */
export async function claimReferralCode(code: string): Promise<ClaimResult> {
  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(trimmed)) return 'bad_code';
  const out = await post('claim', { code: trimmed });
  if (!out) return 'failed';
  if (out.claimed === true) {
    try { await AsyncStorage.setItem(CLAIMED_KEY, trimmed); } catch { /* best-effort */ }
    return 'claimed';
  }
  const err = typeof out.error === 'string' ? out.error : 'failed';
  if (err === 'already_claimed' || err === 'self_referral' || err === 'bad_code') return err;
  return 'failed';
}

/**
 * The friend played — settle their referral.
 *
 * Called from the same real-use moments the trial extension counts (a round started, a swing
 * recorded). Fires at most once per install: the server is idempotent anyway, but a flag here keeps
 * a round from making a network call it will never need again.
 */
export async function reportReferralQualifyingActivity(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(QUALIFIED_KEY)) return;
    // Nothing to settle if this install never claimed anybody's code.
    if (!(await AsyncStorage.getItem(CLAIMED_KEY))) return;
  } catch { return; }
  const out = await post('qualify');
  // Mark on ANY definite answer, including "there was nothing to qualify" — the alternative is
  // retrying forever on every round for an install that was never referred.
  if (out?.ok === true) { try { await AsyncStorage.setItem(QUALIFIED_KEY, '1'); } catch { /* fine */ } }
}

/** Counts for the share screen. Null when offline. */
export async function fetchReferralStatus(): Promise<ReferralStatus | null> {
  const out = await post('status');
  if (!out || out.ok !== true || typeof out.code !== 'string') return null;
  return {
    code: out.code,
    qualified: Number(out.qualified) || 0,
    pending: Number(out.pending) || 0,
    rewardDays: Number(out.rewardDays) || 0,
  };
}

/**
 * Bank whatever this install has earned since last time. Returns the days granted (0 is the normal
 * answer). The SERVER marks the rows redeemed before answering, so a response that never arrives
 * loses the days rather than paying them twice — the safe direction for a grant nobody can take
 * back, and the reason this is not a read-then-write from here.
 */
export async function redeemReferralRewards(): Promise<number> {
  const out = await post('redeem');
  if (!out || out.ok !== true) return 0;
  const days = Number(out.days) || 0;
  return days > 0 ? days : 0;
}
