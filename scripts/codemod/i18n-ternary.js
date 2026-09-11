#!/usr/bin/env node
/**
 * i18n-ternary — the last mechanical pass: a ternary that swaps or appends TEXT.
 *
 * 2026-09-11 (Tim: "make the call yourself"). Passes 1-3 cleared everything a machine could do
 * without deciding what a sentence MEANS. What is left is this shape:
 *
 *     <Text>{n} holes{r.isCompetition ? ' · competition' : ''}</Text>
 *     <Text>…now use these {unit === 'carry' ? 'carries' : 'distances'}</Text>
 *
 * The ternary is not a value — it is part of the prose, and its two branches are two different
 * sentences. Interpolating it would hand a translator a bare fragment ("carries") with no sentence
 * around it, which is the thing every earlier pass refused to do.
 *
 * THE DECISION, made deliberately and once: expand each branch into a COMPLETE sentence with its own
 * key, and let the condition choose between whole sentences.
 *
 *     {r.isCompetition ? t('…holes_competition', { n }) : t('…holes', { n })}
 *
 * A translator now sees two finished sentences and can reorder either one freely — which is the
 * entire point, because Japanese puts the qualifier before the noun and no amount of concatenation
 * would let it.
 *
 * Refused still: more than one text-ternary in the same element (2^n sentences, and the combinations
 * are rarely all real), and anything inside a class component.
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
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

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
  let slug = w.slice(0, 5).join('_').slice(0, 44).replace(/_+$/, '') || 'text';
  for (const suf of PLURAL_SUFFIXES) if (slug.endsWith(`_${suf}`)) { slug = `${slug}_text`; break; }
  return slug;
}
function elementName(node) {
  const n = node?.name;
  if (!n) return '';
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${n.object?.name ?? ''}.${n.property?.name ?? ''}`;
  return '';
}
function isInsideClass(p) {
  let q = p;
  while (q) {
    const t = q.node?.type;
    if (t === 'ClassDeclaration' || t === 'ClassExpression' || t === 'ClassBody' || t === 'ClassMethod') return true;
    q = q.parentPath;
  }
  return false;
}
const NOISE = new Set(['round','trim','length','tofixed','touppercase','tolowercase','map','filter',
  'slice','join','replace','split','abs','max','min','floor','ceil','tostring','math','number',
  'string','json','object','array','date','now','getstate','current']);
function deriveName(src) {
  const ids = src.match(/[A-Za-z_$][\w$]*/g) ?? [];
  const useful = ids.filter((i) => !NOISE.has(i.toLowerCase()));
  return snake(useful.length ? useful[useful.length - 1] : 'value').replace(/^_+/, '') || 'value';
}
/** A ternary (or `&&`) whose branches are prose, not values. */
/**
 * BOTH BRANCHES MUST BE PLAIN STRING LITERALS. This is the guard that was missing, and its absence
 * DELETED USER-FACING TEXT.
 *
 * app/settings.tsx held
 *     {watchBridgeAvailable
 *       ? `Captures every swing the watch sees … Pin yardage and the watch mic do not need this …`
 *       : 'The watch swing-capture module ships in the latest native build …'}
 *
 * The first branch is a TEMPLATE literal, not a string literal. The earlier version read it as
 * `null`, treated null as "this branch renders nothing", and emitted `''` — silently removing a
 * paragraph that explains to a player why their watch yardage is not on this switch. That paragraph
 * exists because of Tim's first Play Store round ("the yardage would not populate on my watch").
 *
 * A branch this pass cannot READ is a branch it must not REWRITE. Anything with a template literal,
 * a nested ternary, or a non-literal on either side is refused and reported.
 */
