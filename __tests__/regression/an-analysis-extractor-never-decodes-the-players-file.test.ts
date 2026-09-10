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

/**
 * 2026-09-09 (triple-check) — this list was hand-written once and was WRONG: it cleared
 * feelReconcile and swingShare as "not on the looping surface" when feelReconcile is called twice
 * from smartmotion.tsx (the putt read and the feel reconcile) and swingShare from the swing-detail
 * screen's Share button while its video plays.
 *
 * So the list is DERIVED now. Every module that pulls frames from a clip is discovered by scanning,
 * and each one must either take the pooled copy or appear in ALLOWED with the reason it is safe.
 * A new extractor added tomorrow fails this test until someone answers the question.
 */
const SCAN_DIRS = ['services', 'app', 'components', 'hooks'];

/**
 * Readers that do NOT need the pooled copy, each with the reason. A full clip copy is hundreds of
 * megabytes; it is the right price for a multi-frame sweep and the wrong one for a single still.
 */
const ALLOWED: Record<string, string> = {
  'utils/videoThumbnail.ts': 'the queue itself',
  'app/swinglab/swing/[swing_id].tsx':
    'the grab-frame handler PAUSES the player first (07-21) — the other valid remedy — and reads one frame',
  'components/swinglab/SwingStillComposite.tsx':
    'one frame, reached only through that same paused grab-frame path',
  'components/swinglab/PuttReadLine.tsx':
    'one frame for a still; failure is handled and a full clip copy costs far more than the read',
  'app/swinglab/library.tsx':
    'thumbnail backfill on the LIST screen — no player is mounted on the clip it reads',
  'app/swinglab/tutorial-upload.tsx': 'one poster frame during import; no player on the file yet',
  'services/puttFrameExtractor.ts': 'called only from videoUpload, an import path with no player',
  'services/videoUpload.ts': 'import/upload path — the clip is not mounted in a player',
  'services/bagScan.ts':
    'the clip comes straight from ImagePicker.launchCameraAsync (the OS camera UI); the app never mounts a player on it',
};

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

/** The extractors that run while a review surface is looping the clip. */
const ANALYSIS_EXTRACTORS = [
  'services/poseDetection.ts',      // fault-read frames + the locate's coarse sweep
  'services/poseAnalysisApi.ts',    // the measured pose read + tempo
  'services/swing/clubPath.ts',     // the arc
  'services/swing/ballPath.ts',     // the trace
  'services/swing/ballDeparture.ts',
  'services/swing/onDeviceLocate.ts',
  'services/swing/feelReconcile.ts', // the putt read + the feel reconcile, both from smartmotion
  'services/swingShare.ts',          // Share, from the swing-detail screen while it plays
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

  it('THE DERIVED SWEEP: every frame reader either pools or is allowed with a reason', () => {
    const unaccounted: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listFiles(path.join(root, dir))) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        const code = stripComments(fs.readFileSync(file, 'utf8'));
        if (!/getThumbnailAsync/.test(code)) continue;
        if (ALLOWED[rel]) continue;
        if (code.includes('acquireClipCopy')) continue;
        unaccounted.push(rel);
      }
    }
    expect(unaccounted).toEqual([]);
  });

  it('every allowance names a file that still reads frames', () => {
    for (const rel of Object.keys(ALLOWED)) {
      const code = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(code).toMatch(/getThumbnailAsync/);
    }
  });

  /**
   * 2026-09-09 — caught by re-reading my own change. The duration probe wanted the same safety, but
   * it lives inside a deliberately BOUNDED function: PROBE_TIMEOUT_MS, which DURATION_PROBE_CEILING_MS
   * is derived from, which feeds ANALYSIS_WORST_CASE_MS — the screen's hang guard. Putting an
   * unbounded multi-hundred-megabyte copy in front of it makes that budget a lie and can fire
   * "Analysis timed out" on a clip that was going to succeed.
   */
  it('the duration probe never MAKES a copy — it only borrows one that exists', () => {
    const src = stripComments(read('services/poseDetection.ts'));
    const probe = src.slice(src.indexOf('async function probeDurationUncached'));
    const body = probe.slice(0, probe.indexOf('async function probeDurationOn'));
    expect(body).toContain('acquireExistingClipCopy');
    expect(body).not.toMatch(/[^g]\bacquireClipCopy\(/);
  });

  it('the hang-guard budget still names the probe timeout it is derived from', () => {
    const src = read('services/poseDetection.ts');
    // If the probe ever grows an unbounded step, this constant stops describing reality.
    expect(src).toMatch(/DURATION_PROBE_CEILING_MS = 8_000;\s*\/\/ probeDurationMs' own PROBE_TIMEOUT_MS/);
    expect(src).toContain('const PROBE_TIMEOUT_MS = 8_000;');
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
