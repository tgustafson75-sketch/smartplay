/**
 * Pre-beta — adaptive GPS polling.
 *
 * Single source of truth for the device GPS subscription during a round.
 * Replaces ad-hoc Location.watchPositionAsync / getCurrentPositionAsync
 * sites with one underlying watch whose poll rate adapts to context:
 *
 *   active     → user has shot intent in last 60s   · 1Hz  · BestForNavigation
 *   walking    → moved >5m in last 30s              · 10s  · Balanced
 *   stationary → no motion for 90s                  · 20s  · Low
 *
 * Round-end drops the subscription entirely. Round-start re-subscribes.
 *
 * One-shot reads (replaceing getCurrentPositionAsync) prefer the manager's
 * cached fix when it's <10s old to avoid redundant high-accuracy pulses.
 */

import * as Location from 'expo-location';
import * as Sentry from '@sentry/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useRoundStore } from '../store/roundStore';
import { ownerSentinel } from './ownerSentinel';
import { haversineMeters } from '../utils/geoDistance';
import { isValidGolfCoord } from '../utils/coordGuard';

export type GpsMode = 'active' | 'walking' | 'stationary';

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed: number | null;
  timestamp: number;
  // 2026-06-07 audit r4: explicit provenance so consumers can
  // distinguish live GPS ticks from setMarkedFix writes.
  // 'live'      = watchPositionAsync / getCurrentPositionAsync tick
  //               from the OS (may legitimately have speed===null
  //               on Android stationary samples)
  // 'user_mark' = setMarkedFix call (SmartVision tap or Mark button)
  // Default 'live' for back-compat; setMarkedFix overrides to
  // 'user_mark'. shotDetectionService gates on this to avoid
  // phantom shot emissions from taps.
  source?: 'live' | 'user_mark';
  // 2026-06-11 — canonical quality bucket derived from accuracy_m so
  // consumers read ONE value off the fix instead of each re-deriving via
  // classifyAccuracy. Mirrors classifyAccuracy's thresholds (<5m / <15m).
  // Optional for back-compat with persisted/legacy fixes.
  confidence?: 'high' | 'medium' | 'low';
}

type Subscriber = (fix: GpsFix) => void;

const ACTIVE_HOLD_MS    = 60_000;
const STATIONARY_AFTER  = 90_000;
const STATIONARY_DELTA  = 5;     // meters
const CACHE_FRESH_MS    = 10_000;

// Phase 107 / B5 — bumped 'walking' from Balanced → High. Balanced
// produces ~100m accuracy on Android in practice; High is needed so
// SmartFinder yardages stay trustworthy between shots while the player
// is walking (where they're glancing at the data strip to plan the
// next club). Battery cost is acceptable — round-active is the only
// time this mode is reached.
const POLL_CONFIG: Record<GpsMode, { intervalMs: number; accuracy: Location.Accuracy }> = {
  active:     { intervalMs: 1_000,  accuracy: Location.Accuracy.BestForNavigation },
  walking:    { intervalMs: 10_000, accuracy: Location.Accuracy.High },
  stationary: { intervalMs: 20_000, accuracy: Location.Accuracy.Low },
};

// Phase 107 / B2 — outlier rejection thresholds.
// accuracy_m worse than this = reading discarded entirely.
// 2026-06-08 — Raised 60 → 90. Rejecting everything worse than 60m left
// lastFix null under real outdoor conditions (trees, slow first lock),
// so the app showed "no signal" while phone/Golfshot still had a fix.
// 90m still rejects true cell-tower garbage but lets weak-but-usable
// fixes reach consumers; downstream confidence gates flag low quality.
const OUTLIER_ACCURACY_M = 90;
// 2026-06-05 — Absolute-distance outlier gate (cell-tower glitch).
// The time-windowed jump check below only fires when the bad fix
// arrives within OUTLIER_JUMP_WINDOW_MS of the last good fix. A
// cell-tower handoff that delivers a 200m-off fix several seconds
// AFTER a clean fix slips through both gates. 300m absolute is the
// realistic "I did not teleport mid-swing" threshold — a golfer
// can't move that far between watch ticks even at full cart speed.
// We reject these regardless of time gap, then let the smoothing
// buffer recover on the next real fix.
const OUTLIER_ABSOLUTE_JUMP_M = 300;
// position jump > this between consecutive accepted fixes within 5s = impossible
const OUTLIER_JUMP_M = 50;
const OUTLIER_JUMP_WINDOW_MS = 5_000;

// Phase 107 / B3 — rolling smoothing window.
// 2026-06-11 — widened 3 → 5 and switched from a flat mean to an
// inverse-accuracy-WEIGHTED mean (see processFix). Now that the pipeline
// KEEPS weak fixes (up to OUTLIER_ACCURACY_M = 90m) instead of discarding
// them, a flat 3-average trusted a 70m fix as much as a 4m one and let weak
// samples yank the smoothed position around. Weighting by 1/accuracy lets the
// strong fixes dominate while the weak ones still contribute a little; a wider
// window steadies it without adding much lag at golf walking speed.
const SMOOTHING_WINDOW = 5;
// 2026-06-12 — after a SIGNAL GAP this long, the resumed fix is NOT blended with the
// pre-gap buffer (which would drag the smoothed point backward and lag yardages for
// several ticks — Tim noticed this when signal came back). 30s is well beyond the normal
// walking (10s) / stationary (20s) tick cadence, so it never fires in steady state.
const SMOOTHING_GAP_MS = 30_000;

// Phase 400-followup — if no fix has arrived for this long while the watch
// is supposedly running, assume the OS killed the subscription during
// backgrounding and restart it on next foreground. 30s covers walking-mode
// (10s) + 3 missed ticks of headroom; stationary (20s) tolerates 1 miss.
const FIX_STALENESS_MS = 30_000;

// Phase 405 wave 2 — "GPS signal weak" callout. When accuracy stays at
// weak (>15m) or none for this long during an active round, fire the
// onPoorSignal callbacks so the caddie / UI can speak a recovery hint.
const POOR_SIGNAL_SUSTAINED_MS = 45_000;

