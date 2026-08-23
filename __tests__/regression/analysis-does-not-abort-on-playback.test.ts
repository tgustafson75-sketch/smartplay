import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.expo', 'android', 'ios', 'dist', '__tests__', 'scripts'].includes(e.name)) continue;
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * 2026-08-23 (Tim — "when you open a file in swing library, sometimes it auto plays. And if you hit
 * analysis, that might stop the playing. So I feel like there's a connection with those.")
 *
 * There was. Analysis aborted whenever the clip was PLAYING, and the ?watch=1 entry auto-plays and
 * THEN analyses — so the two fought and the run died before producing anything. That is the "cannot
 * read / cannot analyze on the first try" he kept hitting.
 *
 * The guard existed for a real MediaMetadataRetriever + ExoPlayer SIGSEGV, but that condition was
 * removed on 2026-07-30: extraction runs on its OWN private copy and clubPath.ts hard-refuses to run
 * without one, so it can never share a handle with the player. One of the two call sites had the
 * stale guard removed on 08-08; the other was missed for two weeks.
 *
 * This forbids the SHAPE rather than the instance: leaving the screen may abort analysis; playing
 * the video may not.
 */
describe('playback never aborts analysis', () => {
  const files = walk(ROOT);

  it('scans a real set of files (not vacuous)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no shouldAbort is bound to playback state', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = strip(fs.readFileSync(f, 'utf-8'));
      const re = /shouldAbort\s*:\s*([^,\n}]{2,80})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (/isPlaying|playing|shouldPlay|isSpeaking/i.test(m[1])) {
          offenders.push(`${path.relative(ROOT, f)}  ->  shouldAbort: ${m[1].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('would CATCH the exact line that was wrong for two weeks', () => {
    const bad = 'shouldAbort: () => isPlayingRef.current });';
    expect(/shouldAbort\s*:\s*([^,\n}]{2,80})/.exec(bad)?.[1]).toMatch(/isPlaying/);
  });

  it('the surviving abort is a LIFECYCLE flag, and it is actually wired', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/swinglab/swing/[swing_id].tsx'), 'utf-8');
    expect(src).toMatch(/shouldAbort: \(\) => cancelled/);
    // A `cancelled` flag with no cleanup to flip it is inert — that would be a half-fix of the fix.
    const flags = (src.match(/let cancelled = false;/g) ?? []).length;
    const cleanups = (src.match(/return \(\) => \{ cancelled = true; \};/g) ?? []).length;
    expect(cleanups).toBeGreaterThanOrEqual(flags - 1);
  });
});
