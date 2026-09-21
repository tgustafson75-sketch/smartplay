/**
 * 2026-09-21 (Tim: "make the issue log more substantial so I dont need to rely on fucking sentry to
 * give you diagnostics").
 *
 * Sentry has been unreadable in production since launch — no auth token, so no source maps and no
 * dSYMs, and every crash arrives as `?, in <redacted>`. The issue log is the OTHER instrument, and
 * it is the one Tim actually sends. It carried the entry text, a persona, a route and a hole, and
 * nothing about the machine: not the bundle, not whether a native module was even present, not
 * whether the GPS fix behind a yardage complaint was sixty seconds stale.
 *
 * WHAT THIS GUARD PINS, and why each part is here rather than a source grep:
 *
 * 1. THE WIRING, ON BOTH CHANNELS. The failure this repo keeps producing is a capability that is
 *    built, correct and connected to nothing. `collectDiagnosticSnapshot` could pass its own unit
 *    tests forever while neither channel called it. So these drive the REAL send paths and read
 *    what comes out the other end. [[orphans-are-live-bugs-not-dead-code]]
 *
 * 2. IT SURVIVES THE SERVER. api/issue-report reads `body.entries` and nothing else. A top-level
 *    `diagnostics` field on the POST is accepted, dropped, and never seen again — a send that looks
 *    successful forever and carries nothing. So the automatic test asserts the snapshot is inside
 *    `context`, which the handler persists verbatim. [[reachable-not-just-wired]]
 *
 * 3. NO PII, BY CONSTRUCTION. The snapshot rides the AUTOMATIC channel, which is anonymous by a
 *    deliberate 09-12 decision, and `shareDiagnostics` defaults ON. Any field added to the snapshot
 *    reaches that channel on the day it is added — so the shape is asserted against an allowlist
 *    rather than a blocklist. A new field fails this test until someone has looked at it.
 *    [[automatic-sends-carry-no-pii]]
 */

import { useIssueLogStore } from '../../store/issueLogStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRoundStore } from '../../store/roundStore';
import {
  buildIssueLogBody, exportAllIssues, autoSendIssues,
} from '../../services/issueLogExport';
import { collectDiagnosticSnapshot, formatSnapshotForEmail } from '../../services/diagnosticSnapshot';

const ctx = {
  route: 'caddie', persona: 'kevin', isRoundActive: false,
  courseId: null, currentHole: null, appVersion: '1.0.0',
} as never;

const TS = 1_758_000_000_000;
const seed = () => {
  useIssueLogStore.setState({
    entries: [{
      id: 'e1', timestamp: TS, text: 'voice_silent_fail: nothing came back',
      kind: 'voice_silent_fail' as const, stage: 'x', details: {}, context: ctx,
    }],
    lastExportedAt: 0,
  } as never);
};

describe('the snapshot reaches the channel Tim actually sends', () => {
  it('the MANUAL export body carries the diagnostics block', async () => {
    seed();
    const snapshot = await collectDiagnosticSnapshot();
    const { body } = buildIssueLogBody(snapshot);
    expect(body).toContain('— DIAGNOSTICS —');
    // The questions past reports could not answer.
    expect(body).toMatch(/Bundle:/);
    expect(body).toMatch(/Device:/);
    expect(body).toMatch(/GPS:/);
    expect(body).toMatch(/Watch:/);
    // ...and the entry itself is still there. A diagnostic that displaces the report is not a win.
    expect(body).toContain('voice_silent_fail: nothing came back');
  });

  /**
   * THE WIRING TEST. buildIssueLogBody takes the snapshot as a PARAMETER, so it is perfectly
   * possible for it to be correct and for the one production caller never to pass it. This drives
   * exportAllIssues and asserts the block arrives — break-tested by dropping the argument at the
   * call site, which fails this and passes every other test in the file.
   */
  it('exportAllIssues actually passes one — not just accepts one', async () => {
    seed();
    const sent: string[] = [];
    const Linking = require('react-native').Linking;
    const canSpy = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true as never);
    const openSpy = jest.spyOn(Linking, 'openURL').mockImplementation((url: unknown) => {
      sent.push(String(url)); return Promise.resolve(true as never);
    });
    const status = await exportAllIssues();
    expect(status).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(decodeURIComponent(sent[0])).toContain('— DIAGNOSTICS —');
    canSpy.mockRestore(); openSpy.mockRestore();
  });
});

