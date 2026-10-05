/**
 * 2026-09-06 (Tim) — "I think it's either analyzing every time I open, even if my swing file already
 * has a reading, and there may be a second read coming after the first."
 *
 * The club-arc runner marked a window "done" only when it found an arc, so a swing whose club path
 * genuinely cannot be traced re-asked the (paid) vision model every open, play and pause.
 *
 *   no answer (no copy, no network, cancelled) → asked again next time;
 *   an answer, even "no traceable arc"          → never re-asked about the same frames.
 *
 * 2026-10-05 — the runner is the orchestrator's shot run now (services/swing/orchestrator/shotDetail),
 * the one every screen asks; these pin the same rule there.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../../services/swing/orchestrator/shotDetail.ts'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a club-arc window is retried only when it was never answered', () => {
  it('stores a REAL result — and an empty one, with its source', () => {
    expect(code).toMatch(/const pts = arc\.points\.length >= 3 \? arc\.points\.map[\s\S]{0,200}: \[\];/);
    expect(code).toMatch(/store\.setShotClubArc\(input\.sessionId, input\.shotId, pts, frame, arc\.source\);/);
  });

  it('remembers the answer, even when it was "no arc"', () => {
    expect(code).toMatch(/if \(!arc\) return null;[^\n]*\n\s*answered\.add\(answerKey\(s, shot\)\);/);
    expect(code).toMatch(/if \(answered\.has\(answerKey\(s, shot\)\)\) return true;/);
    // a tracked answer, found or honestly empty, is final across app restarts too
    expect(code).toMatch(/if \(src === 'tracker'\) return true;/);
  });

  it('still retries when there was no answer at all', () => {
    // `if (!arc) return null` comes BEFORE the answer is remembered — a null never closes the window.
    expect(code.indexOf('if (!arc) return null;')).toBeLessThan(code.indexOf('answered.add('));
  });

  it('the answer key names clip and window, so a DIFFERENT swing (or a trimmed one) is tried', () => {
    expect(code).toMatch(/`\$\{s\.id\}\|\$\{shot\.id\}\|\$\{shot\.clipUri\}\|\$\{shot\.clipStartSeconds \?\? ''\}\|\$\{shot\.clipEndSeconds \?\? ''\}`/);
  });

  it('a new analysis (force) asks again — the window may have moved', () => {
    expect(code).toMatch(/if \(!input\.force && hasFinalArc\(hit\.s, hit\.shot, hit\.first\)\) return false;/);
  });
});
