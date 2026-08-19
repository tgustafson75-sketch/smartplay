/**
 * 2026-08-19 — a beta tester's report arrived in Tim's inbox as:
 *
 *   • analysis_error: swing_located
 *     swing_time_sec: 5.1 · start_sec: 2.6 · end_sec: 8.1 · confidence: low
 *
 * That is the locator SUCCEEDING. It found the swing, windowed it correctly, and reported an honest
 * low confidence — which, since 2026-08-18, is a normal reading and not a failure. It was mailed out
 * as an analysis error because `addAppEvent` defaults its kind to 'analysis_error' and the locator's
 * breadcrumbs passed no kind.
 *
 * The 08-10 note on REPORTABLE_KINDS states the intent plainly: "what we SEND/EXPORT as an issue
 * report is real problems only." A release inbox is only useful if every line in it is worth reading —
 * successes bury the errors. These tests pin the classification so a future breadcrumb can't quietly
 * rejoin the mailing list.
 */
import { useIssueLogStore } from '../../store/issueLogStore';

/** Mirrors services/issueLogExport.REPORTABLE_KINDS — what actually leaves the device. */
const REPORTABLE = new Set([
  'user', 'voice_error', 'voice_silent_fail', 'transcribe_error', 'gps_error', 'analysis_error',
  'voice_miss', 'app_error',
]);
const reportable = (kind?: string) => kind == null || REPORTABLE.has(kind);

describe('issue log — only real problems leave the device', () => {
  beforeEach(() => { useIssueLogStore.getState().clearAll(); });

  it('a successful swing locate is kept on device but never exported', () => {
    useIssueLogStore.getState().addAppEvent(
      'swing_located',
      { swing_time_sec: 5.1, start_sec: 2.6, end_sec: 8.1, confidence: 'low' },
      'diag',
    );
    const entries = useIssueLogStore.getState().entries;
    expect(entries).toHaveLength(1);           // still there for owner-log review
    expect(entries[0].kind).toBe('diag');
    expect(reportable(entries[0].kind)).toBe(false);  // ...and not mailed out
  });

  it('genuine locator degradation IS still exported', () => {
    for (const detail of [
      { stage: 'swing_locate_fallback', reason: 'server_500' },
      { stage: 'swing_locate_fallback', reason: 'exception' },
      { stage: 'range_locate_fallback', reason: 'coarse_frames_failed' },
      { stage: 'swing_locate_skip', reason: 'no_api_url' },
    ]) {
      useIssueLogStore.getState().clearAll();
      useIssueLogStore.getState().addAppEvent(detail.stage, { reason: detail.reason }, 'analysis_error');
      const e = useIssueLogStore.getState().entries[0];
      expect(reportable(e.kind)).toBe(true);
    }
  });

  it('addAppEvent still defaults to an error for callers that mean one', () => {
    // The default is right for its other callers (analysis_failed, frame_extraction_empty…).
    // The fix was to classify the breadcrumbs, not to weaken the default.
    useIssueLogStore.getState().addAppEvent('analysis_failed', { error: 'boom' });
    expect(useIssueLogStore.getState().entries[0].kind).toBe('analysis_error');
  });

  it('the locator classifies success and by-design skips as diag, degradation as error', () => {
    // Guards the classifier in services/poseDetection.logLocate directly, so a new breadcrumb that
    // ends in _located (or skips by design) cannot silently rejoin the owner's inbox.
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../services/poseDetection.ts'), 'utf-8');
    expect(src).toMatch(/stage\.endsWith\('_located'\)/);
    expect(src).toMatch(/reason === 'clip_under_12s' \|\| reason === 'clip_too_short'/);
    expect(src).toMatch(/expected \? 'diag' : 'analysis_error'/);
  });
});