describe('the AUTOMATIC channel carries it too, where the server can see it', () => {
  it('puts the snapshot inside context, which api/issue-report persists', async () => {
    seed();
    useSettingsStore.setState({ shareDiagnostics: true } as never);
    let posted: Record<string, unknown> | null = null;
    const realFetch = global.fetch;
    global.fetch = jest.fn(async (_url: unknown, init: unknown) => {
      posted = JSON.parse(String((init as { body?: unknown }).body));
      return { ok: true, json: async () => ({ ok: true }) } as never;
    }) as never;
    // isTestRunner() blocks a real send from a suite (deliberately — it once mailed Tim a fixture
    // table). Defeat it for this one call the same way the module resolves it: per-call, via env.
    const realJest = process.env.JEST_WORKER_ID;
    const realNode = process.env.NODE_ENV;
    delete process.env.JEST_WORKER_ID;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    try {
      await autoSendIssues();
    } finally {
      if (realJest !== undefined) process.env.JEST_WORKER_ID = realJest;
      if (realNode !== undefined) (process.env as Record<string, string>).NODE_ENV = realNode;
      global.fetch = realFetch;
    }
    expect(posted).not.toBeNull();
    const entries = (posted as unknown as { entries: { context: Record<string, unknown> }[] }).entries;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.context).toBeTruthy();
      expect(e.context.diag).toBeTruthy();
      // The handler reads entries[].context and NOTHING else. A top-level field would be dropped.
      expect((posted as unknown as Record<string, unknown>).diagnostics).toBeUndefined();
    }
  });
});

describe('the snapshot carries no PII, and cannot start to by accident', () => {
  it('every top-level section is on the reviewed allowlist', async () => {
    const snap = await collectDiagnosticSnapshot();
    expect(Object.keys(snap).sort()).toEqual([
      'audio', 'battery', 'build', 'capturedAt', 'device', 'flagsOff', 'gps',
      'logCounts', 'nativeModulesMissing', 'network', 'session', 'watch',
    ]);
  });

  /**
   * 2026-09-21 — THIS TEST USED TO PASS VACUOUSLY, WHICH IS WHY IT MISSED A REAL LEAK.
   *
   * It seeded the player profile and never the ROUND, so `session.courseId` was always null under
   * jest — while the shipped code read `activeCourseId ?? activeCourse`, and `activeCourse` is the
   * course DISPLAY NAME. Every local or manual round would have emitted a course name on the
   * anonymous channel, and this test would have stayed green forever.
   *
   * A blocklist over an empty object proves nothing. The state that produces the leak has to be
   * SEEDED, which is the difference between testing the code and testing the fixture.
   */
  it('no section carries an identity, a name or a coordinate', async () => {
    usePlayerProfileStore.setState({ email: 'tim@example.com', name: 'Tim G' } as never);
    // The leak case: a live round with NO api course id, so the name is the only thing available.
    useRoundStore.setState({
      isRoundActive: true, activeCourseId: null, activeCourse: 'Menifee Lakes Country Club',
    } as never);
    const snap = await collectDiagnosticSnapshot();
    expect(snap.session.courseId).not.toContain('Menifee');
    expect(snap.session.courseId).toBe('local');
    const blob = JSON.stringify(snap).toLowerCase();
    expect(blob).not.toContain('tim@example.com');
    expect(blob).not.toContain('tim g');
    expect(blob).not.toContain('menifee');
    for (const banned of ['email', 'latitude', 'longitude', 'lat"', 'lng"', 'playername']) {
      expect(blob).not.toContain(banned);
    }
  });

  /**
   * The GPS section is the one most likely to drift into PII — the fix object it reads HAS a
   * location on it. Age and accuracy answer the triage question; coordinates answer where the
   * player lives.
   */
  it('the GPS section exposes age and accuracy only', async () => {
    const snap = await collectDiagnosticSnapshot();
    expect(Object.keys(snap.gps).sort()).toEqual(['accuracyM', 'fixAgeMs']);
  });

  it('formats without throwing on a fully-empty snapshot', async () => {
    const snap = await collectDiagnosticSnapshot();
    expect(() => formatSnapshotForEmail(snap)).not.toThrow();
    expect(formatSnapshotForEmail(snap)).toContain('DIAGNOSTICS');
  });
});

