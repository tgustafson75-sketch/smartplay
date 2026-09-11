#!/usr/bin/env node
/**
 * i18n-values — the third and last mechanical pass.
 *
 * 2026-09-11. Pass 2 (i18n-interpolate) only accepted an interpolation it could NAME: a bare
 * identifier or a simple member expression. That left 156 sentences refused. Looking at what they
 * actually are, most were refused for a reason that does not survive inspection:
 *
 *   {Math.round(weather.wind_speed_mph)} mph        the expression yields a VALUE
 *   No courses found for "{query.trim()}".          …evaluated at the CALL SITE
 *   {canvasCount - centerCount} edge                …so complexity is irrelevant
 *
 * Whatever shape the expression has, `t(key, { x: <expr> })` evaluates it exactly where it sat. The
 * only thing pass 2 lacked was a NAME, and a name can be derived: the last identifier that is not a
 * method call, falling back to `value`.
 *
 * It also handles the one shape that genuinely needed a translation feature rather than a rename:
 *
 *   {dayStreak} day{dayStreak === 1 ? '' : 's'}
 *
 * English pluralisation welded into JSX. Japanese and Korean have no plural 's', so no per-branch
 * translation can be right. i18next owns this: `t(key, { count })` with `key_one`/`key_other`, and a
 * locale that does not inflect simply supplies `_other`. That is the correct representation, not a
 * workaround.
 *
 * STILL REFUSED, and deliberately: a ternary that appends or swaps TEXT mid-sentence
 * ({unit === 'carry' ? 'carries' : 'distances'}). That is a judgement about what the sentence means
 * in another language, and a machine guessing it produces fluent nonsense.
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
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.tsx')) out.push(p);
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
/**
 * i18next reads a trailing _zero/_one/_two/_few/_many/_other as a PLURAL FORM, not as part of the
 * name. A sentence ending in the word "one" ("Capture one above") slugs to `…capture_one`, which is
 * indistinguishable from the singular half of a plural pair — and would resolve strangely the moment
 * anyone passed `count` to it. Five such keys were generated before this was noticed.
 */
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function slugFor(text) {
  const w = text.trim().toLowerCase().replace(/\{\{\w+\}\}/g, ' ').replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/).filter(Boolean);
  let slug = w.slice(0, 5).join('_').slice(0, 44).replace(/_+$/, '') || 'text';
  for (const suf of PLURAL_SUFFIXES) {
    if (slug.endsWith(`_${suf}`)) { slug = `${slug}_text`; break; }
  }
  return slug;
}
function elementName(node) {
  const n = node?.name;
  if (!n) return '';
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${n.object?.name ?? ''}.${n.property?.name ?? ''}`;
  return '';
}
function isInsideClassComponent(nodePath) {
  let p = nodePath;
  while (p) {
    const t = p.node?.type;
    if (t === 'ClassDeclaration' || t === 'ClassExpression' || t === 'ClassBody' ||
        t === 'ClassMethod' || t === 'ClassProperty') return true;
    p = p.parentPath;
  }
  return false;
}

/** Method names that describe HOW a value was produced, never what it IS. */
const NOISE = new Set(['round','trim','length','tofixed','toupperCase','touppercase','tolowercase',
  'map','filter','slice','join','replace','split','abs','max','min','floor','ceil','tostring',
  'math','number','string','json','object','array','date','now','getstate','current']);

/** A readable name for an interpolation, derived from the expression's own identifiers. */
function deriveName(exprSrc) {
  const ids = exprSrc.match(/[A-Za-z_$][\w$]*/g) ?? [];
  const useful = ids.filter((i) => !NOISE.has(i.toLowerCase()));
  const pick = useful.length ? useful[useful.length - 1] : null;
  if (!pick) return 'value';
  const n = snake(pick).replace(/^_+/, '');
  return n || 'value';
}

/** `x === 1 ? 'a' : 'b'` or `x !== 1 ? 'b' : 'a'` — English pluralisation welded into JSX. */
function pluralParts(expr, src) {
  if (expr?.type !== 'ConditionalExpression') return null;
  const test = expr.test;
  if (test?.type !== 'BinaryExpression') return null;
  const isEq = test.operator === '===' || test.operator === '==';
  const isNe = test.operator === '!==' || test.operator === '!=';
  if (!isEq && !isNe) return null;
  const one = [test.left, test.right].find((s) => s?.type === 'NumericLiteral' && s.value === 1);
  const countNode = [test.left, test.right].find((s) => s !== one);
  if (!one || !countNode) return null;
  const c = expr.consequent, a = expr.alternate;
  if (c?.type !== 'StringLiteral' || a?.type !== 'StringLiteral') return null;
  return {
    countSrc: src.slice(countNode.start, countNode.end),
    singular: isEq ? c.value : a.value,
    plural:   isEq ? a.value : c.value,
  };
}

const stats = { files: 0, changed: 0, values: 0, plurals: 0, refused: 0 };
const newKeys = new Map();
const refused = [];

function run(abs) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (shared.isOwnerScreen(rel)) return;
  const src = fs.readFileSync(abs, 'utf8');
  let ast;
  try { ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript', 'classProperties'] }); }
  catch { return; }

  const ns = namespaceFor(rel);
  const edits = [];
  const hookFor = new Map();
  let hasImport = /from\s+['"]react-i18next['"]/.test(src);

  traverse(ast, {
    JSXElement(p) {
      if (!shared.isTextComponentName(elementName(p.node.openingElement))) return;
      const kids = p.node.children ?? [];
      if (kids.length < 2) return;

      let hasText = false;
      const parts = [];
      const vars = new Map();
      let countExpr = null;
      const used = new Set();

      for (const c of kids) {
        if (c.type === 'JSXText') {
          const v = decode(c.value).replace(/\s+/g, ' ');
          if (v.trim()) hasText = true;
          parts.push({ k: 't', v });
          continue;
        }
        if (c.type !== 'JSXExpressionContainer') return;                 // nested element
        const e = c.expression;
        if (e?.type === 'JSXEmptyExpression') { parts.push({ k: 't', v: '' }); continue; }

        const pl = pluralParts(e, src);
        if (pl) {
          // The literal halves ARE the sentence; i18next selects between them by count.
          if (countExpr && countExpr !== pl.countSrc) return refuseIt(p, kids, src, rel);
          countExpr = pl.countSrc;
          parts.push({ k: 'plural', singular: pl.singular, plural: pl.plural });
          hasText = hasText || !!(pl.singular || pl.plural);
          continue;
        }
        if (e?.type === 'ConditionalExpression' &&
            (e.consequent?.type === 'StringLiteral' || e.alternate?.type === 'StringLiteral')) {
          return refuseIt(p, kids, src, rel);                            // text ternary — a judgement
        }
        if (e?.type === 'LogicalExpression' &&
            (e.right?.type === 'StringLiteral' || e.left?.type === 'StringLiteral')) {
          // `goal || '—'` yields a VALUE (the fallback is a glyph, not prose) — allow it.
        }
        const exprSrc = src.slice(e.start, e.end);
        let name = deriveName(exprSrc);
        while (used.has(name) && vars.get(name) !== exprSrc) name = /\d$/.test(name) ? name.replace(/\d+$/, (d) => String(+d + 1)) : `${name}2`;
        used.add(name);
        vars.set(name, exprSrc);
        parts.push({ k: 'v', name });
      }

      if (!hasText) return;
      if (!vars.size && !countExpr) return;

      /**
       * When the counted value is ALSO interpolated — `{dayStreak} day{dayStreak === 1 ? '' : 's'}`
       * — it is passed to i18next as `count`, not under its derived name. Writing `{{day_streak}}`
       * into the value while the call supplies `{ count }` leaves a placeholder nothing fills, and
       * the player sees the literal `{{day_streak}}`. The counted variable renders as {{count}}.
       */
      const placeholderFor = (name) => (countExpr && vars.get(name) === countExpr ? 'count' : name);
      const render = (which) => parts.map((x) => {
        if (x.k === 't') return x.v;
        if (x.k === 'v') return `{{${placeholderFor(x.name)}}}`;
        return which === 'one' ? x.singular : x.plural;
      }).join('').trim();
      const english = render('one');
      const englishPlural = render('other');

      const prose = english.replace(/\{\{\w+\}\}/g, ' ');
      if (!/[A-Za-z]{2}/.test(prose)) return;

      const fn = p.getFunctionParent();
      if (!fn || fn.node.body.type !== 'BlockStatement') return refuseIt(p, kids, src, rel);
      if (isInsideClassComponent(fn)) return refuseIt(p, kids, src, rel);
      const binding = p.scope.getBinding('t');
      if (binding) {
        const init = binding.path.node?.init;
        if (!(init?.type === 'CallExpression' && init.callee?.name === 'useTranslation')) return refuseIt(p, kids, src, rel);
      } else if (!/useTranslation\(/.test(src.slice(fn.node.body.start, fn.node.body.end))) {
        hookFor.set(fn.node, fn.node.body.start + 1);
      }

      const compName = fn.node.id?.name
        ?? (fn.parent?.type === 'VariableDeclarator' && fn.parent.id?.type === 'Identifier' ? fn.parent.id.name : null);
      const section = snake(compName || 'text') === ns ? 'text' : snake(compName || 'text');
      const base = `${ns}.${section}.${slugFor(english)}`;
      let key = base, n = 2;
      while (newKeys.has(key) && newKeys.get(key) !== english) key = `${base}_${n++}`;

      const args = [...vars.entries()]
        // `count` is added below for a plural; the same expression must not appear twice in the
        // object literal — `{ count, h, count }` is a TypeScript error, and it happened.
        .filter(([k, v]) => !(countExpr && (k === 'count' || v === countExpr)))
        .map(([k, v]) => (k === v ? k : `${k}: ${v}`));
      if (countExpr) {
        args.unshift(countExpr === 'count' ? 'count' : `count: ${countExpr}`);
        newKeys.set(`${key}_one`, english);
        newKeys.set(`${key}_other`, englishPlural);
        stats.plurals++;
      } else {
        newKeys.set(key, english);
        stats.values++;
      }
      edits.push({ s: kids[0].start, e: kids[kids.length - 1].end, t: `{t(${jsString(key)}, { ${args.join(', ')} })}` });
    },
  });

  if (!edits.length) return;
  for (const [, at] of hookFor) edits.push({ s: at, e: at, t: `\n  const { t } = useTranslation();` });
  if (!hasImport) {
    let lastEnd = 0;
    for (const node of ast.program.body) if (node.type === 'ImportDeclaration') lastEnd = node.end;
    edits.push({ s: lastEnd, e: lastEnd, t: `\nimport { useTranslation } from 'react-i18next';` });
  }
  edits.sort((a, b) => (b.s - a.s) || (b.e - a.e));
  let out = src;
  for (const ed of edits) out = out.slice(0, ed.s) + ed.t + out.slice(ed.e);
  stats.changed++;
  if (WRITE) fs.writeFileSync(abs, out, 'utf8');
}

function refuseIt(p, kids, src, rel) {
  stats.refused++;
  const whole = kids.map((c) => {
    if (c.type === 'JSXText') return decode(c.value).replace(/\s+/g, ' ');
    if (c.type === 'JSXExpressionContainer' && c.expression?.type !== 'JSXEmptyExpression') {
      const s = src.slice(c.expression.start, c.expression.end).replace(/\s+/g, ' ');
      return `{${s.length > 44 ? `${s.slice(0, 41)}…` : s}}`;
    }
    return '';
  }).join('').trim();
  refused.push({ file: rel, line: p.node.loc?.start.line ?? 0, text: whole.slice(0, 150) });
}

for (const f of [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))].sort()) { stats.files++; run(f); }

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
  console.log(`en.json: +${added}`);
}
console.log(JSON.stringify({ mode: WRITE ? 'WRITE' : 'DRY', ...stats, newKeys: newKeys.size }, null, 2));
fs.writeFileSync(path.join(ROOT, 'scripts/codemod/.i18n-refused.json'), JSON.stringify(refused, null, 2));
