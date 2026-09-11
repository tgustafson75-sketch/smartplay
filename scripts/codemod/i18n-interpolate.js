#!/usr/bin/env node
/**
 * i18n-interpolate — turn a sentence split around an interpolation into ONE translatable string.
 *
 * 2026-09-11 (release 1.5, phase 2b). The first codemod deliberately refused these:
 *
 *     <Text>Welcome back, {welcomeName}</Text>
 *
 * Keying the JSXText alone produces "Welcome back," — half a sentence, handed to a translator with
 * no way to know what follows, and unfixable in Japanese where the name and the greeting invert.
 * Refusing was right. Guessing the variable name was the part a machine could not do safely.
 *
 * It can do it safely for a NARROW case, which is what this pass takes: every interpolation in the
 * element is a bare identifier or a simple member expression, so the variable has an obvious,
 * stable name. Those become:
 *
 *     <Text>{t('key', { welcomeName })}</Text>      en.json: "Welcome back, {{welcomeName}}"
 *
 * ANYTHING ELSE IS STILL REFUSED — a conditional, a call, a template literal, a nested ternary.
 * Those carry a judgement about what the sentence means, and a wrong guess there is a sentence that
 * reads fine in English and is nonsense in Japanese.
 *
 *   node scripts/codemod/i18n-interpolate.js --dry
 *   node scripts/codemod/i18n-interpolate.js --write
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

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}
function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
const ENTITIES = { '&apos;': "'", '&#39;': "'", '&rsquo;': '’', '&quot;': '"', '&amp;': '&',
  '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&middot;': '·' };
const decode = (s) => String(s).replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
const jsString = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
const snake = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '').toLowerCase();

function namespaceFor(rel) {
  let p = rel.replace(/\\/g, '/').replace(/\.tsx$/, '').replace(/^(app|components)\//, '');
  const parts = p.split('/').filter((s) => !/^\(.*\)$/.test(s)).filter((s) => !/^\[.*\]$/.test(s)).filter(Boolean);
  let last = parts.pop() ?? 'screen';
  if (last === 'index') last = parts.pop() ?? 'index';
  const parent = parts.length ? parts[parts.length - 1] : '';
  return (parent && parent !== last ? `${snake(parent)}_${snake(last)}` : snake(last)) || 'screen';
}
function slugFor(text) {
  const w = text.trim().toLowerCase().replace(/\{\{\w+\}\}/g, ' ').replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/).filter(Boolean);
  return w.slice(0, 5).join('_').slice(0, 44).replace(/_+$/, '') || 'text';
}
function elementName(node) {
  const n = node?.name;
  if (!n) return '';
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${n.object?.name ?? ''}.${n.property?.name ?? ''}`;
  return '';
}

/** A variable name for an interpolation, or null when the expression is too complex to name. */
function varNameFor(expr) {
  if (!expr) return null;
  if (expr.type === 'Identifier') return expr.name;
  if (expr.type === 'MemberExpression' && !expr.computed && expr.property?.type === 'Identifier') {
    // r.totalScore -> totalScore ; profile.firstName -> firstName
    return expr.property.name;
  }
  return null;
}


/**
 * 2026-09-11 — A CLASS COMPONENT CANNOT HOLD A HOOK, AND THE ONE THAT CAUGHT THIS IS THE ROOT
 * ERROR BOUNDARY.
 *
 * The interpolation pass inserted `const { t } = useTranslation()` into components/ErrorBoundary,
 * which is a React CLASS. React throws on a hook called from a class method, so the boundary that
 * exists to catch render crashes would itself crash the app — the exact field-fatal shape an OTA
 * cannot recover from, because a launch crash cannot download the next update.
 *
 * Caught by the repo's rules-of-hooks LOCK before it left the machine. Both codemods now refuse any
 * function whose enclosing scope is a class body.
 */
function isInsideClassComponent(nodePath) {
  let p = nodePath;
  while (p) {
    const t = p.node?.type;
    if (t === 'ClassDeclaration' || t === 'ClassExpression' || t === 'ClassBody' ||
        t === 'ClassMethod' || t === 'ClassProperty' || t === 'ClassPrivateMethod') return true;
    p = p.parentPath;
  }
  return false;
}

const stats = { files: 0, changed: 0, sentences: 0, refused: 0 };
const newKeys = new Map();
const refusedRows = [];

