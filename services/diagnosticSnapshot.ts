/**
 * services/diagnosticSnapshot.ts — EVERYTHING WE WOULD ASK FOR, ATTACHED BEFORE WE HAVE TO ASK.
 *
 * 2026-09-21 (Tim: "make the issue log more substantial so I dont need to rely on fucking sentry to
 * give you diagnostics").
 *
 * The issue log is the channel Tim actually sends — the one thing reliably in our hands when a
 * report arrives. Until now it carried the entry text, a persona, a route, and a hole. Every other
 * question triage asks ("which bundle was that?", "was a watch paired?", "did the fix go stale?",
 * "was the kill switch already off?") needed a round trip to the player, and each round trip loses
 * a report. Sentry is the other instrument and it has been unreadable in production since launch,
 * so the log had to carry its own weight.
 *
 * WHAT MAKES THIS DIFFERENT FROM A DEVICE DUMP. Every field here was chosen because a specific
 * past report could not be diagnosed without it:
 *   - bundle id / embedded      — 09-06, a flag flip "did nothing"; the build predated the flag.
 *   - native module health      — 08-19, an analysis failure on a shell with no pose module.
 *   - watch reachability        — 09-20, "is it the pre-launch watch build?" came back a guess.
 *   - gps fix age + accuracy    — a yardage complaint is unreadable without the fix behind it.
 *   - flags that are OFF        — a killed feature reads as a broken feature in a report.
 *   - audio route               — the whole caddie-is-silent class.
 *   - connection class          — "it hung" on hotel wifi is not the same defect as "it hung".
 *
 * TWO HARD RULES.
 *
 * 1. **NO PII, EVER, IN HERE.** This snapshot rides BOTH channels, and the automatic one is
 *    anonymous by a deliberate decision (services/issueLogExport, 2026-09-12: `reporter` is the
 *    random install id, never the email, because shareDiagnostics defaults ON and the privacy
 *    policy has no row for an address). A field added here reaches the automatic channel on the
 *    day it is added. So: no email, no name, no home course, no coordinates. Install id is fine —
 *    it is random, local, and regenerated on reinstall. The guard in
 *    __tests__/regression/diagnostic-snapshot-carries-no-pii.test.ts enforces this by construction.
 *
 * 2. **NEVER THROWS, AND NEVER LOSES THE REST.** Every section is collected independently behind
 *    its own try/catch, so a single unavailable module degrades to one null field rather than
 *    costing the whole snapshot. A diagnostic that can fail at the moment of a failure is worse
 *    than none, because it removes the report as well as the answer. [[a-diagnostic-must-reach-the-channel-he-sends]]
 */

import { Platform } from 'react-native';

/** One section's worth of answers. Every field nullable — absence is itself a reading. */
export interface DiagnosticSnapshot {
  capturedAt: number;
  build: {
    appVersion: string | null;
    nativeBuild: string | null;
    runtimeVersion: string | null;
    channel: string | null;
    updateId: string | null;
    updateCreatedAt: string | null;
    /** true = running the JS baked into the binary, no OTA applied yet. */
    embedded: boolean | null;
  };
  device: {
    platform: string;
    osVersion: string | null;
    model: string | null;
    manufacturer: string | null;
    locale: string | null;
    timezone: string | null;
    distanceUnit: string | null;
  };
  session: {
    /** ms since the JS bundle first executed — a proxy for how long the app has been up. */
    uptimeMs: number | null;
    activeSurface: string | null;
    roundActive: boolean | null;
    hole: number | null;
    courseId: string | null;
  };
  gps: {
    fixAgeMs: number | null;
    accuracyM: number | null;
  };
  audio: { route: string | null };
  network: { class: string | null; latencyMs: number | null; kbps: number | null };
  battery: { level: number | null; saverActive: boolean | null };
  /** Only modules that are ABSENT, with the reason. A full list is noise; an absence is the signal. */
  nativeModulesMissing: string[] | null;
  /** Only flags turned OFF from their default — a killed feature reads as a broken one otherwise. */
  flagsOff: string[] | null;
  /** How the retained log is composed, by kind. Tells you what ELSE was happening around the entry. */
  logCounts: Record<string, number> | null;
  watch: { reachable: boolean | null; bridgeAvailable: boolean | null };
}

