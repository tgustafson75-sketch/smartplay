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
  Object.assign(files, {
    'exact_1_1.jpg': (boot - 60_000) / 1000,          // last launch → swept
    'shared-clip-9-ab.mp4': (boot - 60_000) / 1000,   // last launch → swept
    'exact_2_2.jpg': (boot + 5_000) / 1000,           // this launch, in use → kept
    'VideoThumbnails': (boot - 60_000) / 1000,        // not ours → kept
    'swing-thumb-x.jpg': (boot - 60_000) / 1000,      // not ours → kept
  });
  const n = await sweepOrphanFrameFiles(boot);
  expect(deleted.sort()).toEqual(['exact_1_1.jpg', 'shared-clip-9-ab.mp4']);
  expect(n).toBe(2);
});
