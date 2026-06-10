/**
 * A1 — i18n string-extraction AUDIT (read-only).
 *
 * Heuristic scan of app/ + components/ for user-facing static strings that are
 * NOT yet localized (not wrapped in t()). Produces a scope estimate so we can
 * size Track A (UI localization) before committing to it. Run:
 *   npx tsx scripts/audit/i18nAudit.ts
 *
 * It is a HEURISTIC (regex, not a real JSX parser): counts are an estimate with
 * some false positives/negatives, but the relative scope + top offenders are
 * reliable enough to plan from.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOTS = ['app', 'components'];
const exts = new Set(['.tsx']);

function walk(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(p, out);
    } else if (exts.has(path.extname(entry.name))) {
      out.push(p);
    }
  }
}

// JSX text node: text between > and < that contains a run of letters and is not
// an expression. Require a leading capital or a space-separated phrase to skip
// stray lowercase fragments / single tokens.
const RX_JSX_TEXT = />\s*([A-Z][^<>{}\n]{2,}|[^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]* [^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*)\s*</g;
// Localizable string props.
const RX_PROP = /\b(title|label|placeholder|accessibilityLabel|header|subtitle|message|heading|cta|hint|caption|sub)\s*=\s*["']([^"']*[A-Za-z]{2,}[^"']*)["']/g;
// Alert / toast string args.
const RX_ALERT = /(Alert\.alert|\.show)\(\s*["']([^"']*[A-Za-z]{3,}[^"']*)["']/g;

// Filters to drop obvious non-copy.
function isLikelyCopy(s: string): boolean {
  const t = s.trim();
  if (t.length < 3) return false;
  if (/^[a-z_]+$/.test(t)) return false;          // enum-ish token e.g. 'left'
  if (/^[A-Z0-9_]+$/.test(t)) return false;       // CONSTANT
  if (/^#?[0-9a-fA-F]{3,8}$/.test(t)) return false; // color
  if (/^https?:\/\//.test(t)) return false;       // url
  if (/^[\d\s.,:/%+-]+$/.test(t)) return false;    // numbers/units only
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  return true;
}

type FileStat = { file: string; jsx: number; props: number; alerts: number; usesT: boolean; total: number };

const files: string[] = [];
for (const r of ROOTS) { if (fs.existsSync(r)) walk(r, files); }

const stats: FileStat[] = [];
let totalJsx = 0, totalProps = 0, totalAlerts = 0, filesWithT = 0;

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const usesT = /useTranslation|[^A-Za-z]t\(['"`]/.test(src);
  if (usesT) filesWithT++;

  let jsx = 0, props = 0, alerts = 0;
  let m: RegExpExecArray | null;
  RX_JSX_TEXT.lastIndex = 0;
  while ((m = RX_JSX_TEXT.exec(src))) { if (isLikelyCopy(m[1])) jsx++; }
  RX_PROP.lastIndex = 0;
  while ((m = RX_PROP.exec(src))) { if (isLikelyCopy(m[2])) props++; }
  RX_ALERT.lastIndex = 0;
  while ((m = RX_ALERT.exec(src))) { if (isLikelyCopy(m[2])) alerts++; }

  const total = jsx + props + alerts;
  totalJsx += jsx; totalProps += props; totalAlerts += alerts;
  if (total > 0 || usesT) stats.push({ file: f, jsx, props, alerts, usesT, total });
}

stats.sort((a, b) => b.total - a.total);
const grandTotal = totalJsx + totalProps + totalAlerts;

console.log('\n===== i18n STRING AUDIT (heuristic estimate) =====\n');
console.log(`Files scanned (app/ + components/ .tsx):  ${files.length}`);
console.log(`Files already using t()/useTranslation:  ${filesWithT}  (${Math.round((filesWithT / files.length) * 100)}%)`);
console.log(`Files with at least one hardcoded string: ${stats.filter(s => s.total > 0).length}`);
console.log('');
console.log(`Estimated hardcoded user-facing strings:  ~${grandTotal}`);
console.log(`   • JSX text nodes:   ~${totalJsx}`);
console.log(`   • String props:     ~${totalProps}  (title/label/placeholder/etc.)`);
console.log(`   • Alert/toast args: ~${totalAlerts}`);
console.log('');
console.log('TOP 25 FILES BY HARDCODED-STRING COUNT:');
for (const s of stats.slice(0, 25)) {
  console.log(`  ${String(s.total).padStart(4)}  ${s.usesT ? '[t✓]' : '    '}  ${s.file}  (jsx ${s.jsx}, props ${s.props}, alerts ${s.alerts})`);
}
console.log('\nNote: heuristic — expect ±15-20%. Use for SCOPE/PRIORITY, not exact counts.\n');
