import * as Location from 'expo-location';
import { startGpsManager, subscribe as subscribeGps, stopGpsManager } from './gpsManager';
import { startSmartFinderGpsTracking, stopSmartFinderGpsTracking } from './smartFinderService';

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
  promptDelayMinMs: number;       // 5-15s window per spec
  promptDelayMaxMs: number;
  pollIntervalMs: number;
}

const DEFAULT_CONFIG: DetectorConfig = {
  stationaryWindowMs: 20_000,
  stationaryRadiusMeters: 8,
  minDisplacementYards: 30,
  maxCartSpeedMs: 4.0,            // ~9 mph — anything sustained above this is cart, not walk-after-shot
  promptDelayMinMs: 5_000,
  promptDelayMaxMs: 15_000,
  pollIntervalMs: 2_500,
};

const METERS_PER_YARD = 0.9144;

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

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
    this.config = { ...this.config, ...partial };
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
      console.log('[shotDetection] start error:', err);
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
    this.samples.push(sample);
    // Keep last 60s of samples
    const cutoff = sample.timestamp - 60_000;
    this.samples = this.samples.filter(s => s.timestamp >= cutoff);
    this.evaluate();
  }

  /**
   * Manually trigger a shot event — used for testing and as a UI fallback.
   */
  triggerManual(location?: { lat: number; lng: number }): void {
    const now = Date.now();
    const start = location ?? (this.samples.length > 0
      ? { lat: this.samples[this.samples.length - 1].lat, lng: this.samples[this.samples.length - 1].lng }
      : { lat: 0, lng: 0 });
    this.emit({ timestamp: now, start_location: start, estimated_distance_yards: 0 });
  }

  private evaluate(): void {
    const now = Date.now();
    if (now - this.lastShotEmitTime < this.EMIT_COOLDOWN_MS) return;
    if (this.samples.length < 3) return;

    const latest = this.samples[this.samples.length - 1];

    // Suppress: sustained cart speed
    const recentSpeeds = this.samples.slice(-5).map(s => s.speed ?? 0).filter(s => s >= 0);
    const avgSpeed = recentSpeeds.length > 0 ? recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length : 0;
    if (avgSpeed > this.config.maxCartSpeedMs) return;

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
      try { l(event); } catch (err) { console.log('[shotDetection] listener error:', err); }
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
