/**
 * 2026-09-22 — Sentry, Android, FATAL, ongoing since 1.0.0 (1), route `/greeting`:
 * "Player is accessed on the wrong thread. Current thread: 'pool-4-thread-1' Expected thread:
 * 'main'". expo-av drives ExoPlayer — built with the MAIN looper — from expo-modules-core's
 * background `modulesQueue`, and the progress ticker's no-arg `new Handler()` inherits whichever
 * thread scheduled it. A throw from that tick lands outside the AsyncFunction try/catch, so it is
 * uncaught and fatal. `services/audioPlaybackOptions.ts` carries the full mechanism.
 *
 * Two assertions, because the defect has two shapes:
 *
 *  1. BEHAVIOUR — `playbackSoundOptions` must actually put `androidImplementation: 'MediaPlayer'`
 *     on the status, on Android and only on Android. A guard that only checked the string would
 *     pass over a helper that returned its input. [[measure-the-function-dont-read-it]]
 *  2. REACH — every playback load site must go through it. This is the half that matters: the
 *     crash was on ONE path and the same defect sat on eight more.
 *     [[no-half-fixes-enforce-every-surface]] [[two-owners-is-the-root-cause]]
 *
 * The source scan STRIPS COMMENTS FIRST. `audioPlaybackOptions.ts` quotes `Audio.Sound.createAsync`
 * in its own header, and so does this file — a naive grep would match the prose that documents the
 * rule and certify nothing. [[my-own-comment-defeats-my-own-guard]]
 * [[strip-comments-before-a-guard-matches]]
 */
import * as fs from 'fs';
import * as path from 'path';

import { playbackSoundOptions, probeSoundOptions } from '../../services/audioPlaybackOptions';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RN = require('react-native') as { Platform: { OS: string } };

const REPO = path.resolve(__dirname, '../../');
const SCAN_DIRS = ['services', 'app', 'components', 'hooks', 'lib', 'store', 'contexts', 'utils'];

/** The one file allowed to name the option, because it is the file that applies it. */
const OWNER = path.join('services', 'audioPlaybackOptions.ts');

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Return the argument text of every `<call>(...)` in `src`, matched by COUNTING PARENS to the
 * real closing bracket. A non-greedy `([\s\S]*?)\)` stops at the first `)` inside the arguments,
 * so `loadAsync(require('tick.mp3'), playbackSoundOptions())` would be read as ending after
 * `require('tick.mp3'` — and the guard would report a correctly-wired call as bare. That window
 * bug is how three earlier guards went worthless. [[three-ways-a-guard-is-worthless]]
 */
const callArgs = (src: string, callRe: RegExp): { args: string; index: number }[] => {
  const found: { args: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(callRe.source, 'g');
  while ((m = re.exec(src)) !== null) {
    const open = src.indexOf('(', m.index + m[0].length - 1);
    if (open === -1) continue;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    found.push({ args: src.slice(open + 1, i), index: m.index });
  }
  return found;
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};

const sourceFiles = SCAN_DIRS
  .map((d) => path.join(REPO, d))
  .filter((d) => fs.existsSync(d))
  .flatMap((d) => walk(d));

describe('playbackSoundOptions actually changes the status', () => {
  const original = RN.Platform.OS;
  afterEach(() => { RN.Platform.OS = original; });

  it('selects MediaPlayer on Android — the whole point of the fix', () => {
    RN.Platform.OS = 'android';
    const status = playbackSoundOptions({ shouldPlay: true, volume: 0.8 });
    expect(status.androidImplementation).toBe('MediaPlayer');
    // and it must not have eaten the caller's own status
    expect(status.shouldPlay).toBe(true);
    expect(status.volume).toBe(0.8);
  });

  it('leaves iOS untouched — AVPlayer has no wrong-thread assertion to dodge', () => {
    RN.Platform.OS = 'ios';
    const status = playbackSoundOptions({ shouldPlay: true, volume: 0.8 });
    expect(status.androidImplementation).toBeUndefined();
    expect(status.shouldPlay).toBe(true);
  });

  it('works with no caller status at all (tempoMetronome loads a bare asset)', () => {
    RN.Platform.OS = 'android';
    expect(playbackSoundOptions().androidImplementation).toBe('MediaPlayer');
  });

  it('probes stay on ExoPlayer ON PURPOSE — it reads more containers than MediaPlayer', () => {
    RN.Platform.OS = 'android';
    expect(probeSoundOptions({ shouldPlay: false }).androidImplementation).toBeUndefined();
  });
});

describe('every Sound load goes through the owner', () => {
  it('finds the load sites at all — a scan that matches nothing is not a passing scan', () => {
    const calls = sourceFiles.flatMap((f) =>
      callArgs(stripComments(fs.readFileSync(f, 'utf8')), /Audio\.Sound\.createAsync\s*\(/),
    );
    // 13 today (7 voice, 1 filler, 3 probes, 1 custom-caddie preview, and the owner's own doc is
    // stripped). An absolute floor, not a relative one: if a refactor hides the call behind a
    // wrapper this must go red, not quietly certify zero sites. [[measure-the-function-dont-read-it]]
    expect(calls.length).toBeGreaterThanOrEqual(11);
  });

  it('no bare Audio.Sound.createAsync anywhere but the owner', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const rel = path.relative(REPO, file);
      if (rel === OWNER) continue;
      const src = stripComments(fs.readFileSync(file, 'utf8'));

      for (const call of callArgs(src, /Audio\.Sound\.createAsync\s*\(/)) {
        if (!/playbackSoundOptions|probeSoundOptions/.test(call.args)) {
          offenders.push(`${rel}:${src.slice(0, call.index).split('\n').length}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no bare loadAsync on a Sound either — tempoMetronome loads without createAsync', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const rel = path.relative(REPO, file);
      if (rel === OWNER) continue;
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (!/new Audio\.Sound\(\)/.test(src)) continue;

      for (const call of callArgs(src, /\.loadAsync\s*\(/)) {
        if (!/playbackSoundOptions|probeSoundOptions/.test(call.args)) {
          offenders.push(`${rel}:${src.slice(0, call.index).split('\n').length}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the owner is the only file that may spell the option literal', () => {
    const spellers = sourceFiles
      .filter((f) => path.relative(REPO, f) !== OWNER)
      .filter((f) => /androidImplementation/.test(stripComments(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(REPO, f));

    expect(spellers).toEqual([]);
  });
});
