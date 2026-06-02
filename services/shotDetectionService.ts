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

const DEFAULT_CONFIG: DetectorConfig = {
  stationaryWindowMs: 20_000,
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
  stationaryWindowMs: 20_000,
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

    this.lastShotEmitTime = now;
    this.emit({
      timestamp: now,
      start_location: anchor,
      estimated_distance_yards: Math.round(displacementYards),
    });
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
