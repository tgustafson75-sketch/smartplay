/**
 * 2026-10-24 (Tim — "replace the Caddie AI card in Swing Lab with a non-bay-dependent version of
 * SmartBay AI. It is the best coaching logic and setup… same except reading bay screen numbers as a
 * requirement. User can turn that on and off… range vs in a bay").
 *
 * Caddie HOSTS SmartBay rather than copying it: the lesson brain, faults, drills, voice and setup stay
 * in one place (smartbay-ai) and SwingLab opens it in a WebView. This file is the whole contract with
 * the hosted page — the URL Caddie opens and the messages the page posts back. The page side lives in
 * smartbay-ai (host=caddie mode; docs/MANUAL.md).
 *
 *   Caddie → bay   /bay?host=caddie&where=range|bay#player=<base64url smartplay/player>
 *   bay → Caddie   {type:'smartbay:ready'} · {type:'smartbay:where', where} · {type:'smartbay:lesson', lesson}
 *                  · {type:'smartbay:left'} (the answer to Caddie's 'smartbay:leave', after any lesson)
 *
 * RANGE = camera only. BAY = camera + the sim screen's numbers. The player's last choice is kept here.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const SMARTBAY_ORIGIN = 'https://smartbay-ai.vercel.app';
export const SMARTPLAY_GOLF_URL = 'https://smartplaygolf.com';

export type BayWhere = 'range' | 'bay';

const WHERE_KEY = 'smartbay.where';

export async function loadBayWhere(): Promise<BayWhere> {
  try {
    return (await AsyncStorage.getItem(WHERE_KEY)) === 'bay' ? 'bay' : 'range';
  } catch {
    return 'range';
  }
}

export async function saveBayWhere(where: BayWhere): Promise<void> {
  try {
    await AsyncStorage.setItem(WHERE_KEY, where);
  } catch { /* next open starts at the range */ }
}

/** UTF-8 safe base64url (Hermes has TextEncoder + btoa). */
export function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The page Caddie opens. The player file rides in the fragment, so it never reaches a server log. */
export function smartBayUrl(where: BayWhere, player?: unknown): string {
  const base = `${SMARTBAY_ORIGIN}/bay?host=caddie&where=${where}`;
  return player ? `${base}#player=${base64url(JSON.stringify(player))}` : base;
}

export type BayHostMessage =
  | { type: 'smartbay:ready' }
  | { type: 'smartbay:where'; where: BayWhere }
  | { type: 'smartbay:lesson'; lesson: unknown }
  | { type: 'smartbay:left' };

/** The page's postMessage string → a known message, or null. Anything else is ignored. */
export function parseBayHostMessage(raw: string): BayHostMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.type === 'smartbay:ready') return { type: 'smartbay:ready' };
  if (o.type === 'smartbay:left') return { type: 'smartbay:left' };
  if (o.type === 'smartbay:where' && (o.where === 'range' || o.where === 'bay')) return { type: 'smartbay:where', where: o.where };
  if (o.type === 'smartbay:lesson' && o.lesson && typeof o.lesson === 'object') return { type: 'smartbay:lesson', lesson: o.lesson };
  return null;
}

/** Only our two sites load inside the hosted screens; any other link opens in the system browser. */
export function isHostedOrigin(url: string, origin: string): boolean {
  return url === origin || url.startsWith(origin + '/') || url.startsWith(origin + '?') || url.startsWith(origin + '#');
}
