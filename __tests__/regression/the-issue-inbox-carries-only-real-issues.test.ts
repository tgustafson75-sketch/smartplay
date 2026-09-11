/**
 * 2026-09-04 (Tim — "strip all the nonissue reporting issues to the issue log", after 14 emails in
 * fifteen minutes) — THREE DEFECTS, ONE SYMPTOM: an inbox nobody can read.
 *
 * What actually arrived:
 *   • SEVEN identical "ROUND TRACE — Menifee Lakes Palms" emails stamped inside 400ms, then seven
 *     more for the next round. Each said "New entries: 1" — the batching was fine, the function was
 *     called seven times.
 *   • Every one of those emails contained ONE line, the title. The formatted trace they exist to
 *     deliver was dropped by the renderer.
 *   • Successes mailed as failures: local_responder_hit (the fast path WORKED), ondevice_stt_hit
 *     (offline recognition WORKED), persona_handoff_intro (a persona said hello).
 *
 * The 08-19 note on REPORTABLE_KINDS already said what this list is for: "what we SEND/EXPORT as an
 * issue report is real problems only." It was written after the pose locator's success breadcrumbs
 * were auto-forwarded as analysis errors. Same defect, different producer, six weeks later — which
 * is why this is a guard and not just a fix.
 *
 * Not in scope, deliberately: the transcribe 504 in the same batch is a REAL failure and must keep
 * reporting. Measured against production the same night — 5/5 requests returned 200 in ~1s — so it
 * was transient, not systemic. Silencing it would have hidden a genuine outage.
 */
import { isNonFailureStage } from '../../services/voiceErrorLog';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');

describe('successes are not mailed as failures', () => {
  it('the stages that record working behaviour are classified as non-failures', () => {
    for (const s of ['local_responder_hit', 'ondevice_stt_hit', 'local_responder_miss', 'persona_handoff_intro']) {
      expect([s, isNonFailureStage(s)]).toEqual([s, true]);
    }
  });

  it('genuine failures are still failures', () => {
    // If this ever flips, a real defect stops reaching the inbox — far worse than the noise.
    for (const s of ['speak_api_error', 'listen_no_transcript', 'speak_catch', 'empty_transcript', 'tap_swallowed']) {
      expect([s, isNonFailureStage(s)]).toEqual([s, false]);
    }
  });

  it('logVoiceSilentFail routes non-failures to the diag kind, which is not reportable', () => {
    const src = fs.readFileSync(path.join(root, 'services', 'voiceErrorLog.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toMatch(/write\(\s*isNonFailureStage\(stage\)\s*\?\s*'diag'\s*:\s*'voice_silent_fail'/);

    // ...and 'diag' must genuinely be absent from the reportable set, or the routing is theatre.
    const exp = fs.readFileSync(path.join(root, 'services', 'issueLogExport.ts'), 'utf8');
    const reportable = /REPORTABLE_KINDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(exp);
    expect(reportable).not.toBeNull();
    expect(reportable![1]).not.toMatch(/'diag'/);
  });
});

describe('the round trace is sent once, and arrives with its contents', () => {
  it('sendRoundTrace is guarded against repeat calls', () => {
    const src = fs.readFileSync(path.join(root, 'services', 'roundTrace.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // Concurrent callers share one promise; later callers inside the window are dropped.
    expect(code).toMatch(/if \(inFlight\) return inFlight;/);
    expect(code).toMatch(/lastSentKey === key && Date\.now\(\) - lastSentAt < TRACE_DEDUPE_MS/);
  });

  it('the trace is sent as an OBJECT — a bare string is discarded by the renderer', () => {
    const src = fs.readFileSync(path.join(root, 'services', 'roundTrace.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toMatch(/details:\s*\{\s*trace:\s*body\s*\}/);
    // The exact regression: `details: body`, unwrapped.
    expect(code).not.toMatch(/details:\s*body\s*,/);
  });

  /**
   * 2026-09-06 — this used to read the EMAIL renderer in api/issue-report.ts. That renderer is gone
   * (issue log + Sentry are one system now), so the assertion moved to the path that replaced it —
   * and it earned its keep on the way: the first version of the Sentry send interpolated
   * `${e.details}` straight into the message, which is "[object Object]" for the round trace and
   * loses exactly what this test exists to protect.
   */
  it('and the renderer no longer silently drops a non-object details', () => {
    /**
     * 2026-09-10 — the renderer moved AGAIN, to services/issueFeedback, because there are TWO
     * senders to /api/issue-report and only one had it. services/roundTrace POSTs its own entry
     * (`details: { trace: body }` — the exact shape this test protects) and never joined
     * issueLogExport's list, so the round trace had no Sentry mirror at all. Same assertion,
     * third home; the shape it defends has not changed.
     */
    const fb = fs.readFileSync(path.join(root, 'services', 'issueFeedback.ts'), 'utf8');
    const code = fb.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toMatch(/typeof details === 'string'/);
    expect(code).toMatch(/JSON\.stringify\(details/);
    // and the naive interpolation must not come back, in EITHER sender
    expect(code).not.toMatch(/\$\{entry\.details\}/);
    const exp = fs.readFileSync(path.join(root, 'services', 'issueLogExport.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(exp).not.toMatch(/\$\{e\.details\}/);
    const rt = fs.readFileSync(path.join(root, 'services', 'roundTrace.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // the round trace must route through the shared sender, not hand-roll a third copy
    expect(rt).toMatch(/sendIssueFeedback\(/);
  });
});
