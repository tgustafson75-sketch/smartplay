/**
 * 2026-09-09 (72-hour triple-check) — "ONE EVENT, ONE ALERT" ASSUMED A LOCK IT NEVER TOOK.
 *
 * `ed15ed2b` (09-07) fixed the 18-alert storm by PERSISTING `sentIds`. Correct, and not sufficient:
 * ids are only added AFTER the POST resolves, and nothing stopped a second call entering while the
 * first was still in flight. Two independent triggers exist — `app/_layout.tsx` fires one on mount,
 * and `scheduleIssueAutoSend` fires from seven store call sites (behind ~40 log sites) on a 4s
 * debounce WITH a 20s max-wait flush that bypasses the debounce.
 *
 * So a POST slower than the debounce — a cold Lambda, a weak cell signal, precisely the conditions
 * that generate issues worth sending — let the second call recompute `unsent` from an unchanged
 * `sentIds`, re-send the same rows, and file a second Sentry feedback for each. The duplicate storm
 * that commit set out to end, reachable on any slow network.
 *
 * `hydrateSentIds` had the same shape one level down: it sets its flag BEFORE awaiting storage (on
 * purpose, so a failed read cannot retry forever), so a caller arriving mid-await saw an empty
 * `sentIds` and treated every retained entry as unsent. That is the same check-then-act across an
 * await that `27633173` fixed in the media path the very next morning — the class was known and this
 * instance was missed.
 *
 * Source-level, deliberately: exercising the real race needs the network, both stores and Sentry
 * mocked, and a test that elaborate tends to pin the mocks rather than the property. What must be
 * true is that a single in-flight promise is shared.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'services/issueLogExport.ts'), 'utf8');
/** Prose naming a thing is not the code doing it. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('concurrent auto-sends coalesce', () => {
  it('a second caller shares the in-flight send instead of starting a competing one', () => {
    expect(code).toContain('let inFlightSend: Promise<boolean> | null = null;');
    expect(code).toContain('if (inFlightSend) return inFlightSend;');
  });

  it('the lock is released whatever happens, so one failure cannot wedge sending forever', () => {
    expect(code).toMatch(/finally \{\s*inFlightSend = null;\s*\}/);
  });

  it('the real work moved behind the lock rather than beside it', () => {
    expect(code).toContain('inFlightSend = autoSendIssuesInner();');
    expect(code).toContain('async function autoSendIssuesInner(): Promise<boolean> {');
    // ...and the only exported entry point is the guarded one.
    expect(code).toContain('export async function autoSendIssues(): Promise<boolean> {');
    expect(code).not.toContain('export async function autoSendIssuesInner');
  });

  it('sentIds is still persisted and still capped above the log it protects', () => {
    // The 09-07 fix must survive this one: MAX_ENTRIES is 100, so a 400 cap cannot cause a resend.
    expect(code).toContain('const SENT_IDS_CAP = 400;');
    const store = fs.readFileSync(path.join(root, 'store/issueLogStore.ts'), 'utf8');
    const max = /const MAX_ENTRIES = (\d+);/.exec(store);
    expect(max).not.toBeNull();
    expect(Number(max![1])).toBeLessThan(400);
  });

  it('a crash still is not sent as feedback — Sentry already has it as an exception', () => {
    /**
     * 2026-09-10 — the skip moved into services/issueFeedback, the shared sender both callers of
     * /api/issue-report now use (roundTrace POSTs its own entry and had been missing the Sentry
     * mirror entirely). Same invariant, new owner.
     */
    const fb = fs.readFileSync(
      path.join(__dirname, '../../services/issueFeedback.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
    expect(fb).toMatch(/if \(entry\.kind === 'app_error'\) return;/);
    // and this file must route through it rather than keeping a private copy
    expect(code).toMatch(/sendIssueFeedback\(/);
  });
});