/** Run a collector, and turn any failure into `null` rather than losing the snapshot. */
function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}
/**
 * Every async section is BOUNDED, and that is not belt-and-braces.
 *
 * This snapshot is collected at the moment an issue report LEAVES the device, including on the
 * automatic path. `watchReachable()` awaits a native promise on the Wear Data Layer; a wedged
 * Data Layer resolves neither way. Without a bound that await never settles, so
 * `collectDiagnosticSnapshot` never settles, so `autoSendIssuesInner` never returns — and
 * `inFlightSend` in services/issueLogExport is a module-level promise that is only cleared in that
 * function's `finally`. One hung query would therefore block EVERY subsequent issue send for the
 * life of the process.
 *
 * The diagnostic must never be able to cost us the report it is attached to. A section that cannot
 * answer in time degrades to null, which is itself a reading.
 */
const SECTION_TIMEOUT_MS = 1500;

async function safeAsync<T>(fn: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), SECTION_TIMEOUT_MS); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Collect the snapshot. Never throws. Intended to be awaited at the two points where an issue
 * LEAVES the device, not at the ~10 places that write an entry — the same "one place to be right"
 * reasoning that put the install id at the send point.
 */
export async function collectDiagnosticSnapshot(): Promise<DiagnosticSnapshot> {
  const snap: DiagnosticSnapshot = {
    capturedAt: Date.now(),
    build: {
      appVersion: null, nativeBuild: null, runtimeVersion: null,
      channel: null, updateId: null, updateCreatedAt: null, embedded: null,
    },
    device: {
      platform: Platform.OS,
      /**
       * 2026-09-21 — `String(x)` on an absent value yields the LITERAL "undefined", which then
       * renders as `Device: ios undefined` in the mailed report. A diagnostic that prints the word
       * undefined reads as a broken diagnostic, and the reader cannot tell it apart from a real
       * value. Absence must degrade to null so the formatter can say "?" deliberately.
       */
      osVersion: safe(() => (Platform.Version == null ? null : String(Platform.Version))),
      model: null, manufacturer: null, locale: null, timezone: null, distanceUnit: null,
    },
    session: { uptimeMs: null, activeSurface: null, roundActive: null, hole: null, courseId: null },
    gps: { fixAgeMs: null, accuracyM: null },
    audio: { route: null },
    network: { class: null, latencyMs: null, kbps: null },
    battery: { level: null, saverActive: null },
    nativeModulesMissing: null,
    flagsOff: null,
    logCounts: null,
    watch: { reachable: null, bridgeAvailable: null },
  };

  // ── Build identity. The single most-asked question in every past report: which bundle was this?
  await safeAsync(async () => {
    const Updates = await import('expo-updates');
    snap.build.channel = typeof Updates.channel === 'string' ? Updates.channel : null;
    snap.build.updateId = typeof Updates.updateId === 'string' ? Updates.updateId : null;
    snap.build.embedded = Updates.isEmbeddedLaunch === true;
    snap.build.runtimeVersion = typeof Updates.runtimeVersion === 'string' ? Updates.runtimeVersion : null;
    snap.build.updateCreatedAt = Updates.createdAt instanceof Date ? Updates.createdAt.toISOString() : null;
  });
  await safeAsync(async () => {
    const Constants = (await import('expo-constants')).default;
    snap.build.appVersion = Constants.expoConfig?.version ?? null;
    // Whichever platform's build number exists — they are set to the same value in app.json.
    snap.build.nativeBuild =
      (Platform.OS === 'ios'
        ? Constants.expoConfig?.ios?.buildNumber
        : Constants.expoConfig?.android?.versionCode != null
          ? String(Constants.expoConfig.android.versionCode)
          : null) ?? null;
  });

  // ── Device. Platform.constants is the one source available without adding a dependency.
  safe(() => {
    const c = Platform.constants as Record<string, unknown> | undefined;
    if (!c) return;
    snap.device.model = typeof c.Model === 'string' ? c.Model
      : typeof c.systemName === 'string' ? c.systemName : null;
    snap.device.manufacturer = typeof c.Manufacturer === 'string' ? c.Manufacturer
      : typeof c.Brand === 'string' ? c.Brand : null;
  });
  await safeAsync(async () => {
    const Localization = await import('expo-localization');
    const locales = Localization.getLocales?.();
    snap.device.locale = locales?.[0]?.languageTag ?? null;
    snap.device.timezone = Localization.getCalendars?.()?.[0]?.timeZone ?? null;
  });
  safe(() => {
    const { useSettingsStore } = require('../store/settingsStore') as typeof import('../store/settingsStore');
    snap.device.distanceUnit = useSettingsStore.getState().distance_unit ?? null;
  });

  // ── Session shape. Where the player was standing when it happened.
  safe(() => {
    const { bootElapsedMs } = require('./bootTrace') as typeof import('./bootTrace');
    snap.session.uptimeMs = bootElapsedMs();
  });
  safe(() => {
    const { getActiveSurface } = require('./activeSurfaceRegistry') as typeof import('./activeSurfaceRegistry');
    snap.session.activeSurface = getActiveSurface() ?? null;
  });
  safe(() => {
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    const r = useRoundStore.getState();
    snap.session.roundActive = r.isRoundActive ?? null;
    snap.session.hole = r.currentHole ?? null;
    /**
     * 2026-09-21 — `activeCourseId` ONLY, and never `activeCourse` as a fallback.
     *
     * This read `activeCourseId ?? activeCourse`, and `activeCourse` is the course DISPLAY NAME
     * (store/roundStore startRound takes `course` and assigns it there). `activeCourseId` is null
     * for every local or manual round — so on exactly those rounds the snapshot emitted a name
     * like "Menifee Lakes" under a key called `courseId`, on the channel that is anonymous by the
     * 09-12 decision and gated on a consent that defaults ON. The file's own header forbids a home
     * course by name. I wrote the header and then broke it four lines later, resolving a type
     * error.
     *
     * 'local' answers what triage actually needs — "this was not an API course, so there is no
     * surveyed geometry behind the complaint" — and names nowhere.
     */
    snap.session.courseId = r.activeCourseId ?? (r.isRoundActive ? 'local' : null);
  });

  // ── GPS. A yardage complaint cannot be read without the fix that produced it. AGE and ACCURACY
  //    only — never the coordinates, which are PII and are what shareCommunityData governs.
  safe(() => {
    const { getLastFix } = require('./smartFinderService') as typeof import('./smartFinderService');
    const fix = getLastFix();
    if (!fix) return;
    snap.gps.fixAgeMs = typeof fix.timestamp === 'number' ? Date.now() - fix.timestamp : null;
    snap.gps.accuracyM = fix.accuracy_m ?? null;
  });

  safe(() => {
    const { getCurrentRoute } = require('./audioRoutingService') as typeof import('./audioRoutingService');
    snap.audio.route = getCurrentRoute() ?? null;
  });

  // Read the LAST reading only — measuring here would put a network call inside a failure report.
  safe(() => {
    const { lastConnectionReading } = require('./connectionClass') as typeof import('./connectionClass');
    const r = lastConnectionReading();
    if (!r) return;
    snap.network.class = r.klass ?? null;
    snap.network.latencyMs = r.latencyMs ?? null;
    snap.network.kbps = r.kbps ?? null;
  });

  safe(() => {
    const { getBatteryState } = require('./batteryMonitor') as typeof import('./batteryMonitor');
    const b = getBatteryState();
    snap.battery.level = b.level ?? null;
    snap.battery.saverActive = b.saverActive ?? null;
  });

  // ── Native modules. Only the ABSENT ones: a full list is noise, an absence explains a failure.
  safe(() => {
    const { getAllNativeModuleHealth } = require('./nativeModuleHealth') as typeof import('./nativeModuleHealth');
    // The reason is FREE TEXT — nativeModuleHealth builds it as `probe threw: ${String(e)}`, and a
    // native error string can carry a file path with a username in it. Everything else in this
    // snapshot is allowlisted by construction; this is the one unbounded field, so it is truncated
    // and stripped of anything path-shaped before it rides the anonymous channel.
    const missing = getAllNativeModuleHealth()
      .filter(h => !h.loaded)
      .map(h => {
        const reason = h.reason ? h.reason.replace(/[/\\][^\s]*/g, '<path>').slice(0, 80) : '';
        return `${h.id}${reason ? ` (${reason})` : ''}`;
      });
    snap.nativeModulesMissing = missing;
  });

  // ── Flags that are OFF. Without this a killed feature is indistinguishable from a broken one.
  safe(() => {
    const { useFlagStore, DEFAULT_FLAGS } = require('../store/flagStore') as typeof import('../store/flagStore');
    const live = useFlagStore.getState().flags;
    snap.flagsOff = Object.keys(DEFAULT_FLAGS).filter(
      k => live[k as keyof typeof live] === false && DEFAULT_FLAGS[k as keyof typeof DEFAULT_FLAGS] !== false,
    );
  });

  // ── What else was in the log. The shape of the surrounding noise is often the diagnosis.
  safe(() => {
    const { useIssueLogStore } = require('../store/issueLogStore') as typeof import('../store/issueLogStore');
    const counts: Record<string, number> = {};
    for (const e of useIssueLogStore.getState().entries) {
      const k = e.kind ?? 'user';
      counts[k] = (counts[k] ?? 0) + 1;
    }
    snap.logCounts = counts;
  });

  // ── Watch. Three-state on purpose: null is "could not ask", not "no watch".
  await safeAsync(async () => {
    const m = await import('./watchCaddieBridge');
    snap.watch.bridgeAvailable = m.isWatchCaddieBridgeAvailable();
    snap.watch.reachable = await m.watchReachable();
  });

  return snap;
}

