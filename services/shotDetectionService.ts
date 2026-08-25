import * as Location from 'expo-location';
import { startGpsManager, subscribe as subscribeGps, stopGpsManager } from './gpsManager';
import { startSmartFinderGpsTracking, stopSmartFinderGpsTracking } from './smartFinderService';
import { ownerSentinel } from './ownerSentinel';
import { haversineMeters } from '../utils/geoDistance';
import { isValidGolfCoord } from '../utils/coordGuard';

export interface GPSSample {
  lat: number;
  lng: number;
  timestamp: number;
  speed?: number | null;
}

export interface ShotEvent {
  timestamp: number;
  start_location: { lat: number; lng: number };
  estimated_distance_yards: number;
  /**
   * 2026-08-24 (Tim — "it would be great if the user knows if shots are verifiably better when doing
   * their routine") — HOW LONG THEY STOOD OVER IT, in ms.
   *
   * A pre-shot routine takes time: walk in, look at the target, a waggle or a practice swing, then
   * commit. The detector already knows precisely how long the player was stationary at the ball —
   * it has to, because stillness is what tells it a shot happened at all. That number was computed
   * and thrown away every time.
   *
   * Deliberately a LOWER BOUND: it measures from the earliest contiguous sample within the anchor
   * radius up to the stillness cutoff, so a routine is never over-credited. Null when the buffer
   * cannot support the measurement (a shot detected off the fallback path, or a truncated buffer).
   */
  pre_shot_dwell_ms?: number | null;
}

type Listener = (event: ShotEvent) => void;

interface DetectorConfig {
  stationaryWindowMs: number;     // need this much stillness before a shot can be detected
  stationaryRadiusMeters: number; // GPS jitter tolerance during "still"
  minDisplacementYards: number;   // displacement that counts as a shot
  maxCartSpeedMs: number;         // suppress when sustained speed is over this
  /** When true, suppression checks the LATEST sample's speed only (is the
   *  user moving right now?) rather than the rolling 5-sample average.
   *  Stationary window also drops to ~8s so a typical cart pre-shot stop
   *  (5–15s at the ball) actually clears the gate. Trade-off: slightly
   *  more false positives when a cart parks for 8s without a swing. */
  cartMode: boolean;
  promptDelayMinMs: number;       // 5-15s window per spec
  promptDelayMaxMs: number;
  pollIntervalMs: number;
}

/**
 * 2026-08-23 (Tim, from a real round — "when I hit the drive and I go to the next spot, it detects
 * that stroke, but then we don't pick up the other strokes after").
 *
 * WHY ONLY THE DRIVE COUNTED. A shot needs `stationaryWindowMs` of stillness BEFORE the displacement
 * that marks it. On a tee you are trivially still for that long: waiting on the group ahead, teeing
 * the ball, a practice swing. At your ball in the fairway you walk up, look at it, and hit — often in
 * well under 20 seconds. So the tee shot registered every time and the approach almost never did,
 * which is exactly the pattern he describes, and it is why the stroke count drifted.
 *
 * 20s was never needed to prove stillness. The discriminator is the RADIUS: at walking pace (~1.4
 * m/s) you leave an 8m circle in about six seconds, so ten seconds inside it is already inconsistent
 * with walking. Cart mode has run at 8s/12m since it was written, for the same reason.
 *
 * 10s keeps the tighter 8m walking radius and still clears GPS jitter, while fitting how a golfer
 * actually plays an approach.
 */
const WALK_STATIONARY_MS = 10_000;

const DEFAULT_CONFIG: DetectorConfig = {
  stationaryWindowMs: WALK_STATIONARY_MS,
  stationaryRadiusMeters: 8,
  minDisplacementYards: 30,
  maxCartSpeedMs: 4.0,            // ~9 mph — anything sustained above this is cart, not walk-after-shot
  cartMode: false,
  promptDelayMinMs: 5_000,
  promptDelayMaxMs: 15_000,
  pollIntervalMs: 2_500,
};

/** Tuning applied when configure({ cartMode: true }) is called. */
const CART_OVERRIDES: Partial<DetectorConfig> = {
  stationaryWindowMs: 8_000,
  stationaryRadiusMeters: 12,
  cartMode: true,
};

/** Tuning applied when configure({ cartMode: false }) is called (the walking
 *  default). Mirrors DEFAULT_CONFIG so toggling resets cleanly. */
const WALK_OVERRIDES: Partial<DetectorConfig> = {
  stationaryWindowMs: WALK_STATIONARY_MS,
  stationaryRadiusMeters: 8,
  cartMode: false,
};

const METERS_PER_YARD = 0.9144;

// 2026-05-21 — Consolidation 1: local haversineMeters removed in favor of
// utils/geoDistance.ts canonical (mathematically identical formula).

