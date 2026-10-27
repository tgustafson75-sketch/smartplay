/**
 * 2026-10-27 (Phase SB4x — review findings "reanalyze #3" / "issue #4").
 *
 * The rule since SB3a (services/swing/analysisVersion): a body read stored by an older build — an older or a
 * missing analysis_version — is UNREAD. SmartMotion's review follows it (storedShotBiomech). The library
 * swing screen drew `shot.biomechanics` / `session.biomechanics` raw, so an old build's read was drawn as
 * current — skeleton, ring, Swing Breakdown rows — with no "Reading…" while the run read the swing again.
 * The screen's activeBiomech is shotDetail.shownShotBiomech; this drives it.
 */
import { shownShotBiomech } from '../../services/swing/orchestrator/shotDetail';
import { BODY_READ_VERSION } from '../../services/swing/analysisVersion';
import { bodyReadNote } from '../../services/swing/faultSpotlight';

const read = { frames: [{ timestampMs: 1, keypoints: [] }, { timestampMs: 2, keypoints: [] }], angle: 'down_the_line' };
const session = (o: { shot0?: Record<string, unknown>; shot1?: Record<string, unknown>; sess?: Record<string, unknown> }) => ({
  id: 's1', source: 'uploaded_video', club: '7i', ...(o.sess ?? {}),
  shots: [
    { id: 'a', club: '7i', clipUri: 'file:///c.mp4', ...(o.shot0 ?? {}) },
    { id: 'b', club: '7i', clipUri: 'file:///c.mp4', ...(o.shot1 ?? {}) },
  ],
}) as never;
const hasPose = (b: { frames: unknown[] } | null) => (b?.frames.length ?? 0) >= 2;

describe('the library draws a body read only when today\'s code made it', () => {
  it('THE REPORT: swing 2 carries an old build\'s read (no stamp) — not drawn; the screen says Reading… while it is read again', () => {
    const s = session({ shot1: { biomechanics: read } });
    const b = shownShotBiomech(s, 1);
    expect(b).toBeNull();
    expect(bodyReadNote({ wanted: true, hasPose: hasPose(b), pending: true })).toBe('reading');
  });
  it('swing 1, an old session-level read (no stamp): not drawn', () => {
    expect(shownShotBiomech(session({ sess: { biomechanics: read } }), 0)).toBeNull();
  });
  it('an older stamp is unread too', () => {
    expect(shownShotBiomech(session({ shot1: { biomechanics: read, analysis_version: BODY_READ_VERSION - 1 } }), 1)).toBeNull();
  });
  it("today's read is drawn — the shot's own, and swing 1's session-level one", () => {
    expect(shownShotBiomech(session({ shot1: { biomechanics: read, analysis_version: BODY_READ_VERSION } }), 1)).toBe(read);
    expect(shownShotBiomech(session({ sess: { biomechanics: read, analysis_version: BODY_READ_VERSION } }), 0)).toBe(read);
  });
  it('a selection a re-split left out of range shows swing 1 — with swing 1\'s session-level read, not none', () => {
    expect(shownShotBiomech(session({ sess: { biomechanics: read, analysis_version: BODY_READ_VERSION } }), 5)).toBe(read);
  });
  it('swing 2 never borrows swing 1\'s session-level read', () => {
    expect(shownShotBiomech(session({ sess: { biomechanics: read, analysis_version: BODY_READ_VERSION } }), 1)).toBeNull();
  });
});
