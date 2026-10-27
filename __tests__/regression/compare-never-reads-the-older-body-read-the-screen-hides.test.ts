/**
 * 2026-10-27 (Phase SB5 — recheck R2-2 of the SB3/SB4 work).
 *
 * An old library swing before Re-analyze: its body read is an older build's, so the screen says "This
 * swing's body read is from an older version, so it isn't shown." Right under that line, Compare to a
 * reference swing, Compare to an earlier swing and the auto-suggested references were still gated on — and
 * computed from — the raw session.biomechanics: the old build's metrics, shown as better/worse verdicts.
 * And the earlier swings offered included ones whose only read was an older build's.
 *
 * Now every comparison reads the session's body read only when today's code stored it
 * (shotDetail.sessionBodyRead), and only such swings are offered (shotDetail.sessionsToCompare).
 */
import fs from 'fs';
import path from 'path';
import * as shotDetail from '../../services/swing/orchestrator/shotDetail';
import { BODY_READ_VERSION } from '../../services/swing/analysisVersion';

const read = { frames: [{ timestampMs: 1, keypoints: [] }, { timestampMs: 2, keypoints: [] }], angle: 'down_the_line' };
type S = { id: string; date: number; biomechanics?: unknown; analysis_version?: number; putting_analysis?: unknown };
const sess = (id: string, date: number, extra: Partial<S> = {}): S => ({ id, date, biomechanics: read, ...extra });

const { sessionBodyRead, sessionsToCompare } = shotDetail as unknown as {
  sessionBodyRead?: (s: S | null | undefined) => unknown;
  sessionsToCompare?: (all: S[], id: string | null | undefined) => S[];
};

/** The screen's code, comments stripped (they quote the old field names). */
const screen = fs.readFileSync(path.join(__dirname, '..', '..', 'app/swinglab/swing/[swing_id].tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('Compare never reads the older body read the screen says it does not show', () => {
  it('THE REPORT: an old swing (no stamp, or an older one) has nothing to compare; today\'s read does', () => {
    expect(typeof sessionBodyRead).toBe('function');
    expect(sessionBodyRead!(sess('a', 1))).toBeNull();                                          // read before 10-26
    expect(sessionBodyRead!(sess('a', 1, { analysis_version: BODY_READ_VERSION - 1 }))).toBeNull();
    expect(sessionBodyRead!(sess('a', 1, { analysis_version: BODY_READ_VERSION }))).toBe(read);
    expect(sessionBodyRead!(sess('a', 1, { analysis_version: BODY_READ_VERSION, biomechanics: null }))).toBeNull();
    expect(sessionBodyRead!(null)).toBeNull();
  });

  it('the earlier swings offered are only ones today\'s code read, never this one or a putt, newest first', () => {
    expect(typeof sessionsToCompare).toBe('function');
    const all = [
      sess('this', 5, { analysis_version: BODY_READ_VERSION }),
      sess('old', 4),                                                                         // an older build's read
      sess('older-stamp', 3, { analysis_version: BODY_READ_VERSION - 1 }),
      sess('putt', 2, { analysis_version: BODY_READ_VERSION, putting_analysis: {} }),
      sess('cur-1', 1, { analysis_version: BODY_READ_VERSION }),
      sess('cur-2', 6, { analysis_version: BODY_READ_VERSION }),
    ];
    expect(sessionsToCompare!(all, 'this').map((x) => x.id)).toEqual(['cur-2', 'cur-1']);
  });

  it('the screen gates and computes every comparison from that read — no raw session.biomechanics left', () => {
    // Compare to a reference, to an earlier swing, the auto-suggest effect and its card, the picked earlier swing.
    expect(screen).not.toMatch(/\bsession\??\.biomechanics\b/);
    expect(screen).not.toMatch(/\bos\.biomechanics\b/);
    expect(screen).not.toMatch(/\bx\.biomechanics\b/);
    expect(screen).toMatch(/const compareBiomech = sessionBodyRead\(session\)/);
    expect(screen).toMatch(/sessionsToCompare\(allSessions, swing_id\)/);
    expect(screen).toMatch(/const bio = sessionBodyRead\(os\)/);
  });
});
