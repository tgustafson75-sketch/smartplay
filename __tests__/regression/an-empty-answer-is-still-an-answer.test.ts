/**
 * 2026-09-06 (Tim) — "I think it's either analyzing every time I open, even if my swing file already
 * has a reading, and there may be a second read coming after the first."
 *
 * Both were happening, from one line.
 *
 * The club-arc effect guards itself with `clubArcRunKeyRef`, keyed on clip + window. That ref was
 * assigned ONLY inside the success branch — `if (r && r.points.length >= 3)`. So a swing whose club
 * path genuinely cannot be traced never recorded that it had been tried, and every subsequent run of
 * the effect started over.
 *
 * `isPlaying` is in that effect's dependency list deliberately: native frame extraction cannot run
 * while ExoPlayer holds the same file, so a play/pause flip has to retry. Correct on its own. Paired
 * with "mark only on success" it meant every open, every play and every pause fired a fresh native
 * extraction and a PAID vision call — to re-ask a question that had already been answered "no".
 *
 * The fix uses a distinction the code was already logging, `aborted: !r`:
 *
 *   r === null → no answer (superseded, playback started). Retrying is right.
 *   r truthy   → we asked, and the answer was "no traceable arc". Re-asking the same model about the
 *                same frames cannot produce a different result.
 *
 * These lock that, because the failure is invisible: everything looks fine, it just costs money and
 * battery every time he opens a swing.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '../../app/swinglab/swing/[swing_id].tsx'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a club-arc window is retried only when it was never answered', () => {
  it('marks the window done on a REAL result', () => {
    // The original behaviour, unchanged: a good arc closes the window.
    expect(code).toMatch(/if \(r && r\.points\.length >= 3\)[\s\S]{0,200}clubArcRunKeyRef\.current = runKey/);
  });

  it('ALSO marks it done when the answer came back empty', () => {
    // The fix. Without this the effect re-runs forever on any swing that cannot be traced.
    expect(code).toContain('if (r) clubArcRunKeyRef.current = runKey;');
  });

  it('still retries when there was no answer at all', () => {
    // `aborted: !r` — a null result must NOT close the window, or a run cancelled by playback
    // would never be retried and the arc would be permanently absent.
    expect(code).toContain('aborted: !r');
    // The guard is conditional on r, never unconditional.
    expect(code).not.toMatch(/^\s*clubArcRunKeyRef\.current = runKey;\s*$/m);
  });

  it('keeps isPlaying in the deps — the retry it enables is legitimate', () => {
    // Removing it would be the wrong fix for the same symptom: native extraction genuinely cannot
    // run while playback holds the file, and that retry is why the arc appears at all after a pause.
    const effectTail = code.slice(code.indexOf('clubArcRunKeyRef'));
    expect(effectTail).toMatch(/isPlaying[^\]]*\]/);
  });

  it('the run key still distinguishes clip and window, so a DIFFERENT swing is tried', () => {
    // Marking done must not become "never analyse anything again".
    expect(code).toMatch(/const runKey = `\$\{shot\.clipUri\}\|\$\{Math\.round\(startMs\)\}\|\$\{Math\.round\(endMs\)\}`/);
  });
});
