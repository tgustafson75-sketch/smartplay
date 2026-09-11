/**
 * saysToPlayer — "does this screen still say this to the player?"
 *
 * 2026-09-11 — the jest counterpart of the helper in scripts/simulations/run-sim.ts, added for the
 * same reason and sharing its rules exactly.
 *
 * Four codemod passes moved ~2,400 English literals into locale keys. Every guard that proved a
 * screen still says something by GREPPING the .tsx for that sentence went red, and each one was
 * asserting the right thing through the wrong proxy: the presence of characters in a source file.
 *
 * The text counts as present if the file still holds the literal, OR if it calls t('some.key') and
 * en.json maps that key to the text. It is:
 *   - COMMENT-BLIND, because a sentence left behind in a comment is exactly how a guard ends up
 *     satisfied by its own documentation;
 *   - PLURAL-AWARE, because i18next stores `x_one`/`x_other` while the call site names only `x`;
 *   - strict about a key that resolves to NOTHING, which renders the raw key to the player and must
 *     read as a failure rather than a pass.
 */
import fs from 'fs';
import path from 'path';

const EN = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../i18n/locales/en.json'), 'utf8'),
) as Record<string, unknown>;

function lookup(key: string): string | undefined {
  const read = (k: string) => k.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    EN,
  );
  const direct = read(key);
  if (typeof direct === 'string') return direct;
  for (const suffix of ['_other', '_one']) {
    const v = read(`${key}${suffix}`);
    if (typeof v === 'string') return v;
  }
  return undefined;
}

export const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

export function saysToPlayer(src: string, text: string): boolean {
  const code = stripComments(src);
  if (code.includes(text)) return true;
  const want = text.trim().replace(/\s+/g, ' ');
  for (const m of code.matchAll(/\bt\(\s*['"`]([\w.]+)['"`]/g)) {
    const v = lookup(m[1]);
    if (v && v.replace(/\s+/g, ' ').includes(want)) return true;
  }
  return false;
}

/** Read a repo file relative to the project root. */
export const readSrc = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
