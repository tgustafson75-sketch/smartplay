/**
 * SSRF guard for server-side fetches of user-supplied URLs.
 *
 * 2026-07-21 (QA audit, finding #3) — /api/pose-analysis fetched body.imageUrl with no
 * scheme/host validation, letting an unauthenticated caller make the server request
 * internal/metadata endpoints (169.254.169.254, localhost, 10/8, …) and read reachability
 * back through the error string. This module centralizes the defense so every proxy route
 * (pose-analysis, and any future course-proxy / golfbert-proxy / image-edit adoption) uses
 * the same allowlist instead of re-implementing it.
 *
 * Strategy:
 *   - Only http(s) schemes (https strongly preferred; http allowed for on-course CDN quirks
 *     but still IP-filtered).
 *   - Resolve the hostname to its IPs and reject any that fall in a private / loopback /
 *     link-local / carrier-grade-NAT / cloud-metadata range. Resolving BEFORE fetch (and
 *     pinning to the resolved IP) defeats DNS-rebinding.
 *   - Callers should additionally pass redirect:'manual' and re-validate any redirect
 *     target, since a public URL can 30x into an internal one.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

/** True if an IP literal is in a range that must never be reachable via a user URL. */
export function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isBlockedIpv4(ip);
  if (v === 6) return isBlockedIpv6(ip);
  return true; // not a parseable IP → block, don't guess
}

function isBlockedIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                                   // 0.0.0.0/8 "this host"
  if (a === 10) return true;                                  // 10/8 private
  if (a === 127) return true;                                 // 127/8 loopback
  if (a === 169 && b === 254) return true;                    // 169.254/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;           // 172.16/12 private
  if (a === 192 && b === 168) return true;                    // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true;          // 100.64/10 CGNAT
  if (a === 192 && b === 0 && p[2] === 0) return true;        // 192.0.0/24 IETF
  if (a >= 224) return true;                                  // 224/4 multicast + 240/4 reserved
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0]; // strip zone id
  if (lower === '::1' || lower === '::') return true;         // loopback / unspecified
  if (lower.startsWith('fe80')) return true;                  // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique-local
  // IPv4-mapped (::ffff:a.b.c.d) → validate the embedded v4
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

export class SsrfBlockedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * Validate a user-supplied URL and return the parsed URL plus its resolved public IP.
 * Throws SsrfBlockedError if the scheme is unsupported or the host resolves to a blocked IP.
 * Pass the returned `ip` to the fetch layer (or re-validate redirects) to pin the target.
 */
export async function assertPublicHttpUrl(
  raw: string,
  opts: { allowHttp?: boolean } = {},
): Promise<{ url: URL; ip: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  const scheme = url.protocol.replace(':', '');
  if (scheme !== 'https' && !(opts.allowHttp && scheme === 'http')) {
    throw new SsrfBlockedError('Only https URLs are allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip [] on ipv6 literals
  // If the host is already an IP literal, check it directly (no DNS).
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfBlockedError('URL resolves to a blocked address');
    return { url, ip: host };
  }
  // Resolve all addresses; block if ANY is internal (an attacker can control ordering).
  const results = await lookup(host, { all: true });
  if (results.length === 0) throw new SsrfBlockedError('Host does not resolve');
  for (const r of results) {
    if (isBlockedIp(r.address)) throw new SsrfBlockedError('URL resolves to a blocked address');
  }
  return { url, ip: results[0].address };
}