let subscription: Location.LocationSubscription | null = null;
let appStateSub: { remove: () => void } | null = null;
let lastTickAt = 0;
// Phase 405 wave 2 — poor-signal callout state. poorSinceTs is null when
// the current fix is acceptable; once accuracy goes weak (>15m) we
// record the timestamp and fire the listeners after the sustained
// window elapses. poorAlertedAt prevents spamming the same alert more
// than once per recovery cycle.
let poorSinceTs: number | null = null;
let poorAlertedAt: number | null = null;
type PoorSignalListener = (info: { accuracy_m: number | null; duration_ms: number }) => void;
const poorSignalListeners = new Set<PoorSignalListener>();
let mode: GpsMode = 'walking';
let lastFix: GpsFix | null = null;
// 2026-06-04 — Hard-clear timer for lastFix. Every accepted fix arms a
// fresh 60s timer; if no fix arrives in that window, lastFix is null'd
// so downstream consumers (smartFinderService.getGreenYardages) fall
// through to staticYardages() instead of computing against a stale
// position. classifyAccuracy's 30s 'stale' label is a UI hint only —
// this is the structural reset that prevents wrong-by-100yd silent
// failures when GPS drops mid-round.
const STALE_HARD_LIMIT_MS = 60_000;
let staleHardTimer: ReturnType<typeof setTimeout> | null = null;
function armStaleHardTimer(): void {
  if (staleHardTimer) clearTimeout(staleHardTimer);
  staleHardTimer = setTimeout(() => {
    if (lastFix) {
      console.log('[gps] lastFix hard-cleared — no fresh fix in', STALE_HARD_LIMIT_MS, 'ms');
      lastFix = null;
    }
    staleHardTimer = null;
  }, STALE_HARD_LIMIT_MS);
}
function clearStaleHardTimer(): void {
  if (staleHardTimer) {
    clearTimeout(staleHardTimer);
    staleHardTimer = null;
  }
}
// 2026-05-20 — Day 1 / Fix 4: gpsManager is the canonical owner of
// "current position." Sim and marked-fix write paths used to live in
// smartFinderService.ts and only updated its local cache, leaving
// gpsManager.lastFix stale. Any consumer that read via getOneShotFix
// (e.g. shotLocationService) got a real-device fix while the
// simulator believed it was elsewhere — root cause of the 629,441y
// off-course readings and the "yardages drift up" symptom.
let simulatedActive = false;
let lastBumpReason: string | null = null;
let lastBumpAt: number | null = null;
let lastActiveBumpAt = 0;
let lastMotionAt = 0;
let evalTimer: ReturnType<typeof setInterval> | null = null;
let batterySaverFloor: GpsMode | null = null;
// Phase 107 / B3 — rolling buffer of accepted fixes. Mark resets it
// (Mark wants the raw current position, not a smoothed history).
let smoothingBuffer: GpsFix[] = [];
// Phase 107 / B2 — track outlier counts for telemetry.
let outliersDiscarded = 0;
// 2026-06-06 — Timestamp of the most recent setMarkedFix call. While
// (now - userMarkedAt) < USER_MARK_OUTLIER_BYPASS_MS, the next live
// GPS tick bypasses the jump-outlier + absolute-jump gates so it can
// reconcile against the user-marked position (which may be 50-300m
// off the real GPS). Without this bypass the SmartVision tap-to-place
// flow would lock the marked spot in forever — the legitimate live
// fix that should auto-correct gets rejected as a jump-outlier.
let userMarkedAt = 0;
const USER_MARK_OUTLIER_BYPASS_MS = 10_000;

const subscribers = new Set<Subscriber>();
// 2026-06-08 (audit #1) — persistent (app-boot-scoped) subscribers survive
// stopGpsManager(). The fan-out loops iterate `subscribers`; on round-end
// teardown we clear `subscribers` then RE-ADD these, so a once-at-boot
// consumer (smartFinderService's GPS fan-out) keeps receiving fixes across
// rounds instead of going silently dead after round 1.
const persistentSubscribers = new Set<Subscriber>();

function breadcrumb(message: string, data?: Record<string, unknown>) {
  try {
    Sentry.addBreadcrumb({ category: 'gps_mode', level: 'info', message, data });
  } catch {}
}

// 2026-05-21 — Consolidation 1: local haversineMeters removed in favor of
// utils/geoDistance.ts canonical (mathematically identical formula).

/**
 * 2026-06-11 — Canonical confidence bucket from a reported accuracy.
 * Defined locally (NOT imported from smartFinderService.classifyAccuracy)
 * to avoid an import cycle — smartFinderService subscribes to this module.
 * Thresholds are kept identical to classifyAccuracy (<5m strong, <15m
 * moderate) so the quick GpsFix.confidence and the detailed
 * GPSQualityReading never disagree. null accuracy = 'low' (unknown quality).
 */
function confidenceFromAccuracy(accuracy_m: number | null): 'high' | 'medium' | 'low' {
  if (accuracy_m == null) return 'low';
  if (accuracy_m < 5) return 'high';
  if (accuracy_m < 15) return 'medium';
  return 'low';
}

/**
 * Phase 405 wave 4 — shared fix-processing path. Runs the outlier
 * rejection + rolling smoothing + motion-tracking + subscriber-fanout
 * for any incoming fix, whether sourced from watchPositionAsync (the
 * foreground primary), Location.startLocationUpdatesAsync via
 * TaskManager (the background keepalive), or a future test harness.
 *
 * Returns true when the fix was accepted (not rejected as an outlier).
 */
