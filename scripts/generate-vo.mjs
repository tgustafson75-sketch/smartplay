#!/usr/bin/env node
/**
 * One-off marketing voiceover generator.
 *
 * Uses the SAME OpenAI account + key the app already uses
 * (process.env.OPENAI_API_KEY, loaded from .env.local — same source of
 * truth as api/voice.ts). Reuses the `openai` npm package already in
 * package.json. Model is gpt-4o-mini-tts, matching what the app falls
 * back to for OpenAI TTS so the brand voice and the marketing voice
 * come from one consistent source.
 *
 * Generates the narration in THREE voices so Tim can pick by ear, then
 * drops the MP3s on ~/Desktop. If ~/Desktop isn't writable, falls back
 * to ./vo-output/ and prints the path.
 *
 * Run: node scripts/generate-vo.mjs
 */

import { promises as fs, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── Load OPENAI_API_KEY the same way the app does ──────────────────
// api/voice.ts reads process.env.OPENAI_API_KEY directly (populated by
// Vercel for prod, by .env.local for dev). Mirror that here: prefer an
// already-exported env var, otherwise parse .env.local exactly as the
// Vercel CLI does (KEY=VALUE, optionally quoted).
function loadEnvLocal() {
  if (process.env.OPENAI_API_KEY) return;
  const envPath = path.join(PROJECT_ROOT, '.env.local');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('[generate-vo] OPENAI_API_KEY not set and not present in .env.local — aborting.');
  process.exit(1);
}
console.log(`[generate-vo] using OPENAI_API_KEY tail ****${apiKey.slice(-4)}`);

// ─── Style + content ─────────────────────────────────────────────────
const STYLE_INSTRUCTIONS =
  'Confident, warm, premium sports-brand narrator. Measured pace, a slight beat between sentences, like a polished ad. Not hyper, not salesy.';

// Long form — the 60-second narration used for the main social cut.
// 2026-05-27 — corrected: SmartMotion called out by name in the swing
// line so the feature gets product-name recognition in the voiceover.
const NARRATION_LONG = `Every golfer has had that thought standing on the tee — I wish I had a caddie. Someone who knows the yardage, calls the club, and has your back all eighteen.

That's SmartPlay Caddie. An AI caddie that lives in your pocket. Real-time, on-course intelligence — from the first tee to the last putt.

Step onto any hole and you get the real numbers: front, middle, and back of the green. Drag your target, see your carry, and plan the shot before you ever swing.

And you don't tap through menus. You just talk. Ask how far. Ask what club. Ask who won the Masters in '86. Your caddie answers out loud, in real time, between every shot — and you pick from four, so you find the one that fits your game.

Out at the range? SmartMotion reads your swing — the one thing to fix, and a drill to groove it.

Playing with the crew? It runs the whole tournament — scoring, skins, closest-to-pin — so you just play.

Not just GPS. Not just a swing app. A caddie that talks back. This is SmartPlay Caddie, built by SmartPlay AI.`;

// Short form — the 30-second vertical cut for Shorts / Reels / TikTok.
const NARRATION_SHORT = `I wish I had a caddie. Every golfer's had that thought.

That's SmartPlay Caddie — an AI caddie in your pocket. Real-time, on-course intelligence.

Get every distance, front to back. Just talk to it — ask the club, ask the line. It reads your swing at the range, and runs your whole tournament when you play with the crew.

Not just GPS. A caddie that talks back. SmartPlay Caddie — built by SmartPlay AI.`;

// CLI: --short selects the 30s vertical cut. Default is the 60s long.
const useShort = process.argv.includes('--short');
const NARRATION = useShort ? NARRATION_SHORT : NARRATION_LONG;
const FILENAME_TAG = useShort ? 'short_' : '';

// gpt-4o-mini-tts supported voices: alloy, ash, ballad, coral, echo,
// fable, nova, onyx, sage, shimmer, verse. All three default voices
// are supported; no substitution needed.
//
// CLI: --voice=<name> regenerates a single voice (e.g.
// `node scripts/generate-vo.mjs --voice=onyx --short`). Useful when
// one voice from a prior batch needs a re-cut without burning quota
// on the others. Defaults to all three.
const ALL_VOICES = ['onyx', 'ash', 'sage'];
const voiceArg = process.argv.find(a => a.startsWith('--voice='));
const VOICES = voiceArg
  ? [voiceArg.slice('--voice='.length).trim().toLowerCase()].filter(Boolean)
  : ALL_VOICES;

// ─── Output location ─────────────────────────────────────────────────
async function pickOutputDir() {
  const desktop = path.join(os.homedir(), 'Desktop');
  try {
    await fs.access(desktop);
    // Probe writability by opening a temp file handle.
    const probe = path.join(desktop, `.smartplay-vo-probe-${Date.now()}`);
    await fs.writeFile(probe, '');
    await fs.unlink(probe);
    return desktop;
  } catch {
    const fallback = path.join(PROJECT_ROOT, 'vo-output');
    await fs.mkdir(fallback, { recursive: true });
    console.log(`[generate-vo] ~/Desktop unwritable — using fallback: ${fallback}`);
    return fallback;
  }
}

// ─── Generate ────────────────────────────────────────────────────────
const { default: OpenAI } = await import('openai');
const openai = new OpenAI({ apiKey });

const outDir = await pickOutputDir();
console.log(`[generate-vo] output dir: ${outDir}`);
console.log(`[generate-vo] model: gpt-4o-mini-tts`);
console.log(`[generate-vo] voices: ${VOICES.join(', ')}`);
console.log(`[generate-vo] narration: ${NARRATION.length} chars`);

const results = [];
for (const voice of VOICES) {
  const filename = `SmartPlay_VO_${FILENAME_TAG}${voice}.mp3`;
  const fullPath = path.join(outDir, filename);
  console.log(`\n[generate-vo] → ${voice} …`);
  const t0 = Date.now();
  const mp3 = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice,
    input: NARRATION,
    instructions: STYLE_INSTRUCTIONS,
    response_format: 'mp3',
  });
  const buf = Buffer.from(await mp3.arrayBuffer());
  await fs.writeFile(fullPath, buf);
  const dtSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[generate-vo]   wrote ${fullPath} (${buf.length.toLocaleString()} bytes, ${dtSec}s)`);
  results.push({ voice, fullPath, bytes: buf.length });
}

console.log('\n[generate-vo] ── done ─────────────────────────────────');
for (const r of results) {
  console.log(`  ${r.voice.padEnd(8)} ${r.fullPath}  (${r.bytes.toLocaleString()} bytes)`);
}
