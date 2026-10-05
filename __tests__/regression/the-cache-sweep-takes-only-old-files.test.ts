/**
 * 2026-10-04 (sweep + re-review) — exact-frame JPEGs and private clip copies a killed session left in
 * the cache are cleared after launch — but only files from BEFORE this launch: an analysis started in
 * the first seconds may already be using a fresh one. Persistent thumbnails (documentDirectory) and
 * other cache files are never touched.
 */
const files: Record<string, number> = {};
const deleted: string[] = [];
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  readDirectoryAsync: async () => Object.keys(files),
  getInfoAsync: async (u: string) => ({ exists: true, modificationTime: files[u.replace('file:///cache/', '')] }),
  deleteAsync: async (u: string) => { deleted.push(u.replace('file:///cache/', '')); },
}));
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));

import { sweepOrphanFrameFiles } from '../../utils/videoThumbnail';

it('deletes only exact_/shared-clip- files older than this launch', async () => {
  const boot = 1_000_000_000_000;
  // mtime is deliberately OLD on every file: Android's copy keeps the SOURCE clip's date, so the sweep
  // must go by the creation time in the NAME (10-04: a fresh copy was deleted mid-read).
  const old = (boot - 86_400_000) / 1000;
  Object.assign(files, {
    [`exact_${boot - 60_000}_1.jpg`]: old,                // last launch → swept
    [`shared-clip-${boot - 60_000}-ab.mp4`]: old,         // last launch → swept
    [`exact_${boot + 5_000}_2.jpg`]: old,                 // this launch, in use → kept
    [`shared-clip-${boot + 2_000}-cd.mp4`]: old,          // this launch, a copy of yesterday's clip → KEPT
    'VideoThumbnails': old,                               // not ours → kept
    'swing-thumb-x.jpg': old,                             // not ours → kept
  });
  const n = await sweepOrphanFrameFiles(boot);
  expect(deleted.sort()).toEqual([`exact_${boot - 60_000}_1.jpg`, `shared-clip-${boot - 60_000}-ab.mp4`].sort());
  expect(n).toBe(2);
});