function processFix(raw: GpsFix): boolean {
  // 2026-05-20 — Day 1 / Fix 4: drop incoming real GPS while the
  // simulator owns the cache. Without this, watchPositionAsync would
  // overwrite the sim coords with the device's real-world fix on every
  // tick and the simulated round would jump to the player's actual
  // location.
  if (simulatedActive) return false;
  // 2026-06-01 — Fix GL: WGS84 boundary guard. Reject coordinates
  // that aren't real-world golf positions BEFORE they pollute lastFix
  // and propagate through the smoothing buffer, subscribers,
  // setLocationContext, courseDataOrchestrator, etc. Without this,
  // a single bad OS callback (NaN from a hardware glitch, {0,0} from
  // a permission-permission-revoked race, meters leaked into degree
  // slots from a future regression) corrupts EVERY downstream
  // consumer until the next acceptable fix arrives — and the
  // smoothing buffer averages the bad value into the next few good
  // fixes too. Single guard, applied at source, blocks the whole
  // class.
  if (!isValidGolfCoord(raw.lat, raw.lng)) {
    outliersDiscarded++;
    console.log(`[gps:outlier-rejected] invalid coord lat=${raw.lat} lng=${raw.lng}`);
    // 2026-06-02 — Fix GM: ownerSentinel breadcrumb so silent
    // coord-rejection bursts mid-round are visible in telemetry.
    // Without this, a round that silently lost GPS for 20-30 min
    // due to an OEM glitch would look successful in Sentry.
    ownerSentinel('gps.processFix.invalidCoord', new Error(`lat=${raw.lat} lng=${raw.lng}`));
    return false;
  }
  // (1) Discard if reported accuracy is worse than threshold.
  if (raw.accuracy_m != null && raw.accuracy_m > OUTLIER_ACCURACY_M) {
    outliersDiscarded++;
    console.log(`[gps:outlier-rejected] accuracy_m=${raw.accuracy_m.toFixed(1)} (>${OUTLIER_ACCURACY_M})`);
    return false;
  }
  // 2026-06-06 — User-mark bypass: when the user just placed a
  // position via setMarkedFix (SmartVision tap-to-place), the next
  // live fix is EXPECTED to jump far from the marked spot — that's
  // the auto-reconcile. Bypass the outlier gates during
  // USER_MARK_OUTLIER_BYPASS_MS so the legitimate live fix lands.
  const userMarkBypassActive = userMarkedAt > 0 && (Date.now() - userMarkedAt) < USER_MARK_OUTLIER_BYPASS_MS;
  // (2) Discard if position jumps > 50m within 5s of the last accepted fix.
  if (!userMarkBypassActive && lastFix && (raw.timestamp - lastFix.timestamp) < OUTLIER_JUMP_WINDOW_MS) {
    const jump = haversineMeters(lastFix, raw);
    if (jump > OUTLIER_JUMP_M) {
      outliersDiscarded++;
      console.log(`[gps:outlier-rejected] jump_m=${jump.toFixed(1)} dt_ms=${raw.timestamp - lastFix.timestamp}`);
      return false;
    }
  }
  // (3) 2026-06-05 — Absolute-distance gate regardless of time gap.
  // Catches cell-tower handoff glitches that deliver a 200m+ off fix
  // many seconds after the last clean fix (slips through gate 2).
  // A golfer can't physically traverse OUTLIER_ABSOLUTE_JUMP_M between
  // watch ticks even at full cart speed (≈4 m/s ⇒ would need ~75s).
  if (!userMarkBypassActive && lastFix) {
    const absoluteJump = haversineMeters(lastFix, raw);
    if (absoluteJump > OUTLIER_ABSOLUTE_JUMP_M) {
      outliersDiscarded++;
      console.log(`[gps:outlier-rejected] absolute_jump_m=${absoluteJump.toFixed(1)} dt_ms=${raw.timestamp - lastFix.timestamp}`);
      return false;
    }
  }
  // 2026-06-06 — Clear the bypass once a live fix has actually
  // landed; subsequent ticks resume normal outlier gating.
  if (userMarkBypassActive) {
    userMarkedAt = 0;
    console.log('[gps:user-mark-bypass] reconcile fix accepted, bypass cleared');
  }
  // Rolling INVERSE-ACCURACY-WEIGHTED smoothing. Each buffered fix is
  // weighted by 1/accuracy (floored at 5m so a single 2m fix can't fully
  // dominate; null accuracy treated as a weak 30m). Stronger fixes pull the
  // smoothed position harder than weak ones — strictly better than the prior
  // flat mean now that weak fixes (up to 90m) are kept rather than discarded.
  // Drop the pre-gap buffer if signal just resumed after a long silence — otherwise the
  // resumed position is averaged with where the player WAS before the gap and lags.
  const lastBuffered = smoothingBuffer[smoothingBuffer.length - 1];
  if (lastBuffered && raw.timestamp - lastBuffered.timestamp > SMOOTHING_GAP_MS) {
    smoothingBuffer = [];
  }
  smoothingBuffer.push(raw);
  if (smoothingBuffer.length > SMOOTHING_WINDOW) smoothingBuffer.shift();
  let wLat = 0, wLng = 0, wSum = 0;
  for (const f of smoothingBuffer) {
    const w = 1 / Math.max(f.accuracy_m ?? 30, 5);
    wLat += f.lat * w;
    wLng += f.lng * w;
    wSum += w;
  }
  const fix: GpsFix = {
    // wSum is always > 0 (buffer has >=1 fix, weights are positive).
    lat: wLat / wSum,
    lng: wLng / wSum,
    // Report the CURRENT fix's accuracy (honest live quality), NOT the
    // buffer's best — the accuracy pill must reflect signal right now.
    accuracy_m: raw.accuracy_m,
    speed: raw.speed,
    timestamp: raw.timestamp,
    // 2026-06-07 audit r5: explicit 'live' provenance so future
    // consumers can rely on the source discriminator. Live ticks
    // (this path) write 'live'; setMarkedFix writes 'user_mark'.
    source: 'live',
    confidence: confidenceFromAccuracy(raw.accuracy_m),
  };
  // Motion tracking — stationary -> walking on real motion.
  if (lastFix) {
    const moved = haversineMeters(lastFix, fix);
    if (moved >= STATIONARY_DELTA) {
      lastMotionAt = Date.now();
      if (mode === 'stationary') {
        // 2026-05-17 — Audit C "A" fix: clear smoothing buffer BEFORE
        // flipping mode. Otherwise the first 1-3 walking fixes get
        // averaged with stale stationary samples and yardages lag by
        // 20-30 yards for ~20s after motion resumes (the previous
        // buffer entries are from the user's pre-walk location).
        smoothingBuffer = [];
        setMode('walking', 'motion_resumed');
      }
    }
  } else {
    lastMotionAt = Date.now();
  }
  lastFix = fix;
  lastTickAt = Date.now();
  armStaleHardTimer();
  for (const cb of subscribers) {
    try { cb(fix); } catch (e) { ownerSentinel('gps.subscriber.fix', e); }
  }
  // 2026-05-22 — Course Data Orchestrator: feed every accepted fix into
  // the sustained-fix buffer so reconciliation + heading-aware logic
  // have a rolling window to read. Dynamic require avoids the orchestrator
  // depending on gpsManager and vice-versa at module-load time.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const orch = require('./courseDataOrchestrator');
    orch.pushSustainedFix?.(fix);
  } catch { /* non-fatal */ }
  // 2026-05-24 — Location-type tagging (tee/fairway/green). roundStore
  // dedups on unchanged state so this is cheap to call every fix.
  // Does NOT touch currentHole — holeDetection.ts owns that.
  try {
    useRoundStore.getState().setLocationContext({ lat: fix.lat, lng: fix.lng });
  } catch (e) { ownerSentinel('gps.setLocationContext', e); }
  return true;
}

