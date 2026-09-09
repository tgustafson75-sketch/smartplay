/**
 * 2026-09-09 (Tim — "pose and arc and trace have to work smoothly").
 *
 * SmartMotion's review <Video> is `isLooping` with `shouldPlay`, so the clip is being decoded by
 * ExoPlayer for the whole time the analysis runs on it. A native MediaMetadataRetriever reading the
 * same file is the documented OOM/SIGSEGV that kills the process to the launcher — and short of the
 * crash, it is why a read comes back with nothing: `frame_extraction_empty`,
 * `clubpath_arc_too_sparse · points: 0`, a trace that never draws.
 *
 * clubPath settled this on 07-30 (extract from a PRIVATE COPY, and REFUSE rather than fall back to
 * the original), and 08-09 put every consumer on one refcounted pool so the clip is copied once per
 * review instead of four times. But the migration was partial and stayed that way:
 *
 *   - poseDetection's fault-read frames and the locate's coarse sweep still decoded the ORIGINAL.
 *   - onDeviceLocate (09-01) decoded the ORIGINAL, and was not even on the serializing queue.
 *   - ballPath made its own second full copy of a clip the pool already held.
 *
 * utils/videoThumbnail serializes retriever against retriever. It cannot serialize a retriever
 * against ExoPlayer — that is what the private copy is for, and the two guards are not
 * interchangeable. Every swing-analysis extractor needs BOTH.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');

/** The extractors that run while the review surface is looping the clip. */
const ANALYSIS_EXTRACTORS = [
  'services/poseDetection.ts',      // fault-read frames + the locate's coarse sweep
  'services/poseAnalysisApi.ts',    // the measured pose read + tempo
  'services/swing/clubPath.ts',     // the arc
  'services/swing/ballPath.ts',     // the trace
  'services/swing/ballDeparture.ts',
  'services/swing/onDeviceLocate.ts',
];

const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('every swing-analysis extractor reads a private copy', () => {
  it('the shared pool still refcounts and still refuses to hand back a bad copy', () => {
    const pool = read('services/swing/sharedClipCopy.ts');
    expect(pool).toContain('export async function acquireClipCopy');
    expect(pool).toContain('refs');
    // A zero-byte copy must never be adopted — adopting one silently produces an empty read.
    expect(pool).toContain('info.size ?? 0) <= 0');
  });

  it('THE CLASS: each extractor acquires the shared copy', () => {
    const offenders = ANALYSIS_EXTRACTORS.filter((rel) => !stripComments(read(rel)).includes('acquireClipCopy'));
    expect(offenders).toEqual([]);
  });

  it('each extractor RELEASES it, or the pool never frees the file', () => {
    const offenders = ANALYSIS_EXTRACTORS.filter((rel) => !/\.release\(\)/.test(stripComments(read(rel))));
    expect(offenders).toEqual([]);
  });

  it('nobody makes a SECOND copy of a clip the pool already holds', () => {
    // ballPath did until 09-09: hundreds of megabytes copied twice per review on a 60fps capture.
    for (const rel of ANALYSIS_EXTRACTORS) {
      expect(stripComments(read(rel))).not.toMatch(/copyAsync\(\{\s*from:\s*[\w.]*[Vv]ideoUri/);
    }
  });

  it('and each one is on the serializing queue too — the guards are not interchangeable', () => {
    // The private copy stops the collision with the PLAYER. The queue stops the collision with the
    // other extractors. onDeviceLocate had neither; clubPath had both.
    for (const rel of ANALYSIS_EXTRACTORS) {
      const code = stripComments(read(rel));
      if (!/getThumbnailAsync/.test(code)) continue;
      expect(code).not.toMatch(/['"]expo-video-thumbnails['"]/);
    }
  });
});
