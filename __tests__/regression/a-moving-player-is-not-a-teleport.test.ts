/**
 * 2026-10-15 (review, ROUND-BREAKING) — the outlier gates compared every new RAW fix against
 * lastFix, and lastFix is the SMOOTHED position: a 5-sample weighted mean that trails a moving player
 * by about two intervals. So the implied speed the gate saw was ~3x the real one.
 *
 *   - A cart at 5 m/s on the 1 Hz `active` cadence read as ~15 m/s and was rejected as a teleport:
 *     9 of 120 fixes accepted, the position up to 423 m behind. At 6.7 m/s: 5/120, 697 m.
 *   - Once the lag passed 300 m the absolute gate rejected EVERYTHING until 90 s after the last
 *     accepted fix. Cart ride then parked: 170 m behind at +20 s, 110 m at +40 s.
 *   - Walking on Android's 10 s cadence: a steady ~28 m lag (~31 yds long), 17 m still at +10 s
 *     after stopping.
 *   - forceRefreshGps kept the frozen reference, so fresh fixes stayed rejected and the player was
 *     told "Still searching for a strong GPS signal" on a perfect signal.
 *
 * This drives the REAL processFix through ingestExternalFix with synthetic tracks, and asserts both
 * halves: a moving player is followed closely, and a genuine glitch is still thrown away.
 */
jest.mock('../../store/roundStore', () => ({
  useRoundStore: { getState: () => ({ setLocationContext: () => undefined, isRoundActive: true }) },
}));
jest.mock('../../services/courseDataOrchestrator', () => ({ pushSustainedFix: () => undefined }));

let watchCb: ((loc: unknown) => void) | null = null;
let mockOneShot: (() => unknown) | null = null;
jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  requestForegroundPermissionsAsync: async () => ({ granted: true }),
  watchPositionAsync: async (_o: unknown, cb: (loc: unknown) => void) => {
    watchCb = cb;
    return { remove: () => { watchCb = null; } };
  },
  getCurrentPositionAsync: async () => {
    if (!mockOneShot) throw new Error('no one-shot in this test');
    return mockOneShot();
  },
}));

import * as gps from '../../services/gpsManager';
import { haversineMeters } from '../../utils/geoDistance';

const ORIGIN = { lat: 33.7, lng: -116.97 };
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
const at = (northM: number, eastM = 0) => ({
  lat: ORIGIN.lat + northM / M_PER_DEG_LAT,
  lng: ORIGIN.lng + eastM / mPerDegLng,
});

// Deterministic PRNG so a failure is reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000 - 0.5;
  };
}

/**
 * GPS error is temporally correlated (a slowly wandering bias), not white noise — consecutive 1 Hz
 * fixes from a phone differ by well under a metre while the absolute error is a few metres.
 */
function noiseModel(seed: number, maxM = 3) {
  const r = rng(seed);
  let bn = 0, be = 0;
  return () => {
    bn = Math.max(-maxM, Math.min(maxM, bn + r() * 0.8));
    be = Math.max(-maxM, Math.min(maxM, be + r() * 0.8));
    return { n: bn + r() * 0.5, e: be + r() * 0.5 };
  };
}

let clock = 1_800_000_000_000;
function feed(northM: number, eastM: number, opts: { acc?: number; speed?: number | null } = {}) {
  const p = at(northM, eastM);
  jest.setSystemTime(clock);
  return gps.ingestExternalFix({
    lat: p.lat, lng: p.lng,
    accuracy_m: opts.acc ?? 4,
    speed: opts.speed === undefined ? null : opts.speed,
    timestamp: clock,
  });
}
const lagTo = (northM: number, eastM = 0) => {
  const f = gps.getLastFix();
  if (!f) return Infinity;
  return haversineMeters(f, at(northM, eastM));
};

beforeEach(() => {
  jest.useFakeTimers();
  clock += 3_600_000;
  jest.setSystemTime(clock);
  gps.stopGpsManager();
});
afterEach(() => {
  gps.stopGpsManager();
  jest.useRealTimers();
});

/** Drive a straight-line track; returns accepted count and max lag after the first `settle` ticks. */
function drive(opts: {
  speedMps: number; cadenceS: number; seconds: number; seed: number; reportSpeed: boolean; startN?: number; settle?: number;
}) {
  const noise = noiseModel(opts.seed);
  let truthN = opts.startN ?? 0;
  let accepted = 0, maxLag = 0, ticks = 0;
  const n = Math.floor(opts.seconds / opts.cadenceS);
  for (let i = 0; i < n; i++) {
    clock += opts.cadenceS * 1000;
    truthN += opts.speedMps * opts.cadenceS;
    const e = noise();
    if (feed(truthN + e.n, e.e, { speed: opts.reportSpeed ? opts.speedMps : null })) accepted++;
    ticks++;
    if (ticks > (opts.settle ?? 3)) maxLag = Math.max(maxLag, lagTo(truthN));
  }
  return { accepted, total: n, maxLag, truthN };
}