/**
 * Phase 405 wave 4 — public ingest for fixes that originate outside
 * watchPositionAsync (currently: the background-location TaskManager
 * callback in services/backgroundLocationTask.ts). Runs through the
 * same outlier-rejection + smoothing + subscriber-fanout path so
 * consumers see a unified stream regardless of source.
 */
export function ingestExternalFix(fix: GpsFix): boolean {
  return processFix(fix);
}

// 2026-05-20 — Day 1 / Fix 4: canonical write paths for simulator and
// manual-mark seeded fixes. These were previously in smartFinderService
// and only updated that service's local cache, diverging from
// gpsManager.lastFix. Now they update the one true cache + fan out to
// every subscriber (smartFinderService, shotLocationService, GPS quality
// overlay, etc.) so every consumer sees the same position.

/**
 * Simulator-only fix seed. Sets lastFix to the harness-provided coords
 * and flips simulatedActive so live GPS ticks are suppressed (would
 * overwrite the sim) and getOneShotFix short-circuits to the cached
 * sim fix (would otherwise pulse a real-device read).
 */
export function setSimulatedFix(loc: { lat: number; lng: number }, accuracy_m = 3): void {
  // 2026-06-01 — Fix GL: same coord guard as the real-fix path.
  if (!isValidGolfCoord(loc.lat, loc.lng)) {
    console.log(`[gps:sim-rejected] invalid coord lat=${loc.lat} lng=${loc.lng}`);
    ownerSentinel('gps.setSimulatedFix.invalidCoord', new Error(`lat=${loc.lat} lng=${loc.lng}`));
    return;
  }
  simulatedActive = true;
  lastFix = {
    lat: loc.lat,
    lng: loc.lng,
    accuracy_m,
    speed: null,
    timestamp: Date.now(),
    // 2026-06-07 audit r5: simulated fixes behave as live for
    // downstream consumers (harness testing relies on shot
    // detection firing on simulated movement).
    source: 'live',
    confidence: confidenceFromAccuracy(accuracy_m),
  };
  lastTickAt = Date.now();
  // 2026-06-05 — arm the stale-clear so a sim fix doesn't hard-clear
  // 60s later when no real watch tick comes in. Without this, harness
  // scenarios broke when a single sim seed sat for 60s+ between events.
  armStaleHardTimer();
  for (const cb of subscribers) {
    try { cb(lastFix); } catch (e) { ownerSentinel('gps.subscriber.sim', e); }
  }
}

/** Stop the sim and clear the cached fix so the next real GPS tick wins. */
export function clearSimulatedFix(): void {
  simulatedActive = false;
  lastFix = null;
  smoothingBuffer = [];
  clearStaleHardTimer();
}

export function isSimulatedActive(): boolean {
  return simulatedActive;
}

/**
 * Manual-mark seed. Forces lastFix to the user-marked coordinates so
 * yardages (front / middle / back, shot start_location, etc.) reflect
 * the marked spot immediately without waiting for the next watch tick.
 * Resets the smoothing buffer per the Phase 107 / B3 note in
 * bumpToActive — mark wants the raw current position, not a smoothed
 * blend with the prior walking-mode samples.
 */
export function setMarkedFix(lat: number, lng: number, accuracy_m: number | null): void {
  // 2026-06-01 — Fix GL: reject Mark events with invalid coords. A
  // bad Mark would otherwise poison lastFix and every downstream
  // yardage / off-course / hole-detection consumer.
  if (!isValidGolfCoord(lat, lng)) {
    console.log(`[gps:mark-rejected] invalid coord lat=${lat} lng=${lng}`);
    ownerSentinel('gps.setMarkedFix.invalidCoord', new Error(`lat=${lat} lng=${lng}`));
    return;
  }
  lastFix = {
    lat,
    lng,
    accuracy_m,
    speed: null,
    timestamp: Date.now(),
    source: 'user_mark' as const,
    confidence: confidenceFromAccuracy(accuracy_m),
  };
  // 2026-06-06 — Mark a "user-marked" timestamp so the next 1-2 live
  // GPS ticks bypass the outlier-rejection gates in processFix. ONLY
  // arm the bypass when accuracy_m === null (tap-derived from
  // SmartVision cart placement). Other setMarkedFix callers — like
  // the on-course Mark button via forceMarkPosition — pass a REAL
  // accuracy from a high-accuracy getCurrentPositionAsync and want
  // the outlier gate to keep filtering bad ticks, NOT trust the
  // next tick blindly.
  // 2026-06-07 GPS-audit #2: when a real-accuracy Mark fires INSIDE
  // an active bypass window (SmartVision tap was within last 10s),
  // explicitly DISARM the bypass — otherwise the next live tick
  // after the Mark would bypass outlier gates, defeating the
  // outlier filtering the user just trusted the Mark button to
  // provide.
  if (accuracy_m === null) {
    userMarkedAt = Date.now();
  } else {
    userMarkedAt = 0;
  }
  smoothingBuffer = [];
  lastTickAt = Date.now();
  // 2026-06-05 — arm the stale-clear so the user-marked position
  // doesn't hard-clear 60s later if no watch tick arrives. Mark is an
  // explicit "trust this spot" signal — losing it silently because
  // the watcher was slow is exactly the wrong behavior.
  armStaleHardTimer();
  for (const cb of subscribers) {
    try { cb(lastFix); } catch (e) { ownerSentinel('gps.subscriber.mark', e); }
  }
}

