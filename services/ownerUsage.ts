/**
 * 2026-09-23 (Tim) — the Owner Tools "App usage" card: fetch the aggregate report from
 * /api/owner-usage and hand it to SmartManage.
 *
 * Export goes to tim@smartplaycaddie.com, which Google Workspace routes into SmartManage's inbox
 * tagged to the SmartPlay Caddie workspace (api/inbound/gmail there) — no new integration needed.
 *
 * The owner key is a server secret (OWNER_USAGE_KEY), typed in once on the owner's phone and kept in
 * this device's storage. expo-secure-store is not in the binary, and adding it needs a store build.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Share } from 'react-native';
import { getApiBaseUrl } from './apiBase';
import type { OwnerUsageReport } from '../api/owner-usage';

const KEY_STORAGE = 'owner-usage-key-v1';
export const EXPORT_TO = 'tim@smartplaycaddie.com';

export async function getOwnerKey(): Promise<string> {
  try { return (await AsyncStorage.getItem(KEY_STORAGE)) ?? ''; } catch { return ''; }
}
export async function setOwnerKey(v: string): Promise<void> {
  try { await AsyncStorage.setItem(KEY_STORAGE, v.trim()); } catch { /* retried on next save */ }
}

export type FetchResult =
  | { ok: true; report: OwnerUsageReport }
  | { ok: false; reason: 'no_key' | 'unauthorized' | 'not_configured' | 'unavailable'; message: string };

export async function fetchOwnerUsage(): Promise<FetchResult> {
  const key = await getOwnerKey();
  if (!key) return { ok: false, reason: 'no_key', message: 'Enter your owner key to load usage.' };
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/owner-usage`, {
      headers: { 'x-owner-key': key },
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status === 401) return { ok: false, reason: 'unauthorized', message: 'That owner key was not accepted.' };
    if (res.status === 503) return { ok: false, reason: 'not_configured', message: 'Usage reporting is not set up on the server yet.' };
    if (!res.ok) return { ok: false, reason: 'unavailable', message: `Usage is unavailable right now (${res.status}).` };
    return { ok: true, report: (await res.json()) as OwnerUsageReport };
  } catch {
    return { ok: false, reason: 'unavailable', message: 'Could not reach the server. Check the connection and refresh.' };
  }
}

const n = (v: number | null) => (v == null ? 'unknown' : String(v));

/** Plain-text report — what lands in SmartManage's inbox. States its own blind spot up front. */
export function formatUsageReport(r: OwnerUsageReport): { subject: string; body: string } {
  const o = r.opted_in;
  const lines = [
    `SmartPlay Caddie — app usage (${r.generated_at.slice(0, 10)})`,
    '',
    'Opted-in players only (usage sharing is off by default):',
    `  Active installs — today ${o.active_installs.d1} · 7 days ${o.active_installs.d7} · 30 days ${o.active_installs.d30}`,
    `  Events in 30 days: ${o.events_30d}${o.truncated ? ' (capped — more exist)' : ''}`,
    '',
    'Daily active installs, last 7 days:',
    ...o.daily_active_7d.map((d) => `  ${d.day}: ${d.installs}`),
    '',
    'Top activity, 30 days:',
    ...(o.top_events_30d.length ? o.top_events_30d.map((e) => `  ${e.event}: ${e.count}`) : ['  none recorded']),
    '',
    `Cloud backups — total ${n(r.backups.total)} · updated in 7 days ${n(r.backups.updated_7d)} · in 30 days ${n(r.backups.updated_30d)}`,
    `Referrals — claimed ${n(r.referrals.claimed)} · qualified ${n(r.referrals.qualified)}`,
    '',
    `Not visible here: ${r.cannot_see}`,
  ];
  return { subject: `SmartPlay usage report ${r.generated_at.slice(0, 10)}`, body: lines.join('\n') };
}

/** Mail it to the SmartManage-routed inbox; the share sheet if no mail app is set up. */
export async function exportUsageToSmartManage(r: OwnerUsageReport): Promise<'sent' | 'failed'> {
  const { subject, body } = formatUsageReport(r);
  const mailto = `mailto:${EXPORT_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  try {
    if (await Linking.canOpenURL(mailto).catch(() => false)) await Linking.openURL(mailto);
    else await Share.share({ message: `${EXPORT_TO}\n\n${body}`, title: subject });
    return 'sent';
  } catch {
    return 'failed';
  }
}