/** Render the snapshot as the block that heads a mailed issue log. Plain text, no PII. */
export function formatSnapshotForEmail(s: DiagnosticSnapshot): string {
  const yn = (v: boolean | null) => (v === null ? '?' : v ? 'yes' : 'no');
  const ms = (v: number | null) => (v === null ? '—' : v < 1000 ? `${v}ms` : `${Math.round(v / 1000)}s`);
  const bundle = s.build.embedded
    ? 'embedded (no OTA applied)'
    : `${s.build.updateId?.slice(0, 8) ?? 'unknown'}${s.build.updateCreatedAt ? ` · ${s.build.updateCreatedAt}` : ''}`;
  const lines = [
    '— DIAGNOSTICS ——————————————',
    `App:      ${s.build.appVersion ?? '?'} (build ${s.build.nativeBuild ?? '?'}) · runtime ${s.build.runtimeVersion ?? '?'}`,
    `Bundle:   ${bundle} · channel ${s.build.channel ?? '?'}`,
    `Device:   ${s.device.platform} ${s.device.osVersion ?? '?'} · ${s.device.manufacturer ?? '?'} ${s.device.model ?? '?'}`,
    `Locale:   ${s.device.locale ?? '?'} · ${s.device.timezone ?? '?'} · distances in ${s.device.distanceUnit ?? '?'}`,
    `Session:  up ${ms(s.session.uptimeMs)} · surface ${s.session.activeSurface ?? '—'} · ${
      s.session.roundActive ? `round on, hole ${s.session.hole ?? '?'} @ ${s.session.courseId ?? '?'}` : 'no round'
    }`,
    `GPS:      fix ${ms(s.gps.fixAgeMs)} old · accuracy ${s.gps.accuracyM ?? '?'}m`,
    `Audio:    ${s.audio.route ?? '?'}`,
    `Network:  ${s.network.class ?? '?'}${s.network.latencyMs != null ? ` · ${s.network.latencyMs}ms` : ''}${
      s.network.kbps != null ? ` · ${s.network.kbps}kbps` : ''
    }`,
    `Battery:  ${s.battery.level != null ? `${Math.round(s.battery.level * 100)}%` : '?'}${
      s.battery.saverActive ? ' · saver ON' : ''
    }`,
    `Watch:    bridge ${yn(s.watch.bridgeAvailable)} · reachable ${yn(s.watch.reachable)}`,
  ];
  if (s.nativeModulesMissing?.length) lines.push(`Missing:  ${s.nativeModulesMissing.join(', ')}`);
  if (s.flagsOff?.length) lines.push(`Killed:   ${s.flagsOff.join(', ')}`);
  if (s.logCounts && Object.keys(s.logCounts).length) {
    lines.push(`Log:      ${Object.entries(s.logCounts).map(([k, v]) => `${k}×${v}`).join(' · ')}`);
  }
  lines.push('———————————————————————————');
  return lines.join('\n');
}
