/**
 * IS IT SAFE TO PULL A WHOLE COURSE RIGHT NOW?
 *
 * 2026-08-21. Tim: "if you're on Wi-Fi you can pull the course ahead of time… we should be able to
 * OTA a wifi bridge and gate."
 *
 * He is right that this can ship over the air, and my earlier framing was wrong. I said Wi-Fi
 * detection needs a native module — true of the LABEL (NetInfo / expo-network are native, and adding
 * either breaks OTA for every tester frozen on the current TestFlight build). But the label is not
 * what we actually want.
 *
 * What the app needs to know is whether this connection can comfortably carry a full course download
 * — geometry, content, intelligence and satellite imagery — right now. That is a question about
 * THROUGHPUT AND LATENCY, and we can measure both directly in JavaScript.
 *
 * Measuring beats the flag on its own merits:
 *   • weak hotel Wi-Fi is worse than good 5G, and a Wi-Fi flag would confidently lie about that;
 *   • a metered-but-fast connection is the user's call, not ours to infer from a radio type;
 *   • it degrades honestly — if we cannot measure, we say UNKNOWN rather than guessing.
 *
 * Zero native modules, zero new dependencies. It reuses the static CDN asset that primeTransport
 * already fetches, so on the warm path this costs one small extra GET and nothing else.
 */
import { getApiBaseUrl, getConnectionEvidence } from './apiBase';

export type ConnectionClass = 'fast' | 'usable' | 'poor' | 'unknown';

export type ConnectionReading = {
  klass: ConnectionClass;
  /** Measured throughput in kilobytes/sec, or null when unmeasured. */
  kbps: number | null;
  /** Round-trip latency to our host in ms, or null. */
  latencyMs: number | null;
  /** Safe to start a large, unattended download without the user asking twice. */
  goodForBulk: boolean;
  reason: string;
};

/**
 * Thresholds are deliberately conservative, because the COST OF BEING WRONG IS ASYMMETRIC: starting
 * a multi-megabyte course pull on a weak cellular link burns a tester's data and their battery on a
 * download that may not even finish, while declining a download that would have worked costs one
 * tap later. Err toward declining.
 */
const FAST_KBPS = 400;   // comfortably carries imagery without the player waiting on it
const USABLE_KBPS = 120; // will finish, but not something to start unattended
const FAST_LATENCY_MS = 400;

/** The asset primeTransport already uses. Small, static, edge-served — no Lambda, no cold start. */
const PROBE_PATH = '/.well-known/assetlinks.json';
/** Below this the sample is too small for the timing to mean anything. */
const MIN_BYTES_FOR_TIMING = 256;

let lastReading: ConnectionReading | null = null;
let lastReadingAt = 0;
/** A connection does not change character second to second, and this costs a request. */
const CACHE_MS = 60_000;

export function lastConnectionReading(): ConnectionReading | null {
  return lastReading;
}

export async function measureConnection(opts?: { force?: boolean; timeoutMs?: number }): Promise<ConnectionReading> {
  const now = Date.now();
  if (!opts?.force && lastReading && now - lastReadingAt < CACHE_MS) return lastReading;

  const base = getApiBaseUrl();
  const evidence = getConnectionEvidence();
  let kbps: number | null = null;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 6000);
    const started = Date.now();
    // cache-bust so we time the NETWORK rather than the client's own disk.
    const res = await fetch(`${base}${PROBE_PATH}?cb=${started}`, { method: 'GET', signal: ctrl.signal })
      .finally(() => clearTimeout(t));
    const body = await res.text();
    const elapsedMs = Math.max(1, Date.now() - started);
    const bytes = body.length;
    if (res.ok && bytes >= MIN_BYTES_FOR_TIMING) {
      kbps = Math.round((bytes / 1024) / (elapsedMs / 1000));
    }
  } catch {
    // An unreachable host is not a slow connection — it is no connection. Say so honestly below.
  }

  const latencyMs = evidence.lastMs >= 0 ? evidence.lastMs : null;

  let klass: ConnectionClass = 'unknown';
  let reason = 'could not measure the connection';
  if (kbps != null) {
    if (kbps >= FAST_KBPS && (latencyMs == null || latencyMs <= FAST_LATENCY_MS)) {
      klass = 'fast'; reason = `${kbps} KB/s${latencyMs != null ? `, ${latencyMs}ms round trip` : ''}`;
    } else if (kbps >= USABLE_KBPS) {
      klass = 'usable'; reason = `${kbps} KB/s — will finish, but not unattended`;
    } else {
      klass = 'poor'; reason = `${kbps} KB/s — too slow for a course download`;
    }
  } else if (evidence.provenRecently && !evidence.slow) {
    // The host answered fast very recently. Weaker evidence than a real measurement, so it never
    // earns 'fast' — it only rules out 'poor'.
    klass = 'usable'; reason = 'host answered quickly a moment ago, but throughput is unmeasured';
  }

  const reading: ConnectionReading = { klass, kbps, latencyMs, goodForBulk: klass === 'fast', reason };
  lastReading = reading;
  lastReadingAt = now;
  return reading;
}

/**
 * The GATE. A large unattended download runs only on a connection we have MEASURED and found fast.
 * 'unknown' deliberately does NOT pass: the whole point is to protect a tester's data plan, and an
 * unmeasured connection is exactly the case where we should ask rather than assume.
 */
export async function mayPullCourseNow(): Promise<{ ok: boolean; reading: ConnectionReading }> {
  const reading = await measureConnection();
  return { ok: reading.goodForBulk, reading };
}