function setMode(next: GpsMode, reason: string) {
  if (mode === next) return;
  // Battery-saver floor — never drop into 'active' if the user opted to save.
  if (batterySaverFloor === 'walking' && next === 'active') {
    breadcrumb('mode_active_blocked_by_saver', { wanted: next, reason });
    return;
  }
  const prev = mode;
  mode = next;
  breadcrumb('mode_change', { from: prev, to: next, reason });
  console.log(`[gps] ${prev} → ${next} (${reason})`);
  if (subscription) restartWatch();
}

async function restartWatch() {
  if (!subscription) return;
  try { subscription.remove(); } catch {}
  subscription = null;
  await startWatchInternal();
}

async function startWatchInternal() {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) {
      // 2026-05-17 — Audit C "E" / "L" P1 fix: surface permission
      // denial as an owner toast AND a user-facing toast. Previously
      // this was console-log-only, which masked the round-killing
      // silent-no-GPS failure mode Tim has hit before. Both toasts
      // fire from this single site so any consumer who calls
      // startWatchInternal (round start, recalibrate, foreground
      // recovery) gets the warning.
      ownerSentinel('gps.startWatch.no_permission',
        new Error('Location permission denied'));
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useToastStore } = require('../store/toastStore') as typeof import('../store/toastStore');
        useToastStore.getState().show('GPS off — enable Location in Settings to keep yardages live.');
      } catch { /* toast layer unavailable */ }
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../store/issueLogStore').useIssueLogStore.getState().addGpsEvent('permission_denied');
      } catch { /* issue-log best-effort */ }
      return;
    }
    const cfg = POLL_CONFIG[mode];
    // Audit follow-up (2026-05-13) — fallback ladder for older Android
    // devices / locked-down OEMs that throw on the configured accuracy
    // tier. Try the configured accuracy first, drop to Balanced on
    // failure, then Low. If all three throw, we log and leave the
    // subscription null (consumers handle the absent-fix case).
    // Yardages going coarse-but-present is strictly better than yardages
    // going completely dark for the rest of the round.
    const accuracyLadder: Location.Accuracy[] = [
      cfg.accuracy,
      Location.Accuracy.Balanced,
      Location.Accuracy.Low,
    ];
    // Phase 405 wave 4 — body extracted into module-level processFix
    // so background-location ingest paths share the same outlier +
    // smoothing + subscriber-fanout flow.
    const onLocationUpdate = (loc: Location.LocationObject) => {
      processFix({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        accuracy_m: loc.coords.accuracy ?? null,
        speed: loc.coords.speed ?? null,
        timestamp: loc.timestamp,
      });
    };

    // Try each accuracy in the ladder. First success wins.
    let lastWatchErr: unknown = null;
    for (const accuracy of accuracyLadder) {
      try {
        subscription = await Location.watchPositionAsync(
          {
            accuracy,
            timeInterval: cfg.intervalMs,
            distanceInterval: 2,
          },
          onLocationUpdate,
        );
        if (accuracy !== cfg.accuracy) {
          // Made it on a fallback rung — tell the breadcrumbs so we
          // can see the device class fingerprint in Sentry later.
          breadcrumb('watch_accuracy_fallback', {
            wanted: cfg.accuracy,
            got: accuracy,
          });
          console.log(`[gps] accuracy fallback: ${cfg.accuracy} → ${accuracy}`);
        }
        break;
      } catch (err) {
        lastWatchErr = err;
        console.log(`[gps] watch error at accuracy=${accuracy}:`, err);
      }
    }
    if (!subscription) {
      // 2026-05-17 — Audit C "L" P1: all-accuracy-rungs-failed was
      // logging only. Now surfaces via ownerSentinel so a silent
      // dead-GPS round is at least visible to Tim mid-round.
      ownerSentinel('gps.startWatch.allAccuracyFailed', lastWatchErr ?? new Error('No subscription'));
      // 2026-06-08 (audit #1) — also tell the USER. A silent dead-GPS
      // round (locked-down OEM / location services off) otherwise looks
      // like the app is broken while the phone "has GPS".
      try {
        const { useToastStore } = require('../store/toastStore') as typeof import('../store/toastStore');
        useToastStore.getState().show('GPS unavailable on this device — check Location Services, then restart the app.');
      } catch { /* toast is best-effort */ }
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../store/issueLogStore').useIssueLogStore.getState().addGpsEvent('all_accuracy_failed', {
          error: lastWatchErr instanceof Error ? lastWatchErr.message : String(lastWatchErr ?? 'no subscription'),
        });
      } catch { /* issue-log best-effort */ }
    }
  } catch (err) {
    ownerSentinel('gps.startWatchInternal', err);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../store/issueLogStore').useIssueLogStore.getState().addGpsEvent('watch_setup_error', {
        error: err instanceof Error ? err.message : String(err),
      });
    } catch { /* issue-log best-effort */ }
  }
}

