/**
 * 2026-10-04 (orchestrator phase 3) — THE SECOND COPY.
 *
 * SmartMotion's read starts on the recorder's raw file; the pose pass and club arc read the durable
 * copy persistClipToDocuments makes of it. Same bytes, two URIs, so the private-copy pool made two full
 * copies of one clip. aliasClipCopy lets the durable URI share the raw URI's live entry, and reaping
 * an entry forgets every name it had, so a later acquire never gets a deleted file.
 */
import fs from 'fs';
import path from 'path';

const copies: string[] = [];
const deleted: string[] = [];
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  copyAsync: jest.fn(async ({ to }: { to: string }) => { copies.push(to); }),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1000 })),
  deleteAsync: jest.fn(async (u: string) => { deleted.push(u); }),
}));

import { acquireClipCopy, aliasClipCopy } from '../../services/swing/sharedClipCopy';

beforeEach(() => { copies.length = 0; deleted.length = 0; jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('one clip, one private copy', () => {
  it('the durable name shares the copy the raw name already holds', async () => {
    const raw = await acquireClipCopy('file:///raw-a.mp4');
    aliasClipCopy('file:///docs/durable-a.mp4', 'file:///raw-a.mp4');
    const durable = await acquireClipCopy('file:///docs/durable-a.mp4');
    expect(copies).toHaveLength(1);
    expect(durable!.uri).toBe(raw!.uri);
    raw!.release(); durable!.release();
  });

  it('reaping forgets every name — the next acquire makes a fresh copy, never a deleted one', async () => {
    const raw = await acquireClipCopy('file:///raw-b.mp4');
    aliasClipCopy('file:///docs/durable-b.mp4', 'file:///raw-b.mp4');
    raw!.release();
    jest.advanceTimersByTime(10_000);   // past the linger
    expect(deleted).toContain(raw!.uri);
    const again = await acquireClipCopy('file:///docs/durable-b.mp4');
    expect(again!.uri).not.toBe(raw!.uri);
    expect(copies).toHaveLength(2);
    again!.release();
  });

  it('no live entry: nothing to share, nothing done', async () => {
    aliasClipCopy('file:///docs/durable-c.mp4', 'file:///raw-c.mp4');
    const d = await acquireClipCopy('file:///docs/durable-c.mp4');
    expect(copies).toHaveLength(1);
    d!.release();
  });

  it('SmartMotion aliases the durable clip right after persisting it', () => {
    const sm = fs.readFileSync(path.join(__dirname, '..', '..', 'app/swinglab/smartmotion.tsx'), 'utf8');
    expect(sm).toMatch(/uri = await persistClipToDocuments\(rawUri\);[\s\S]{0,400}?aliasClipCopy\(uri, rawUri\)/);
  });
});
