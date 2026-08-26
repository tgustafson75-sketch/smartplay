/**
 * 2026-08-25 — EVERY require()'d ASSET MUST EXIST ON DISK.
 *
 * Found the hard way. Deleting Tank's images left two `require()` calls behind in
 * data/drillCatalog.ts — on a drill card that was already HIDDEN, so no player could see it — and
 * nothing caught it: TypeScript does not resolve asset requires, and Jest mocks them. The first
 * thing that would have noticed is the Metro bundler, during the production build, at the worst
 * possible moment before an App Store submission.
 *
 * A hidden card still bundles its assets. "Not visible" is not "not loaded".
 *
 * Cheap to run and impossible to argue with: read every require('...png'|'.jpg'|'.mp3'|...) in the
 * source tree and stat the file.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SKIP = new Set(['node_modules', '.git', 'ios', 'android', '.expo', 'dist', 'coverage']);
const ASSET_EXT = /\.(png|jpg|jpeg|gif|webp|mp3|mp4|wav|m4a|ttf|otf|json)$/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every require('<relative asset path>') whose target is missing on disk. */
export function findMissingAssetRequires(): string[] {
  const missing: string[] = [];
  for (const file of walk(ROOT)) {
    /**
     * Comments stripped first. A doc block showing the SHAPE of a require —
     * `require('../assets/swing-references/<category>/illustration.png')` in swingReferences' own
     * "how to add one" instructions — is not a require, and flagging it would train everyone to
     * ignore this check. Same lesson as the prose-assertion sweep: a file's description of itself
     * is not its behaviour.
     */
    const src = fs.readFileSync(file, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const rel = m[1]!;
      if (!ASSET_EXT.test(rel)) continue;            // module requires resolve through TS, not here
      const resolved = path.resolve(path.dirname(file), rel);
      if (!fs.existsSync(resolved)) {
        missing.push(`${path.relative(ROOT, file)} :: ${rel}`);
      }
    }
  }
  return missing.sort();
}
