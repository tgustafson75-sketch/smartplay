import * as fs from 'fs';
import * as path from 'path';
const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');
const svc = read('services/tankReview.ts');
/** Comments stripped: a note EXPLAINING the old bug must not read as the old bug. Third time today. */
const svcCode = svc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const screen = read('app/swinglab/swing/[swing_id].tsx');

/**
 * 2026-08-22 (Tim — "I did export them from the swing library. An email was sent, but there's no
 * video attached. So it's really hard to do that.")
 *
 * Two independent ways that happened, both silent:
 *   1. nothing checked videoUri pointed at a real, non-empty file
 *   2. the RN Share fallback is text/url only and CANNOT carry a binary — yet it returned `ok`,
 *      and the body said "Review the attached swing video"
 */
describe('a swing export either carries the video or says it did not', () => {
  it('proves the file exists and is non-trivial before sending', () => {
    expect(svc).toMatch(/getInfoAsync\(opts\.videoUri\)/);
    expect(svc).toMatch(/size < 1024/);
    expect(svc).toMatch(/refusing to send: video missing or empty/);
  });

  it('the text-only path is no longer reported as success', () => {
    expect(svc).toMatch(/kind: 'no_attachment'/);
    expect(svc).not.toMatch(/via: 'fallback_share'/);
  });

  it('the email body never promises an attachment the path cannot deliver', () => {
    expect(svcCode).not.toMatch(/Review the attached swing video/);
    expect(svcCode).toMatch(/Review the swing video when you have a moment/);
  });

  it('and the screen tells the player the video did not go', () => {
    expect(screen).toMatch(/result\.kind === 'no_attachment'/);
    expect(screen).toMatch(/couldn.{0,8}t attach the video/);
  });

  it('the no-file case is still surfaced too', () => {
    expect(svc).toMatch(/return \{ kind: 'no_file' \}/);
    expect(screen).toMatch(/result\.kind === 'no_file'/);
  });
});
