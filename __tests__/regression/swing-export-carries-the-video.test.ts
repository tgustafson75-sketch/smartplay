import * as fs from 'fs';
import * as path from 'path';
const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');
const screen = read('app/swinglab/swing/[swing_id].tsx');

/**
 * 2026-08-22 (Tim — "I did export them from the swing library. An email was sent, but there's no
 * video attached. So it's really hard to do that.")
 *
 * Two independent ways that happened, both silent:
 *   1. nothing checked the clip URI pointed at a real file
 *   2. the RN Share fallback is text/url only and CANNOT carry a binary — yet it returned `ok`
 *
 * 2026-08-25 — REWRITTEN, NOT DELETED. The service this used to guard (the send-to-Tank email
 * route) is gone with that persona, and it would have been easy to drop the test with it. But the
 * BUG it protects against is about exporting a swing at all, and the general share path survives.
 * So the guard moves to that path rather than disappearing with the feature that happened to
 * surface it first.
 */
describe('a swing export either carries the video or says it did not', () => {
  it('refuses to share when the session has no video file', () => {
    expect(screen).toMatch(/if \(!shot\?\.clipUri\) \{[\s\S]{0,160}Nothing to share/);
  });

  it('re-anchors the clip URI so a stale post-reinstall path is not "shared"', () => {
    expect(screen).toMatch(/resolveClipUri\(shot\.clipUri\)/);
  });

  it('uses the Sharing API, which can carry a binary — never the text-only RN Share', () => {
    expect(screen).toMatch(/Sharing\.shareAsync\(shareUri, \{[\s\S]{0,120}mimeType: 'video\/mp4'/);
    expect(screen).toMatch(/Sharing\.isAvailableAsync\(\)/);
  });

  it('says so when the share fails instead of reporting a silent success', () => {
    expect(screen).toMatch(/Share failed[\s\S]{0,120}no longer be on this device/);
  });
});
