/**
 * 2026-09-09 (Tim — "open smartmotion and record crashes the app", and "it did work before").
 *
 * utils/videoThumbnail exists because of a hard crash: Android's MediaMetadataRetriever, behind
 * expo-video-thumbnails, is not safe to run as several concurrent instances against a file — least
 * of all one ExoPlayer is decoding for playback. That is a native OOM/SIGSEGV which kills the process
 * to the launcher and CANNOT be caught from JS, so it never reaches the issue log, never fires an
 * error boundary, and looks to the player like the app simply vanished.
 *
 * The module is a drop-in re-export whose whole value is that EVERY reader goes through it, giving
 * one native reader at a time app-wide. A single import of the raw package silently forfeits that
 * for the entire app, and nothing about the offending file looks wrong.
 *
 * That is exactly how it broke. services/swing/onDeviceLocate.ts (09-01) imported the raw package
 * and read twelve frames per analysis. Its own comment said "the media chain serializes them anyway"
 * — it did not, because the file was not on the chain. Serial-with-itself is not the property that
 * matters. On 09-01 ad3d1216 wired that locate into analyzeSwing for every caller, so SmartMotion's
 * stop-recording handoff set clipUri (the <Video> mounts and decodes) and then ran twelve
 * unserialized retriever reads against that same file.
 *
 * A comment could not have prevented this and did not. Only the import can be checked.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['app', 'components', 'hooks', 'services', 'utils', 'store'];

/** The one module allowed to touch the raw package: the queue itself. */
const THE_QUEUE = 'utils/videoThumbnail.ts';

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('every native frame read goes through the single-flight queue', () => {
  const files = SCAN_DIRS.flatMap((d) => listFiles(path.join(root, d)));

  it('the queue is still there and still serializes', () => {
    const src = fs.readFileSync(path.join(root, THE_QUEUE), 'utf8');
    expect(src).toContain('let chain: Promise<unknown>');
    expect(src).toContain('export function serializeMediaRead');
    // getThumbnailAsync must be the SHADOWING export, or callers get the unserialized star-export.
    expect(src).toContain('export function getThumbnailAsync');
  });

  it('THE CLASS: nothing but the queue imports expo-video-thumbnails', () => {
    const offenders = files
      .map((f) => ({ rel: path.relative(root, f).split(path.sep).join('/'), src: fs.readFileSync(f, 'utf8') }))
      .filter(({ rel }) => rel !== THE_QUEUE)
      .filter(({ src }) => /['"]expo-video-thumbnails['"]/.test(stripComments(src)))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it('the two files that broke it read through the queue', () => {
    // Named rather than left to the sweep: these are the regression, and a rename that quietly drops
    // one of them back onto the raw package should fail here with the reason attached.
    for (const rel of ['services/swing/onDeviceLocate.ts', 'services/swingShare.ts']) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(src).toMatch(/from '(\.\.\/)+utils\/videoThumbnail'/);
    }
  });
});