/**
 * Phase 400-followup — backgrounding kill detection.
 *
 * expo-location's watchPositionAsync silently stops delivering fixes when
 * the OS suspends the app on Android (Doze) or iOS (low-power background).
 * The subscription object stays non-null so callers can't tell from the
 * outside; lastFix just goes stale and yardages drift.
 *
 * On foreground we check: if the watch is supposedly running but we
 * haven't received a fix within FIX_STALENESS_MS, tear it down and start
 * a new one. lastFix is preserved (so the UI doesn't blank out during the
 * 1–2s the new watch takes to warm) but a fresh tick will overwrite it.
 */
async function handleAppStateChange(next: AppStateStatus): Promise<void> {
  if (next !== 'active') return;
  if (!subscription) return; // round inactive — stopGpsManager handles
  const stale = lastTickAt > 0 && Date.now() - lastTickAt > FIX_STALENESS_MS;
  if (!stale) return;
  breadcrumb('foreground_restart_stale_watch', {
    age_ms: Date.now() - lastTickAt,
    mode,
  });
  console.log(`[gps] foreground: watch stale (${Date.now() - lastTickAt}ms) — restarting`);
  await restartWatch();
  // Force a one-shot read so consumers don't sit on a stale fix while
  // the new watch warms up.
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    // 2026-06-01 — Fix GL: guard before seeding lastFix. A garbage
    // one-shot here would replace good cached state with bad data
    // even though processFix's gates protect every OTHER path.
    if (!isValidGolfCoord(pos.coords.latitude, pos.coords.longitude)) {
      console.log(`[gps] foreground one-shot returned invalid coord lat=${pos.coords.latitude} lng=${pos.coords.longitude}`);
      return;
    }
    const fresh: GpsFix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy ?? null,
      speed: pos.coords.speed ?? null,
      timestamp: pos.timestamp,
      source: 'live',
      confidence: confidenceFromAccuracy(pos.coords.accuracy ?? null),
    };
    lastFix = fresh;
    lastTickAt = Date.now();
    // 2026-06-05 — arm stale-clear so a foreground-resume fix doesn't
    // hard-clear 60s later before the restarted watcher ticks.
    armStaleHardTimer();
    for (const cb of subscribers) {
      try { cb(fresh); } catch (e) { ownerSentinel('gps.subscriber.fresh', e); }
    }
  } catch (e) {
    console.log('[gps] foreground one-shot failed:', e);
  }
}

function evaluateMode() {
  const now = Date.now();
  // Cool down from active 60s after the most recent bump
  if (mode === 'active' && now - lastActiveBumpAt > ACTIVE_HOLD_MS) {
    setMode('walking', 'active_hold_expired');
  }
  // Stationary if no motion for 90s
  if (mode !== 'stationary' && lastMotionAt > 0 && now - lastMotionAt > STATIONARY_AFTER) {
    if (mode !== 'active') setMode('stationary', 'no_motion_90s');
  }
  // Phase 405 wave 2 — sustained-poor-signal detector. Fires the
  // poorSignalListeners fanout after POOR_SIGNAL_SUSTAINED_MS of
  // accuracy worse than the pipeline gate (i.e. fixes the pipeline
  // is REJECTING). Reset when the fix recovers.
  const acc = lastFix?.accuracy_m ?? null;
  const isPoor = acc == null || acc > OUTLIER_ACCURACY_M;
  if (isPoor) {
    if (poorSinceTs == null) poorSinceTs = now;
    else if (poorAlertedAt == null && now - poorSinceTs >= POOR_SIGNAL_SUSTAINED_MS) {
      poorAlertedAt = now;
      const info = { accuracy_m: acc, duration_ms: now - poorSinceTs };
      for (const cb of poorSignalListeners) {
        try { cb(info); } catch (e) { ownerSentinel('gps.poorSignal.listener', e); }
      }
    }
  } else {
    poorSinceTs = null;
    poorAlertedAt = null;
  }
}

/**
 * Phase 405 wave 2 — subscribe to sustained-poor-signal events. Fires
 * once when accuracy has stayed worse than OUTLIER_ACCURACY_M (the
 * pipeline rejection gate) for POOR_SIGNAL_SUSTAINED_MS. Listener fires
 * again only after signal recovers (accuracy drops back within the
 * gate) so the caddie doesn't loop the same callout.
 */
export function subscribePoorSignal(cb: PoorSignalListener): () => void {
  poorSignalListeners.add(cb);
  return () => { poorSignalListeners.delete(cb); };
}

/** Called by round-start. No-op if already running. */
/**
 * 2026-05-25 — Fix R: forced subscription refresh. User says "refresh
 * GPS" / "GPS is wrong" → handler calls this → existing watch is torn
 * down, mode reset to 'active' (1 Hz), and a fresh watch starts. The
 * next emitted fix is guaranteed-fresh (not pre-sleep cached) and the
 * `active` mode forces aggressive polling for ~30s until the natural
 * motion-based downgrade kicks back in. Resolves with the FIRST fresh
 * fix (or null after a 12s timeout) so the caller can speak ack with
 * the new yardage.
 */
export async function forceRefreshGps(): Promise<GpsFix | null> {
  if (subscription) {
    try { subscription.remove(); } catch {}
    subscription = null;
  }
  mode = 'active';
  lastMotionAt = Date.now();
  lastTickAt = 0;
  await startWatchInternal();
  breadcrumb('manager_force_refresh');

  // Wait for the FIRST fresh fix (timestamp newer than now) or 12s
  // timeout. The subscription will populate lastFix on first callback.
  const startedAt = Date.now();
  return new Promise<GpsFix | null>((resolve) => {
    const timer = setInterval(() => {
      const fx = getLastFix();
      if (fx && fx.timestamp >= startedAt) {
        clearInterval(timer);
        resolve(fx);
      } else if (Date.now() - startedAt > 12_000) {
        clearInterval(timer);
        resolve(null);
      }
    }, 200);
  });
}

