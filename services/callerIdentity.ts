/**
 * 2026-10-27 (security audit Section 4) — tell OUR API who is calling.
 *
 * Every request to our own API carries `x-rc-app-user-id`: this install's RevenueCat appUserID. The
 * server (api/_callerIdentity) checks it for the smartplay_caddie_pro entitlement; in the current
 * phase it only LOGS the verdict and serves every request.
 *
 * One owner instead of 89 fetch sites: a thin wrapper over global fetch, installed once when billing
 * configures (services/billing/purchases.initBilling). It touches ONLY requests to our API base —
 * Sentry, Mapbox and every other host pass through unchanged — and never overwrites a header a caller
 * set itself. Until RevenueCat answers with an id, requests go out exactly as before.
 */
import { getApiBaseUrl, PROD_API_BASE_URL } from './apiBase';

export const CALLER_ID_HEADER = 'x-rc-app-user-id';

let appUserId: string | null = null;
let installed = false;

export function setCallerAppUserId(id: string | null | undefined): void {
  appUserId = typeof id === 'string' && id.trim() ? id.trim() : null;
}

function isOurApi(url: string): boolean {
  return url.startsWith(`${getApiBaseUrl()}/`) || url.startsWith(`${PROD_API_BASE_URL}/`);
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const o = input as { href?: unknown; url?: unknown };
    if (typeof o.href === 'string') return o.href;   // URL
    if (typeof o.url === 'string') return o.url;     // Request
  }
  return '';
}

export function installCallerIdentityHeader(): void {
  if (installed || typeof globalThis.fetch !== 'function') return;
  installed = true;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const id = appUserId;
    if (!id || !isOurApi(urlOf(input))) return original(input, init);
    const base = init?.headers ?? (input as { headers?: HeadersInit }).headers;
    const headers = new Headers(base);
    if (!headers.has(CALLER_ID_HEADER)) headers.set(CALLER_ID_HEADER, id);
    return original(input, { ...init, headers });
  }) as typeof fetch;
}

export function __resetCallerIdentityForTest(): void {
  appUserId = null;
  installed = false;
}
