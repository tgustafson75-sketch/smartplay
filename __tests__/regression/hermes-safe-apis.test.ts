/**
 * 2026-08-12 (Tim, an hour before a league round) — "I'm getting that the message just says
 * undefined is not a function."
 *
 * It was mine, shipped hours earlier. I used AbortSignal.any() in the voice warmup — and warmup runs
 * from _layout at BOOT, so it threw on every launch.
 *
 * The tell I should have caught when writing it: AbortSignal.timeout appears 78 times in this app,
 * AbortSignal.any appeared ONCE. React Native runs Hermes, not V8 or JSC-with-everything, and Hermes
 * lags the spec. An API being standard, documented and correct says nothing about whether this
 * engine has it. The only evidence that counts is that the app already uses it somewhere.
 *
 * Same mistake in the same session: Paths.cache.list() to sweep stale voice clips — used once, by
 * me, while the proven pattern (clipStorageGc) is readDirectoryAsync from expo-file-system/legacy.
 *
 * These are hard to catch precisely because tsc is happy: TypeScript types the standard library, not
 * the runtime. Neither jest (node, full V8) nor the sim can see it either. Only the device finds it,
 * which is the worst possible place — Tim found it an hour before playing.
 */
import fs from 'fs';
import path from 'path';

const ROOTS = ['app', 'services', 'components', 'hooks', 'store', 'lib', 'utils'];

function shippingSources(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = [];
  const walk = (dir: string) => {
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(p)) continue;
      const raw = fs.readFileSync(p, 'utf8');
      // Strip comments — an explanatory note about an API is not a call to it.
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      out.push({ file: path.relative(path.join(__dirname, '../..'), p), code });
    }
  };
  for (const r of ROOTS) walk(path.join(__dirname, '../..', r));
  return out;
}

/**
 * APIs that are standard, that TypeScript accepts, and that Hermes does NOT reliably provide.
 * Every one of these fails at runtime as "undefined is not a function" — on device, in the field.
 */
const NOT_IN_HERMES: { pattern: RegExp; api: string; instead: string }[] = [
  { pattern: /AbortSignal\s*\.\s*any\s*\(/, api: 'AbortSignal.any()', instead: 'link an AbortController to a setTimeout by hand (see voiceWarmup.linkedTimeoutSignal)' },
  { pattern: /\bstructuredClone\s*\(/, api: 'structuredClone()', instead: 'JSON round-trip, or an explicit copy' },
  { pattern: /\bObject\s*\.\s*groupBy\s*\(/, api: 'Object.groupBy()', instead: 'a reduce into a Map' },
  { pattern: /\bMap\s*\.\s*groupBy\s*\(/, api: 'Map.groupBy()', instead: 'a reduce into a Map' },
  { pattern: /\.\s*toSorted\s*\(/, api: 'Array.toSorted()', instead: '[...arr].sort()' },
  { pattern: /\.\s*toReversed\s*\(/, api: 'Array.toReversed()', instead: '[...arr].reverse()' },
  { pattern: /\.\s*toSpliced\s*\(/, api: 'Array.toSpliced()', instead: 'slice + spread' },
  { pattern: /\bPromise\s*\.\s*withResolvers\s*\(/, api: 'Promise.withResolvers()', instead: 'new Promise with captured resolve/reject' },
  { pattern: /\bArray\s*\.\s*fromAsync\s*\(/, api: 'Array.fromAsync()', instead: 'a for-await loop' },
  { pattern: /Paths\.\w+\.list\s*\(/, api: 'Paths.<dir>.list()', instead: "FileSystem.readDirectoryAsync from 'expo-file-system/legacy'" },
];

describe('no shipping code calls an API Hermes does not have', () => {
  const sources = shippingSources();

  it('is actually reading the app — not passing vacuously', () => {
    expect(sources.length).toBeGreaterThan(200);
  });

  it.each(NOT_IN_HERMES.map(r => [r.api, r] as const))('%s is never called', (_api, rule) => {
    const offenders = sources
      .filter(s => (rule as typeof NOT_IN_HERMES[number]).pattern.test(s.code))
      .map(s => s.file);
    // Failing here means the app will throw "undefined is not a function" ON DEVICE at whatever
    // point this line runs — which tsc, jest and the sim will all happily miss.
    expect(offenders).toEqual([]);
  });

  it('the replacement for AbortSignal.any is present and used', () => {
    const warm = fs.readFileSync(path.join(__dirname, '../../services/voiceWarmup.ts'), 'utf8');
    expect(warm).toContain('function linkedTimeoutSignal(outer: AbortSignal, ms: number): AbortSignal');
    expect(warm).toContain('signal: linkedTimeoutSignal(signal, WARMUP_TIMEOUT_MS)');
  });

  it('AbortSignal.timeout stays — it IS present, and is used throughout', () => {
    // The point is not "avoid new APIs", it's "only use what this app has already proven".
    const uses = sources.filter(s => /AbortSignal\s*\.\s*timeout\s*\(/.test(s.code)).length;
    expect(uses).toBeGreaterThan(20);
  });
});
