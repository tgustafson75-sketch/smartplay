#!/usr/bin/env node
/**
 * i18n-extract — rewrite hardcoded user-facing strings to t() calls.
 *
 * 2026-09-11 (release 1.5, Localization Layer). Phase 2 of the release: phase 1 landed the ESLint
 * gate that makes NEW literals fail; this clears the 2,732-violation backlog the gate inherited.
 *
 * WHAT IT DOES
 *   1. Finds exactly what eslint-rules/no-hardcoded-jsx-text flags — the predicates are shared via
 *      eslint-rules/i18n-shared.js, so the gate and this tool cannot disagree.
 *   2. Reuses an EXISTING key when the English value already lives in i18n/locales/en.json. That is
 *      what keeps the 178 keys three campaigns already translated from being duplicated under new
 *      names, and it means es/zh coverage carries straight over for those strings.
 *   3. Generates `screen.section.purpose` keys for the rest — derived from the file path, the
 *      enclosing component, and the text itself, so they are stable across runs and readable in a
 *      locale file. Never key1/key2.
 *   4. Adds `useTranslation` where missing.
 *
 * HOW IT EDITS: byte-offset replacement against the original source, applied in reverse order. It
 * does NOT print from the AST. A printer would reformat all 172 files and bury the real change in
 * whitespace noise, making the rewrite commit impossible to review or revert cleanly.
 *
 * WHAT IT REFUSES TO DO: anything it cannot prove is safe. A string outside a React component has
 * nowhere to get `t` from; a concise-body arrow has no block to insert the hook into. Those are
 * REPORTED, not guessed at. Hand-editing them is a triage decision, not a codemod's call.
 *
 * Usage:
 *   node scripts/codemod/i18n-extract.js --dry     # report only, writes nothing
 *   node scripts/codemod/i18n-extract.js --write   # apply
 */
'use strict';

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default ?? traverseModule;

const shared = require('../../eslint-rules/i18n-shared');
const ROOT = path.resolve(__dirname, '../..');
const EN_PATH = path.join(ROOT, 'i18n/locales/en.json');

const WRITE = process.argv.includes('--write');

// ─── file discovery ──────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

// ─── existing keys ───────────────────────────────────────────────────────────
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
const enFlat = flatten(JSON.parse(fs.readFileSync(EN_PATH, 'utf8')));
/** English value -> existing key. Normalised so whitespace differences still match. */
const valueToKey = new Map();
for (const [k, v] of Object.entries(enFlat)) {
  if (typeof v === 'string') {
    const norm = v.trim().replace(/\s+/g, ' ');
    if (!valueToKey.has(norm)) valueToKey.set(norm, k);
  }
}

// ─── text handling ───────────────────────────────────────────────────────────
const ENTITIES = {
  '&apos;': "'", '&#39;': "'", '&rsquo;': '’', '&lsquo;': '‘',
  '&quot;': '"', '&#34;': '"', '&ldquo;': '“', '&rdquo;': '”',
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ',
  '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&middot;': '·',
};
/** JSX text carries HTML entities; a locale file must hold the CHARACTER, not `&apos;`. */
function decodeEntities(s) {
  return String(s).replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}