/**
 * 2026-09-21 — THE DIAGNOSTIC MUST NEVER COST US THE REPORT IT IS ATTACHED TO.
 *
 * `watchReachable()` awaits a native promise on the Wear Data Layer. A wedged Data Layer resolves
 * neither way, and `inFlightSend` in services/issueLogExport is a module-level promise cleared only
 * in autoSendIssuesInner's `finally` — so one hung query would have blocked EVERY subsequent issue
 * send for the life of the process. The thing that was supposed to make failures legible would have
 * made them invisible.
 */
describe('a hung native query cannot wedge the send path', () => {
  it('collects within the bound and reports the unanswerable section as unknown', async () => {
    const bridge = require('../../services/watchCaddieBridge');
    const spy = jest.spyOn(bridge, 'watchReachable')
      .mockImplementation(() => new Promise(() => { /* never settles — a wedged Data Layer */ }));
    const started = Date.now();
    const snap = await collectDiagnosticSnapshot();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(4000);
    expect(snap.watch.reachable).toBeNull();
    // ...and the REST of the snapshot still arrived. One unanswerable section must not cost the others.
    expect(snap.device.platform).toBeTruthy();
    expect(snap.capturedAt).toBeGreaterThan(0);
    spy.mockRestore();
  }, 10_000);
});

/**
 * 2026-09-21 — THE RENDERED BLOCK MUST NEVER PRINT THE WORD "undefined".
 *
 * Caught by rendering the thing and reading it, rather than by a type: `String(Platform.Version)`
 * on an absent value produces the literal string "undefined", and the report read
 * `Device: ios undefined`. Every other unknown in this block is a deliberate "?", so one stray
 * "undefined" is indistinguishable from a bug in the diagnostic itself — and the person reading it
 * is already looking at a failure and deciding whether to trust the tool.
 *
 * Asserted on the FORMATTED output, because that is the artifact a human reads. A field-level type
 * check would not have caught a stringified absence.
 */
describe('the mailed diagnostics block never prints undefined or null as text', () => {
  it('renders only deliberate unknowns', async () => {
    const snap = await collectDiagnosticSnapshot();
    const body = formatSnapshotForEmail(snap);
    expect(body).not.toMatch(/\bundefined\b/);
    expect(body).not.toMatch(/\bnull\b/);
    expect(body).not.toMatch(/\[object Object\]/);
    expect(body).not.toMatch(/\bNaN\b/);
  });
});

/**
 * 2026-09-21 — THE REPORT MUST NOT CLAIM TO KNOW WHICH BINARY IT IS RUNNING ON.
 *
 * `Constants.expoConfig` comes from the loaded MANIFEST. runtimeVersion is the literal "1.0.0", so
 * one OTA reaches every binary ever shipped — a build-27 phone that applies today's update would
 * otherwise report "1.0.1 (build 29)", a version pair it has never had, on the most-asked triage
 * question, stated with total confidence. There is no way to read the true native build from here
 * (expo-application is not a dependency, and adding it needs the native build this packet exists to
 * avoid needing), so the honest move is to label provenance rather than invent certainty.
 */
describe('the build line does not overstate what it knows', () => {
  it('says the numbers describe the bundle when an update has been applied', async () => {
    const snap = await collectDiagnosticSnapshot();
    const body = formatSnapshotForEmail({ ...snap, build: { ...snap.build, embedded: false } });
    expect(body).toMatch(/binary may be older/);
    expect(body).not.toMatch(/binary \(no OTA applied\)/);
  });

  it('claims exactness only when nothing has been applied over the binary', async () => {
    const snap = await collectDiagnosticSnapshot();
    const body = formatSnapshotForEmail({ ...snap, build: { ...snap.build, embedded: true } });
    expect(body).toMatch(/binary \(no OTA applied\)/);
  });

  /** A deliberate build decision must not be reported in the same voice as a broken dependency. */
  it('an EXPECTED native-module absence is labelled as expected', async () => {
    const snap = await collectDiagnosticSnapshot();
    const body = formatSnapshotForEmail({ ...snap, nativeModulesMissing: ['MetaWearablesFrame (expected: not in this build)'] });
    expect(body).toMatch(/expected:/);
  });

  /** Three-state: "no round" is a claim, and we must not make it from an unreadable store. */
  it('an unreadable round state is not rendered as "no round"', async () => {
    const snap = await collectDiagnosticSnapshot();
    const body = formatSnapshotForEmail({ ...snap, session: { ...snap.session, roundActive: null } });
    expect(body).toMatch(/round state unreadable/);
    expect(body).not.toMatch(/no round/);
  });
});