function run(abs) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (shared.isOwnerScreen(rel)) return;
  const src = fs.readFileSync(abs, 'utf8');
  if (!/\bt\(/.test(src) && !/useTranslation/.test(src)) { /* still fine: hook added below */ }

  let ast;
  try {
    ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript', 'classProperties'] });
  } catch (e) { refusedRows.push({ file: rel, line: 0, text: `parse error: ${e.message.split('\n')[0]}` }); return; }

  const ns = namespaceFor(rel);
  const edits = [];
  const hookFor = new Map();
  let hasImport = /from\s+['"]react-i18next['"]/.test(src);

  traverse(ast, {
    JSXElement(p) {
      const open = p.node.openingElement;
      if (!shared.isTextComponentName(elementName(open))) return;
      const kids = p.node.children ?? [];
      if (kids.length < 2) return;

      // Must be text + interpolations only, and at least one of each.
      let hasText = false, hasExpr = false;
      const parts = [];
      const vars = new Map();
      for (const c of kids) {
        if (c.type === 'JSXText') {
          const v = decode(c.value).replace(/\s+/g, ' ');
          if (v.trim()) hasText = true;
          parts.push({ kind: 'text', v });
        } else if (c.type === 'JSXExpressionContainer') {
          if (c.expression?.type === 'JSXEmptyExpression') { parts.push({ kind: 'text', v: '' }); continue; }
          const name = varNameFor(c.expression);
          if (!name) { parts.push({ kind: 'complex' }); hasExpr = true; continue; }
          hasExpr = true;
          vars.set(name, src.slice(c.expression.start, c.expression.end));
          parts.push({ kind: 'var', name });
        } else return;   // nested elements — out of scope
      }
      if (!hasText || !hasExpr) return;
      /**
       * Only NOW is this a sentence worth reporting. Refusing inside the loop counted every
       * `<Text>{formatSomething(x)}</Text>` — an element with no hardcoded text at all — as a
       * refusal, inflating the triage list to 676 entries the reader would have to discard by hand.
       */
      if (parts.some((x) => x.kind === 'complex')) return refuse(p, kids, src, rel, refusedRows);

      const english = parts.map((x) => (x.kind === 'text' ? x.v : `{{${x.name}}}`)).join('').trim();
      /**
       * THERE MUST BE WORDS TO TRANSLATE, and the placeholder NAMES are not words.
       *
       * Testing the whole string let `{{pct}}%` and `{{source}}` through — the letters came from the
       * variable name. Those are not sentences: a translator would be handed "{{pct}}%" and could
       * only hand it back, while the key itself ("…row.text") says nothing about what it holds.
       * Strip the placeholders first, then require two consecutive letters of real prose.
       */
      const prose = english.replace(/\{\{\w+\}\}/g, ' ');
      if (!/[A-Za-z]{2}/.test(prose)) return;

      // The component must be able to call t().
      const fn = p.getFunctionParent();
      if (!fn || fn.node.body.type !== 'BlockStatement') return refuse(p, kids, src, rel, refusedRows);
      if (isInsideClassComponent(fn)) return refuse(p, kids, src, rel, refusedRows);
      const binding = p.scope.getBinding('t');
      if (binding) {
        const init = binding.path.node?.init;
        const ok = init?.type === 'CallExpression' && init.callee?.name === 'useTranslation';
        if (!ok) return refuse(p, kids, src, rel, refusedRows);
      } else if (!/useTranslation\(/.test(src.slice(fn.node.body.start, fn.node.body.end))) {
        hookFor.set(fn.node, fn.node.body.start + 1);
      }

      const base = `${ns}.${snake(componentName(fn) || 'text')}.${slugFor(english)}`;
      let key = base, n = 2;
      while (newKeys.has(key) && newKeys.get(key) !== english) key = `${base}_${n++}`;
      newKeys.set(key, english);

      const argList = [...vars.entries()]
        .map(([name, expr]) => (name === expr ? name : `${name}: ${expr}`)).join(', ');
      const first = kids[0], last = kids[kids.length - 1];
      edits.push({ start: first.start, end: last.end, text: `{t(${jsString(key)}, { ${argList} })}` });
      stats.sentences++;
    },
  });

  function componentName(fnPath) {
    const n = fnPath.node;
    if (n.id?.name) return n.id.name;
    const par = fnPath.parent;
    if (par?.type === 'VariableDeclarator' && par.id?.type === 'Identifier') return par.id.name;
    return null;
  }

  if (!edits.length) return;
  for (const [, at] of hookFor) edits.push({ start: at, end: at, text: `\n  const { t } = useTranslation();` });
  if (!hasImport) {
    let lastEnd = 0;
    for (const node of ast.program.body) if (node.type === 'ImportDeclaration') lastEnd = node.end;
    edits.push({ start: lastEnd, end: lastEnd, text: `\nimport { useTranslation } from 'react-i18next';` });
  }
  edits.sort((a, b) => (b.start - a.start) || (b.end - a.end));
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  stats.changed++;
  if (WRITE) fs.writeFileSync(abs, out, 'utf8');
}

function refuse(p, kids, src, rel, rows) {
  stats.refused++;
  const whole = kids.map((c) => {
    if (c.type === 'JSXText') return decode(c.value).replace(/\s+/g, ' ');
    if (c.type === 'JSXExpressionContainer' && c.expression?.type !== 'JSXEmptyExpression') {
      const inner = src.slice(c.expression.start, c.expression.end).replace(/\s+/g, ' ');
      return `{${inner.length > 40 ? `${inner.slice(0, 37)}…` : inner}}`;
    }
    return '';
  }).join('').trim();
  rows.push({ file: rel, line: p.node.loc?.start.line ?? 0, text: whole.slice(0, 140) });
}

const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))].sort();
for (const f of files) { stats.files++; run(f); }

if (WRITE && newKeys.size) {
  const en = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));
  let added = 0;
  for (const [dotted, value] of newKeys) {
    const parts = dotted.split('.');
    let node = en;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    const leaf = parts[parts.length - 1];
    if (!(leaf in node)) { node[leaf] = value; added++; }
  }
  fs.writeFileSync(EN_PATH, `${JSON.stringify(en, null, 2)}\n`, 'utf8');
  console.log(`en.json: +${added} interpolated sentences`);
}

console.log(JSON.stringify({ mode: WRITE ? 'WRITE' : 'DRY', ...stats, newKeys: newKeys.size }, null, 2));
fs.writeFileSync(path.join(ROOT, 'scripts/codemod/.i18n-refused.json'), JSON.stringify(refusedRows, null, 2));
console.log('refused (needs a human) -> scripts/codemod/.i18n-refused.json');
