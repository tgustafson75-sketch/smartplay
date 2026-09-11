#!/usr/bin/env node
/**
 * i18n guard, restricted to the lines this commit actually adds.
 *
 * 2026-09-11 — WHY THIS EXISTS RATHER THAN `eslint <staged files>`.
 *
 * The first pre-commit wiring linted whole staged files. It then blocked a comment-only deletion in
 * app/swinglab/smartmotion.tsx by reporting 39 violations that were already there and had nothing to
 * do with the change. A gate that fails work it has no quarrel with is a gate that gets bypassed,
 * and a bypassed gate is how the last two translation campaigns rotted.
 *
 * So: run the rule over the staged content, then keep only the reports that land on a line this
 * commit ADDS. Pre-existing violations in a file you happened to touch are not your problem; a new
 * hardcoded string is, wherever you put it.
 *
 * Exits 1 with a report when a new violation is found, 0 otherwise.
 */
import { execFileSync } from 'node:child_process';
import { ESLint } from 'eslint';

const RULE = 'i18n/no-hardcoded-jsx-text';

/**
 * Two callers, one rule. The pre-commit hook reads the staged index; CI passes a commit range via
 * I18N_BASE/I18N_HEAD. Keeping both on this script is deliberate — the hook and the workflow
 * disagreeing about what counts as "new" is how a gate ends up protecting a path nobody uses.
 */
const BASE = process.env.I18N_BASE ?? '';
const HEAD = process.env.I18N_HEAD ?? '';
const RANGE = BASE && HEAD ? [BASE, HEAD] : null;
const diffArgs = (extra) => RANGE
  ? ['diff', ...extra, ...RANGE, '--', ':(glob)app/**/*.tsx', ':(glob)components/**/*.tsx']
  : ['diff', '--cached', ...extra, '--', ':(glob)app/**/*.tsx', ':(glob)components/**/*.tsx'];

const files = execFileSync('git', diffArgs(['--name-only', '--diff-filter=ACMR']), { encoding: 'utf8' })
  .split('\n').filter(Boolean);

if (files.length === 0) process.exit(0);

/** Line numbers ADDED by the staged diff, per file, from a zero-context unified diff. */
function addedLines(file) {
  const args = RANGE
    ? ['diff', '-U0', ...RANGE, '--', file]
    : ['diff', '--cached', '-U0', '--', file];
  const diff = execFileSync('git', args, { encoding: 'utf8' });
  const lines = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) lines.add(start + i);
  }
  return lines;
}

const eslint = new ESLint();
const results = await eslint.lintFiles(files);

const offences = [];
for (const res of results) {
  const rel = res.filePath.replace(`${process.cwd()}/`, '');
  const added = addedLines(rel);
  for (const m of res.messages) {
    if (m.ruleId !== RULE) continue;
    if (!added.has(m.line)) continue;          // pre-existing — not this commit's doing
    offences.push(`  ${rel}:${m.line}:${m.column}  ${m.message}`);
  }
}

if (offences.length) {
  console.error(offences.join('\n'));
  process.exit(1);
}
process.exit(0);