export async function startGpsManager(): Promise<void> {
  if (subscription) return;
  mode = 'walking';
  lastMotionAt = Date.now();
  lastTickAt = 0;
  await startWatchInternal();
  if (!evalTimer) evalTimer = setInterval(evaluateMode, 5_000);
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (next) => {
      void handleAppStateChange(next);
    });
  }
  breadcrumb('manager_start');
  // Phase 405 wave 4 — also start the background-location task. This
  // shows the foreground-service notification on Android (keeps the
  // location subsystem alive during Doze) and registers the iOS
  // background-mode entitlement use. Fire-and-forget — if the user
  // hasn't granted background-location permission, the call no-ops
  // gracefully and watchPositionAsync still provides foreground fixes.
  void (async () => {
    try {
      const { startBackgroundLocation } = await import('./backgroundLocationTask');
      await startBackgroundLocation();
    } catch (e) {
      console.log('[gps] background task start skipped:', e);
    }
  })();
}

/** Called by round-end. Drops the underlying subscription. */
export function stopGpsManager(): void {
  if (subscription) {
    try { subscription.remove(); } catch {}
    subscription = null;
  }
  if (evalTimer) {
    clearInterval(evalTimer);
    evalTimer = null;
  }
  if (appStateSub) {
    try { appStateSub.remove(); } catch {}
    appStateSub = null;
  }
  // 2026-06-07 (audit N4) — CONTRACT: `subscribers` is round-scoped.
  // stopGpsManager() clears ALL of them globally (cheap teardown that
  // matches today's consumers — shotDetection + caddie effects — which
  // all RE-SUBSCRIBE on the next startGpsManager/round start). Footgun:
  // any future consumer that subscribes ONCE at app boot (not per round)
  // would be silently dropped here after the first round ends. Such a
  // consumer must either re-subscribe on round start or this clear must
  // be narrowed to internal subscriptions first.
  subscribers.clear();
  // Re-add app-boot-scoped consumers so they survive round teardown.
  for (const cb of persistentSubscribers) subscribers.add(cb);
  lastFix = null;
  clearStaleHardTimer();
  // 2026-05-20 — Day 1 / Fix 4: clear the simulator flag on
  // round-end so the next round starts with real GPS enabled by
  // default. The simulator harness is round-scoped — leaving the
  // flag true would silently suppress real GPS in the next round.
  simulatedActive = false;
  smoothingBuffer = [];
  outliersDiscarded = 0;
  batterySaverFloor = null;
  lastTickAt = 0;
  // 2026-05-17 — reset module-level book-keeping that otherwise
  // bleeds across round boundaries. Previously poorAlertedAt /
  // lastBumpReason / lastMotionAt / lastActiveBumpAt / mode all
  // survived stop+restart, so the first poor-signal callout of
  // round N+1 was suppressed if round N had just alerted.
  poorSinceTs = null;
  poorAlertedAt = null;
  lastBumpReason = null;
  lastBumpAt = null;
  lastActiveBumpAt = 0;
  lastMotionAt = 0;
  mode = 'walking';
  breadcrumb('manager_stop');
  // Phase 405 wave 4 — also stop the background-location task so the
  // foreground-service notification dismisses and the OS releases the
  // location subsystem. Fire-and-forget; no-op when the task isn't
  // currently running.
  void (async () => {
    try {
      const { stopBackgroundLocation } = await import('./backgroundLocationTask');
      await stopBackgroundLocation();
    } catch (e) {
      console.log('[gps] background task stop skipped:', e);
    }
  })();
}

/** Phase 107 / C2 — runtime stats for the GPS quality debug overlay. */
export function getGpsStats(): {
  mode: GpsMode;
  lastFix: GpsFix | null;
  outliersDiscarded: number;
  smoothingBufferSize: number;
} {
  return { mode, lastFix, outliersDiscarded, smoothingBufferSize: smoothingBuffer.length };
}

/** Subscribe to fixes. Returns an unsubscribe fn. Pass `{ persistent: true }`
 *  for app-boot-scoped consumers that must survive round-end teardown. */
export function subscribe(cb: Subscriber, opts?: { persistent?: boolean }): () => void {
  subscribers.add(cb);
  if (opts?.persistent) persistentSubscribers.add(cb);
  return () => { subscribers.delete(cb); persistentSubscribers.delete(cb); };
}

/** Shot intent event — bump to active for 60s. */
export function bumpToActive(reason: string): void {
  lastActiveBumpAt = Date.now();
  lastBumpReason = reason;
  lastBumpAt = lastActiveBumpAt;
  // Phase 107 / B3 — Mark wants the raw current position, not a smoothed
  // history. Reset the smoothing buffer so the next fix is unaveraged.
  smoothingBuffer = [];
  setMode('active', reason);
}

export function getCurrentMode(): GpsMode {
  return mode;
}

export function getLastFix(): GpsFix | null {
  return lastFix;
}

export function getLastBump(): { reason: string | null; ts: number | null } {
  return { reason: lastBumpReason, ts: lastBumpAt };
}

/**
 * 2026-06-01 — Fix GL: surface GPS subscription health so the UI can
 * show a mid-round "GPS stopped" banner instead of silently going
 * blank. Three failure modes covered:
 *  - 'no_subscription': startGpsManager was called but the watch
 *    never landed (permission denied at orchestration, all-accuracy-
 *    rungs failed). Subscription is null.
 *  - 'never_ticked': subscription exists but no fix has ever arrived
 *    (cold start blocked by GPS-off or chip warmup, or all incoming
 *    fixes rejected as outliers).
 *  - 'stale': subscription exists and a fix arrived once, but
 *    nothing in the last STALE_HEALTH_MS. AppState foreground
 *    recovery handles this by restarting the watch, but if the watch
 *    silently dies WITHOUT a foreground transition (Doze on Android
 *    without our foreground service), this is the only visible signal.
 *
 * UI consumers (DataStrip / Caddie banner) poll this every 5-10s.
 */
const STALE_HEALTH_MS = 30_000;
export type GpsHealth =
  | { state: 'healthy'; ageMs: number; accuracy_m: number | null }
  | { state: 'no_subscription' }
  | { state: 'never_ticked' }
  | { state: 'stale'; ageMs: number };

