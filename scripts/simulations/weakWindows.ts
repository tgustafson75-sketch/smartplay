/**
 * GUARDS THAT CANNOT FAIL ON THE EDIT THEY EXIST TO CATCH.
 *
 * 2026-08-28 (adversarial audit 3 — the measuring apparatus itself). The harness already ratchets
 * two ways a guard can be worthless: PROSE_ASSERTION_BASELINE catches assertions satisfied only by a
 * comment, and ISLAND_BASELINE catches guards pointed at code nothing imports. This is the third
 * way, and it is the one I personally hit three times in a single day:
 *
 *     A non-greedy character window, /A[\s\S]{0,N}?B/, whose B occurs MORE THAN ONCE inside the
 *     window. Delete the B the guard means, and the pattern quietly matches the next one.
 *
 * Concretely, today: a guard asserting the notes microphone answers on an EMPTY transcript tested
 * `/\} else \{[\s\S]{0,200}?toast\(/`. Removing the else-branch toast left it GREEN, because the
 * match ran past the else and found the toast in the CATCH — so it proved "there is a toast
 * somewhere below the word else", which is true whenever EITHER branch answers. It could not fail on
 * the branch it was written for. Later the same day, a guard for the TTS fallback searched the whole
 * file for `deviceSpeakFallback(...)`, which appears twice; deleting the one that mattered left it
 * green on the strength of the other.
 *
 * Both were caught by break-testing — but only because I remembered to break-test the case that did
 * NOT motivate the guard. This makes that check mechanical instead of remembered.
 *
 * WHAT IT DOES NOT CATCH, stated so the number is not read as more than it is:
 *   - windows whose pattern is tested against an inline `read('f')` rather than a bound const (the
 *     binder resolves the common form only);
 *   - it evaluates the FIRST match of the pre-pattern, not every match;
 *   - count-threshold assertions, `(src.match(/x/g) ?? []).length >= N`, which fail differently —
 *     they can come to REQUIRE the duplication a fix removes. Two of those bit me today as well and
 *     they need judgment per guard, not a rule.
 * A partial check that says what it misses beats a total one that quietly does not.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../');

const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

export interface WeakWindow {
  /** The check() label, for the failure message. */
  label: string;
  file: string;
  window: number;
  occurrences: number;
  post: string;
}

export function findWeakWindows(): WeakWindow[] {
  let sim = '';
  try { sim = fs.readFileSync(path.join(ROOT, 'scripts/simulations/run-sim.ts'), 'utf-8'); } catch { return []; }
  const lines = sim.split('\n');
  const starts: number[] = [];
  lines.forEach((l, i) => { if (l.startsWith('check(')) starts.push(i); });

  const cache = new Map<string, string | null>();
  const load = (rel: string): string | null => {
    if (!cache.has(rel)) {
      try { cache.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8')); } catch { cache.set(rel, null); }
    }
    return cache.get(rel) ?? null;
  };

  const out: WeakWindow[] = [];
  for (let b = 0; b < starts.length; b += 1) {
    const from = starts[b];
    const to = b + 1 < starts.length ? starts[b + 1] : lines.length;
    const rawBlock = lines.slice(from, to).join('\n');
    const label = (/^check\('([^']+)'/.exec(rawBlock)?.[1] ?? '?').slice(0, 60);
    const body = strip(rawBlock);

    const bind = new Map<string, string>();
    for (const m of body.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*read(?:Code)?\('([^']+)'\)/g)) {
      bind.set(m[1], m[2]);
    }

    for (const m of body.matchAll(/\/((?:[^/\\\n]|\\.)+?)\/\.test\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
      const pattern = m[1];
      if (!/\[\\s\\S\]\{0,\d+\}\?/.test(pattern)) continue;
      const rel = bind.get(m[2]);
      if (!rel) continue;                       // cannot resolve the file — do not guess
      const srcRaw = load(rel);
      if (!srcRaw) continue;
      const src = strip(srcRaw);

      const parts = pattern.split(/\[\\s\\S\]\{0,(\d+)\}\?/);
      if (parts.length < 3) continue;
      const pre = parts[0];
      const n = Number(parts[1]);
      const post = parts.slice(2).join('');
      if (!pre.trim() || !post.trim()) continue;

      let preRe: RegExp;
      let postRe: RegExp;
      try { preRe = new RegExp(pre); postRe = new RegExp(post, 'g'); } catch { continue; }
      const pm = preRe.exec(src);
      if (!pm) continue;

      const after = src.slice(pm.index + pm[0].length, pm.index + pm[0].length + n);
      const occurrences = (after.match(postRe) ?? []).length;
      if (occurrences > 1) out.push({ label, file: rel, window: n, occurrences, post: post.slice(0, 60) });
    }
  }
  return out;
}

/**
 * FROZEN AT EMPTY, which is the whole point of adding it now.
 *
 * The sweep found none surviving once today's three were fixed, so the baseline starts empty and a
 * new one fails on the day it is written rather than the day it lets a bug through. If something
 * lands here later it needs a reason beside it, the same as the orphan and prose baselines — and
 * "the window is fine in practice" is not one, because that is exactly what was believed about the
 * three that were not.
 */
export const WEAK_WINDOW_BASELINE: string[] = [];
