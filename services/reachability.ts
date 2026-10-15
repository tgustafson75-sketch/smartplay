/**
 * IS IT THE PHONE'S CONNECTION, OR IS IT US?
 *
 * 2026-10-15 (John Lonero, beta tester, Cross Creek GC, Temecula) — six analysis_errors in a minute:
 * course_search_failed ×5 and course_locate_failed · timeout, every one telling him "Course search
 * unavailable — check connection". Our server answered the same search in 0.7s that afternoon and
 * had Cross Creek in the results. Nothing in the report could say whether his phone had internet:
 * the diagnostics read `Network: ?`, because the app has no radio state (NetInfo is native — adding
 * it breaks OTA) and the throughput probe never ran that session.
 *
 * So the app was blaming the player's signal without evidence. Tim: "we'll have egg on our face if we
 * say that and then they got five bars at 5G." Bars are not the question anyway — a phone can show
 * five bars and carry no data. The question is whether the phone can reach THE INTERNET, and that
 * can be measured in JavaScript: ask hosts that are not ours.
 *
 * When one of our calls fails at the transport level, this fetches two independent control endpoints
 * — Apple's captive-portal check (the page iOS itself uses to decide a network has internet) and
 * Google's generate_204 (Android's equivalent). Three operators, three networks:
 *
 *   a control answers correctly   → the internet works; the failure is OURS. Never blame the player.
 *   …but takes seconds to do it   → 'slow': a weak link. The control page is a few hundred bytes from
 *                                   the nearest edge and arrives in well under a second on any healthy
 *                                   connection, so seconds is measured evidence, not a guess.
 *   a control answers WRONGLY     → something intercepted it: a Wi-Fi sign-in page (captive portal).
 *   no control answers at all     → the phone cannot reach the internet. Now, and only now, we may
 *                                   say so — and we say "no internet", never "weak signal", because
 *                                   we can prove the first and not the second.
 *
 * The verdict also goes into the issue log, so the next report answers "app or signal?" on its own.
 */

export type NetVerdict =
  /** No control host answered. The phone cannot reach the internet right now. */
  | 'offline'
  /** A control answered with the wrong content — a Wi-Fi network wants a sign-in first. */
  | 'captive'
  /** A control answered, but a few-hundred-byte page took seconds — a weak link, not a dead one. */
  | 'slow'
  /** A control answered correctly and quickly. The internet works; whatever failed is on our side. */
  | 'internet_ok';

export type Reachability = {
  verdict: NetVerdict;
  /** Which control proved the internet works (or intercepted), null when none answered. */
  via: string | null;
  /** Time for the first correct control answer, ms. Null unless internet_ok / slow. */
  controlMs: number | null;
  at: number;
};

type Control = {
  name: string;
  url: string;
  /** true = genuine answer; false = an answer, but not the real one (intercepted). */
  genuine: (status: number, body: string) => boolean;
};

const CONTROLS: Control[] = [
  {
    name: 'apple',
    url: 'https://captive.apple.com/hotspot-detect.html',
    // The real page is a fixed tiny document whose title is "Success". A portal serves its login page.
    genuine: (status, body) => status === 200 && /<TITLE>\s*Success\s*<\/TITLE>/i.test(body),
  },
  {
    name: 'google',
    url: 'https://www.gstatic.com/generate_204',
    genuine: (status) => status === 204,
  },
];

/**
 * The control pages are a few hundred bytes from the nearest edge; on any working link they arrive in
 * well under a second. 6s is generous enough that a slow-but-working connection still counts as
 * working — the error we must never make is calling a working connection "no internet".
 */
const CONTROL_TIMEOUT_MS = 6000;
/**
 * Above this, a genuine control answer means a weak connection. Deliberately high: cold DNS + TLS on
 * LTE costs ~0.5–0.8s, and calling a healthy connection "slow" is the same false blame we are removing.
 */
const SLOW_CONTROL_MS = 2500;
/** A verdict holds briefly, so a burst of failures (one per keystroke in a search box) probes once. */
const CACHE_MS = 20_000;