function textBranches(e) {
  const lit = (n) => (n?.type === 'StringLiteral' ? n.value : undefined);
  if (e?.type === 'ConditionalExpression') {
    const c = lit(e.consequent), a = lit(e.alternate);
    // BOTH sides must be readable; one readable side is how the other got erased.
    if (c === undefined || a === undefined) return null;
    return { testStart: e.test.start, testEnd: e.test.end, whenTrue: c, whenFalse: a, node: e };
  }
  if (e?.type === 'LogicalExpression' && e.operator === '&&' && lit(e.right) !== undefined) {
    return { testStart: e.left.start, testEnd: e.left.end, whenTrue: e.right.value, whenFalse: '', node: e };
  }
  return null;
}

const stats = { changed: 0, pairs: 0, refused: 0, lostGuard: 0 };
const newKeys = new Map();
const refused = [];

function run(abs) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (shared.isOwnerScreen(rel)) return;
  const src = fs.readFileSync(abs, 'utf8');
  let ast;
  try { ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript', 'classProperties'] }); } catch { return; }

  const ns = namespaceFor(rel);
  const edits = [];
  const hookFor = new Map();
  let hasImport = /from\s+['"]react-i18next['"]/.test(src);

  traverse(ast, {
    JSXElement(p) {
      if (!shared.isTextComponentName(elementName(p.node.openingElement))) return;
      const kids = p.node.children ?? [];
      if (kids.length < 2) return;

      let hasText = false, tern = null, ternCount = 0;
      const parts = [];
      const vars = new Map();
      const used = new Set();

      for (const c of kids) {
        if (c.type === 'JSXText') {
          const v = decode(c.value).replace(/\s+/g, ' ');
          if (v.trim()) hasText = true;
          parts.push({ k: 't', v });
          continue;
        }
        if (c.type !== 'JSXExpressionContainer') return;
        const e = c.expression;
        if (e?.type === 'JSXEmptyExpression') { parts.push({ k: 't', v: '' }); continue; }
        const tb = textBranches(e);
        if (tb) { ternCount++; tern = tb; parts.push({ k: 'tern' }); hasText = true; continue; }
        // A conditional carrying prose we cannot fully read: refuse the whole element loudly.
        if ((e?.type === 'ConditionalExpression' &&
             [e.consequent, e.alternate].some((b) => b?.type === 'StringLiteral' || b?.type === 'TemplateLiteral')) ||
            (e?.type === 'LogicalExpression' && e.right?.type === 'TemplateLiteral')) {
          return refuseIt(p, kids, src, rel);
        }
        const exprSrc = src.slice(e.start, e.end);
        let name = deriveName(exprSrc);
        while (used.has(name) && vars.get(name) !== exprSrc) name = /\d$/.test(name) ? name.replace(/\d+$/, (d) => String(+d + 1)) : `${name}2`;
        used.add(name); vars.set(name, exprSrc);
        parts.push({ k: 'v', name });
      }

      if (!tern || !hasText) return;
      if (ternCount > 1) return refuseIt(p, kids, src, rel);

      const build = (branch) => parts.map((x) =>
        x.k === 't' ? x.v : x.k === 'v' ? `{{${x.name}}}` : (branch ?? '')).join('').replace(/\s+/g, ' ').trim();
      const tText = build(tern.whenTrue);
      const fText = build(tern.whenFalse);
      if (tText === fText) return;
      const prose = (s2) => /[A-Za-z]{2}/.test(s2.replace(/\{\{\w+\}\}/g, ' '));
      if (!prose(tText) && !prose(fText)) return;

      const fn = p.getFunctionParent();
      if (!fn || fn.node.body.type !== 'BlockStatement' || isInsideClass(fn)) return refuseIt(p, kids, src, rel);
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
      const mk = (text, hint) => {
        const base = `${ns}.${section}.${slugFor(text) || hint}`;
        let k = base, n = 2;
        while (newKeys.has(k) && newKeys.get(k) !== text) k = `${base}_${n++}`;
        newKeys.set(k, text);
        return k;
      };
      const args = [...vars.entries()].map(([k, v]) => (k === v ? k : `${k}: ${v}`));
      const argStr = args.length ? `, { ${args.join(', ')} }` : '';
      const testSrc = src.slice(tern.testStart, tern.testEnd);
      /**
       * AN EMPTY BRANCH IS NOT A TRANSLATABLE STRING. Where one side of the ternary renders nothing
       * — `{cond ? '' : 'Tap a golfer…'}` — the first version minted a key for it anyway and got
       * `dashboard.text.text = ''`: a key whose name says nothing, whose value is nothing, and which
       * a translator would be asked to translate. Emit the empty string literally instead.
       */
      const side = (text, hint) => (text.trim() ? `t(${jsString(mk(text, hint))}${argStr})` : `''`);
      edits.push({
        s: kids[0].start, e: kids[kids.length - 1].end,
        t: `{${testSrc} ? ${side(tText, 'variant_a')} : ${side(fText, 'variant_b')}}`,
      });
      stats.pairs++;
    },
  });

  if (!edits.length) return;
  for (const [, at] of hookFor) edits.push({ s: at, e: at, t: `\n  const { t } = useTranslation();` });
  if (!hasImport) {
    let lastEnd = 0;
    for (const n of ast.program.body) if (n.type === 'ImportDeclaration') lastEnd = n.end;
    edits.push({ s: lastEnd, e: lastEnd, t: `\nimport { useTranslation } from 'react-i18next';` });
  }
  edits.sort((a, b) => (b.s - a.s) || (b.e - a.e));
  let out = src;
  for (const ed of edits) out = out.slice(0, ed.s) + ed.t + out.slice(ed.e);

  /**
   * NO SENTENCE MAY DISAPPEAR. Compiling is not proof: the previous version of this pass wrote
   * valid TypeScript that silently deleted a paragraph from Settings, because it read one branch of
   * a ternary as "renders nothing" when it simply could not parse it.
   *
   * So every run of prose in the ORIGINAL must still be reachable afterwards — either still present
   * in the source, or now held in a key this pass is about to write. If any is not, the file is left
   * untouched and the element is reported instead. A codemod that cannot prove it kept the words has
   * no business editing the file.
   */
  const norm = (x) => x.replace(/\s+/g, ' ').replace(/^[^A-Za-z]+|[^A-Za-z.!?]+$/g, '').trim().toLowerCase();
  const proseOf = (text) => (text.match(/[A-Za-z][A-Za-z' ,.\-]{14,}/g) ?? [])
    .map(norm).filter((x) => x.split(' ').length >= 4);
  const before = new Set(proseOf(src));
  const afterHay = norm(out + ' ' + [...newKeys.values()].join(' '));
  const lost = [...before].filter((x) => !afterHay.includes(x));
  if (lost.length) {
    stats.lostGuard++;
    refused.push({ file: rel, line: 0, text: `REFUSED WHOLE FILE — rewrite would have dropped: ${lost[0].slice(0, 90)}` });
    return;
  }

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

for (const f of [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))].sort()) run(f);

if (WRITE && newKeys.size) {
  const en = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));
  let added = 0;
  for (const [dotted, value] of newKeys) {
    const ps = dotted.split('.');
    let node = en;
    for (let i = 0; i < ps.length - 1; i++) {
      if (typeof node[ps[i]] !== 'object' || node[ps[i]] === null) node[ps[i]] = {};
      node = node[ps[i]];
    }
    const leaf = ps[ps.length - 1];
    if (!(leaf in node)) { node[leaf] = value; added++; }
  }
  fs.writeFileSync(EN_PATH, `${JSON.stringify(en, null, 2)}\n`, 'utf8');
  console.log(`en.json: +${added}`);
}
console.log(JSON.stringify({ mode: WRITE ? 'WRITE' : 'DRY', ...stats, newKeys: newKeys.size }, null, 2));
fs.writeFileSync(path.join(ROOT, 'scripts/codemod/.i18n-refused.json'), JSON.stringify(refused, null, 2));