export function getGpsHealth(): GpsHealth {
  if (simulatedActive) {
    // Simulator owns the cache — always healthy from a UI POV.
    return { state: 'healthy', ageMs: 0, accuracy_m: lastFix?.accuracy_m ?? null };
  }
  if (!subscription) return { state: 'no_subscription' };
  if (lastTickAt === 0) return { state: 'never_ticked' };
  const ageMs = Date.now() - lastTickAt;
  if (ageMs > STALE_HEALTH_MS) return { state: 'stale', ageMs };
  return { state: 'healthy', ageMs, accuracy_m: lastFix?.accuracy_m ?? null };
}

/**
 * One-shot read. Returns the cached fix if it's <10s old (cuts redundant
 * high-accuracy pulses); otherwise refreshes via Location.getCurrentPositionAsync.
 */
export async function getOneShotFix(opts?: { maxAgeMs?: number }): Promise<GpsFix | null> {
  // 2026-05-20 — Day 1 / Fix 4: when simulator owns the cache, always
  // return the cached sim fix. Pulsing a real-device read here would
  // bypass the simulator and return the player's real-world coords —
  // exactly the bug that produced 629,441y off-course readings.
  if (simulatedActive) return lastFix;
  const maxAge = opts?.maxAgeMs ?? CACHE_FRESH_MS;
  if (lastFix && Date.now() - lastFix.timestamp < maxAge) return lastFix;
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    // 2026-06-01 — Fix GL: reject one-shot reads with bad coords.
    if (!isValidGolfCoord(pos.coords.latitude, pos.coords.longitude)) {
      console.log(`[gps] one-shot returned invalid coord lat=${pos.coords.latitude} lng=${pos.coords.longitude}`);
      return lastFix;
    }
    const fix: GpsFix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy ?? null,
      speed: pos.coords.speed ?? null,
      timestamp: pos.timestamp,
      // 2026-06-07 audit r5: one-shot reads (refreshFix path) are
      // genuine live GPS — mark as 'live' so the type discriminator
      // is consistent.
      source: 'live',
      confidence: confidenceFromAccuracy(pos.coords.accuracy ?? null),
    };
    lastFix = fix;
    // 2026-06-05 — arm stale-clear so explicit one-shot reads (e.g.
    // SmartFinder refreshFix) don't hard-clear 60s later before a
    // watch tick lands.
    armStaleHardTimer();
    return fix;
  } catch (err) {
    console.log('[gps] one-shot error:', err);
    return lastFix;
  }
}

/** Battery-saver — clamps the floor mode so 'active' bumps are blocked. */
export function setBatterySaverFloor(floor: GpsMode | null): void {
  batterySaverFloor = floor;
  if (floor === 'walking' && mode === 'active') {
    setMode('walking', 'battery_saver_floor');
  }
}

/**
 * Phase V.7+ — user-initiated GPS recalibration. Drops the current
 * subscription + cached fix, re-requests permission (in case it was
 * revoked), pulls a single Highest-accuracy fix to seed `lastFix`, then
 * restarts the watch in 'active' mode for the next 60s so subsequent
 * fixes converge fast. Returns the new fix (or null on failure) so the
 * caller can show user-facing feedback ("Locked, accuracy ~Xm").
 */
export async function recalibrateGps(): Promise<GpsFix | null> {
  breadcrumb('manager_recalibrate_start');
  // Tear down current watch + cache so stale tower-triangulation fixes
  // can't bleed into the recalibrated state.
  if (subscription) {
    try { subscription.remove(); } catch {}
    subscription = null;
  }
  lastFix = null;

  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      breadcrumb('manager_recalibrate_no_permission');
      return null;
    }
    // Pull a single high-accuracy fix immediately so the UI has something
    // to show instead of "Locking GPS…" while the watch warms up.
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });
    // 2026-06-01 — Fix GL: same coord guard as the OS-boundary path.
    if (!isValidGolfCoord(pos.coords.latitude, pos.coords.longitude)) {
      console.log(`[gps] recalibrate returned invalid coord lat=${pos.coords.latitude} lng=${pos.coords.longitude}`);
      breadcrumb('manager_recalibrate_invalid_coord');
      return null;
    }
    const fresh: GpsFix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy ?? null,
      speed: pos.coords.speed ?? null,
      timestamp: pos.timestamp,
      source: 'live',
      confidence: confidenceFromAccuracy(pos.coords.accuracy ?? null),
    };
    lastFix = fresh;
    lastMotionAt = Date.now();
    // 2026-06-05 — arm stale-clear. Without it, a recalibrate that
    // happens just before backgrounding could hard-clear the fresh
    // fix while the restarted watcher is still warming up.
    armStaleHardTimer();
    // Bump to active so the restarted watch ticks at 1Hz/BestForNavigation
    // for the 60s convergence window.
    lastActiveBumpAt = Date.now();
    lastBumpReason = 'recalibrate';
    lastBumpAt = lastActiveBumpAt;
    mode = 'active';
    await startWatchInternal();
    if (!evalTimer) evalTimer = setInterval(evaluateMode, 5_000);
    // Notify subscribers immediately so on-screen yardages refresh.
    for (const cb of subscribers) {
      try { cb(fresh); } catch (e) { ownerSentinel('gps.subscriber.fresh', e); }
    }
    breadcrumb('manager_recalibrate_ok', {
      accuracy_m: fresh.accuracy_m,
    });
    return fresh;
  } catch (err) {
    console.log('[gps] recalibrate error:', err);
    breadcrumb('manager_recalibrate_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    // 2026-05-17 — reset mode + active-bump bookkeeping before
    // restarting the watch. Previously the highest-accuracy fetch
    // failure path left mode='active' set with no fresh fix landing,
    // which orphaned the active state until the next bumpToActive.
    mode = 'walking';
    lastActiveBumpAt = 0;
    lastBumpReason = null;
    // Try to leave something running even on failure.
    try { await startWatchInternal(); } catch {}
    return null;
  }
}
