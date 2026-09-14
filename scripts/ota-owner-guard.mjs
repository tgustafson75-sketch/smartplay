#!/usr/bin/env node
/**
 * ota-owner-guard — refuse a PRODUCTION OTA while owner mode is switched on locally.
 *
 * 2026-09-13. Tim asked whether he could publish the day's work to see it on his phone. Checking which
 * channel his app listens to turned up the problem: every EAS build on this project is
 * `profile=production / channel=production`, including the Play Store INTERNAL TESTING build he has
 * installed. So `npm run ota:production` is the only command his app ever sees — and that bundle reaches
 * every user on that channel.
 *
 * THE HAZARD. `app/_layout.tsx` computes
 *
 *     isOwner: isOwnerEmail(profileEmail) || (EXPO_PUBLIC_OWNER_EMAIL ?? '').trim().length > 0
 *
 * so ANY non-empty value makes the BUNDLE an owner bundle: Owner Tools on every player's Settings screen
 * and `grantLifetime` for everyone, which bypasses billing entirely and persists to disk before anyone
 * notices. eas.json deliberately keeps that variable off every release BUILD profile, and a test asserts
 * it — but `eas update` exports LOCALLY, so a value in `.env.local` is inlined into the published bundle
 * and walks straight around that protection. Proved on 2026-09-13 with a sentinel export: a value
 * present nowhere in the source appeared in the exported Hermes bundle.
 *
 * This is the same defect as the `OWNER_EMAILS.length === 1` landmine removed earlier that day, arriving
 * through a different door — and I opened this one myself by telling Tim to create `.env.local`. A rule
 * that lives only in a comment is a rule that depends on remembering. This makes the machine enforce it.
 *
 * Wired into `ota:production` only. A preview/development OTA may legitimately carry owner mode, because
 * those channels are Tim's own builds.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VAR = 'EXPO_PUBLIC_OWNER_EMAIL';

/**
 * Every source Expo itself would read, in its precedence order. Checked by parsing rather than by
 * importing @expo/env, so the guard cannot be defeated by that package being absent or changing.
 */
const ENV_FILES = ['.env.local', '.env.development.local', '.env.production.local', '.env'];

function valueFrom(file) {
  const abs = join(root, file);
  if (!existsSync(abs)) return null;
  for (const line of readFileSync(abs, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;                 // a commented line is OFF
    const m = /^(?:export\s+)?([A-Z_0-9]+)\s*=\s*(.*)$/.exec(t);
    if (!m || m[1] !== VAR) continue;
    const raw = m[2].trim().replace(/^['"]|['"]$/g, '').trim();
    if (raw.length > 0) return { file, value: raw };
  }
  return null;
}

const sources = [];
if ((process.env[VAR] ?? '').trim().length > 0) {
  sources.push({ file: 'the shell environment', value: process.env[VAR].trim() });
}
for (const f of ENV_FILES) {
  const hit = valueFrom(f);
  if (hit) sources.push(hit);
}

if (sources.length === 0) {
  console.log(`[ota-owner-guard] ${VAR} is not set. Safe to publish to production.`);
  process.exit(0);
}

const redact = (v) => (v.length <= 4 ? '***' : `${v.slice(0, 2)}***${v.slice(-2)}`);
console.error(`
  PRODUCTION OTA REFUSED — owner mode is switched on locally.

  ${VAR} is set in:
${sources.map((s) => `    • ${s.file}  (${redact(s.value)})`).join('\n')}

  \`eas update\` bundles LOCALLY, so that value would be inlined into the published bundle. And
  app/_layout.tsx treats ANY non-empty value as owner:

      isOwner: isOwnerEmail(profileEmail) || (${VAR} ?? '').trim().length > 0

  Publishing it to the production channel would give EVERY user Owner Tools and a lifetime grant,
  bypassing billing — persisted to disk before anyone noticed. eas.json keeps this variable off every
  release BUILD profile for exactly that reason; an OTA exported locally walks around that.

  To publish: comment the line out (or unset the shell variable), then re-run.
  To keep owner mode for a local run: use a development/preview build, not a production OTA.

  There is no override flag.
`);
process.exit(1);