class ShotDetector {
  private config: DetectorConfig = DEFAULT_CONFIG;
  private listeners: Set<Listener> = new Set();
  private samples: GPSSample[] = [];
  private subscription: Location.LocationSubscription | null = null;
  private unsubscribeGps: (() => void) | null = null;
  private running = false;
  private lastShotEmitTime = 0;
  private readonly EMIT_COOLDOWN_MS = 30_000;

  configure(partial: Partial<DetectorConfig>): void {
    // When toggling cartMode, apply the bundled overrides so the caller
    // doesn't have to know which thresholds shift with it.
    if (partial.cartMode === true) {
      this.config = { ...this.config, ...CART_OVERRIDES, ...partial };
    } else if (partial.cartMode === false) {
      this.config = { ...this.config, ...WALK_OVERRIDES, ...partial };
    } else {
      this.config = { ...this.config, ...partial };
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Start subscribing to GPS updates and watching for shot signatures.
   * Safe to call multiple times — no-op if already running.
   */
  async start(): Promise<boolean> {
    if (this.running) return true;
    try {
      // Pre-beta — route through gpsManager so the underlying watch is a
      // single adaptive subscription (active/walking/stationary modes)
      // instead of a dedicated high-accuracy 2.5s poll. Battery win.
      await startGpsManager();
      // Phase 107 / B1 — wire smartFinderService.lastFix to live gps
      // updates so yardages auto-refresh as the player walks. Idempotent.
      startSmartFinderGpsTracking();
      this.unsubscribeGps = subscribeGps((fix) => {
        // 2026-06-07 GPS-audit #1 (round 4): gate on source === 'user_mark'
        // not speed === null. Initial fix used speed===null as the
        // discriminator, but Android `Location.coords.speed` is
        // legitimately null on stationary watchPositionAsync ticks
        // AND on getCurrentPositionAsync — so the prior gate silently
        // disabled real shot detection on Android stationary samples.
        // GpsFix now carries an explicit `source` field; only
        // user-mark writes (SmartVision tap + Mark button via
        // setMarkedFix) get the skip. Live ticks always pass through.
        if (fix.source === 'user_mark') return;
        this.ingest({
          lat: fix.lat,
          lng: fix.lng,
          timestamp: fix.timestamp,
          speed: fix.speed,
        });
      });
      this.running = true;
      console.log('[shotDetection] started (via gpsManager)');
      return true;
    } catch (err) {
      ownerSentinel('shotDetection.start', err);
      return false;
    }
  }

  stop(): void {
    if (this.unsubscribeGps) {
      this.unsubscribeGps();
      this.unsubscribeGps = null;
    }
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
    this.running = false;
    this.samples = [];
    // Round-end stops the underlying gpsManager too. Other subscribers
    // (smartfinder, hole-view) tear down their watches when leaving the
    // round flow on their own.
    stopSmartFinderGpsTracking();
    stopGpsManager();
    console.log('[shotDetection] stopped');
  }

  /**
   * 2026-06-24 — Fix T (mid-round auto-shot-detection toggle). Stop ONLY
   * this service's own behavior — its gpsManager listener and its in-flight
   * shot-segmentation state — while leaving the SHARED round GPS
   * (gpsManager + smartFinder tracking) fully running for the rest of the
   * round. This is what the autoShotDetection setting must call when the
   * player flips it OFF mid-round: the STROKE counter stops auto-logging,
   * but yardages / hole-view / SmartFinder keep their live fixes.
   *
   * Difference vs stop(): pause() does NOT call stopGpsManager() or
   * stopSmartFinderGpsTracking(). Other features depend on the shared
   * round GPS, so a shot-detection pause must never tear it down.
   *
   * start() is safe to call after pause() to resume (it re-subscribes the
   * service's own listener; startGpsManager()/startSmartFinderGpsTracking()
   * are idempotent and simply no-op on the already-running shared watch).
   */
  pause(): void {
    if (!this.running && !this.unsubscribeGps) return;
    // Drop only OUR subscription to the shared gpsManager — do not stop
    // the manager itself.
    if (this.unsubscribeGps) {
      this.unsubscribeGps();
      this.unsubscribeGps = null;
    }
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
    this.running = false;
    // Clear in-flight segmentation state so a later resume starts from a
    // fresh stationary anchor rather than a stale pre-pause buffer.
    this.samples = [];
    this.lastShotEmitTime = 0;
    console.log('[shotDetection] paused (own listener + segmentation only; shared GPS untouched)');
  }

  /**
   * Manually feed a GPS sample (useful for testing or non-expo-location pipelines).
   */
  ingest(sample: GPSSample): void {
    // 2026-06-02 — Fix GM: guard manually-ingested samples. The
    // gpsManager.subscribe() path is already validated upstream, but
    // this public method is also called from test harnesses and
    // future non-expo-location pipelines (Meta glasses ingest, watch
    // bridge). A {0,0} sample here would pollute the anchor average
    // and produce a phantom shot at the equator.
    if (!isValidGolfCoord(sample.lat, sample.lng)) {
      console.log('[shotDetection] ingest rejected — invalid coord', sample.lat, sample.lng);
      return;
    }
    this.samples.push(sample);
    this.senseTransport(sample);
    // PGA HOPE follow-up (B1): adaptive players (wheelchair transfers,
    // prosthetic adjustment, longer pre-shot routine) routinely take 90s+
    // between sample-down and swing. The prior 60s buffer dropped the
    // stationary anchor before displacement could be measured, so the
    // shot was never detected. 180s covers realistic adaptive setup
    // without ballooning memory (~180 samples at 1Hz).
    const cutoff = sample.timestamp - 180_000;
    this.samples = this.samples.filter(s => s.timestamp >= cutoff);
    this.evaluate();
  }

  /**
   * Manually trigger a shot event — used for testing and as a UI fallback.
   */
  triggerManual(location?: { lat: number; lng: number }): void {
    const now = Date.now();
    // 2026-06-02 — Fix GM: dropped the `{ lat: 0, lng: 0 }` final
    // fallback. A shot emitted with start_location={0,0} would later
    // produce a 246yd-class haversine artifact when downstream code
    // measures distance from it. If we have no validated coord
    // anywhere (no provided location, no samples), refuse to emit
    // rather than poison the round with a bogus origin.
    let start: { lat: number; lng: number } | null = null;
    if (location && isValidGolfCoord(location.lat, location.lng)) {
      start = location;
    } else if (this.samples.length > 0) {
      const last = this.samples[this.samples.length - 1];
      if (isValidGolfCoord(last.lat, last.lng)) {
        start = { lat: last.lat, lng: last.lng };
      }
    }
    if (!start) {
      console.log('[shotDetection] triggerManual rejected — no valid origin coord');
      return;
    }
    this.emit({ timestamp: now, start_location: start, estimated_distance_yards: 0 });
  }

  private evaluate(): void {
    const now = Date.now();
    if (now - this.lastShotEmitTime < this.EMIT_COOLDOWN_MS) return;
    if (this.samples.length < 3) return;

    // 2026-06-05 — No-round guard. handleShotEvent (the subscriber
    // callback that wires this to gpsManager) already gates on
    // isRoundActive, but ingest() is a PUBLIC API also called from
    // test harnesses, Meta-glasses pipelines, and watch-bridge
    // ingestion paths. A phantom shot emitted while pre-round (e.g.
    // browsing the Play tab with GPS moving) would surface a SHOT
    // RESULT card from nowhere. Dynamic require avoids dragging
    // roundStore into this module at boot.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const round = require('../store/roundStore') as typeof import('../store/roundStore');
      if (!round.useRoundStore.getState().isRoundActive) return;
    } catch (e) {
      // If roundStore can't load (cyclical import race at boot), fail
      // SAFE — bail rather than emit a phantom shot.
      console.log('[shotDetection] roundStore probe failed; skipping evaluate:', e);
      return;
    }

    const latest = this.samples[this.samples.length - 1];

    // Suppress: user currently moving (or sustained moving in walking mode).
    // In cartMode we look at JUST the most recent sample's speed — the
    // whole point of cart play is that the rolling avg WILL include
    // recent cart driving, but if the user is stopped right now, a
    // shot is possible.
    if (this.config.cartMode) {
      const latestSpeed = latest.speed ?? 0;
      if (latestSpeed > this.config.maxCartSpeedMs) return;
    } else {
      const recentSpeeds = this.samples.slice(-5).map(s => s.speed ?? 0).filter(s => s >= 0);
      const avgSpeed = recentSpeeds.length > 0 ? recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length : 0;
      if (avgSpeed > this.config.maxCartSpeedMs) return;
    }

    // Find a stationary window earlier in the buffer
    const stationaryEndCutoff = latest.timestamp - this.config.stationaryWindowMs;
    const beforeStationary = this.samples.filter(s => s.timestamp <= stationaryEndCutoff);
    if (beforeStationary.length < 2) return;

    // The "anchor" is the centroid of the stationary window
    const stationarySamples = this.samples.filter(s =>
      s.timestamp <= stationaryEndCutoff &&
      s.timestamp >= stationaryEndCutoff - this.config.stationaryWindowMs,
    );
    if (stationarySamples.length < 2) return;

    const anchor = {
      lat: stationarySamples.reduce((a, s) => a + s.lat, 0) / stationarySamples.length,
      lng: stationarySamples.reduce((a, s) => a + s.lng, 0) / stationarySamples.length,
    };

    // All stationary samples must lie within radius of anchor
    const stillEnough = stationarySamples.every(s =>
      haversineMeters(anchor, s) <= this.config.stationaryRadiusMeters,
    );
    if (!stillEnough) return;

    // Displacement from anchor to latest position
    const displacementMeters = haversineMeters(anchor, latest);
    const displacementYards = displacementMeters / METERS_PER_YARD;
    if (displacementYards < this.config.minDisplacementYards) return;

    /**
     * 2026-08-24 — HOW LONG THEY STOOD THERE. Walk back from the stillness cutoff while samples stay
     * inside the anchor radius; the first one that leaves ends the dwell. Contiguity matters: a
     * player who was at this spot, wandered off, and came back should be credited only with the
     * visit they actually took, not the gap.
     *
     * A lower bound by construction — the buffer is 180s, so a very long routine saturates rather
     * than over-reporting, and the move itself happens somewhere after the cutoff. Under-crediting a
     * routine is the safe direction: it can only weaken a correlation, never manufacture one.
     */
    const dwellMs = (() => {
      const inWindow = this.samples.filter(s => s.timestamp <= stationaryEndCutoff);
      let earliest = stationaryEndCutoff;
      for (let i = inWindow.length - 1; i >= 0; i--) {
        const s = inWindow[i];
        if (haversineMeters(anchor, s) > this.config.stationaryRadiusMeters) break;
        earliest = s.timestamp;
      }
      const ms = stationaryEndCutoff - earliest;
      return Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null;
    })();

    this.lastShotEmitTime = now;
    this.emit({
      timestamp: now,
      start_location: anchor,
      estimated_distance_yards: Math.round(displacementYards),
      pre_shot_dwell_ms: dwellMs,
    });
  }

  /**
   * 2026-08-23 (Tim — "I wasn't walking yesterday. I was in a cart. I just forgot to do the settings…
   * I'm pretty sure other apps, I don't always have to tell if I'm a cart or walking").
   *
   * STOP ASKING. SENSE IT.
   *
   * Cart and walking need different tuning, and the app made the player declare which — a setting
   * that is trivially forgotten on the first tee and then silently wrong for eighteen holes. Yesterday
   * that mismatch ran the WALKING detector (10s of required stillness, 8m radius) while he rode, so
   * his approach shots never registered and the stroke count drifted.
   *
   * We already have what we need on every sample: speed. Nothing walks a golf course at 4 m/s
   * (~9 mph) — that is a cart, full stop. One reading could be GPS noise, so it takes SUSTAINED
   * evidence, and it decays: park the cart and walk a few holes and it reverts on its own.
   *
   * This never fights the player. An explicit choice in Settings still wins (`transportMode` on the
   * round); this only fills the gap when they never made one, which is the common case.
   */
  private cartEvidence = 0;
  private lastSensedCart: boolean | null = null;
  private senseTransport(sample: GPSSample): void {
    const speed = sample.speed;
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0) return;
    // Well clear of a fast walk (~2 m/s) so a brisk stride can never bank evidence.
    if (speed > 4.0) this.cartEvidence = Math.min(6, this.cartEvidence + 1);
    else if (speed < 1.8) this.cartEvidence = Math.max(0, this.cartEvidence - 1);
    // Hysteresis: 4 up to switch INTO cart, 1 down to fall back, so it does not flap at the boundary.
    const sensed = this.cartEvidence >= 4 ? true : this.cartEvidence <= 1 ? false : this.lastSensedCart;
    if (sensed == null || sensed === this.lastSensedCart) return;
    this.lastSensedCart = sensed;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const round = require('../store/roundStore') as typeof import('../store/roundStore');
      // An explicit player choice is never overridden — we only fill an unset one.
      const declared = round.useRoundStore.getState().transportMode;
      if (declared === 'cart' || declared === 'walking') {
        // They told us. Honour it, and stop re-deciding.
        if ((declared === 'cart') !== this.config.cartMode) this.configure({ cartMode: declared === 'cart' });
        return;
      }
    } catch { /* store unavailable — fall through and use what we sensed */ }

    if (sensed === this.config.cartMode) return;
    console.log(`[shotDetection] transport sensed as ${sensed ? 'CART' : 'WALKING'} from speed — retuning`);
    this.configure({ cartMode: sensed });
  }

  private emit(event: ShotEvent): void {
    console.log('[shotDetection] shot_likely', event);
    this.listeners.forEach(l => {
      try { l(event); } catch (err) { ownerSentinel('shotDetection.listener', err); }
    });
  }
}

export const shotDetectionService = new ShotDetector();

export function getPromptDelayMs(): number {
  // Random within configured window — adds natural variance per shot
  const min = DEFAULT_CONFIG.promptDelayMinMs;
  const max = DEFAULT_CONFIG.promptDelayMaxMs;
  return min + Math.floor(Math.random() * (max - min));
}
