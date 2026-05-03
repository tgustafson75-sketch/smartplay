#!/usr/bin/env node
/**
 * Generate the 12 pre-rendered Kevin greeting audio files.
 *
 * Run once after writing or after Kevin's voice config changes:
 *   npm run generate:greetings
 *
 * The output mp3s live at assets/audio/greetings/ and ARE committed
 * to the repo — they ship with the app bundle.
 *
 * TTS:
 *   model:       gpt-4o-mini-tts
 *   voice:       onyx                (canonical Kevin, see api/_kevinVoice.ts)
 *   instructions: KEVIN_TTS_INSTRUCTIONS (also from api/_kevinVoice.ts)
 *   format:      mp3
 *
 * Sequential, 200ms inter-call delay, single retry on failure. Sanity-
 * checks every output file is between 5 KB and 500 KB.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'assets', 'audio', 'greetings');

// ─── Load .env so OPENAI_API_KEY is available without external dotenv ────────

function loadEnv() {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY missing from environment / .env');
  process.exit(1);
}

// ─── Kevin canonical voice (mirrored from api/_kevinVoice.ts) ────────────────

const KEVIN_TTS_VOICE = 'onyx';
const KEVIN_TTS_INSTRUCTIONS =
  "Warm, calm, and conversational — like a seasoned caddie who genuinely cares. " +
  "Never preachy or performatively enthusiastic. Measured pace, slight forward lean " +
  "on key words. When encouraging, sound like you mean it. When delivering facts, " +
  "plain and direct. Never melancholy. Family-appropriate in all contexts.";

// ─── The canon — exact strings, no edits ─────────────────────────────────────

const LINES = [
  ['universal_01.mp3',  "Welcome back. Let's play some golf."],
  ['universal_02.mp3',  'There you are. Ready when you are.'],
  ['universal_03.mp3',  "Good to see you. Let's do this."],
  ['morning_01.mp3',    'Early start today — I like it.'],
  ['morning_02.mp3',    'Morning. Course is calling.'],
  ['evening_01.mp3',    "Squeezing in a late round? Let's go."],
  ['evening_02.mp3',    "Evening light's the best light. Let's play."],
  ['weekend_01.mp3',    'Saturday golf is the right kind of golf.'],
  ['weekend_02.mp3',    'Weekend round. My favorite kind.'],
  ['first_launch.mp3',  "Welcome to SmartPlay Caddie. I'm Kevin — your golf companion. Let's play some golf."],
  ['returning.mp3',     "Been a minute. Glad you're back."],
  ['demo_mode.mp3',     "Welcome to SmartPlay Caddie. I'm Kevin — your AI golf companion."],
];

const MIN_BYTES = 5 * 1024;
const MAX_BYTES = 500 * 1024;
const INTER_CALL_DELAY_MS = 200;

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// ─── Single OpenAI TTS call ──────────────────────────────────────────────────

async function ttsOnce(text) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: KEVIN_TTS_VOICE,
      input: text,
      instructions: KEVIN_TTS_INSTRUCTIONS,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '<unreadable>');
    throw new Error(`OpenAI ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function ttsWithRetry(text) {
  try {
    return await ttsOnce(text);
  } catch (e) {
    console.warn('   ↻ retry after error:', e.message);
    await new Promise(r => setTimeout(r, INTER_CALL_DELAY_MS));
    return await ttsOnce(text);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const failed = [];
let totalBytes = 0;

console.log(`Generating ${LINES.length} Kevin greetings → ${OUT_DIR}`);
console.log(`Voice: ${KEVIN_TTS_VOICE}, model: gpt-4o-mini-tts\n`);

for (const [filename, text] of LINES) {
  const outPath = join(OUT_DIR, filename);
  try {
    const buf = await ttsWithRetry(text);
    writeFileSync(outPath, buf);
    const size = statSync(outPath).size;
    totalBytes += size;
    if (size < MIN_BYTES || size > MAX_BYTES) {
      console.warn(`   ⚠ ${filename} size ${(size / 1024).toFixed(1)}KB out of [${MIN_BYTES / 1024}, ${MAX_BYTES / 1024}]KB sanity bounds`);
      failed.push(filename + ' (size out of bounds)');
    } else {
      console.log(`   ✓ ${filename}  (${(size / 1024).toFixed(1)} KB)`);
    }
  } catch (e) {
    console.error(`   ✗ ${filename}  FAILED: ${e.message}`);
    failed.push(filename);
  }
  await new Promise(r => setTimeout(r, INTER_CALL_DELAY_MS));
}

console.log(`\nTotal: ${(totalBytes / 1024).toFixed(1)} KB across ${LINES.length - failed.length} files.`);
if (failed.length > 0) {
  console.error(`Failed: ${failed.length} — ${failed.join(', ')}`);
  process.exit(1);
}
console.log('All 12 greetings generated successfully.');
