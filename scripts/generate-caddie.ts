#!/usr/bin/env tsx
/**
 * 2026-05-25 — D-ID caddie clip generator (CLI).
 *
 * Usage:
 *   npm run kevin -- <slot> "<script text>"
 *   # or generic:
 *   npm run caddie -- <caddie> <slot> "<script text>"
 *   # or directly:
 *   tsx --env-file=.env.local scripts/generate-caddie.ts kevin tee "Welcome to the tee box."
 *
 * Flow:
 *   1. Validates D-ID API key from .env.local.
 *   2. Picks presenter: D_ID_{CADDIE}_PRESENTER_ID env var if set,
 *      else STOCK source_url fallback (Alice — clearly NOT the caddie,
 *      lets you validate the pipeline without a custom presenter set up).
 *   3. POSTs /talks with the script text + presenter or source_url.
 *   4. Polls /talks/{id} every 2s until status=done OR error OR timeout.
 *   5. Downloads result mp4 to assets/caddie/{caddie}/{slot}.mp4.
 *
 * Idempotent on output: overwrites existing slot file (regeneration is
 * the point). Source files untouched.
 *
 * Env (.env.local):
 *   D_ID_API_KEY=...                  (required)
 *   D_ID_KEVIN_PRESENTER_ID=...       (optional — when set, uses your custom Kevin)
 *
 * TTS provider: Microsoft Azure (en-US-GuyNeural) via D-ID. 2026-06-04 —
 * the ElevenLabs branch was removed when ElevenLabs left the runtime
 * voice pipeline. To restore a richer voice here, update the provider
 * call to use the api/voice endpoint pattern (OpenAI TTS via our server)
 * and feed the resulting audio into D-ID's source_url instead.
 *
 * Never hardcodes the API key. Reads only from process.env.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const DID_BASE = 'https://api.d-id.com';
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 60; // 2 minutes

// 2026-05-25 — Per-caddie portrait fallback via public GitHub raw URLs.
// The repo is public; the existing assets/avatars/*_portrait.* files
// are already valid D-ID source_urls — no D-ID Studio presenter setup
// required to get caddie-specific faces. When D_ID_{CADDIE}_PRESENTER_ID
// is set in .env.local, that takes precedence (lets you swap in a
// custom D-ID Studio presenter later). When NEITHER env var nor a
// known portrait exists, falls through to ALICE as a last resort so
// the pipeline still produces SOMETHING and the error is visible.
const REPO_RAW_BASE = 'https://raw.githubusercontent.com/tgustafson75-sketch/smartplay/main/assets/avatars';
const CADDIE_PORTRAIT_URLS: Record<string, string> = {
  kevin:  `${REPO_RAW_BASE}/kevin_portrait.jpg`,
  serena: `${REPO_RAW_BASE}/serena_portrait.jpg`,
  tank:   `${REPO_RAW_BASE}/tank_portrait.png`,
  harry:  `${REPO_RAW_BASE}/harry_portrait.png`,
};
const ALICE_FALLBACK_URL = 'https://d-id-public-bucket.s3.us-west-2.amazonaws.com/alice.jpg';

interface CreateTalkResponse { id: string }
interface PollTalkResponse {
  id: string;
  status: 'created' | 'started' | 'done' | 'error' | 'rejected';
  result_url?: string;
  error?: { description?: string; kind?: string };
}

function fatal(msg: string): never {
  console.error(`[did] ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [, , caddieArg, slotArg, ...textParts] = process.argv;
  const scriptText = textParts.join(' ').trim();

  if (!caddieArg || !slotArg || !scriptText) {
    fatal(
      'Usage: npm run kevin -- <slot> "<script text>"\n' +
      '   or: tsx --env-file=.env.local scripts/generate-caddie.ts <caddie> <slot> "<script text>"',
    );
  }

  const caddie = caddieArg.toLowerCase();
  const slot = slotArg.toLowerCase();

  const apiKey = process.env.D_ID_API_KEY;
  if (!apiKey) fatal('Missing D_ID_API_KEY in .env.local — add it then retry.');

  const presenterEnvKey = `D_ID_${caddie.toUpperCase()}_PRESENTER_ID`;
  const presenterId = process.env[presenterEnvKey];

  // 2026-06-04 — ElevenLabs removed from runtime voice pipeline. The
  // D-ID provider branch that used D_ID_*_VOICE_ID env vars to route
  // through ElevenLabs is gone; Microsoft Azure is the only D-ID
  // provider this script now uses. To re-enable a richer voice
  // provider here, update the provider call below to use the api/voice
  // endpoint pattern (OpenAI TTS via our own server) and feed the
  // resulting audio into D-ID's audio source_url path instead of
  // letting D-ID render the TTS itself.

  // D-ID auth: Basic with apiKey:''
  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

  console.log(`[did] creating talk: caddie=${caddie} slot=${slot}`);
  console.log(`[did] script: "${scriptText.slice(0, 80)}${scriptText.length > 80 ? '…' : ''}"`);

  // Resolve the face: explicit presenter_id env var wins, else the
  // per-caddie public portrait URL from GitHub, else Alice last-resort.
  const portraitUrl = CADDIE_PORTRAIT_URLS[caddie] ?? null;
  if (!presenterId && portraitUrl) {
    console.log(`[did] ${presenterEnvKey} not set — using public portrait: ${portraitUrl}`);
  } else if (!presenterId && !portraitUrl) {
    console.warn(
      `[did] ⚠️  no ${presenterEnvKey} and no known portrait for "${caddie}" — ` +
      `falling back to Alice (output will NOT look like ${caddie}).`,
    );
  }

  // ── 1. CREATE TALK ─────────────────────────────────────────────────
  // Build either a presenter-based or source_url-based request body.
  // Both produce the same response shape; only the input differs.
  const scriptBlock = {
    type: 'text' as const,
    input: scriptText,
    provider: { type: 'microsoft' as const, voice_id: 'en-US-GuyNeural' },
  };
  const createBody = presenterId
    ? {
        presenter_id: presenterId,
        script: scriptBlock,
        config: { fluent: true, pad_audio: 0.0, stitch: true },
      }
    : {
        source_url: portraitUrl ?? ALICE_FALLBACK_URL,
        script: scriptBlock,
        config: { fluent: true, pad_audio: 0.0, stitch: true },
      };

  const createRes = await fetch(`${DID_BASE}/talks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(createBody),
  });
  if (!createRes.ok) {
    const errBody = await createRes.text();
    fatal(`create /talks failed (${createRes.status}): ${errBody.slice(0, 400)}`);
  }
  const { id } = (await createRes.json()) as CreateTalkResponse;
  if (!id) fatal('create /talks succeeded but returned no id');
  console.log(`[did] talk created: id=${id} — polling for completion`);

  // ── 2. POLL UNTIL DONE ─────────────────────────────────────────────
  let resultUrl: string | null = null;
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`${DID_BASE}/talks/${id}`, { headers: { Authorization: auth } });
    if (!pollRes.ok) {
      console.log(`[did] poll ${i + 1}: HTTP ${pollRes.status} — retrying`);
      continue;
    }
    const data = (await pollRes.json()) as PollTalkResponse;
    if (data.status === 'done' && data.result_url) {
      resultUrl = data.result_url;
      break;
    }
    if (data.status === 'error' || data.status === 'rejected') {
      fatal(`talk ${data.status}: ${data.error?.description ?? '(no description)'}`);
    }
    process.stdout.write('.');
  }
  if (!resultUrl) fatal(`timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
  console.log(`\n[did] done — downloading from ${resultUrl}`);

  // ── 3. DOWNLOAD MP4 ────────────────────────────────────────────────
  const videoRes = await fetch(resultUrl);
  if (!videoRes.ok) fatal(`download failed: HTTP ${videoRes.status}`);
  const buffer = Buffer.from(await videoRes.arrayBuffer());

  // ── 4. WRITE TO ASSETS DIR ─────────────────────────────────────────
  const outDir = join(process.cwd(), 'assets', 'caddie', caddie);
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${slot}.mp4`);
  await writeFile(outPath, buffer);

  console.log(`Done: ${caddie}/${slot}.mp4 ready (${buffer.length.toLocaleString()} bytes)`);
}

main().catch((e: unknown) => {
  console.error('[did] script failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