describe('a cart on the 1 Hz active cadence is followed, not rejected as a teleport', () => {
  for (const speed of [5, 6.7]) {
    for (const reportSpeed of [true, false]) {
      it(`${speed} m/s, OS speed ${reportSpeed ? 'reported' : 'missing'}`, () => {
        feed(0, 0, { speed: 0 });
        const r = drive({ speedMps: speed, cadenceS: 1, seconds: 120, seed: 7, reportSpeed });
        // Pre-fix: 9/120 at 5 m/s and 5/120 at 6.7 m/s, lag 423 m / 697 m.
        expect(r.accepted).toBeGreaterThanOrEqual(115);
        expect(r.maxLag).toBeLessThan(15);
      });
    }
  }

  it('a cart ride then parked: the readout is right within seconds of stopping', () => {
    feed(0, 0, { speed: 0 });
    const r = drive({ speedMps: 6, cadenceS: 1, seconds: 60, seed: 11, reportSpeed: true });
    const noise = noiseModel(12);
    const lagAt: Record<number, number> = {};
    for (let s = 1; s <= 70; s++) {
      clock += 1000;
      const e = noise();
      feed(r.truthN + e.n, e.e, { speed: 0 });
      lagAt[s] = lagTo(r.truthN);
    }
    // Pre-fix: 170 m behind at +20 s, 110 m at +40 s.
    expect(lagAt[5]).toBeLessThan(10);
    expect(lagAt[20]).toBeLessThan(6);
    expect(lagAt[40]).toBeLessThan(6);
  });
});

describe('walking on the Android 10 s cadence does not trail the player', () => {
  for (const reportSpeed of [true, false]) {
    it(`1.3 m/s, OS speed ${reportSpeed ? 'reported' : 'missing'}`, () => {
      feed(0, 0, { speed: 0 });
      const r = drive({ speedMps: 1.3, cadenceS: 10, seconds: 300, seed: 21, reportSpeed, settle: 2 });
      // Pre-fix: a steady ~28 m lag.
      expect(r.accepted).toBe(r.total);
      expect(r.maxLag).toBeLessThan(8);
      // Then he stops — pre-fix 17 m off at +10 s, 8 m at +20 s.
      const noise = noiseModel(22);
      clock += 10_000;
      let e = noise();
      feed(r.truthN + e.n, e.e, { speed: reportSpeed ? 0 : null });
      expect(lagTo(r.truthN)).toBeLessThan(6);
      clock += 10_000;
      e = noise();
      feed(r.truthN + e.n, e.e, { speed: reportSpeed ? 0 : null });
      expect(lagTo(r.truthN)).toBeLessThan(6);
    });
  }
});

describe('standing still keeps the jitter smoothing', () => {
  it('the smoothed position is steadier than the raw fixes', () => {
    const r = rng(99);
    let rawErr = 0, smErr = 0, n = 0;
    for (let i = 0; i < 120; i++) {
      clock += 1000;
      // White jitter — the worst case for a smoother.
      const en = r() * 6, ee = r() * 6;
      feed(en, ee, { speed: 0.2 });
      if (i >= 5) {
        rawErr += Math.hypot(en, ee);
        smErr += lagTo(0, 0);
        n++;
      }
    }
    expect(smErr / n).toBeLessThan((rawErr / n) * 0.75);
  });
});

describe('genuine glitches are still rejected', () => {
  it('a single 300 m jump at 1 Hz is thrown away and the next real fix lands', () => {
    for (let i = 0; i < 5; i++) { clock += 1000; feed(0, 0, { speed: 0 }); }
    clock += 1000;
    expect(feed(300, 0, { speed: 0 })).toBe(false);
    expect(lagTo(0)).toBeLessThan(2);
    clock += 1000;
    expect(feed(0.5, 0, { speed: 0 })).toBe(true);
    expect(lagTo(0)).toBeLessThan(2);
  });

  it('a 300 m jump on the 20 s stationary cadence is still rejected (absolute backstop)', () => {
    for (let i = 0; i < 3; i++) { clock += 20_000; feed(0, 0, { speed: 0 }); }
    clock += 20_000;
    expect(feed(320, 0)).toBe(false);
  });

  it('a 120 m cell-tower handoff on the 10 s walking cadence is rejected', () => {
    for (let i = 0; i < 3; i++) { clock += 10_000; feed(0, 0, { speed: 0 }); }
    clock += 10_000;
    expect(feed(0, 120, { acc: 12 })).toBe(false);
    expect(lagTo(0)).toBeLessThan(2);
  });

  it('a fix worse than 90 m accuracy is rejected outright', () => {
    for (let i = 0; i < 3; i++) { clock += 1000; feed(0, 0, { speed: 0 }); }
    clock += 1000;
    expect(feed(5, 0, { acc: 95 })).toBe(false);
  });

  it('an 80 m-accuracy fix does not yank a still player (blended, not trusted)', () => {
    for (let i = 0; i < 5; i++) { clock += 1000; feed(0, 0, { speed: 0 }); }
    clock += 1000;
    // A weak fix 9 m off and reporting a spurious speed: it must not trigger the moving reset.
    feed(9, 0, { acc: 80, speed: 3 });
    expect(lagTo(0)).toBeLessThan(2);
  });
});