let last: Reachability | null = null;
let inFlight: Promise<Reachability> | null = null;

export function lastReachability(): Reachability | null {
  return last;
}

type ControlOutcome = { name: string; kind: 'genuine' | 'intercepted' | 'none'; ms: number };

async function askControl(c: Control): Promise<ControlOutcome> {
  const started = Date.now();
  try {
    const res = await fetch(`${c.url}?cb=${started}`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    } as RequestInit);
    const body = await res.text().catch(() => '');
    return { name: c.name, kind: c.genuine(res.status, body) ? 'genuine' : 'intercepted', ms: Date.now() - started };
  } catch {
    return { name: c.name, kind: 'none', ms: Date.now() - started };
  }
}

/**
 * Probe the internet, independent of our backend. Call it when one of OUR requests has failed at the
 * transport level. Controls run in parallel; the first genuine answer settles it without waiting for
 * the other. Cached for CACHE_MS and deduped while in flight. Never throws.
 */
export function probeReachability(opts?: { force?: boolean }): Promise<Reachability> {
  const now = Date.now();
  if (!opts?.force && last && now - last.at < CACHE_MS) return Promise.resolve(last);
  if (inFlight) return inFlight;

  inFlight = new Promise<Reachability>((resolve) => {
    const outcomes: ControlOutcome[] = [];
    let settled = false;
    const finish = (r: Reachability) => {
      if (settled) return;
      settled = true;
      last = r;
      inFlight = null;
      logVerdict(r, outcomes);
      resolve(r);
    };
    for (const c of CONTROLS) {
      void askControl(c).then((o) => {
        outcomes.push(o);
        if (o.kind === 'genuine') {
          finish({ verdict: o.ms > SLOW_CONTROL_MS ? 'slow' : 'internet_ok', via: o.name, controlMs: o.ms, at: Date.now() });
          return;
        }
        if (outcomes.length < CONTROLS.length) return;
        const intercepted = outcomes.find((x) => x.kind === 'intercepted');
        finish(intercepted
          ? { verdict: 'captive', via: intercepted.name, controlMs: null, at: Date.now() }
          : { verdict: 'offline', via: null, controlMs: null, at: Date.now() });
      });
    }
  });
  return inFlight;
}

/**
 * What to tell the player when `what` (e.g. "Course search") could not be reached. Every branch is a
 * claim the probe actually proved — 'internet_ok' takes the blame onto us rather than the player.
 */
/** Proven that the phone has no usable internet — the only verdicts allowed to raise "No internet". */
export function isProvenOffline(v: NetVerdict): boolean {
  return v === 'offline' || v === 'captive';
}

export function unreachableMessage(verdict: NetVerdict, what: string): string {
  switch (verdict) {
    // What still works is from the offline audit: yardages + scoring on courses already on the phone
    // (played, downloaded, or bundled) and the watch. Kevin's voice and new searches need the internet.
    case 'offline':
      return 'Your phone isn’t reaching the internet right now. Yardages and scoring still work on courses you’ve played or downloaded — searching needs a connection.';
    case 'slow':
      return 'Your connection is very slow right now. Yardages and scoring still work on courses you’ve played or downloaded — try the search again when it picks up.';
    case 'captive':
      return 'This Wi-Fi needs you to sign in first — open Safari to finish connecting.';
    case 'internet_ok':
      return `${what} isn’t responding on our end — your connection is fine. Try again in a moment.`;
  }
}

function logVerdict(r: Reachability, outcomes: ControlOutcome[]): void {
  try {
    const controls = outcomes.map((o) => `${o.name}:${o.kind}:${o.ms}ms`).join(' ');
    require('../store/issueLogStore').useIssueLogStore.getState()
      .addAppEvent('reachability', { verdict: r.verdict, controls }, 'diag');
  } catch { /* a diagnostic never breaks the caller */ }
}

/** Test seam. */
export function _resetReachabilityForTests(): void {
  last = null;
  inFlight = null;
}
