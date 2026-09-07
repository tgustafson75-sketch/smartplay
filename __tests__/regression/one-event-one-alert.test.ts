/**
 * 2026-09-06, 11:31pm–11:39pm — "18 new alerts from smartplay-caddie-mobile", five of them at a
 * single timestamp, several from the previous day.
 *
 * I caused that tonight, and it is worth writing down exactly how, because both halves looked
 * correct in isolation:
 *
 *   1. `sentIds` was an in-memory Set, so it emptied on every app launch and autoSendIssues re-sent
 *      every retained entry. That was TOLERABLE while the server was the only consumer —
 *      api/issue-report dedupes on id and only ever emailed genuinely-new rows. Merging the log into
 *      Sentry added a CLIENT-side consumer that fires for everything in `unsent`, so the server's
 *      dedupe stopped protecting anything. A relaunch became a duplicate storm.
 *
 *   2. A crash reached Sentry TWICE under two shapes: once as a fatal exception from Sentry's own
 *      global handler (with a real stack), and once as user feedback carrying the issue-log copy.
 *      Visible in Tim's inbox as "Error anonymous(index.android)" at 11:32:07 and "User Feedback:
 *      SmartPlay owner test e..." at 11:32:50 — one event, two entries.
 *
 * The whole point of merging the log into Sentry was ONE fingerprint space. Duplicating what was
 * already there would have undone that on the first crash, and a channel that cries wolf is a
 * channel Tim stops reading — which is worse than the email path I removed.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '../../services/issueLogExport.ts'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('an entry is sent once, not once per launch', () => {
  it('remembers what it sent across launches', () => {
    expect(code).toContain("const SENT_IDS_KEY = 'issue-log-sent-ids-v1';");
    expect(code).toContain('AsyncStorage.getItem(SENT_IDS_KEY)');
    expect(code).toContain('AsyncStorage.setItem(SENT_IDS_KEY');
  });

  it('loads that memory BEFORE deciding what is unsent', () => {
    // Hydrating after the filter would be the same bug with extra steps.
    const hydrate = code.indexOf('await hydrateSentIds()');
    const filter = code.indexOf('const unsent =');
    expect(hydrate).toBeGreaterThan(-1);
    expect(filter).toBeGreaterThan(hydrate);
  });

  it('writes the memory as soon as a send succeeds', () => {
    expect(code).toMatch(/for \(const e of unsent\) sentIds\.add\(e\.id\);\s*\n\s*void persistSentIds\(\);/);
  });

  it('bounds the memory — it must not grow forever', () => {
    // Only recent ids can still be in the retained log, so an unbounded list would grow indefinitely
    // guarding against resends of entries that no longer exist.
    expect(code).toContain('SENT_IDS_CAP');
    expect(code).toContain('slice(-SENT_IDS_CAP)');
  });

  it('does not retry a failed hydrate forever', () => {
    // The flag is set BEFORE the await, so a storage error degrades to "re-send once" (the old
    // behaviour) rather than reading AsyncStorage on every single send.
    const fn = code.slice(code.indexOf('async function hydrateSentIds'), code.indexOf('async function persistSentIds'));
    expect(fn.indexOf('sentIdsHydrated = true')).toBeLessThan(fn.indexOf('await AsyncStorage.getItem'));
  });
});

describe('a crash is reported once, by the handler that has the stack', () => {
  it('skips app_error when sending user feedback', () => {
    expect(code).toContain("if (e.kind === 'app_error') continue;");
  });

  it('the skip is inside the feedback loop, not the send', () => {
    // It must NOT stop the crash reaching Supabase or the log — only the duplicate Sentry feedback.
    const loop = code.slice(code.indexOf('for (const e of unsent) {'));
    expect(loop.indexOf("if (e.kind === 'app_error') continue;"))
      .toBeLessThan(loop.indexOf('captureFeedback'));
    // app_error stays reportable: it still goes to the server in the payload above.
    expect(code).toContain("'voice_miss', 'app_error',");
  });

  it('still sends the kinds Sentry does NOT already have', () => {
    // voice_silent_fail, analysis_error and manual notes have no exception counterpart — they exist
    // only because the app chose to record them, so feedback is the only way they arrive.
    for (const kind of ['voice_silent_fail', 'analysis_error', 'voice_error']) {
      expect(code).toContain(`'${kind}'`);
    }
  });
});