describe('forceRefreshGps lets go of the old gate reference', () => {
  it('the first fresh fix after a refresh lands even far from the last accepted one', async () => {
    jest.useRealTimers();
    // Reference fixes in the recent past, so the refresh's "newer than the request" check is honest.
    clock = Date.now() - 10_000;
    // Establish a reference.
    for (let i = 0; i < 3; i++) { clock += 1000; gps.ingestExternalFix({ ...at(0, 0), accuracy_m: 4, speed: 0, timestamp: clock }); }
    const startedAt = Date.now();
    const pending = gps.forceRefreshGps();
    await new Promise((r) => setTimeout(r, 20));
    expect(watchCb).not.toBeNull();
    // 400 m away, 3 s later — the absolute gate would reject this against the old reference.
    const p = at(400, 0);
    watchCb!({ coords: { latitude: p.lat, longitude: p.lng, accuracy: 4, speed: 0 }, timestamp: startedAt + 50 });
    const fx = await pending;
    expect(fx).not.toBeNull();
    expect(haversineMeters(fx!, p)).toBeLessThan(1);
  }, 20_000);
});

describe('one-shot reads go through the same gate and seam as every fix (review #8)', () => {
  afterEach(() => { mockOneShot = null; });

  it('a coarse one-shot (150 m) does not become the position', async () => {
    for (let i = 0; i < 3; i++) { clock += 1000; feed(0, 0, { speed: 0 }); }
    clock += 20_000;
    jest.setSystemTime(clock);
    const p = at(60, 0);
    mockOneShot = () => ({ coords: { latitude: p.lat, longitude: p.lng, accuracy: 150, speed: 0 }, timestamp: clock });
    await gps.getOneShotFix({ maxAgeMs: 0 });
    expect(lagTo(0)).toBeLessThan(2);
  });

  it('a one-shot teleport is rejected by the outlier gates', async () => {
    for (let i = 0; i < 3; i++) { clock += 1000; feed(0, 0, { speed: 0 }); }
    clock += 1000;
    jest.setSystemTime(clock);
    const p = at(400, 0);
    mockOneShot = () => ({ coords: { latitude: p.lat, longitude: p.lng, accuracy: 5, speed: 0 }, timestamp: clock });
    await gps.getOneShotFix({ maxAgeMs: 0 });
    expect(lagTo(0)).toBeLessThan(2);
  });

  it('a good one-shot reaches subscribers (it used to be written silently)', async () => {
    const seen: number[] = [];
    const unsub = gps.subscribe((f) => seen.push(f.timestamp));
    clock += 1000;
    jest.setSystemTime(clock);
    const p = at(0, 0);
    mockOneShot = () => ({ coords: { latitude: p.lat, longitude: p.lng, accuracy: 5, speed: 0 }, timestamp: clock });
    await gps.getOneShotFix({ maxAgeMs: 0 });
    unsub();
    expect(seen).toContain(clock);
  });

  it('a Mark with a coarse real accuracy does not replace the fix; a tap-to-place still does', () => {
    for (let i = 0; i < 3; i++) { clock += 1000; feed(0, 0, { speed: 0 }); }
    const far = at(80, 0);
    gps.setMarkedFix(far.lat, far.lng, 150);
    expect(lagTo(0)).toBeLessThan(2);
    gps.setMarkedFix(far.lat, far.lng, null);
    expect(lagTo(80)).toBeLessThan(1);
  });
});

describe('an off-round refresh does not leave a 1 Hz watch running (review #11)', () => {
  it('the refresh releases the watch it started', async () => {
    jest.useRealTimers();
    const startedAt = Date.now();
    const pending = gps.forceRefreshGps();
    await new Promise((r) => setTimeout(r, 20));
    expect(watchCb).not.toBeNull();
    const p = at(0, 0);
    watchCb!({ coords: { latitude: p.lat, longitude: p.lng, accuracy: 4, speed: 0 }, timestamp: startedAt + 50 });
    await pending;
    expect(watchCb).toBeNull();
    expect(gps.getGpsHealth().state).toBe('no_subscription');
  }, 20_000);

  it('a round that starts during the refresh adopts the watch and gets its manager', async () => {
    jest.useRealTimers();
    const startedAt = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native');
    const appStateSpy = jest.spyOn(rn.AppState, 'addEventListener');
    const pending = gps.forceRefreshGps();
    await new Promise((r) => setTimeout(r, 20));
    await gps.startGpsManager();
    // Pre-fix startGpsManager saw the refresh's subscription and returned: no foreground recovery,
    // no evaluateMode, no background task for the whole round.
    expect(appStateSpy).toHaveBeenCalled();
    appStateSpy.mockRestore();
    const p = at(0, 0);
    watchCb!({ coords: { latitude: p.lat, longitude: p.lng, accuracy: 4, speed: 0 }, timestamp: startedAt + 50 });
    await pending;
    expect(watchCb).not.toBeNull();
    expect(gps.getGpsHealth().state).toBe('healthy');
  }, 20_000);
});