function jsString(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

// ─── key generation ──────────────────────────────────────────────────────────
function snake(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/** `app/(tabs)/play.tsx` -> `play`; `app/recap/hole/[round_id]/[hole].tsx` -> `recap_hole`. */
function namespaceFor(relPath) {
  let p = relPath.replace(/\\/g, '/').replace(/\.tsx$/, '');
  p = p.replace(/^(app|components)\//, '');
  const parts = p.split('/')
    .filter((seg) => !/^\(.*\)$/.test(seg))       // (tabs) route groups carry no meaning
    .filter((seg) => !/^\[.*\]$/.test(seg))       // [round_id] is a value, not a name
    .filter(Boolean);
  let last = parts.pop() ?? 'screen';
  if (last === 'index') last = parts.pop() ?? 'index';
  const parent = parts.length ? parts[parts.length - 1] : '';
  const ns = parent && parent !== last ? `${snake(parent)}_${snake(last)}` : snake(last);
  return ns || 'screen';
}

/** First few words of the text, as a readable slug. */
function slugFor(text) {
  const words = decodeEntities(text).trim().toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/).filter(Boolean);
  const slug = words.slice(0, 5).join('_').slice(0, 44).replace(/_+$/, '');
  return slug || 'text';
}

// ─── per-file transform ──────────────────────────────────────────────────────
const stats = {
  filesScanned: 0, filesChanged: 0, filesSkippedOwner: 0,
  rewritten: 0, reusedKeys: 0, newKeys: 0,
};
const newKeyValues = new Map();   // key -> english value
const skipped = [];               // { file, line, text, reason }
const failedFiles = [];           // { file, reason }
const fragmentSeen = new Set();   // one triage entry per JSX element, not per fragment

function elementName(node) {
  const n = node?.name;
  if (!n) return '';
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${n.object?.name ?? ''}.${n.property?.name ?? ''}`;
  return '';
}
function calleeName(node) {
  const c = node.callee;
  if (!c) return '';
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression') {
    const o = c.object?.name ?? (c.object?.type === 'MemberExpression' ? c.object.property?.name : '');
    return `${o ?? ''}.${c.property?.name ?? ''}`;
  }
  return '';
}

/**
 * Walk up to the function that should own `const { t } = useTranslation()`.
 * A React component here means: a function whose name starts uppercase. Hooks may only be called
 * from one, which is exactly why a string outside one cannot be rewritten.
 */
function findOwningComponent(nodePath) {
  let fn = nodePath.getFunctionParent();
  const chain = [];
  while (fn) {
    chain.push(fn);
    const name = componentNameOf(fn);
    if (name && /^[A-Z]/.test(name)) return { fn, name };
    fn = fn.getFunctionParent();
  }
  return { fn: null, name: null, chain };
}
function componentNameOf(fnPath) {
  const n = fnPath.node;
  if (n.id?.name) return n.id.name;
  const p = fnPath.parent;
  if (p?.type === 'VariableDeclarator' && p.id?.type === 'Identifier') return p.id.name;
  if (p?.type === 'ExportDefaultDeclaration') return 'default';
  return null;
}

function transformFile(absPath) {
  const rel = path.relative(ROOT, absPath).replace(/\\/g, '/');
  const src = fs.readFileSync(absPath, 'utf8');

  let ast;
  try {
    ast = parser.parse(src, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
    });
  } catch (e) {
    failedFiles.push({ file: rel, reason: `parse error: ${e.message.split('\n')[0]}` });
    return;
  }

  const edits = [];                 // { start, end, text }
  const componentsNeedingHook = new Map();  // fnNode -> { bodyStart, name }
  let hasUseTranslationImport = /from\s+['"]react-i18next['"]/.test(src);
  const ns = namespaceFor(rel);
  const usedKeys = new Map();       // key -> value, within this file

  /** Reuse an existing locale key, else mint `ns.section.slug`. */
  function keyFor(rawText, section) {
    const value = decodeEntities(rawText).trim().replace(/\s+/g, ' ');
    const existing = valueToKey.get(value);
    if (existing) { stats.reusedKeys++; return { key: existing, value, reused: true }; }
    const base = `${ns}.${snake(section || 'text') || 'text'}.${slugFor(value)}`;
    let key = base, n = 2;
    while ((newKeyValues.has(key) && newKeyValues.get(key) !== value) ||
           (usedKeys.has(key) && usedKeys.get(key) !== value)) { key = `${base}_${n++}`; }
    if (!newKeyValues.has(key)) { newKeyValues.set(key, value); stats.newKeys++; }
    usedKeys.set(key, value);
    return { key, value, reused: false };
  }

  function requireHook(nodePath, rawText, line) {
    const { fn, name } = findOwningComponent(nodePath);
    if (!fn) {
      skipped.push({ file: rel, line, text: decodeEntities(rawText).trim().slice(0, 60),
        reason: 'not inside a React component — no scope to call useTranslation() from' });
      return null;
    }
    const body = fn.node.body;
    if (body.type !== 'BlockStatement') {
      skipped.push({ file: rel, line, text: decodeEntities(rawText).trim().slice(0, 60),
        reason: `component ${name} has a concise arrow body — needs a block to hold the hook` });
      return null;
    }
    // Already has `t` in scope?
    const hasT = fn.scope.hasBinding('t') ||
      new RegExp(`useTranslation\\(`).test(src.slice(body.start, body.end));
    if (!hasT) componentsNeedingHook.set(fn.node, { bodyStart: body.start + 1, name });
    return name;
  }

  traverse(ast, {
    JSXText(p) {
      const raw = p.node.value;
      if (!shared.looksLikeProse(raw)) return;
      const parent = p.parent;
      if (parent?.type !== 'JSXElement') return;
      if (!shared.isTextComponentName(elementName(parent.openingElement))) return;

      const line = p.node.loc?.start.line ?? 0;

      /**
       * A SENTENCE FRAGMENT IS NOT A TRANSLATABLE UNIT — refuse it.
       *
       * `<Text>({dist}y off)</Text>` gives a JSXText of "y off)". Keying that produces
       * `undo_mark_banner.text.y_off = "y off)"`, and a Japanese translator is handed half a
       * sentence with no way to know what precedes it. Worse, Japanese puts the counter and the
       * particle in a different order, so no translation of the fragment can be correct for every
       * value of {dist}. The fix is interpolation — t('key', { dist }) with `{{dist}}` in the
       * locale value — which is a judgement about the sentence, not a mechanical rewrite.
       *
       * So: if this text shares its parent with a DYNAMIC expression, skip and report it.
       */
      const siblings = parent.children ?? [];
      const hasDynamicSibling = siblings.some((c) =>
        c.type === 'JSXExpressionContainer' &&
        c.expression?.type !== 'JSXEmptyExpression' &&
        !((c.expression?.type === 'StringLiteral' || c.expression?.type === 'Literal') &&
          typeof c.expression.value === 'string'));
      if (hasDynamicSibling) {
        /**
         * Report the WHOLE sentence, not the fragment. A triage list of 'y off)' and '". Try a
         * different name.' is unreadable; the same list showing
         *   No courses found for "{query}". Try a different name.
         * can be decided on in a second. Fragments of one element collapse to one entry.
         */
        const whole = siblings.map((c) => {
          if (c.type === 'JSXText') return decodeEntities(c.value).replace(/\s+/g, ' ');
          if (c.type === 'JSXExpressionContainer') {
            const inner = src.slice(c.expression.start, c.expression.end).replace(/\s+/g, ' ');
            return `{${inner.length > 40 ? `${inner.slice(0, 37)}…` : inner}}`;
          }
          return '';
        }).join('').trim();
        const id = `${rel}:${parent.loc?.start.line ?? line}`;
        if (!fragmentSeen.has(id)) {
          fragmentSeen.add(id);
          skipped.push({ file: rel, line: parent.loc?.start.line ?? line, text: whole.slice(0, 140),
            reason: 'sentence fragment split by an interpolation — needs t(key, { var }), a human call' });
        }
        return;
      }
      const section = componentSection(p);
      if (requireHook(p, raw, line) === null) return;
      const { key } = keyFor(raw, section);
      // Preserve the exact surrounding whitespace; swap only the visible text.
      const lead = raw.match(/^\s*/)[0];
      const trail = raw.match(/\s*$/)[0];
      edits.push({ start: p.node.start, end: p.node.end, text: `${lead}{t(${jsString(key)})}${trail}` });
      stats.rewritten++;
    },

    JSXExpressionContainer(p) {
      if (p.parent?.type !== 'JSXElement') return;               // child, not an attribute value
      const expr = p.node.expression;
      let raw = null;
      if (expr?.type === 'Literal' || expr?.type === 'StringLiteral') raw = expr.value;
      else if (expr?.type === 'TemplateLiteral' && expr.expressions.length === 0) raw = expr.quasis[0]?.value?.cooked;
      if (typeof raw !== 'string' || !shared.looksLikeProse(raw)) return;
      if (!shared.isTextComponentName(elementName(p.parent.openingElement))) return;

      const line = p.node.loc?.start.line ?? 0;
      if (requireHook(p, raw, line) === null) return;
      const { key } = keyFor(raw, componentSection(p));
      edits.push({ start: p.node.start, end: p.node.end, text: `{t(${jsString(key)})}` });
      stats.rewritten++;
    },

    JSXAttribute(p) {
      const prop = p.node.name?.name;
      if (typeof prop !== 'string') return;
      if (shared.IGNORED_PROPS.includes(prop)) return;
      if (!shared.USER_FACING_PROPS.includes(prop)) return;

      const v = p.node.value;
      let raw = null, replaceStart, replaceEnd;
      if ((v?.type === 'StringLiteral' || v?.type === 'Literal') && typeof v.value === 'string') {
        raw = v.value; replaceStart = v.start; replaceEnd = v.end;
      } else if (v?.type === 'JSXExpressionContainer' &&
                 (v.expression?.type === 'StringLiteral' || v.expression?.type === 'Literal') &&
                 typeof v.expression.value === 'string') {
        raw = v.expression.value; replaceStart = v.start; replaceEnd = v.end;
      }
      if (raw == null || !shared.looksLikeProse(raw)) return;

      const line = p.node.loc?.start.line ?? 0;
      if (requireHook(p, raw, line) === null) return;
      const { key } = keyFor(raw, prop);
      edits.push({ start: replaceStart, end: replaceEnd, text: `{t(${jsString(key)})}` });
      stats.rewritten++;
    },

    CallExpression(p) {
      if (!shared.ALERT_CALLEES.includes(calleeName(p.node))) return;
      for (const arg of p.node.arguments) {
        const isStr = (arg.type === 'StringLiteral' || arg.type === 'Literal') && typeof arg.value === 'string';
        if (!isStr || !shared.looksLikeProse(arg.value)) continue;
        const line = arg.loc?.start.line ?? 0;
        if (requireHook(p, arg.value, line) === null) continue;
        const { key } = keyFor(arg.value, 'alert');
        edits.push({ start: arg.start, end: arg.end, text: `t(${jsString(key)})` });
        stats.rewritten++;
      }
    },
  });

  /** Nearest enclosing component name, used as the `section` segment of a generated key. */
  function componentSection(p) {
    const { name } = findOwningComponent(p);
    if (!name || name === 'default') return 'text';
    const s = snake(name);
    return s === ns ? 'text' : s;
  }

  if (!edits.length) return;

  // Insert the hook at the top of each component that needs it.
  for (const [, info] of componentsNeedingHook) {
    edits.push({ start: info.bodyStart, end: info.bodyStart, text: `\n  const { t } = useTranslation();` });
  }
  // Insert the import after the last top-level import.
  if (!hasUseTranslationImport) {
    let lastImportEnd = 0;
    for (const node of ast.program.body) if (node.type === 'ImportDeclaration') lastImportEnd = node.end;
    edits.push({ start: lastImportEnd, end: lastImportEnd, text: `\nimport { useTranslation } from 'react-i18next';` });
    hasUseTranslationImport = true;
  }

  // Apply in reverse so earlier offsets stay valid. Insertions sort after replacements at the
  // same offset so a hook lands inside the brace it belongs to.
  edits.sort((a, b) => (b.start - a.start) || (b.end - a.end));
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  stats.filesChanged++;
  if (WRITE) fs.writeFileSync(absPath, out, 'utf8');
}

// ─── run ─────────────────────────────────────────────────────────────────────
const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))].sort();
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  stats.filesScanned++;
  if (shared.isOwnerScreen(rel)) { stats.filesSkippedOwner++; continue; }
  transformFile(f);
}

const report = {
  mode: WRITE ? 'WRITE' : 'DRY RUN',
  ...stats,
  newKeyCount: newKeyValues.size,
  skippedCount: skipped.length,
  parseFailures: failedFiles.length,
};
console.log(JSON.stringify(report, null, 2));

fs.writeFileSync(path.join(ROOT, 'scripts/codemod/.i18n-newkeys.json'),
  JSON.stringify(Object.fromEntries([...newKeyValues].sort()), null, 2));
fs.writeFileSync(path.join(ROOT, 'scripts/codemod/.i18n-skipped.json'),
  JSON.stringify({ skipped, failedFiles }, null, 2));
console.log('\nnew keys  -> scripts/codemod/.i18n-newkeys.json');
console.log('skipped   -> scripts/codemod/.i18n-skipped.json');
